#!/usr/bin/env python3
"""Verify first-run native library selection and normal Quit with owned fixtures."""
import argparse
import importlib.util
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import traceback
import unittest
from unittest.mock import Mock, patch


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
smoke = load_module("chooser_smoke", ROOT / "smoke-native.py")
linux = load_module("chooser_linux", ROOT / "native_dialog_linux.py")
boundary = load_module("chooser_boundary", ROOT / "native_boundary_fixture.py")


def first_run_environment(inherited, config):
    env = smoke.real_app_environment(inherited, Path("unused"), config)
    env["XDG_DATA_HOME"] = str(config.parent / "data")
    env["XDG_CACHE_HOME"] = str(config.parent / "cache")
    for key in ("IBIS_LIBRARY", "IBIS_GALLERY_READY_FILE"):
        env.pop(key, None)
    return env


def claim_owned_settings(candidate):
    # Path.exists() alone misses dangling links. Never claim or later remove
    # an existing preference link, even when its destination is absent.
    if any(candidate.with_suffix(suffix).is_symlink() for suffix in (".json", ".json.bak", ".json.tmp")):
        raise smoke.Unavailable("Use a disposable desktop account without existing Ibis settings")
    return smoke.claim_settings(candidate)


def flags(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys) or any(type(value[key]) is not bool for key in keys):
        raise AssertionError("Native chooser state must contain exact boolean fields")
    return value


def ready(value):
    return all(flags(value, ("visible", "foreground", "owned")).values())


def saved_bibtex_library(settings, expected):
    def unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("Duplicate settings field")
            value[key] = item
        return value
    try:
        value = json.loads(settings.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
        if not isinstance(value, dict) or type(value.get("schema_version")) is not int or value["schema_version"] != 2:
            return False
        choice = value.get("library")
        if not isinstance(choice, dict) or set(choice) != {"bibtex"}:
            return False
        path = choice["bibtex"]
        return (isinstance(path, str) and bool(path) and "\x00" not in path
                and Path(path).is_absolute() and Path(path).samefile(expected))
    except (OSError, ValueError, TypeError):
        return False


WINDOWS_LOCATION_FIELDS = (
    "owned_before", "foreground_before", "owned_after", "foreground_after", "gui_available", "gui_idle",
    "focus_live", "focus_visible", "focus_enabled", "focus_same_pid", "focus_same_thread", "focus_edit", "focus_descendant",
    "ancestry_reaches_dialog", "filename_id", "uia_unique_edit", "uia_owned", "uia_visible", "uia_enabled", "uia_filename", "native_ready", "uia_ready",
)
WINDOWS_KEYBOARD_FIELDS = (
    "available", "owned_picker", "native_child_focus", "unique_search", "unique_results",
    "direct_search_focus", "controller_for_results", "controlled_results_focus", "ready",
)


def windows_keyboard_state(value):
    value = flags(value, WINDOWS_KEYBOARD_FIELDS)
    expected = (value["available"] and value["owned_picker"] and value["native_child_focus"] and value["unique_search"]
                and (value["direct_search_focus"] or (value["unique_results"] and value["controller_for_results"]
                                                     and value["controlled_results_focus"])))
    if value["ready"] is not expected:
        raise AssertionError("Native keyboard evidence is inconsistent")
    return value


WINDOWS_NATIVE_OBSERVATION_FIELDS = (
    "exception", "owned", "gui_available", "gui_idle", "active_picker", "focus_present", "focus_is_picker",
    "focus_live", "focus_visible", "focus_strict_child", "focus_pid_matches", "focus_thread_matches",
)
WINDOWS_UIA_OBSERVATION_FIELDS = (
    "exception", "root_identity", "enumeration_complete", "search_owned", "results_owned", "focused_present", "focused_owned",
    "focused_is_search", "focused_is_results", "focused_is_picker", "final_focus_same", "final_owned",
    "ownership_pid_mismatch", "ownership_offscreen", "ownership_disabled", "ownership_walk_failed",
)


def windows_keyboard_observation(value):
    # These optional facts only explain a failed predicate. They never authorize
    # typing, and malformed diagnostics must not replace the original error.
    if (not isinstance(value, dict) or set(value) != {"native_before", "native_after", "focus_stable", "uia"}
            or type(value["focus_stable"]) is not bool):
        return None
    result = {"focus_stable": value["focus_stable"]}
    for section in ("native_before", "native_after", "uia"):
        uia = section == "uia"
        fields = WINDOWS_UIA_OBSERVATION_FIELDS if uia else WINDOWS_NATIVE_OBSERVATION_FIELDS
        counts = ("search_matches", "results_matches") if uia else ()
        stages = (("unobserved", "root", "enumeration", "focused", "ownership", "relation", "ancestry", "final", "complete")
                  if uia else ("unobserved", "picker", "gui", "focus", "complete"))
        observed = value[section]
        if (not isinstance(observed, dict) or set(observed) != {"stage", *fields, *counts}
                or type(observed["stage"]) is not str or observed["stage"] not in stages
                or any(type(observed[key]) is not bool for key in fields)
                or any(type(observed[key]) is not int or not 0 <= observed[key] <= 4000 for key in counts)
                or observed["stage"] == "unobserved" and any(observed[key] for key in (*fields, *counts))):
            return None
        result[section] = {key: observed[key] for key in ("stage", *fields, *counts)}
    return result


def windows_focused_nodes(current, previous_index):
    roles = {"edit": "edit", "combobox": "combobox", "button": "button", "listitem": "option", "option": "option",
             "list": "list", "text": "text", "pane": "pane", "document": "document", "window": "window"}
    def role(node):
        value = node.get("role")
        return roles.get(value.lower().replace("controltype.", "").replace(" ", ""), "other") if isinstance(value, str) else "other"
    nodes = current.get("nodes", [])
    nodes = [node for node in nodes[:4000] if isinstance(node, dict)] if isinstance(nodes, list) else []
    focused = [node for node in nodes if node.get("focused") is True]
    title = ["Ibis", "smoke", "reference", f"{previous_index:06d}"] if previous_index is not None else None
    key = f"smoke{previous_index:06d}" if previous_index is not None else None
    def known_option(node):
        name = node.get("name")
        if title is None or role(node) != "option" or not isinstance(name, str) or len(name) > 512:
            return False
        words = name.split()
        return words[:4] == title and all(value in words for value in ("Example", "2026", key))
    options = [node for node in nodes if known_option(node)]
    return {"focused_roles": sorted({role(node) for node in focused}),
            "focused_reload": any(role(node) == "button" and node.get("name") == "Reload" for node in focused),
            "focused_other_known_control": any(role(node) == "button" and node.get("name") in ("Choose library…", "Use Zotero", "Quit") for node in focused),
            "known_option_unique": len(options) == 1,
            "known_option_focused": len(options) == 1 and options[0].get("focused") is True}

MACOS_DISCOVERY_BOUNDS = {
    **dict.fromkeys(("windows", "titled_windows", "window_dialog_subroles", "window_standard_subroles", "window_subrole_unavailable"), 20),
    **dict.fromkeys(("direct_children", "direct_windows", "direct_sheets", "direct_dialog_roles", "titled_sheets", "direct_static_texts", "direct_static_title_matches"), 640),
    **dict.fromkeys(("title_unavailable", "description_unavailable", "title_empty", "title_other", "description_empty", "description_other"), 660),
}

MACOS_AX_APIS = frozenset((
    'AXUIElementCreateSystemWide', 'AXUIElementCreateApplication', 'AXUIElementGetTypeID', 'AXValueGetTypeID',
    'AXUIElementSetMessagingTimeout', 'AXUIElementGetPid', 'AXUIElementCopyAttributeValue',
    'AXUIElementGetAttributeValueCount', 'AXUIElementCopyAttributeValues', 'AXValueGetType', 'AXValueGetValue',
    'CFGetTypeID', 'CFEqual', 'CFStringGetTypeID', 'CFBooleanGetValue', 'CFBooleanGetTypeID', 'CFArrayGetTypeID',
    'CFArrayGetCount', 'CFArrayGetValueAtIndex', 'CGPointMake', 'CGSizeMake',
))
MACOS_AX_REASONS = frozenset((
    'bind-unavailable', 'call-exception', 'ax-error', 'missing-reference', 'invalid-type-id',
    'type-mismatch', 'owner-mismatch', 'budget-exceeded', 'invalid-result',
))
MACOS_READY_REASONS = frozenset((
    'registration-unavailable', 'panel-not-found', 'not-foreground', 'sheet-absent',
    'focused-control-not-ready', 'focus-outside-sheet', 'final-ownership-not-ready',
))


def absolute_executable(value):
    return isinstance(value, str) and value.startswith('/') and '\x00' not in value and len(value) <= 1024


def location_token(token, process_id, executable=None):
    def exact(value, keys):
        return isinstance(value, dict) and set(value) == set(keys)
    def positive_integer(value, maximum=0xffffffff):
        return type(value) is int and 0 < value <= maximum
    def finite(value):
        try:
            return type(value) in (int, float) and math.isfinite(value)
        except OverflowError:
            return False
    valid = exact(token, ("owner", "panel", "sheet")) and positive_integer(process_id, 0x7fffffff)
    if valid:
        owner = token["owner"]
        valid = (exact(owner, ("pid", "executable")) and positive_integer(owner["pid"], 0x7fffffff)
                 and owner["pid"] == process_id and absolute_executable(owner["executable"])
                 and (executable is None or owner["executable"] == executable))
    if valid:
        for key in ("panel", "sheet"):
            window = token[key]
            keys = ("window", "bounds") if key == "panel" else ("bounds",)
            if not exact(window, keys) or key == "panel" and not positive_integer(window["window"]):
                valid = False
                break
            bounds = window["bounds"]
            if (not exact(bounds, ("X", "Y", "Width", "Height")) or not all(finite(value) for value in bounds.values())
                    or not 0 < bounds["Width"] <= 8192 or not 0 < bounds["Height"] <= 8192):
                valid = False
                break
    if not valid:
        raise AssertionError("Native chooser location identity is invalid")
    return token


def location_identity(value, process_id, executable=None):
    if (not isinstance(value, dict) or set(value) != {"ready", "owned", "token"}
            or type(value["ready"]) is not bool or type(value["owned"]) is not bool):
        raise AssertionError("Native chooser location metadata is invalid")
    if not value["ready"]:
        if value["token"] is not None:
            raise AssertionError("Unready native chooser exposed a location identity")
        return None
    if not value["owned"]:
        raise AssertionError("Ready native chooser is not owned")
    return location_token(value["token"], process_id, executable)


def after_location(value):
    value = flags(value, ("ready", "closed"))
    if value["closed"] and not value["ready"]:
        raise AssertionError("Native chooser closure was not verified")
    return value


def helper_diagnostics(stderr):
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    if not isinstance(stderr, str):
        return []
    safe = []
    ax_reported = False
    ready_reported = False
    discovery_reported = False
    budget_reported = False
    for line in stderr[:65536].splitlines():
        prefix = next((value for value in ("NATIVE CHOOSER WINDOWS LOCATION ", "NATIVE CHOOSER WINDOWS RAW ", "NATIVE CHOOSER WINDOWS ", "NATIVE CHOOSER MACOS AX ", "NATIVE CHOOSER MACOS READY ", "NATIVE CHOOSER MACOS DISCOVERY ", "NATIVE CHOOSER MACOS BUDGET ", "NATIVE CHOOSER MACOS ") if line.startswith(value)), None)
        if prefix is None:
            continue
        try:
            def unique_fields(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError("Duplicate diagnostic field")
                    value[key] = item
                return value
            value = json.loads(line[len(prefix):], object_pairs_hook=unique_fields if prefix in ("NATIVE CHOOSER MACOS DISCOVERY ", "NATIVE CHOOSER MACOS BUDGET ") else None)
        except ValueError:
            continue
        if not isinstance(value, dict):
            continue
        if prefix == "NATIVE CHOOSER MACOS AX ":
            valid = (not ax_reported and set(value) == {'api', 'reason'}
                     and type(value['api']) is str and value['api'] in MACOS_AX_APIS
                     and type(value['reason']) is str and value['reason'] in MACOS_AX_REASONS)
            ax_reported = ax_reported or valid
        elif prefix == "NATIVE CHOOSER MACOS READY ":
            valid = (not ready_reported and set(value) == {'reason'}
                     and type(value['reason']) is str and value['reason'] in MACOS_READY_REASONS)
            ready_reported = ready_reported or valid
        elif prefix == "NATIVE CHOOSER MACOS DISCOVERY ":
            valid = (not discovery_reported and set(value) == set(MACOS_DISCOVERY_BOUNDS)
                     and all(type(count) is int and 0 <= count <= MACOS_DISCOVERY_BOUNDS[key] for key, count in value.items()))
            discovery_reported = discovery_reported or valid
        elif prefix == "NATIVE CHOOSER MACOS BUDGET ":
            valid = (not budget_reported and set(value) == {"kind", "calls", "stage"}
                     and type(value["kind"]) is str and value["kind"] in ("call-limit", "time-limit", "clock-regression")
                     and type(value["calls"]) is int and 0 <= value["calls"] <= 256
                     and type(value["stage"]) is str and value["stage"] in ("scope", "windows", "candidates", "sheets", "bounds", "location", "controls"))
            budget_reported = budget_reported or valid
        elif prefix == "NATIVE CHOOSER WINDOWS LOCATION ":
            valid = set(value) == set(WINDOWS_LOCATION_FIELDS) and all(type(item) is bool for item in value.values())
        elif prefix == "NATIVE CHOOSER MACOS ":
            valid = set(value) == {"stage"} and value["stage"] in ("identity", "scope", "windows", "metadata", "bounds", "candidates", "sheets", "location", "controls", "invoke")
        else:
            valid = (set(value) == {"stage", "reason", "matches", "enumerated", "owned", "foreground", "selector"}
                     and value["stage"] in ("startup", "assembly", "resolve", "tree", "target", "verify", "pattern", "invoke")
                     and value["reason"] in ("provider-unavailable", "picker-identity", "enumeration-bound", "dialog-ambiguous", "dialog-ownership", "owner-bound", "accessibility-identity", "tree-bound", "not-foreground", "target-unavailable", "ownership-changed")
                     and all(type(value[key]) is int and 0 <= value[key] <= 4000 for key in ("matches", "enumerated"))
                     and all(type(value[key]) is bool for key in ("owned", "foreground"))
                     and isinstance(value["selector"], dict)
                     and set(value["selector"]) == {"buttons", "exact_id", "exact_name", "offscreen", "eligible"}
                     and all(type(count) is int and 0 <= count <= 4000 for count in value["selector"].values()))
        if valid:
            safe.append(prefix + json.dumps(value, sort_keys=True))
            if len(safe) > 16:
                safe.pop(0)
    return safe


def query_ready(current, index):
    key = f"smoke{index:06d}"
    text = smoke.strings(current)
    return (any(node.get("value") == key for node in smoke.named(current, "Search references"))
            and f"Ibis smoke reference {index:06d}" in text and "1 result" in text)


def wait_for_chosen_query(snapshot, index, report):
    last = {"nodes": []}
    def matched():
        nonlocal last
        last = snapshot()
        return query_ready(last, index)
    try:
        smoke.wait_for(matched, "chosen library accepts a new query and is searchable")
    except AssertionError:
        # Classify the same observation that failed the native predicate. A
        # further provider read could describe a different state or fail too.
        report["query_failure"] = smoke.query_failure_facts(last, f"smoke{index:06d}", f"Ibis smoke reference {index:06d}")
        print("NATIVE CHOOSER QUERY FAILURE " + json.dumps(report["query_failure"]), file=sys.stderr)
        raise


def prepare_rename_query(native, snapshot, system, previous_index=None, report=None, capture_failure=None):
    native.key("Escape")
    smoke.wait_for(lambda: not snapshot()["visible"], "rename query hides picker before restoring search focus")
    native.key("ctrl+super+r" if system == "Darwin" else "ctrl+shift+y")
    current, editable, keyboard = {"nodes": []}, [], None
    def ready():
        nonlocal current, editable, keyboard
        current = snapshot()
        named = smoke.named(current, "Search references")
        editable = ([node for node in named if node.get("role", "").lower().replace(" ", "") in smoke.EDITABLE_ROLES]
                    if system == "Windows" else [])
        if system == "Windows":
            keyboard = None
            keyboard = windows_keyboard_state(current.get("keyboard"))
        focused = len(editable) == 1 and keyboard is not None and keyboard["ready"]
        return current["visible"] and current["foreground"] and bool(named) and (system != "Windows" or focused)
    try:
        smoke.wait_for(ready, "rename query shows the foreground picker before typing")
    except AssertionError:
        if system == "Windows" and report is not None:
            prior = f"smoke{previous_index:06d}" if previous_index is not None else None
            title = f"Ibis smoke reference {previous_index:06d}" if previous_index is not None else None
            facts = {"visible": current.get("visible") is True, "foreground": current.get("foreground") is True,
                     "unique_editable": len(editable) == 1,
                     "editable_focused": len(editable) == 1 and editable[0].get("focused") is True,
                     "known_result_focused": title is not None and any(node.get("focused") is True for node in smoke.named(current, title)),
                     "previous_query_unchanged": prior is not None and len(editable) == 1 and editable[0].get("value") == prior}
            report["rename_focus_failure"] = facts
            facts.update(windows_focused_nodes(current, previous_index))
            facts["keyboard_metadata_valid"] = keyboard is not None
            facts["keyboard"] = dict(keyboard) if keyboard is not None else {key: False for key in WINDOWS_KEYBOARD_FIELDS}
            observation = windows_keyboard_observation(current.get("keyboard_observation"))
            facts["keyboard_observation_valid"] = observation is not None
            if observation is not None:
                facts["keyboard_observation"] = observation
            print("NATIVE CHOOSER RENAME FOCUS FAILURE " + json.dumps(facts), file=sys.stderr)
        if system == "Windows" and capture_failure is not None:
            try:
                capture_failure()
            except Exception:
                pass # Preserve the original readiness error if observation fails.
        raise


def rename_library_roundtrip(library, settings, click, snapshot, query, prepare_query=lambda previous: None):
    original, preferences = library.read_bytes(), settings.read_bytes()
    renamed = library.with_name("renamed 引用.bib")
    assert not renamed.exists() and not renamed.is_symlink(), "Owned rename destination already exists"

    def unchanged_settings():
        # samefile cannot check the remembered path while it is missing.
        assert settings.read_bytes() == preferences, "Rename saved settings bytes changed"

    def loaded(count, index=None):
        unchanged_settings()
        current = snapshot()
        text = smoke.strings(current)
        return (f"{library.name}: {count} references" in text
                and "The library could not be opened:" not in text
                and (index is None or query_ready(current, index)))

    try:
        library.rename(renamed)
        click("Reload")

        previous = None
        def missing_explained(require_query=False):
            nonlocal previous
            unchanged_settings()
            current = snapshot()
            text = smoke.strings(current)
            state = {
                "named_old_path": f"The library could not be opened: {library.name}." in text,
                "unavailable_retention": "the library file is unavailable; keeping the last loaded references" in text,
                "recovery_action": "Choose it again or reconnect the drive." in text,
                "retained_count": f"{library.name}: 3 references" in text,
                "retained_query_zero": query_ready(current, 0),
            }
            if state != previous:
                print("NATIVE CHOOSER RENAME " + json.dumps(state), flush=True)
                previous = state
            return (all(state[key] for key in ("named_old_path", "unavailable_retention", "recovery_action", "retained_count"))
                    and (not require_query or state["retained_query_zero"]))

        smoke.wait_for(missing_explained, "renamed-away library names the missing old path and retains its snapshot")
        prepare_query(1)
        query(0)
        smoke.wait_for(lambda: missing_explained(True), "renamed-away retained query is searchable with unchanged settings")

        renamed.rename(library)
        library.write_text(smoke.fixture(5), encoding="utf-8")
        click("Reload")
        smoke.wait_for(lambda: loaded(5), "distinct recovery content replaces the retained snapshot")
        prepare_query(0)
        query(4)
        smoke.wait_for(lambda: loaded(5, 4), "distinct recovery query and count are visible together with unchanged settings")

        library.write_bytes(original)
        click("Reload")
        smoke.wait_for(lambda: loaded(3), "rename roundtrip restores the original three references")
        prepare_query(4)
        query(2)
        smoke.wait_for(lambda: loaded(3, 2), "restored query and baseline count are visible together with unchanged settings")
    finally:
        # Only suite-owned files are touched. Return the selected path even if
        # the missing-file assertion or native input fails midway through.
        if renamed.exists():
            renamed.replace(library)
        if not library.exists() or library.read_bytes() != original:
            library.write_bytes(original)


def normal_quit(process, click, timeout=10):
    if process.poll() is not None:
        raise AssertionError("App exited before native Quit")
    started = time.monotonic()
    click("Quit Ibis")
    remaining = timeout - (time.monotonic() - started)
    if remaining <= 0:
        raise AssertionError("Native Quit did not end the app promptly")
    try:
        result = process.wait(timeout=remaining)
    except subprocess.TimeoutExpired:
        raise AssertionError("Native Quit did not end the app promptly") from None
    if result != 0:
        raise AssertionError("Native Quit did not exit successfully")


def quit_during_reload(process, click, snapshot, name):
    click("Reload")
    smoke.wait_for(lambda: f"Reloading {name}…" in smoke.strings(snapshot()),
                   "actual pending library reload is exposed before Quit")
    normal_quit(process, click)


def cleanup_owned(process, log, native, owned):
    successful = True
    if process and process.poll() is None:
        try:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            successful = False
    if log:
        try:
            log.close()
        except OSError:
            successful = False
    if native:
        try:
            native.close()
        except (OSError, RuntimeError, AssertionError, subprocess.SubprocessError):
            successful = False
        # These Popen handles belong to this check. Reap them even if a separate
        # native cleanup action failed; never find or kill processes by name.
        for process in (getattr(native, "editor", None), getattr(native, "wm", None)):
            if process:
                try:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                except (OSError, subprocess.SubprocessError):
                    successful = False
    if owned:
        try:
            smoke.clean_settings(owned)
        except OSError:
            successful = False
    return successful


class Dialog:
    def __init__(self, native, system, output=None):
        self.native, self.system, self.output = native, system, output
        self.linux = linux.Dialog(native, smoke.run) if system == "Linux" else None
        if system == "Darwin":
            # This is the direct, exclusively managed Popen child. It cannot
            # reuse its PID until this checker reaps it; never poll/reap it
            # elsewhere while a synchronous native helper is in flight.
            self.child = native.app
            self.child_pid = self.child.pid
            # launch() already resolves the executable before passing this
            # single argument to Popen. Retain that exact launch identity.
            arguments = self.child.args
            if (type(self.child_pid) is not int or not 0 < self.child_pid <= 0x7fffffff
                    or not isinstance(arguments, list) or len(arguments) != 1
                    or not absolute_executable(arguments[0])):
                raise AssertionError("Owned app executable identity is invalid")
            self.executable = arguments[0]

    def require_owned_child(self):
        if (self.native.app is not self.child or self.child.pid != self.child_pid
                or self.child.args != [self.executable] or self.child.poll() is not None):
            raise AssertionError("Owned app exited or its identity changed")

    def capture_failure(self, kind="chooser"):
        if kind not in ("chooser", "picker") or kind == "picker" and self.system != "Windows":
            raise AssertionError("Invalid native failure capture kind")
        if self.system not in ("Darwin", "Windows") or self.output is None or self.native.app.poll() is not None:
            return
        # Capture before the fixture context exits or owned processes stop.
        # The suite requires a disposable desktop with synthetic files.
        try:
            if self.system == "Windows":
                image = self.output / ("picker-failure.png" if kind == "picker" else "chooser-failure.png")
                def has_png():
                    if image.is_symlink() or not image.is_file():
                        return False
                    with image.open("rb") as source:
                        return source.read(8) == b"\x89PNG\r\n\x1a\n"
                if not has_png():
                    command = ["pwsh", "-NoProfile", "-File", str(ROOT / "dialog-windows.ps1"),
                               "-Action", "capture-failure", "-AppId", str(self.native.app.pid),
                               "-PickerHandle", str(self.native.picker_handle), "-FailureImage", str(image), "-CaptureKind", kind]
                    result = subprocess.run(command, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                    for line in helper_diagnostics(result.stderr):
                        print(line, file=sys.stderr, flush=True)
                    if result.returncode:
                        self.native.dialog_failure_capture = "unavailable"
                        return
                self.native.dialog_failure_capture = "captured" if has_png() else "unavailable"
                return
            subprocess.run(["screencapture", "-x", str(self.output / "chooser-failure.png")],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            self.native.dialog_failure_capture = "captured"
        except (OSError, subprocess.SubprocessError):
            self.native.dialog_failure_capture = "unavailable"

    def call(self, action, token=None):
        guarded = self.system == "Darwin" and action in ("after-location", "confirm-key")
        if guarded:
            location_token(token, self.child_pid, self.executable)
        elif token is not None:
            raise AssertionError("Unexpected native chooser identity argument")
        if self.linux:
            return getattr(self.linux, action.replace("-", "_"))()
        print(f"NATIVE CHOOSER ACTION {action}", flush=True)
        if self.system == "Windows":
            command = ["pwsh", "-NoProfile", "-File", str(ROOT / "dialog-windows.ps1"),
                       "-Action", action, "-AppId", str(self.native.app.pid),
                       "-PickerHandle", str(self.native.picker_handle)]
            if self.output is not None:
                command += ["-FailureImage", str(self.output / "chooser-failure.png")]
        else:
            command = ["osascript", "-l", "JavaScript", str(ROOT / "dialog-macos.js"),
                       action, str(self.child_pid), self.executable]
            if guarded:
                command.append(json.dumps(token, allow_nan=False))
        try:
            if self.system == "Darwin":
                self.require_owned_child()
            try:
                result = subprocess.run(command, encoding="utf-8", stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=30)
            finally:
                if self.system == "Darwin":
                    self.require_owned_child()
        except subprocess.TimeoutExpired as error:
            for line in helper_diagnostics(error.stderr):
                print(line, file=sys.stderr, flush=True)
            self.capture_failure()
            raise AssertionError("Native chooser helper timed out") from None
        if result.returncode:
            for line in helper_diagnostics(result.stderr):
                print(line, file=sys.stderr, flush=True)
            self.capture_failure()
            raise smoke.Unavailable("Native chooser action unavailable")
        if self.system == "Windows" and action == "location-state":
            for line in helper_diagnostics(getattr(result, "stderr", "")):
                if line.startswith("NATIVE CHOOSER WINDOWS LOCATION ") and line != getattr(self, "last_location_facts", None):
                    print(line, file=sys.stderr, flush=True)
                    self.last_location_facts = line
        try:
            value = json.loads(result.stdout)
        except ValueError:
            raise AssertionError("Native chooser helper returned invalid metadata") from None
        if self.system == "Darwin" and action == "location-identity":
            location_identity(value, self.child_pid, self.executable)
            diagnostics = tuple(helper_diagnostics(getattr(result, "stderr", "")))
            if diagnostics != getattr(self, "last_macos_location_diagnostics", None):
                for line in diagnostics:
                    print(line, file=sys.stderr, flush=True)
                self.last_macos_location_diagnostics = diagnostics
            state = {"ready": value["ready"], "owned": value["owned"]}
            if state != getattr(self, "last_macos_location_state", None):
                print("NATIVE CHOOSER MACOS LOCATION " + json.dumps(state), file=sys.stderr, flush=True)
                self.last_macos_location_state = state
        if action in ("confirm", "cancel") or guarded and action == "confirm-key":
            if self.system == "Windows":
                key = "escape" if action == "cancel" else "return"
                if (not isinstance(value, dict) or set(value) != {"dialog_handle", "key"}
                        or type(value["dialog_handle"]) is not int or not 0 < value["dialog_handle"] < 2**63
                        or value["key"] != key):
                    raise AssertionError("Native chooser returned an invalid keyboard plan")
                payload = {"dialog_handle": value["dialog_handle"], "picker_handle": self.native.picker_handle, "key": key}
                if self.native.call("dialog-key", json.dumps(payload)) is not True:
                    raise AssertionError("Native chooser keyboard action was not acknowledged")
                return True
            invoked = isinstance(value, dict) and set(value) == {"invoked"} and value["invoked"] is True
            if not invoked:
                raise AssertionError("Native chooser action was not acknowledged")
        return value

    def state(self):
        return flags(self.call("state"), ("visible", "foreground", "owned"))

    def select(self, path):
        if self.system not in ("Windows", "Darwin"):
            return self._select(path)
        try:
            return self._select(path)
        except Exception:
            try:
                if self.system != "Darwin" or getattr(self.native, "dialog_failure_capture", None) not in ("captured", "unavailable"):
                    self.capture_failure()
            except Exception:
                pass  # A secondary observation must preserve the selection failure.
            raise

    def _select(self, path):
        if self.linux:
            smoke.wait_for(self.linux.location_controls_ready, "native chooser controls finish initialization")
            self.linux.select_path(path)
            smoke.wait_for(lambda: not self.state()["visible"], "native chooser closes after Open")
            return
        self.native.key("alt+n" if self.system == "Windows" else "super+shift+g" if self.system == "Darwin" else "ctrl+l")
        if self.system == "Darwin":
            token = None
            def located():
                nonlocal token
                token = location_identity(self.call("location-identity"), self.native.app.pid)
                return token is not None
            smoke.wait_for(located, "owned native Go To Folder identity is ready before typing")
            self.native.set_clipboard(str(path))
            self.native.key("super+v")
            self.native.key("Return")
            state = None
            def sheet_closed():
                nonlocal state
                state = after_location(self.call("after-location", token))
                return state["ready"]
            smoke.wait_for(sheet_closed, "native Go To Folder sheet is physically dismissed")
            if state["closed"]:
                return # The caller still verifies the exact loaded/saved library.
            self.call("confirm-key", token)
            smoke.wait_for(lambda: after_location(self.call("after-location", token))["closed"],
                           "native chooser is physically closed after one guarded Return")
            return
        smoke.wait_for(lambda: all(flags(self.call("location-state"), ("ready", "owned")).values()),
                       "owned native location field receives focus")
        if self.system != "Darwin":
            self.native.key("ctrl+a")
        if self.system == "Windows":
            self.native.text(str(path))
        else:
            self.native.set_clipboard(str(path))
            self.native.key("super+v" if self.system == "Darwin" else "ctrl+v")
        if not ready(self.state()):
            raise AssertionError("Native chooser lost ownership before Open")
        self.call("confirm")
        smoke.wait_for(lambda: not self.state()["visible"], "native chooser closes after Open")


def check(app_path, output, system):
    digest = hashlib.sha256()
    with app_path.open("rb") as binary:
        for chunk in iter(lambda: binary.read(1024 * 1024), b""):
            digest.update(chunk)
    report = {"platform": system, "checks": [], "status": "failed", "binary_sha256": digest.hexdigest()}
    native, process, log, owned = None, None, None, None
    try:
        if system not in ("Linux", "Windows", "Darwin"):
            raise smoke.Unavailable("Unsupported native chooser platform")
        if system == "Darwin":
            owned = claim_owned_settings(smoke.settings_path(system, Path(".")))
        if system == "Windows":
            for helper in ("dialog-windows.ps1", "smoke-windows.ps1"):
                subprocess.run(["pwsh", "-NoProfile", "-File", str(ROOT / helper), "-SelfTest"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        native = smoke.Linux() if system == "Linux" else smoke.Scripted(system)
        with tempfile.TemporaryDirectory(prefix="ibis chooser synthetic ") as temporary:
            folder = Path(temporary)
            settings = smoke.settings_path(system, folder, native)
            if system != "Darwin":
                owned = claim_owned_settings(settings)
            library = folder / "example 引用.bib"
            library.write_text(smoke.fixture(), encoding="utf-8")
            damaged = folder / "unreadable 引用.bib"
            damaged.write_bytes(b"\xff\xfe invalid UTF-8 synthetic fixture")
            env = first_run_environment(os.environ, folder / "config")
            if system == "Linux":
                gtk = folder / "config/gtk-3.0"
                gtk.mkdir(parents=True)
                (gtk / "settings.ini").write_text("[Settings]\ngtk-recent-files-enabled=false\n", encoding="utf-8")

            def launch(label):
                nonlocal process, log
                log = (output / f"startup-{label}.log").open("wb")
                process = subprocess.Popen([str(app_path.resolve())], env=env, cwd=folder if system == "Linux" else None,
                                           stdout=log, stderr=log)
                native.app = process

            def snapshot():
                if process.poll() is not None:
                    raise AssertionError("App exited during chooser verification")
                if system == "Linux":
                    for app in native.atspi.Registry.getDesktop(0):
                        if app and app.get_process_id() == process.pid:
                            app.clearCache()
                return native.snapshot()

            def passed(name):
                report["checks"].append({"name": name, "status": "passed"})
                print("PASS " + name, flush=True)

            def chooser_ready():
                state = dialog.state()
                if state != report.get("last_dialog_state"):
                    report["last_dialog_state"] = state
                    print("NATIVE CHOOSER STATE " + json.dumps(state), flush=True)
                return ready(state)

            def saved_library(expected=None):
                return saved_bibtex_library(settings, expected or library)

            def query(index):
                key = f"smoke{index:06d}"
                native.key("ctrl+a" if system != "Darwin" else "super+a")
                native.text(key)
                wait_for_chosen_query(snapshot, index, report)

            report["stage"] = "C1"
            launch("first-run")
            smoke.wait_for(lambda: bool(smoke.named(snapshot(), "Choose library to get started")), "first-run library choice is visible")
            dialog = Dialog(native, system, output)
            native.click("Choose library to get started")
            smoke.wait_for(chooser_ready, "exact owned chooser is visible and foreground")
            assert (dialog.linux.picker_visible() if dialog.linux else snapshot()["visible"]), "Chooser hid the picker"
            dialog.call("cancel")
            smoke.wait_for(lambda: not dialog.state()["visible"], "Cancel closes the native chooser")
            smoke.wait_for(lambda: bool(smoke.named(snapshot(), "Choose library to get started")) and snapshot()["foreground"], "Cancel preserves first run and returns picker focus")
            assert not settings.exists(), "Cancel saved a library unexpectedly"
            passed("C1 owned chooser cancellation preserves first run")
            report["stage"] = "C2"
            native.click("Choose library…")
            smoke.wait_for(chooser_ready, "chooser can reopen after Cancel")
            dialog.select(library)
            smoke.wait_for(lambda: f"{library.name}: 3 references" in smoke.strings(snapshot()) and saved_library(), "chosen library loads and is remembered")
            smoke.wait_for(lambda: snapshot()["foreground"], "picker receives focus after selection")
            query(2)
            passed("C2 native selection loads and remembers a Unicode path")
            report["stage"] = "C3"
            native.click("Choose library…")
            smoke.wait_for(chooser_ready, "chooser opens for unreadable fixture")
            dialog.select(damaged)
            def unreadable_explained():
                text = smoke.strings(snapshot())
                state = {"attempted_name": f"The library could not be opened: {damaged.name}" in text,
                         "utf8_reason": "not UTF-8 text" in text,
                         "retained_snapshot": f"{library.name}: 3 references" in text,
                         "saved_library": saved_library()}
                if state != report.get("unreadable_state"):
                    print("NATIVE CHOOSER UNREADABLE " + json.dumps(state), flush=True)
                    report["unreadable_state"] = state
                return state["attempted_name"] and state["utf8_reason"]
            smoke.wait_for(unreadable_explained, "chosen unreadable file is explained")
            assert f"{library.name}: 3 references" in smoke.strings(snapshot()), "Unreadable choice relabeled the retained snapshot"
            assert saved_library(), "Unreadable choice replaced saved library"
            query(1)
            passed("C3 unreadable native choice retains searchable library and settings")
            report["stage"] = "rename-away"
            rename_library_roundtrip(library, settings, native.click, snapshot, query,
                                     lambda previous: prepare_rename_query(native, snapshot, system, previous, report,
                                         lambda: dialog.capture_failure("picker")))
            passed("rename-away retains searchable references and settings and recovers distinct content")
            report["stage"] = "C4"
            normal_quit(process, native.click)
            log.close()
            process, log = None, None
            passed("C4 native Quit exits zero")
            report["stage"] = "relaunch"
            launch("remembered")
            smoke.wait_for(lambda: f"{library.name}: 3 references" in smoke.strings(snapshot()), "relaunch remembers library without override")
            smoke.wait_for(lambda: snapshot()["foreground"], "relaunch is foreground")
            query(0)
            passed("relaunch remembers the chosen library and accepts a new query")
            report["stage"] = "boundary"
            large = folder / "boundary 引用.bib"
            records = smoke.fixture(100000)
            first, last = records.rsplit("\n", 1)
            boundary.write_boundary_library(large, first, last + "\n")
            del records, first, last
            assert large.stat().st_size == boundary.FILE_LIMIT, "Boundary fixture has the wrong byte count"
            dialog = Dialog(native, system, output)
            native.click("Choose library…")
            smoke.wait_for(chooser_ready, "chooser opens for the exact size boundary")
            dialog.select(large)
            smoke.wait_for(lambda: f"{large.name}: 100000 references" in smoke.strings(snapshot()) and saved_library(large),
                           "exact 64 MiB library loads all 100000 references", timeout=120)
            query(99999)
            passed("exact 64 MiB native choice loads 100000 records including the record after padding")
            report["stage"] = "quit-during-reload"
            quit_during_reload(process, native.click, snapshot, large.name)
            log.close()
            process, log = None, None
            assert saved_library(large), "Quit during reload changed saved library"
            passed("native Quit exits zero within ten seconds after an observed pending reload")
            report["stage"] = "boundary-relaunch"
            launch("boundary-remembered")
            smoke.wait_for(lambda: f"{large.name}: 100000 references" in smoke.strings(snapshot()),
                           "relaunch loads the saved boundary library after Quit during reload", timeout=120)
            query(99998)
            report["stage"] = "relaunch-shortcut"
            native.key("Escape")
            smoke.wait_for(lambda: not snapshot()["visible"], "relaunch can hide before shortcut check")
            native.focus_editor()
            smoke.wait_for(native.editor_focused, "owned editor receives focus")
            native.key("ctrl+super+r" if system == "Darwin" else "ctrl+shift+y")
            def shortcut_ready():
                current = snapshot()
                state = {"visible": current["visible"], "foreground": current["foreground"],
                         "search_focused": smoke.search_focused(current)}
                if state != report.get("last_shortcut_state"):
                    report["last_shortcut_state"] = state
                    print("NATIVE CHOOSER SHORTCUT " + json.dumps(state), flush=True)
                return state["visible"] and state["foreground"] and bool(smoke.named(current, "Search references"))
            smoke.wait_for(shortcut_ready, "relaunch shows the foreground picker after native Quit")
            # AT-SPI may focus aria-activedescendant while the combobox receives
            # input. Prove keyboard routing with a different exact query/result.
            query(99997)
            passed("relaunch reacquires the shortcut and routes a new native query after Quit")
            normal_quit(process, native.click)
            log.close()
            process, log = None, None
            passed("relaunch after Quit during reload retains valid preferences and searchable records")
            report["status"] = "passed"
    except BaseException as error:
        if native and getattr(native, "dialog_failure_capture", None):
            report["failure_capture"] = native.dialog_failure_capture
        report["failure_locations"] = [{"source": Path(frame.filename).name, "line": frame.lineno}
            for frame in traceback.extract_tb(error.__traceback__)
            if Path(frame.filename).name in ("check-native-chooser.py", "native_dialog_linux.py", "smoke-native.py")]
        print("NATIVE CHOOSER FAILURE " + json.dumps({"stage": report.get("stage", "setup"), "locations": report["failure_locations"]}), flush=True)
        raise
    finally:
        original_failure = sys.exc_info()[0] is not None
        cleaned = cleanup_owned(process, log, native, owned)
        if not cleaned:
            report["status"] = "failed"
            report["cleanup"] = "failed"
        (output / "chooser.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if not cleaned and not original_failure:
            raise RuntimeError("Owned native cleanup failed")


class Tests(unittest.TestCase):
    def keyboard_evidence(self, *, virtual=False, ready=True):
        return {"available": True, "owned_picker": True, "native_child_focus": True, "unique_search": True,
                "unique_results": virtual, "direct_search_focus": not virtual and ready,
                "controller_for_results": virtual, "controlled_results_focus": virtual and ready, "ready": ready}

    def observation_evidence(self):
        native = {"stage": "complete", **dict.fromkeys(("exception", "owned", "gui_available", "gui_idle", "active_picker", "focus_present", "focus_is_picker", "focus_live", "focus_visible", "focus_strict_child", "focus_pid_matches", "focus_thread_matches"), False)}
        uia = {"stage": "complete", "search_matches": 1, "results_matches": 1,
               **dict.fromkeys(("exception", "root_identity", "enumeration_complete", "search_owned", "results_owned", "focused_present", "focused_owned", "focused_is_search", "focused_is_results", "focused_is_picker", "final_focus_same", "final_owned", "ownership_pid_mismatch", "ownership_offscreen", "ownership_disabled", "ownership_walk_failed"), False)}
        return {"native_before": dict(native), "native_after": dict(native), "focus_stable": False, "uia": uia}

    def test_keyboard_observations_accept_only_fixed_typed_bounded_metadata(self):
        import copy
        value = self.observation_evidence()
        result = windows_keyboard_observation(value)
        self.assertEqual(result, value)
        self.assertIsNot(result, value)
        self.assertIsNot(result["native_before"], value["native_before"])
        for section in ("native_before", "native_after", "uia"):
            for key in value[section]:
                invalid_values = ("/private/provider/text", None, [], {})
                if type(value[section][key]) is bool:
                    invalid_values += (0, 1, 1.0)
                for bad in invalid_values:
                    invalid = copy.deepcopy(value)
                    invalid[section][key] = bad
                    self.assertIsNone(windows_keyboard_observation(invalid), (section, key, bad))
            for key in value[section]:
                invalid = copy.deepcopy(value)
                del invalid[section][key]
                self.assertIsNone(windows_keyboard_observation(invalid), (section, key))
            invalid = copy.deepcopy(value)
            invalid[section]["pid"] = 123
            self.assertIsNone(windows_keyboard_observation(invalid))
        for key in ("search_matches", "results_matches"):
            for count in (-1, 4001, True, 1.0, float("nan"), None):
                invalid = copy.deepcopy(value); invalid["uia"][key] = count
                self.assertIsNone(windows_keyboard_observation(invalid), (key, count))
            for count in (0, 4000):
                valid = copy.deepcopy(value); valid["uia"][key] = count
                self.assertEqual(windows_keyboard_observation(valid), valid)
        for invalid in (None, {}, {**value, "focus_stable": 1}, {**value, "raw": "/private/path"}):
            self.assertIsNone(windows_keyboard_observation(invalid))

    def test_keyboard_observation_stages_do_not_claim_unobserved_facts(self):
        import copy
        value = self.observation_evidence()
        for section, stages in (("native_before", ("unobserved", "picker", "gui", "focus", "complete")),
                                ("native_after", ("unobserved", "picker", "gui", "focus", "complete")),
                                ("uia", ("unobserved", "root", "enumeration", "focused", "ownership", "relation", "ancestry", "final", "complete"))):
            for stage in stages:
                valid = copy.deepcopy(value); valid[section]["stage"] = stage
                if stage == "unobserved":
                    for key in ("search_matches", "results_matches"):
                        if key in valid[section]: valid[section][key] = 0
                self.assertEqual(windows_keyboard_observation(valid), valid)
            invalid = copy.deepcopy(value); invalid[section]["stage"] = "private stage"
            self.assertIsNone(windows_keyboard_observation(invalid))
            invalid[section]["stage"] = "unobserved"; invalid[section]["exception"] = True
            self.assertIsNone(windows_keyboard_observation(invalid))
        invalid = copy.deepcopy(value); invalid["uia"]["stage"] = "unobserved"
        self.assertIsNone(windows_keyboard_observation(invalid))

    def test_rename_failure_projects_only_same_final_observation_without_more_reads_or_inputs(self):
        from io import StringIO
        actions, report, stderr = [], {}, StringIO()
        class Native:
            def key(self, key): actions.append(key)
        current = {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(ready=False),
                   "nodes": [{"name": "Search references", "role": "ControlType.ComboBox"}],
                   "keyboard_observation": self.observation_evidence()}
        current["keyboard_observation"]["native_after"]["focus_is_picker"] = True
        snapshot = Mock(side_effect=[{"visible": False}, current])
        failure = AssertionError("original readiness timeout")
        def wait(predicate, message):
            if "hides" in message: self.assertTrue(predicate())
            else:
                self.assertFalse(predicate()); raise failure
        capture = Mock(side_effect=RuntimeError("secondary private failure"))
        with patch.object(smoke, "wait_for", side_effect=wait), patch.object(sys, "stderr", stderr):
            with self.assertRaises(AssertionError) as caught:
                prepare_rename_query(Native(), snapshot, "Windows", 1, report, capture)
        self.assertIs(caught.exception, failure)
        facts = report["rename_focus_failure"]
        self.assertTrue(facts["keyboard_observation_valid"])
        self.assertEqual(facts["keyboard_observation"], current["keyboard_observation"])
        self.assertEqual(snapshot.call_count, 2)
        self.assertEqual(actions, ["Escape", "ctrl+shift+y"])
        capture.assert_called_once_with()
        self.assertNotIn("private", stderr.getvalue())

    def test_diagnostic_payload_failure_never_changes_readiness_or_reuses_earlier_observations(self):
        from io import StringIO
        current = {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(),
                   "nodes": [{"name": "Search references", "role": "ControlType.ComboBox"}],
                   "keyboard_observation": {"private": "/private/path"}}
        snapshots = iter([{"visible": False}, current])
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate())):
            prepare_rename_query(Mock(), lambda: next(snapshots), "Windows")
        earlier = {**current, "keyboard": self.keyboard_evidence(ready=False), "keyboard_observation": self.observation_evidence()}
        final = {**earlier, "keyboard_observation": current["keyboard_observation"]}
        snapshot = Mock(side_effect=[{"visible": False}, earlier, final]); report = {}; stderr = StringIO()
        failure = AssertionError("original readiness timeout")
        def wait(predicate, message):
            if "hides" in message: self.assertTrue(predicate())
            else:
                self.assertFalse(predicate()); self.assertFalse(predicate()); raise failure
        with patch.object(smoke, "wait_for", side_effect=wait), patch.object(sys, "stderr", stderr):
            with self.assertRaises(AssertionError) as caught:
                prepare_rename_query(Mock(), snapshot, "Windows", 1, report)
        self.assertIs(caught.exception, failure)
        self.assertFalse(report["rename_focus_failure"]["keyboard_observation_valid"])
        self.assertNotIn("keyboard_observation", report["rename_focus_failure"])
        self.assertEqual(snapshot.call_count, 3)
        self.assertNotIn("private", stderr.getvalue())

    def test_windows_rename_accepts_only_proven_controller_focus_with_native_child_focus(self):
        actions = []
        class Native:
            def key(self, key): actions.append(key)
        current = {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(virtual=True),
                   "nodes": [{"name": "Search references", "role": "ControlType.ComboBox", "focused": False}]}
        snapshots = iter([{"visible": False}, current])
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
            prepare_rename_query(Native(), lambda: next(snapshots), "Windows")
            actions.append("type")
        self.assertEqual(actions, ["Escape", "ctrl+shift+y", "type"])

    def test_windows_keyboard_evidence_rejects_each_missing_virtual_or_native_proof(self):
        for key in ("available", "owned_picker", "native_child_focus", "unique_search", "unique_results",
                    "controller_for_results", "controlled_results_focus"):
            value = self.keyboard_evidence(virtual=True)
            value[key], value["ready"] = False, False
            self.assertFalse(windows_keyboard_state(value)["ready"], key)
        direct = self.keyboard_evidence()
        direct["native_child_focus"], direct["ready"] = False, False
        self.assertFalse(windows_keyboard_state(direct)["ready"])

    def test_windows_keyboard_metadata_cannot_override_its_proofs_or_expose_payloads(self):
        value = self.keyboard_evidence()
        for invalid in ({**value, "ready": False}, {**value, "owned_picker": 1},
                        {**value, "payload": "/private/path"}, {}, None):
            with self.assertRaises(AssertionError):
                windows_keyboard_state(invalid)

    def test_macos_budget_facts_accept_only_one_fixed_typed_record(self):
        prefix = "NATIVE CHOOSER MACOS BUDGET "
        for kind in ("call-limit", "time-limit", "clock-regression"):
            for stage in ("scope", "windows", "candidates", "sheets", "bounds", "location", "controls"):
                for calls in (0, 256):
                    facts = {"kind": kind, "calls": calls, "stage": stage}
                    line = prefix + json.dumps(facts, sort_keys=True)
                    self.assertEqual(helper_diagnostics(line), [line])
                    self.assertEqual(helper_diagnostics("\n".join([line] * 20)), [line])
        valid = {"kind": "call-limit", "calls": 256, "stage": "sheets"}
        invalid = [{**valid, "calls": value} for value in (-1, 257, True, 1.0, float("nan"), float("inf"), "private", None)]
        invalid += [{**valid, "kind": value} for value in ("private provider text", True, [], {})]
        invalid += [{**valid, "stage": value} for value in ("private provider text", True, [], {})]
        invalid += [{**valid, "path": "/private/path"}, {}, {"kind": "call-limit", "stage": "scope"}]
        for value in invalid:
            self.assertEqual(helper_diagnostics(prefix + json.dumps(value)), [])
        self.assertEqual(helper_diagnostics(prefix + '{"kind":"call-limit","calls":0,"calls":1,"stage":"scope"}'), [])
        budget = prefix + json.dumps(valid, sort_keys=True)
        ax = 'NATIVE CHOOSER MACOS AX {"api": "CFEqual", "reason": "budget-exceeded"}'
        self.assertEqual(helper_diagnostics(budget + "\n" + ax), [budget, ax])
        stage = 'NATIVE CHOOSER MACOS {"stage": "scope"}'
        self.assertEqual(helper_diagnostics(budget + "\n" + "\n".join([stage] * 25)), [stage] * 16)

    def test_macos_discovery_counts_are_exact_bounded_and_failure_only_metadata(self):
        prefix = "NATIVE CHOOSER MACOS DISCOVERY "
        bounds = {**dict.fromkeys(("windows", "titled_windows", "window_dialog_subroles", "window_standard_subroles", "window_subrole_unavailable"), 20),
                  **dict.fromkeys(("direct_children", "direct_windows", "direct_sheets", "direct_dialog_roles", "titled_sheets", "direct_static_texts", "direct_static_title_matches"), 640),
                  **dict.fromkeys(("title_unavailable", "description_unavailable", "title_empty", "title_other", "description_empty", "description_other"), 660)}
        valid = {key: maximum for key, maximum in bounds.items()}
        line = prefix + json.dumps(valid, sort_keys=True)
        self.assertEqual(helper_diagnostics(line), [line])
        self.assertEqual(helper_diagnostics("\n".join([line] * 30)), [line])
        for key, maximum in bounds.items():
            for bad in (-1, maximum + 1, True, 1.0, "private provider text", None):
                self.assertEqual(helper_diagnostics(prefix + json.dumps({**valid, key: bad})), [], (key, bad))
        for bad in ({**valid, "path": "/private/path"}, {}, {key: value for key, value in valid.items() if key != "windows"}):
            self.assertEqual(helper_diagnostics(prefix + json.dumps(bad)), [])
        duplicate = json.dumps(valid)[:-1] + ', "windows": 1}'
        self.assertEqual(helper_diagnostics(prefix + duplicate), [])

    def test_windows_focused_roles_and_options_never_expose_provider_payloads(self):
        option = {"name": "Ibis smoke reference 000001 Example Alex 2026 smoke000001", "role": "ControlType.ListItem", "focused": True}
        facts = windows_focused_nodes({"nodes": [option, {"name": "/private/path", "role": "secret role", "focused": True},
                  {"name": "Reload", "role": "ControlType.Button", "focused": True}]}, 1)
        self.assertEqual(facts, {"focused_roles": ["button", "option", "other"], "focused_reload": True,
                         "focused_other_known_control": False, "known_option_unique": True, "known_option_focused": True})
        for invalid in ({**option, "role": "ControlType.Text"}, {**option, "name": option["name"].replace("000001", "000002")},
                        {**option, "name": option["name"].replace("Example", "Unknown")}, {**option, "name": option["name"] + "x" * 513}):
            self.assertFalse(windows_focused_nodes({"nodes": [invalid]}, 1)["known_option_focused"])
        self.assertFalse(windows_focused_nodes({"nodes": [option, dict(option)]}, 1)["known_option_unique"])
        self.assertFalse(windows_focused_nodes({"nodes": [{}] * 4000 + [option]}, 1)["known_option_focused"])
        encoded = json.dumps(facts)
        for forbidden in ("private", "secret", "smoke000001", "Example"):
            self.assertNotIn(forbidden, encoded)

    def test_windows_invalid_latest_keyboard_evidence_drops_prior_metadata_and_preserves_error(self):
        from io import StringIO
        native, report = Mock(), {}
        current = {"visible": True, "foreground": True, "nodes": [{"name": "Search references", "role": "ControlType.ComboBox"}],
                   "keyboard": self.keyboard_evidence(ready=False)}
        snapshots = iter([{"visible": False}, current, {**current, "keyboard": {}}])
        def wait(predicate, message):
            if "hides" in message: self.assertTrue(predicate())
            else:
                self.assertFalse(predicate())
                predicate()
        capture = Mock(side_effect=RuntimeError("secondary capture failure"))
        with patch.object(smoke, "wait_for", side_effect=wait), patch.object(sys, "stderr", StringIO()):
            with self.assertRaisesRegex(AssertionError, "exact boolean"):
                prepare_rename_query(native, lambda: next(snapshots), "Windows", 1, report, capture)
        self.assertFalse(report["rename_focus_failure"]["keyboard_metadata_valid"])
        self.assertFalse(any(report["rename_focus_failure"]["keyboard"].values()))
        capture.assert_called_once_with()
        self.assertEqual([call.args[0] for call in native.key.call_args_list], ["Escape", "ctrl+shift+y"])

    def test_windows_picker_capture_is_explicit_and_never_falls_back_to_chooser(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            native = SimpleNamespace(app=SimpleNamespace(pid=10, poll=lambda: None), picker_handle=12)
            dialog = Dialog(native, "Windows", Path(folder))
            result = SimpleNamespace(returncode=1, stdout="", stderr="private provider text")
            with patch.object(subprocess, "run", return_value=result) as run:
                dialog.capture_failure("picker")
            command = run.call_args.args[0]
            self.assertEqual(command[command.index("-CaptureKind") + 1], "picker")
            self.assertEqual(Path(command[command.index("-FailureImage") + 1]).name, "picker-failure.png")
            self.assertEqual(run.call_count, 1)
            self.assertEqual(native.dialog_failure_capture, "unavailable")
            with patch.object(subprocess, "run") as run:
                for kind in ("foreign", None):
                    with self.assertRaises(AssertionError): dialog.capture_failure(kind)
            run.assert_not_called()

    def test_macos_unready_reasons_accept_only_one_fixed_reason_per_helper(self):
        prefix = 'NATIVE CHOOSER MACOS READY '
        reasons = ('registration-unavailable', 'panel-not-found', 'not-foreground', 'sheet-absent',
                   'focused-control-not-ready', 'focus-outside-sheet', 'final-ownership-not-ready')
        for reason in reasons:
            valid = prefix + json.dumps({'reason': reason}, sort_keys=True)
            self.assertEqual(helper_diagnostics(valid), [valid])
            self.assertEqual(helper_diagnostics('\n'.join([valid] * 20)), [valid])
        for invalid in ({'reason': 'private provider text'}, {'reason': True}, {'reason': []},
                        {'reason': 'sheet-absent', 'token': '/private/path'}, {}):
            self.assertEqual(helper_diagnostics(prefix + json.dumps(invalid)), [])
        valid = prefix + '{"reason": "sheet-absent"}'
        lines = helper_diagnostics('\n'.join(['NATIVE CHOOSER MACOS {"stage":"scope"}'] * 20 + [valid]))
        self.assertEqual(len(lines), 16)
        self.assertEqual(lines[-1], valid)

    def test_successful_darwin_location_observations_emit_only_validated_changed_facts(self):
        from io import StringIO
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        dialog = Dialog(native, "Darwin")
        token = self.macos_token()
        responses = [{"ready": False, "owned": False, "token": None}] * 2 + [{"ready": True, "owned": True, "token": token}]
        diagnostic = 'NATIVE CHOOSER MACOS {"stage":"scope"}\nNATIVE CHOOSER MACOS READY {"reason":"sheet-absent"}'
        results = [SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr=diagnostic + '\nprivate provider text') for value in responses]
        stderr = StringIO()
        with patch.object(subprocess, "run", side_effect=results), patch.object(sys, "stderr", stderr):
            for value in responses:
                self.assertEqual(dialog.call("location-identity"), value)
        lines = stderr.getvalue().splitlines()
        self.assertEqual(lines.count('NATIVE CHOOSER MACOS {"stage": "scope"}'), 1)
        self.assertEqual(lines.count('NATIVE CHOOSER MACOS READY {"reason": "sheet-absent"}'), 1)
        self.assertEqual([line for line in lines if line.startswith('NATIVE CHOOSER MACOS LOCATION ')], [
            'NATIVE CHOOSER MACOS LOCATION {"ready": false, "owned": false}',
            'NATIVE CHOOSER MACOS LOCATION {"ready": true, "owned": true}'])
        self.assertNotIn('private', stderr.getvalue())
        self.assertNotIn(token['owner']['executable'], stderr.getvalue())
        self.assertNotIn('token', stderr.getvalue())
        self.assertNotIn('pid', stderr.getvalue())

    def test_invalid_darwin_location_metadata_emits_no_success_diagnostics(self):
        from io import StringIO
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        token = self.macos_token()
        token['owner']['executable'] = '/foreign/app'
        for value in ({"ready": 1, "owned": False, "token": None},
                      {"ready": False, "owned": False, "token": None, "path": "/private/path"},
                      {"ready": True, "owned": True, "token": token}):
            stderr = StringIO()
            result = SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr='NATIVE CHOOSER MACOS {"stage":"scope"}\nprivate payload')
            with patch.object(subprocess, "run", return_value=result), patch.object(sys, "stderr", stderr):
                with self.assertRaises(AssertionError):
                    Dialog(native, 'Darwin').call('location-identity')
            self.assertEqual(stderr.getvalue(), '')

    def test_darwin_valid_unready_timeout_captures_before_return_without_typing(self):
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        native.key, native.set_clipboard = Mock(), Mock()
        dialog = Dialog(native, 'Darwin')
        failure = AssertionError('original readiness timeout')
        def timeout(predicate, message):
            self.assertFalse(predicate())
            raise failure
        result = SimpleNamespace(returncode=0, stdout='{"ready":false,"owned":false,"token":null}', stderr='')
        with patch.object(subprocess, 'run', return_value=result), patch.object(smoke, 'wait_for', side_effect=timeout), \
             patch.object(dialog, 'capture_failure', side_effect=RuntimeError('secondary capture failure')) as capture:
            with self.assertRaises(AssertionError) as caught:
                dialog.select(Path('synthetic.bib'))
        self.assertIs(caught.exception, failure)
        capture.assert_called_once_with()
        native.key.assert_called_once_with('super+shift+g')
        native.set_clipboard.assert_not_called()

    def test_windows_rename_focus_timeout_keeps_the_same_snapshot_and_known_query_facts(self):
        from io import StringIO
        current = {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(ready=False), "nodes": [
            {"name": "Search references", "role": "ControlType.ComboBox", "value": "smoke000001", "focused": False},
            {"name": "Ibis smoke reference 000001", "role": "ControlType.Text", "focused": True}, {"name": "private provider text"}]}
        snapshot, report, stderr = Mock(side_effect=[{"visible": False}, current]), {}, StringIO()
        failure = AssertionError("original focus timeout")
        def wait(predicate, message):
            if "hides" in message:
                self.assertTrue(predicate())
            else:
                self.assertFalse(predicate())
                raise failure
        with patch.object(smoke, "wait_for", side_effect=wait), patch.object(sys, "stderr", stderr):
            with self.assertRaises(AssertionError) as caught:
                prepare_rename_query(Mock(), snapshot, "Windows", previous_index=1, report=report)
        self.assertIs(caught.exception, failure)
        self.assertEqual(snapshot.call_count, 2)
        expected = {"visible": True, "foreground": True, "unique_editable": True, "editable_focused": False,
                    "known_result_focused": True, "previous_query_unchanged": True}
        self.assertEqual({key: report["rename_focus_failure"][key] for key in expected}, expected)
        self.assertEqual(report["rename_focus_failure"]["focused_roles"], ["text"])
        self.assertFalse(report["rename_focus_failure"]["known_option_focused"])
        self.assertTrue(report["rename_focus_failure"]["keyboard_metadata_valid"])
        self.assertEqual(report["rename_focus_failure"]["keyboard"], current["keyboard"])
        self.assertNotIn("private", stderr.getvalue())
        self.assertNotIn("smoke000001", stderr.getvalue())

    def test_windows_rename_never_types_until_the_unique_editable_search_is_focused(self):
        actions = []
        unfocused = {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(ready=False), "nodes": [
            {"name": "Search references", "role": "ControlType.ComboBox", "value": "smoke000001", "focused": False},
            {"name": "Reload", "focused": True}, {"name": "1 result"}]}
        focused = {**unfocused, "keyboard": self.keyboard_evidence(), "nodes": [{**unfocused["nodes"][0], "focused": True}]}
        snapshots = iter([{"visible": False}, unfocused, focused])
        class Native:
            def key(self, key): actions.append(key)
        def wait(predicate, message):
            if "hides" in message:
                self.assertTrue(predicate())
            else:
                self.assertFalse(predicate())
                self.assertNotIn("type", actions)
                self.assertTrue(predicate())
        with patch.object(smoke, "wait_for", side_effect=wait):
            prepare_rename_query(Native(), lambda: next(snapshots), "Windows")
            actions.append("type")
        self.assertEqual(actions, ["Escape", "ctrl+shift+y", "type"])

    def test_windows_rename_rejects_noneditable_or_ambiguous_focused_search(self):
        for nodes in ([{"name": "Search references", "role": "ControlType.Button", "focused": True}],
                      [{"name": "Search references", "role": "ControlType.ComboBox", "focused": True}] * 2):
            snapshots = iter([{"visible": False}, {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(), "nodes": nodes}])
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaises(AssertionError):
                    prepare_rename_query(Mock(), lambda: next(snapshots), "Windows")

    def test_fresh_saved_library_requires_format_two_and_one_bibtex_path(self):
        with tempfile.TemporaryDirectory() as folder:
            library, settings = Path(folder) / "references 引用.bib", Path(folder) / "settings.json"
            library.write_text(smoke.fixture(), encoding="utf-8")
            settings.write_text(json.dumps({"schema_version": 2, "library": {"bibtex": str(library)}, "copy_format": "pandoc"}), encoding="utf-8")
            self.assertTrue(saved_bibtex_library(settings, library))
            other = Path(folder) / "other.bib"
            other.write_text(smoke.fixture(), encoding="utf-8")
            self.assertFalse(saved_bibtex_library(settings, other))
            for version in (None, 0, 1, True, "2", 3):
                value = {"library": {"bibtex": str(library)}}
                if version is not None:
                    value["schema_version"] = version
                settings.write_text(json.dumps(value), encoding="utf-8")
                self.assertFalse(saved_bibtex_library(settings, library), version)

    def test_fresh_saved_library_rejects_legacy_zotero_mixed_and_malformed_choices(self):
        with tempfile.TemporaryDirectory() as folder:
            library, settings = Path(folder) / "references.bib", Path(folder) / "settings.json"
            library.write_text(smoke.fixture(), encoding="utf-8")
            for choice in (str(library), {"zotero": "user"}, {"zotero": {"group": 42}},
                           {"bibtex": str(library), "zotero": "user"}, {}, None, [],
                           {"bibtex": None}, {"bibtex": True}, {"bibtex": ""}, {"bibtex": "relative.bib"},
                           {"bibtex": str(library) + "\x00"}, {"bibtex": str(library.with_name("missing.bib"))}):
                settings.write_text(json.dumps({"schema_version": 2, "library": choice}), encoding="utf-8")
                self.assertFalse(saved_bibtex_library(settings, library))
            encoded = json.dumps(str(library))
            for content in ("{", "[]", "null", "true", '{}',
                            '{"schema_version":2,"library":{"bibtex":' + encoded + ',"bibtex":' + encoded + '}}',
                            '{"schema_version":1,"schema_version":2,"library":{"bibtex":' + encoded + '}}'):
                settings.write_text(content, encoding="utf-8")
                self.assertFalse(saved_bibtex_library(settings, library))
            settings.unlink()
            self.assertFalse(saved_bibtex_library(settings, library))

    def test_chosen_query_timeout_reports_only_the_final_predicate_snapshot(self):
        from io import StringIO
        first = {"nodes": [{"role": "ControlType.Edit", "name": "Search references", "value": "smoke000000"}]}
        final = {"nodes": [{"role": "ControlType.Edit", "name": "Search references", "value": "private unrelated value"},
                           {"name": "private unrelated title"}, {"name": "11 results"}]}
        snapshot = Mock(side_effect=[first, final])
        failure = AssertionError("original query timeout")
        def timeout(predicate, message):
            self.assertFalse(predicate())
            self.assertFalse(predicate())
            raise failure
        report, stderr = {}, StringIO()
        with patch.object(smoke, "wait_for", side_effect=timeout), patch.object(sys, "stderr", stderr):
            with self.assertRaises(AssertionError) as caught:
                wait_for_chosen_query(snapshot, 0, report)
        self.assertIs(caught.exception, failure)
        self.assertEqual(snapshot.call_count, 2)
        self.assertEqual(report["query_failure"], smoke.query_failure_facts(final, "smoke000000", "Ibis smoke reference 000000"))
        self.assertFalse(report["query_failure"]["exact_search_value"])
        self.assertFalse(report["query_failure"]["expected_result"])
        self.assertFalse(report["query_failure"]["one_result"])
        self.assertTrue(all(type(value) is bool for value in report["query_failure"].values()))
        self.assertNotIn("private", stderr.getvalue())
        self.assertNotIn("smoke000000", stderr.getvalue())

    def test_chosen_query_success_preserves_the_existing_acceptance_predicate(self):
        # Diagnostic classification must not change the current native gate.
        current = {"nodes": [{"name": "Search references", "value": "smoke000000"},
                             {"name": "Ibis smoke reference 000000"}, {"name": "1 result"}]}
        report, snapshot = {}, Mock(return_value=current)
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate())):
            wait_for_chosen_query(snapshot, 0, report)
        self.assertEqual(snapshot.call_count, 1)
        self.assertEqual(report, {})

    def test_chosen_query_observation_error_is_preserved_without_an_extra_read(self):
        failure, report = RuntimeError("native observation unavailable"), {}
        snapshot = Mock(side_effect=failure)
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: predicate()):
            with self.assertRaises(RuntimeError) as caught:
                wait_for_chosen_query(snapshot, 0, report)
        self.assertIs(caught.exception, failure)
        self.assertEqual(snapshot.call_count, 1)
        self.assertEqual(report, {})

    def test_macos_ax_failure_facts_accept_only_fixed_api_and_reason(self):
        prefix = 'NATIVE CHOOSER MACOS AX '
        value = {'api': 'AXUIElementSetMessagingTimeout', 'reason': 'ax-error'}
        self.assertEqual(helper_diagnostics(prefix + json.dumps(value)), [prefix + json.dumps(value, sort_keys=True)])
        for invalid in ({**value, 'api': 'private provider text'}, {**value, 'reason': 'private error'},
                        {**value, 'payload': '/private/path'}, {**value, 'api': True}, {'api': value['api']}):
            self.assertEqual(helper_diagnostics(prefix + json.dumps(invalid)), [])
        self.assertEqual(helper_diagnostics('\n'.join([prefix + json.dumps(value)] * 20)),
                         [prefix + json.dumps(value, sort_keys=True)])
        self.assertEqual(helper_diagnostics('NATIVE CHOOSER MACOS {"stage":"scope"}\n' + prefix + json.dumps(value)),
                         ['NATIVE CHOOSER MACOS {"stage": "scope"}', prefix + json.dumps(value, sort_keys=True)])

    def darwin_owned_native(self, polls=None):
        from types import SimpleNamespace
        executable = '/Applications/Ibis.app/Contents/MacOS/ibis-desktop'
        poll = (lambda: None) if polls is None else Mock(side_effect=polls)
        child = SimpleNamespace(pid=10, args=[executable], poll=poll)
        return SimpleNamespace(app=child), executable

    def test_darwin_every_action_requires_the_same_live_unreaped_child(self):
        from types import SimpleNamespace
        for action in ('state', 'cancel', 'confirm', 'location-state', 'location-identity', 'after-location', 'confirm-key'):
            native, executable = self.darwin_owned_native([7])
            dialog = Dialog(native, 'Darwin')
            token = {**self.macos_token(), 'owner': {'pid': 10, 'executable': executable}} if action in ('after-location', 'confirm-key') else None
            with patch.object(subprocess, 'run') as run:
                with self.assertRaisesRegex(AssertionError, 'Owned app'):
                    dialog.call(action, token)
                run.assert_not_called()
            native, executable = self.darwin_owned_native([None, 7])
            dialog = Dialog(native, 'Darwin')
            token = {**self.macos_token(), 'owner': {'pid': 10, 'executable': executable}} if action in ('after-location', 'confirm-key') else None
            with patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"invoked":true}')) as run:
                with self.assertRaisesRegex(AssertionError, 'Owned app'):
                    dialog.call(action, token)
                self.assertEqual(run.call_count, 1)

    def test_darwin_changed_child_pid_or_executable_never_starts_a_helper(self):
        from types import SimpleNamespace
        for changed in ('instance', 'pid', 'executable'):
            native, executable = self.darwin_owned_native()
            dialog = Dialog(native, 'Darwin')
            if changed == 'instance': native.app = SimpleNamespace(pid=10, args=[executable], poll=lambda: None)
            elif changed == 'pid': native.app.pid = 11
            else: native.app.args = ['/foreign/app']
            with patch.object(subprocess, 'run') as run:
                with self.assertRaisesRegex(AssertionError, 'Owned app'):
                    dialog.call('location-identity')
                run.assert_not_called()

    def test_darwin_request_uses_the_exact_resolved_launch_argument_on_every_host(self):
        native, executable = self.darwin_owned_native()
        with patch.object(Path, 'resolve', side_effect=AssertionError('No host-specific rewriting of macOS identity')):
            dialog = Dialog(native, 'Darwin')
        self.assertEqual(dialog.executable, executable)

    def test_darwin_helper_exception_still_checks_the_child_and_never_retries(self):
        native, _ = self.darwin_owned_native([None, 7])
        dialog = Dialog(native, 'Darwin')
        with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired('synthetic', 30)) as run:
            with self.assertRaisesRegex(AssertionError, 'Owned app'):
                dialog.call('location-identity')
        self.assertEqual(run.call_count, 1)
        self.assertEqual(native.app.poll.call_count, 2)

    def test_darwin_executable_request_and_token_are_exact_before_subprocess(self):
        from types import SimpleNamespace
        native, executable = self.darwin_owned_native()
        dialog = Dialog(native, 'Darwin')
        token = {**self.macos_token(), 'owner': {'pid': 10, 'executable': '/foreign/app'}}
        with patch.object(subprocess, 'run') as run:
            with self.assertRaises(AssertionError): dialog.call('confirm-key', token)
            run.assert_not_called()
        token['owner']['executable'] = executable
        with patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"invoked":true}')) as run:
            self.assertEqual(dialog.call('confirm-key', token), {'invoked': True})
        self.assertEqual(run.call_args.args[0][-4:-1], ['confirm-key', '10', executable])
        self.assertEqual(json.loads(run.call_args.args[0][-1]), token)

    def test_darwin_owned_child_is_a_real_direct_process_for_the_whole_helper_call(self):
        from types import SimpleNamespace
        executable = str(Path(sys.executable).resolve())
        child = subprocess.Popen([executable], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            # Exercise the real child lifetime on every host OS. The separate
            # Darwin request-schema tests use a synthetic absolute macOS path.
            dialog = Dialog.__new__(Dialog)
            dialog.native, dialog.system, dialog.linux = SimpleNamespace(app=child), 'Darwin', None
            dialog.child, dialog.child_pid, dialog.executable = child, child.pid, executable
            def observe(command, **_options):
                self.assertIsNone(child.poll())
                self.assertEqual(command[-3:], ['state', str(child.pid), executable])
                return SimpleNamespace(returncode=0, stdout='{"visible":true,"foreground":true,"owned":true}')
            with patch.object(subprocess, 'run', side_effect=observe):
                self.assertEqual(dialog.state(), {'visible': True, 'foreground': True, 'owned': True})
            self.assertIsNone(child.poll())
        finally:
            if child.poll() is None: child.terminate()
            child.communicate(timeout=10)

    def test_darwin_issued_identity_for_another_executable_is_rejected_before_input(self):
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        token = self.macos_token()
        token['owner']['executable'] = '/foreign/app'
        response = {'ready': True, 'owned': True, 'token': token}
        with patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(response))) as run:
            with self.assertRaises(AssertionError): Dialog(native, 'Darwin').call('location-identity')
        self.assertEqual(run.call_count, 1)

    def test_windows_location_facts_accept_only_the_exact_boolean_schema(self):
        prefix = "NATIVE CHOOSER WINDOWS LOCATION "
        facts = {key: False for key in WINDOWS_LOCATION_FIELDS}
        self.assertEqual(helper_diagnostics(prefix + json.dumps(facts)), [prefix + json.dumps(facts, sort_keys=True)])
        for invalid in ({**facts, "focus_edit": 1}, {**facts, "filename_id": "private"},
                        {**facts, "payload": "private"}, {key: value for key, value in facts.items() if key != "owned_after"}):
            self.assertEqual(helper_diagnostics(prefix + json.dumps(invalid)), [])

    def test_windows_false_location_wait_reports_only_changed_allowlisted_facts(self):
        from types import SimpleNamespace
        prefix = "NATIVE CHOOSER WINDOWS LOCATION "
        first = {key: False for key in WINDOWS_LOCATION_FIELDS}
        second = {**first, "gui_available": True}
        native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12)
        dialog = Dialog(native, "Windows")
        with patch("builtins.print") as printed:
            for facts in (first, first, second):
                result = SimpleNamespace(returncode=0, stdout='{"ready":false,"owned":true}',
                                         stderr=prefix + json.dumps(facts) + "\nprivate provider payload")
                with patch.object(subprocess, "run", return_value=result):
                    self.assertEqual(dialog.call("location-state"), {"ready": False, "owned": True})
        lines = [call.args[0] for call in printed.call_args_list if call.args and call.args[0].startswith(prefix)]
        self.assertEqual(lines, [prefix + json.dumps(facts, sort_keys=True) for facts in (first, second)])
        self.assertFalse(any("private" in str(call) for call in printed.call_args_list))

    def test_windows_select_timeout_captures_before_fixture_cleanup_and_never_inputs(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            fixture = output / "synthetic.bib"
            fixture.write_text(smoke.fixture(3))
            inputs = []
            native = SimpleNamespace(app=SimpleNamespace(pid=10, poll=lambda: None), picker_handle=12,
                                     key=lambda *_: inputs.append("key"), call=lambda *_: inputs.append("call"))
            dialog = Dialog(native, "Windows", output)
            failure = AssertionError("synthetic filename focus timeout")
            def capture(command, **options):
                self.assertTrue(fixture.exists())
                self.assertEqual(command[command.index("-Action") + 1], "capture-failure")
                self.assertEqual(command[command.index("-PickerHandle") + 1], "12")
                self.assertEqual(options["timeout"], 10)
                image = Path(command[command.index("-FailureImage") + 1])
                image.write_bytes(b"\x89PNG\r\n\x1a\nsynthetic")
                return SimpleNamespace(returncode=0, stdout='{"captured":true}', stderr="")
            with patch.object(dialog, "_select", side_effect=failure), patch.object(subprocess, "run", side_effect=capture):
                with self.assertRaises(AssertionError) as caught:
                    dialog.select(fixture)
            self.assertIs(caught.exception, failure)
            self.assertEqual(native.dialog_failure_capture, "captured")
            self.assertEqual(inputs, [])

    def test_windows_capture_failure_preserves_the_original_selection_error(self):
        from types import SimpleNamespace
        failure = AssertionError("synthetic selection failure")
        dialog = Dialog(SimpleNamespace(), "Windows")
        with patch.object(dialog, "_select", side_effect=failure), patch.object(dialog, "capture_failure", side_effect=RuntimeError("secondary capture failure")):
            with self.assertRaises(AssertionError) as caught:
                dialog.select(Path("synthetic.bib"))
        self.assertIs(caught.exception, failure)
        for system in ("Linux",):
            dialog.system = system
            with patch.object(dialog, "_select", side_effect=failure), patch.object(dialog, "capture_failure") as capture:
                with self.assertRaises(AssertionError):
                    dialog.select(Path("synthetic.bib"))
            capture.assert_not_called()

    def test_windows_failure_capture_requires_a_png_and_never_sends_input(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            inputs = []
            native = SimpleNamespace(app=SimpleNamespace(pid=10, poll=lambda: None), picker_handle=12,
                                     key=lambda *_: inputs.append("key"), call=lambda *_: inputs.append("call"))
            dialog = Dialog(native, "Windows", Path(folder))
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"captured":true}', stderr="")):
                dialog.capture_failure()
            self.assertEqual(native.dialog_failure_capture, "unavailable")
            with patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("synthetic capture", 10)):
                dialog.capture_failure()
            self.assertEqual(native.dialog_failure_capture, "unavailable")
            self.assertEqual(inputs, [])

    def test_windows_failure_capture_preserves_the_first_owned_png(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "chooser-failure.png"
            first = b"\x89PNG\r\n\x1a\nsynthetic first failure"
            image.write_bytes(first)
            native = SimpleNamespace(app=SimpleNamespace(pid=10, poll=lambda: None), picker_handle=12)
            with patch.object(subprocess, "run") as capture:
                Dialog(native, "Windows", Path(folder)).capture_failure()
            capture.assert_not_called()
            self.assertEqual(image.read_bytes(), first)

    def test_rename_query_requires_verified_hide_then_foreground_show_before_typing(self):
        for system, shortcut in (("Linux", "ctrl+shift+y"), ("Windows", "ctrl+shift+y"), ("Darwin", "ctrl+super+r")):
            actions = []
            class Native:
                def key(self, key): actions.append(key)
            snapshots = iter([{"visible": False}, {"visible": True, "foreground": True, "keyboard": self.keyboard_evidence(), "nodes": [{"name": "Search references", "role": "ControlType.ComboBox", "focused": True}]}])
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                prepare_rename_query(Native(), lambda: next(snapshots), system)
                actions.append("type")
            self.assertEqual(actions, ["Escape", shortcut, "type"])

    def test_rename_query_never_summons_after_failed_hide_or_types_without_ready_picker(self):
        for current, expected_actions in (({"visible": True}, ["Escape"]),
            ({"visible": False, "foreground": False, "nodes": []}, ["Escape", "ctrl+shift+y"]),
            ({"visible": True, "foreground": False, "nodes": [{"name": "Search references"}]}, ["Escape", "ctrl+shift+y"]),
            ({"visible": True, "foreground": True, "nodes": []}, ["Escape", "ctrl+shift+y"])):
            actions = []
            class Native:
                def key(self, key): actions.append(key)
            def snapshot():
                return current if len(expected_actions) == 1 or len(actions) > 1 else {"visible": False}
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaises(AssertionError):
                    prepare_rename_query(Native(), snapshot, "Linux")
                    actions.append("type")
            self.assertEqual(actions, expected_actions)

    def test_every_rename_query_prepares_focus_before_its_distinct_native_input(self):
        with tempfile.TemporaryDirectory() as folder:
            library, _, settings, _, click, query, snapshot = self.rename_case(folder)
            actions = []
            def typed(index): actions.append(index); query(index)
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                rename_library_roundtrip(library, settings, click, snapshot, typed, lambda previous: actions.append(("prepare", previous)))
            self.assertEqual(actions, [("prepare", 1), 0, ("prepare", 0), 4, ("prepare", 4), 2])

    def rename_case(self, folder, *, stale=False, change_settings=False):
        library = Path(folder) / "example 引用.bib"
        library.write_text(smoke.fixture(), encoding="utf-8")
        renamed = library.with_name("renamed 引用.bib")
        settings = Path(folder) / "settings.json"
        settings.write_text(json.dumps({"schema_version": 2, "library": {"bibtex": str(library)}}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        state = {"count": 3, "missing": False, "query": None, "queries": []}

        def click(name):
            self.assertEqual(name, "Reload")
            state["missing"] = not library.exists()
            if state["missing"]:
                self.assertTrue(renamed.is_file())
                # A path-identity predicate fails while the selected file is
                # absent. Persisted settings must instead be compared by bytes.
                with self.assertRaises(FileNotFoundError):
                    Path(json.loads(settings.read_text(encoding="utf-8"))["library"]["bibtex"]).samefile(library)
                if change_settings:
                    settings.write_text(json.dumps(json.loads(settings.read_text(encoding="utf-8"))), encoding="utf-8")
            elif not stale:
                state["count"] = library.read_text(encoding="utf-8").count("@article{")

        def query(index):
            state["query"] = index
            state["queries"].append(index)

        def snapshot():
            nodes = [{"name": f"{library.name}: {state['count']} references"}]
            if state["missing"]:
                nodes.append({"name": f"The library could not be opened: {library.name}. the library file is unavailable; keeping the last loaded references. Choose it again or reconnect the drive."})
            if state["query"] is not None:
                index = state["query"]
                nodes.append({"name": "Search references", "value": f"smoke{index:06d}"})
                if index < state["count"]:
                    nodes.extend([{"name": f"Ibis smoke reference {index:06d}"}, {"name": "1 result"}])
            return {"nodes": nodes}

        return library, renamed, settings, state, click, query, snapshot

    def test_rename_roundtrip_requires_new_content_then_restores_the_baseline(self):
        with tempfile.TemporaryDirectory() as folder:
            library, renamed, settings, state, click, query, snapshot = self.rename_case(folder)
            original, preferences = library.read_bytes(), settings.read_bytes()
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                rename_library_roundtrip(library, settings, click, snapshot, query)
            self.assertEqual(state["queries"], [0, 4, 2])
            self.assertEqual(state["count"], 3)
            self.assertEqual(library.read_bytes(), original)
            self.assertEqual(settings.read_bytes(), preferences)
            self.assertFalse(renamed.exists())

    def test_rename_recovery_rejects_a_stale_retained_snapshot_and_returns_the_owned_path(self):
        with tempfile.TemporaryDirectory() as folder:
            library, renamed, settings, state, click, query, snapshot = self.rename_case(folder, stale=True)
            original = library.read_bytes()
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaisesRegex(AssertionError, "distinct recovery"):
                    rename_library_roundtrip(library, settings, click, snapshot, query)
            self.assertEqual(state["queries"], [0])
            self.assertEqual(library.read_bytes(), original)
            self.assertFalse(renamed.exists())

    def test_rename_retained_query_cannot_reuse_the_preceding_query_one(self):
        with tempfile.TemporaryDirectory() as folder:
            library, _, settings, state, click, query, snapshot = self.rename_case(folder)
            def stale_query_snapshot():
                current = snapshot()
                if state["query"] == 0:
                    for node in current["nodes"]:
                        if node.get("name") == "Search references":
                            node["value"] = "smoke000001"
                        if node.get("name") == "Ibis smoke reference 000000":
                            node["name"] = "Ibis smoke reference 000001"
                return current
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaisesRegex(AssertionError, "retained query"):
                    rename_library_roundtrip(library, settings, click, stale_query_snapshot, query)
            self.assertEqual(state["queries"], [0])

    def test_rename_count_and_query_must_pass_in_the_same_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            library, _, settings, state, click, query, snapshot = self.rename_case(folder)
            alternating = 0
            def inconsistent_snapshot():
                nonlocal alternating
                current = snapshot()
                if state["query"] == 4:
                    alternating += 1
                    if alternating % 2:
                        for node in current["nodes"]:
                            if node.get("name") == "Search references":
                                node["value"] = "smoke000000"
                            if node.get("name") == "Ibis smoke reference 000004":
                                node["name"] = "Ibis smoke reference 000000"
                    else:
                        current["nodes"][0]["name"] = f"{library.name}: 3 references"
                return current
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaisesRegex(AssertionError, "distinct recovery query"):
                    rename_library_roundtrip(library, settings, click, inconsistent_snapshot, query)

    def test_rename_rejects_even_semantically_identical_rewritten_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            library, renamed, settings, state, click, query, snapshot = self.rename_case(folder, change_settings=True)
            original, preferences = library.read_bytes(), settings.read_bytes()
            expected_choice = json.loads(preferences)
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                with self.assertRaisesRegex(AssertionError, "saved settings bytes changed"):
                    rename_library_roundtrip(library, settings, click, snapshot, query)
            self.assertNotEqual(settings.read_bytes(), preferences)
            self.assertEqual(json.loads(settings.read_bytes()), expected_choice)
            self.assertEqual(library.read_bytes(), original)
            self.assertFalse(renamed.exists())

    def test_helper_diagnostics_reject_provider_text_and_untrusted_metadata(self):
        windows = {"stage": "target", "reason": "target-unavailable", "matches": 0, "enumerated": 20, "owned": True, "foreground": True,
                   "selector": {"buttons": 4, "exact_id": 0, "exact_name": 0, "offscreen": 0, "eligible": 0}}
        prefix = "NATIVE CHOOSER WINDOWS "
        mac = 'NATIVE CHOOSER MACOS {"stage":"location"}'
        allowed = prefix + json.dumps(windows)
        self.assertEqual(len(helper_diagnostics((allowed + "\n" + mac).encode())), 2)
        rejected = ["private provider failure", prefix + "private provider failure"]
        for field, value in (("stage", "private path"), ("reason", "private payload"), ("matches", True), ("enumerated", 4001), ("owned", 1)):
            rejected.append(prefix + json.dumps({**windows, field: value}))
        rejected += [prefix + json.dumps({**windows, "payload": "private"}), 'NATIVE CHOOSER MACOS {"stage":"private"}', 'NATIVE CHOOSER MACOS {"stage":"location","payload":"private"}']
        for selector in (None, [], {}, {**windows["selector"], "buttons": True}, {**windows["selector"], "exact_name": 4001}, {**windows["selector"], "payload": "private"}):
            rejected.append(prefix + json.dumps({**windows, "selector": selector}))
        self.assertEqual(helper_diagnostics("\n".join(rejected)), [])
        self.assertEqual(len(helper_diagnostics("\n".join([allowed] * 100))), 16)
        last = 'NATIVE CHOOSER MACOS {"stage":"invoke"}'
        self.assertIn('"invoke"', helper_diagnostics("\n".join([allowed] * 100 + [last]))[-1])

    def test_windows_raw_diagnostics_use_the_same_strict_metadata_schema(self):
        prefix = "NATIVE CHOOSER WINDOWS RAW "
        value = {"stage": "target", "reason": "target-unavailable", "matches": 0, "enumerated": 20,
                 "owned": True, "foreground": True,
                 "selector": {"buttons": 4, "exact_id": 0, "exact_name": 0, "offscreen": 0, "eligible": 0}}
        self.assertEqual(helper_diagnostics(prefix + json.dumps(value)), [prefix + json.dumps(value, sort_keys=True)])
        for invalid in ({**value, "payload": "private"}, {**value, "matches": True},
                        {**value, "selector": {**value["selector"], "buttons": 4001}}):
            self.assertEqual(helper_diagnostics(prefix + json.dumps(invalid)), [])
        self.assertEqual(helper_diagnostics(prefix + "private provider data"), [])

    def test_windows_failure_image_is_scoped_to_the_requested_output(self):
        from types import SimpleNamespace
        native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12, call=lambda *_: True)
        for output in (None, Path("owned output")):
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"dialog_handle":20,"key":"escape"}')) as run:
                Dialog(native, "Windows", output).call("cancel")
            command = run.call_args.args[0]
            if output is None:
                self.assertNotIn("-FailureImage", command)
            else:
                self.assertEqual(command[-2:], ["-FailureImage", str(output / "chooser-failure.png")])

    def test_binary_hashing_supports_the_python_310_native_atspi_runner(self):
        import io
        content = b"synthetic executable" * 100000
        class BoundedReader(io.BytesIO):
            def read(self, size=-1):
                self_test.assertGreater(size, 0)
                self_test.assertLessEqual(size, 1024 * 1024)
                return super().read(size)
        self_test = self
        original_open = Path.open
        def open_owned(path, *args, **kwargs):
            return BoundedReader(content) if path == Path("owned executable") else original_open(path, *args, **kwargs)
        with patch.object(Path, "open", new=open_owned), patch.object(hashlib, "file_digest", create=True, side_effect=AssertionError("Not available in Python 3.10")):
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(smoke.Unavailable):
                    check(Path("owned executable"), Path(folder), "unsupported test platform")
                report = json.loads((Path(folder) / "chooser.json").read_text(encoding="utf-8"))
                self.assertEqual(report["binary_sha256"], hashlib.sha256(content).hexdigest())

    def test_overrides_cannot_bypass_first_run(self):
        env = first_run_environment({"IBIS_LIBRARY": "private", "IBIS_GALLERY": "1", "IBIS_GALLERY_STATE": "empty", "IBIS_GALLERY_READY_FILE": "private"}, Path("synthetic"))
        self.assertFalse(any(key in env for key in ("IBIS_LIBRARY", "IBIS_GALLERY", "IBIS_GALLERY_STATE", "IBIS_GALLERY_READY_FILE")))

    def test_wrong_or_ambiguous_dialog_never_becomes_owned(self):
        self.assertIsNone(linux.owned_candidate([], 10))
        self.assertEqual(linux.owned_candidate([(20, 10, linux.TITLE)], 10), 20)
        for candidates in ([(20, 11, linux.TITLE)], [(20, 10, "other")], [(20, 10, linux.TITLE)] * 2):
            with self.assertRaises(AssertionError):
                linux.owned_candidate(candidates, 10)

    def test_ready_requires_every_boolean_and_rejects_coerced_values(self):
        for bad in ({"visible": True, "foreground": False, "owned": True}, {"visible": True, "foreground": True, "owned": False}):
            self.assertFalse(ready(bad))
        for bad in ({"visible": True}, {"visible": 1, "foreground": True, "owned": True}):
            with self.assertRaises(AssertionError):
                ready(bad)

    def test_a_running_or_failed_process_is_not_normal_quit(self):
        class Process:
            def poll(self): return None
            def wait(self, timeout): raise subprocess.TimeoutExpired("private", timeout)
        clicks = []
        with self.assertRaisesRegex(AssertionError, "promptly"):
            normal_quit(Process(), clicks.append)
        self.assertEqual(clicks, ["Quit Ibis"])

    def test_native_quit_click_time_counts_toward_the_ten_second_limit(self):
        class Process:
            def poll(self): return None
            def wait(self, timeout): return 0
        with patch.object(time, "monotonic", side_effect=[0, 11]):
            with self.assertRaisesRegex(AssertionError, "promptly"):
                normal_quit(Process(), lambda _: None)

    def test_a_visible_dialog_alone_cannot_prove_the_picker_stayed_visible(self):
        class Native:
            app = type("App", (), {"pid": 10})()
            def window(self, _pid): return "12"
        def run(*arguments):
            if arguments[1] == "getwindowpid": return "10"
            if arguments[1] == "search": return "20"
            raise AssertionError("unexpected native query")
        dialog = linux.Dialog(Native(), run)
        self.assertFalse(dialog.picker_visible())

    def test_cleanup_failure_still_attempts_settings_and_other_owned_resources(self):
        actions = []
        class Editor:
            def poll(self): return None
            def terminate(self): actions.append("terminate-editor")
            def wait(self, timeout): actions.append("reap-editor"); return 0
        class Native:
            editor = Editor()
            def close(self): actions.append("native"); raise RuntimeError("private")
        with patch.object(smoke, "clean_settings", side_effect=lambda _: actions.append("settings")):
            self.assertFalse(cleanup_owned(None, None, Native(), Path("owned")))
        self.assertEqual(actions, ["native", "terminate-editor", "reap-editor", "settings"])

    def macos_token(self):
        return {"owner": {"pid": 10, "executable": '/Applications/Ibis.app/Contents/MacOS/ibis-desktop'},
                "panel": {"window": 20, "bounds": {"X": -100, "Y": 20, "Width": 600, "Height": 500}},
                "sheet": {"bounds": {"X": -90, "Y": 30, "Width": 580, "Height": 200}}}

    def test_macos_logical_path_sheet_needs_no_separate_physical_window(self):
        token = self.macos_token()
        token["sheet"].pop("window", None)
        self.assertEqual(location_identity({"ready": True, "owned": True, "token": token}, 10), token)
        for section, field, value in (("owner", "pid", 2**31), ("panel", "window", 2**32), ("sheet", "window", 21)):
            invalid = json.loads(json.dumps(token))
            invalid[section][field] = value
            with self.assertRaises(AssertionError):
                location_token(invalid, 10)

    def macos_case(self, after, *, identity=None, confirm=None):
        actions = []
        class Native:
            app = type("App", (), {"pid": 10})()
            def key(self, key): actions.append("key:" + key)
            def set_clipboard(self, _text): actions.append("clipboard")
        dialog = Dialog.__new__(Dialog)
        dialog.native, dialog.system, dialog.linux = Native(), "Darwin", None
        token = self.macos_token()
        identities = iter(identity or [{"ready": True, "owned": True, "token": token}])
        states = iter(after)
        def call(action, supplied=None):
            actions.append(action)
            if action == "location-identity": return next(identities)
            self.assertEqual(supplied, token)
            if action == "after-location": return next(states)
            if action == "confirm-key":
                if isinstance(confirm, BaseException): raise confirm
                return {"invoked": True} if confirm is None else confirm
            self.fail("Legacy AX reads or actions must not follow path Return")
        dialog.call = call
        return dialog, actions

    def macos_wait(self, predicate, message):
        for _ in range(5):
            if predicate(): return
        self.fail(message)

    def test_macos_go_to_file_can_finish_selection_without_a_second_open(self):
        dialog, actions = self.macos_case([{"ready": True, "closed": True}])
        with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
            dialog.select(Path("owned synthetic.bib"))
        self.assertEqual(actions, ["key:super+shift+g", "location-identity", "clipboard", "key:super+v", "key:Return", "after-location"])

    def test_macos_waits_for_identity_and_sheet_dismissal_before_one_guarded_confirmation(self):
        dialog, actions = self.macos_case([
            {"ready": False, "closed": False}, {"ready": True, "closed": False},
            {"ready": True, "closed": False}, {"ready": True, "closed": True}],
            identity=[{"ready": False, "owned": False, "token": None},
                      {"ready": True, "owned": True, "token": self.macos_token()}])
        with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
            dialog.select(Path("owned synthetic.bib"))
        self.assertEqual(actions, ["key:super+shift+g", "location-identity", "location-identity", "clipboard",
            "key:super+v", "key:Return", "after-location", "after-location", "confirm-key", "after-location", "after-location"])

    def test_macos_does_not_retry_a_failed_guarded_confirmation(self):
        dialog, actions = self.macos_case([{"ready": True, "closed": False}], confirm=AssertionError("Native guard failed"))
        with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
            with self.assertRaisesRegex(AssertionError, "Native guard failed"):
                dialog.select(Path("owned synthetic.bib"))
        self.assertEqual(actions.count("confirm-key"), 1)
        self.assertEqual(actions.count("after-location"), 1)

    def test_macos_never_types_without_identity_or_confirms_before_sheet_dismissal(self):
        for identity, after, forbidden in (
            ([{"ready": False, "owned": False, "token": None}] * 5, [], "clipboard"),
            (None, [{"ready": False, "closed": False}] * 5, "confirm-key"),
        ):
            dialog, actions = self.macos_case(after, identity=identity)
            with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
                with self.assertRaises(AssertionError): dialog.select(Path("owned synthetic.bib"))
            self.assertNotIn(forbidden, actions)

    def test_macos_token_metadata_is_strict_and_belongs_to_the_running_app(self):
        token = self.macos_token()
        self.assertEqual(location_identity({"ready": True, "owned": True, "token": token}, 10), token)
        self.assertIsNone(location_identity({"ready": False, "owned": True, "token": None}, 10))
        invalid = [None, {}, {**token, "payload": "private"}]
        for section, field, value in (("owner", "pid", True), ("owner", "pid", 11), ("owner", "executable", "relative/app"),
                ("owner", "executable", "/bad\x00app"), ("owner", "executable", "/" * 1025), ("panel", "window", True),
                ("sheet", "window", 20), ("sheet", "window", -1)):
            malformed = json.loads(json.dumps(token))
            malformed[section][field] = value
            invalid.append(malformed)
        for field, value in (("X", True), ("Y", float("inf")), ("Width", 0), ("Height", 8193), ("Width", "600")):
            malformed = self.macos_token()
            malformed["sheet"]["bounds"][field] = value
            invalid.append(malformed)
        for malformed in invalid:
            with self.assertRaises(AssertionError):
                location_identity({"ready": True, "owned": True, "token": malformed}, 10)
        for malformed in ({"ready": True, "owned": False, "token": token},
                          {"ready": False, "owned": True, "token": token},
                          {"ready": 1, "owned": True, "token": token}):
            with self.assertRaises(AssertionError): location_identity(malformed, 10)

    def test_macos_invalid_identity_never_reaches_clipboard_or_path_input(self):
        dialog, actions = self.macos_case([], identity=[{"ready": True, "owned": True, "token": None}])
        with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
            with self.assertRaises(AssertionError): dialog.select(Path("owned synthetic.bib"))
        self.assertEqual(actions, ["key:super+shift+g", "location-identity"])

    def test_macos_token_is_only_forwarded_to_the_two_guarded_native_actions(self):
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        token = self.macos_token()
        for action, response in (("after-location", '{"ready":true,"closed":true}'), ("confirm-key", '{"invoked":true}')):
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=response)) as run:
                Dialog(native, "Darwin").call(action, token)
            self.assertEqual(run.call_args.args[0][-4:-1], [action, "10", self.macos_token()["owner"]["executable"]])
            self.assertEqual(json.loads(run.call_args.args[0][-1]), token)

    def test_macos_guarded_confirmation_requires_exact_success_metadata(self):
        from types import SimpleNamespace
        native, _ = self.darwin_owned_native()
        for response in ('true', '{"invoked":false}', '{"invoked":1}', '{"invoked":true,"extra":1}'):
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=response)):
                with self.assertRaises(AssertionError):
                    Dialog(native, "Darwin").call("confirm-key", self.macos_token())
        with patch.object(subprocess, "run") as run:
            for action, token in (("after-location", None), ("state", self.macos_token())):
                with self.assertRaises(AssertionError): Dialog(native, "Darwin").call(action, token)
            run.assert_not_called()

    def test_macos_native_closure_exception_does_not_become_success(self):
        dialog, actions = self.macos_case([])
        original = dialog.call
        def failed(action, token=None):
            if action == "after-location":
                actions.append(action)
                raise RuntimeError("Native identity observation failed")
            return original(action, token)
        dialog.call = failed
        with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
            with self.assertRaisesRegex(RuntimeError, "Native identity observation failed"):
                dialog.select(Path("owned synthetic.bib"))
        self.assertNotIn("confirm-key", actions)

    def test_linux_native_button_role_opens_once(self):
        class State:
            def contains(self, _flag): return True
        actions = []
        class Button:
            name = "Open"
            def getRoleName(self): return "button"
            def getState(self): return State()
            def queryAction(self): return self
            def doAction(self, index): actions.append(index); return True
        dialog = linux.Dialog.__new__(linux.Dialog)
        dialog.native = type("Native", (), {"atspi": type("Atspi", (), {"STATE_SHOWING": 1, "STATE_ENABLED": 2})()})()
        dialog._nodes = lambda: [Button()]
        with patch.object(linux.time, "monotonic", side_effect=[0, 11]):
            dialog.confirm()
        self.assertEqual(actions, [0])

    def test_macos_inconsistent_absence_does_not_complete_selection(self):
        for state in ({"ready": False, "closed": True}, {"ready": 1, "closed": True},
                      {"ready": True}, {"ready": True, "closed": True, "payload": "private"}):
            dialog, actions = self.macos_case([state])
            with patch.object(smoke, "wait_for", side_effect=self.macos_wait):
                with self.assertRaises(AssertionError):
                    dialog.select(Path("owned synthetic.bib"))
            self.assertNotIn("confirm-key", actions)

    def test_external_actions_require_exact_success_metadata(self):
        from types import SimpleNamespace
        inputs = []
        native = SimpleNamespace(app=SimpleNamespace(pid=10, args=[self.macos_token()['owner']['executable']], poll=lambda: None), picker_handle=12,
                                 call=lambda *arguments: inputs.append(arguments) or True)
        for system, accepted, rejected in (
            ("Windows", '{"dialog_handle":20,"key":"return"}', ["false", "true", "1", "null", '{"invoked":true}',
                '{"dialog_handle":true,"key":"return"}', '{"dialog_handle":0,"key":"return"}',
                '{"dialog_handle":9223372036854775808,"key":"return"}', '{"dialog_handle":20,"key":"escape"}',
                '{"dialog_handle":20,"key":"return","extra":1}']),
            ("Darwin", '{"invoked":true}', ["false", "true", '{"invoked":1}', '{"invoked":false}']),
        ):
            dialog = Dialog(native, system)
            for value in rejected:
                inputs.clear()
                with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=value)):
                    with self.assertRaises(AssertionError):
                        dialog.call("confirm")
                self.assertEqual(inputs, [])
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=accepted)):
                dialog.call("confirm")

    def test_windows_dialog_plan_passes_only_fixed_metadata_to_the_input_adapter(self):
        from types import SimpleNamespace
        actions = []
        native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12,
                                 call=lambda action, payload: actions.append((action, json.loads(payload))) or True)
        for action, key in (("cancel", "escape"), ("confirm", "return")):
            plan = json.dumps({"dialog_handle": 20, "key": key})
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=plan)):
                self.assertIs(Dialog(native, "Windows").call(action), True)
            self.assertEqual(actions[-1], ("dialog-key", {"dialog_handle": 20, "picker_handle": 12, "key": key}))

    def test_windows_dialog_input_requires_an_exact_adapter_acknowledgement(self):
        from types import SimpleNamespace
        for acknowledgement in (False, 1, None, {"invoked": True}):
            native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12, call=lambda *_: acknowledgement)
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"dialog_handle":20,"key":"return"}')):
                with self.assertRaises(AssertionError):
                    Dialog(native, "Windows").call("confirm")

    def test_linux_native_row_target_handles_nested_cells_and_rejects_ambiguity(self):
        from types import SimpleNamespace
        class Cell:
            def __init__(self, name, parent): self.name, self.parent = name, parent
            def getRoleName(self): return "table cell"
            def getState(self): return SimpleNamespace(contains=lambda _: True)
            def getIndexInParent(self): return 4
        table = SimpleNamespace(getRowAtIndex=lambda _: 1, nRows=3)
        parent = SimpleNamespace(name="", getRoleName=lambda: "table", queryTable=lambda: table)
        outer = Cell("", parent)
        cell = Cell("owned 引用.bib", outer)
        nodes = [cell, outer, parent]
        self.assertIsNone(linux.row_target([], cell.name, 1))
        self.assertEqual(linux.row_target(nodes, cell.name, 1), (table, 1))
        self.assertIsNone(linux.row_target(nodes, "foreign.bib", 1))
        with self.assertRaises(AssertionError):
            linux.row_target(nodes + [cell], cell.name, 1)
        with self.assertRaises(AssertionError):
            linux.row_target([cell], cell.name, 1)
        outer.parent = cell
        with self.assertRaises(AssertionError):
            linux.row_target(nodes, cell.name, 1)

    def test_native_query_requires_new_value_and_result_even_when_ax_focuses_the_option(self):
        current = {"nodes": [
            {"name": "Search references", "value": "smoke099997", "focused": False},
            {"name": "Ibis smoke reference 099997", "role": "option", "focused": True},
            {"name": "1 result"},
        ]}
        self.assertTrue(query_ready(current, 99997))
        current["nodes"][0]["value"] = "smoke099998"
        self.assertFalse(query_ready(current, 99997))
        current["nodes"][0]["value"] = "smoke099997"
        current["nodes"][1]["name"] = "Ibis smoke reference 099998"
        self.assertFalse(query_ready(current, 99997))

    def test_native_row_already_selected_skips_add_and_wrong_row_rejection_fails(self):
        from types import SimpleNamespace
        actions = []
        selected = SimpleNamespace(getSelectedRows=lambda: [1], addRowSelection=lambda _: actions.append("add"))
        linux.select_exact_row(selected, 1)
        self.assertEqual(actions, [])
        wrong = SimpleNamespace(getSelectedRows=lambda: [2], addRowSelection=lambda _: False)
        with self.assertRaises(AssertionError):
            linux.select_exact_row(wrong, 1)
        rows = iter([[2], [1]])
        changed = SimpleNamespace(getSelectedRows=lambda: next(rows), addRowSelection=lambda _: False)
        linux.select_exact_row(changed, 1)

    def test_loaded_state_cannot_substitute_for_quitting_during_reload(self):
        clicks = []
        snapshot = lambda: {"nodes": [{"name": "synthetic.bib: 100000 references"}]}
        def require(predicate, _description):
            if not predicate(): raise AssertionError("pending reload was not observed")
        with patch.object(smoke, "wait_for", side_effect=require):
            with self.assertRaises(AssertionError):
                quit_during_reload(None, clicks.append, snapshot, "synthetic.bib")
        self.assertEqual(clicks, ["Reload"])

    def test_reload_quit_requires_pending_state_then_zero_exit(self):
        actions = []
        class Process:
            def poll(self): return None
            def wait(self, timeout): actions.append(("exit", timeout)); return 0
        snapshot = lambda: {"nodes": [{"name": "Reloading synthetic.bib…"}]}
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, _: self.assertTrue(predicate())), patch.object(time, "monotonic", side_effect=[0, 0]):
            quit_during_reload(Process(), actions.append, snapshot, "synthetic.bib")
        self.assertEqual(actions, ["Reload", "Quit Ibis", ("exit", 10)])

    def test_a_dangling_settings_symlink_is_not_owned(self):
        with patch.object(Path, "is_symlink", return_value=True), patch.object(smoke, "claim_settings") as claim:
            with self.assertRaises(smoke.Unavailable):
                claim_owned_settings(Path("synthetic/settings.json"))
        claim.assert_not_called()

    def test_existing_settings_are_refused_and_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            path.write_text("private", encoding="utf-8")
            with self.assertRaises(smoke.Unavailable): smoke.claim_settings(path)
            self.assertEqual(path.read_text(encoding="utf-8"), "private")


def main():
    if "--self-test" in sys.argv:
        unittest.main(argv=[sys.argv[0]])
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.app.is_file(): parser.error("--app must name the native executable")
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        check(args.app, args.output, platform.system())
    except smoke.Unavailable:
        print("Native chooser capability unavailable; inspect fixed helper diagnostics.", file=sys.stderr)
        return 2
    except Exception:
        print("Native chooser verification failed; inspect chooser.json and synthetic startup logs.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
