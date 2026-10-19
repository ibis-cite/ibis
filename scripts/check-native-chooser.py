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
from unittest.mock import patch


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


def location_token(token, process_id):
    def exact(value, keys):
        return isinstance(value, dict) and set(value) == set(keys)
    def positive_integer(value):
        return type(value) is int and value > 0
    def finite(value):
        try:
            return type(value) in (int, float) and math.isfinite(value)
        except OverflowError:
            return False
    valid = exact(token, ("owner", "panel", "sheet"))
    if valid:
        owner = token["owner"]
        valid = (exact(owner, ("pid", "started")) and positive_integer(owner["pid"])
                 and owner["pid"] == process_id and finite(owner["started"]) and owner["started"] > 0)
    if valid:
        for key in ("panel", "sheet"):
            window = token[key]
            if not exact(window, ("window", "bounds")) or not positive_integer(window["window"]):
                valid = False
                break
            bounds = window["bounds"]
            if (not exact(bounds, ("X", "Y", "Width", "Height")) or not all(finite(value) for value in bounds.values())
                    or not 0 < bounds["Width"] <= 8192 or not 0 < bounds["Height"] <= 8192):
                valid = False
                break
    if not valid or token["panel"]["window"] == token["sheet"]["window"]:
        raise AssertionError("Native chooser location identity is invalid")
    return token


def location_identity(value, process_id):
    if (not isinstance(value, dict) or set(value) != {"ready", "owned", "token"}
            or type(value["ready"]) is not bool or type(value["owned"]) is not bool):
        raise AssertionError("Native chooser location metadata is invalid")
    if not value["ready"]:
        if value["token"] is not None:
            raise AssertionError("Unready native chooser exposed a location identity")
        return None
    if not value["owned"]:
        raise AssertionError("Ready native chooser is not owned")
    return location_token(value["token"], process_id)


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
    for line in stderr[:65536].splitlines():
        prefix = next((value for value in ("NATIVE CHOOSER WINDOWS RAW ", "NATIVE CHOOSER WINDOWS ", "NATIVE CHOOSER MACOS ") if line.startswith(value)), None)
        if prefix is None:
            continue
        try:
            value = json.loads(line[len(prefix):])
        except ValueError:
            continue
        if not isinstance(value, dict):
            continue
        if prefix == "NATIVE CHOOSER MACOS ":
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


def prepare_rename_query(native, snapshot, system):
    native.key("Escape")
    smoke.wait_for(lambda: not snapshot()["visible"], "rename query hides picker before restoring search focus")
    native.key("ctrl+super+r" if system == "Darwin" else "ctrl+shift+space")
    def ready():
        current = snapshot()
        return current["visible"] and current["foreground"] and bool(smoke.named(current, "Search references"))
    smoke.wait_for(ready, "rename query shows the foreground picker before typing")


def rename_library_roundtrip(library, settings, click, snapshot, query, prepare_query=lambda: None):
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
        prepare_query()
        query(0)
        smoke.wait_for(lambda: missing_explained(True), "renamed-away retained query is searchable with unchanged settings")

        renamed.rename(library)
        library.write_text(smoke.fixture(5), encoding="utf-8")
        click("Reload")
        smoke.wait_for(lambda: loaded(5), "distinct recovery content replaces the retained snapshot")
        prepare_query()
        query(4)
        smoke.wait_for(lambda: loaded(5, 4), "distinct recovery query and count are visible together with unchanged settings")

        library.write_bytes(original)
        click("Reload")
        smoke.wait_for(lambda: loaded(3), "rename roundtrip restores the original three references")
        prepare_query()
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

    def capture_failure(self):
        if self.system != "Darwin" or self.output is None or self.native.app.poll() is not None:
            return
        # Capture before the fixture context exits or owned processes stop.
        # The suite requires a disposable desktop with synthetic files.
        try:
            subprocess.run(["screencapture", "-x", str(self.output / "chooser-failure.png")],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            self.native.dialog_failure_capture = "captured"
        except (OSError, subprocess.SubprocessError):
            self.native.dialog_failure_capture = "unavailable"

    def call(self, action, token=None):
        guarded = self.system == "Darwin" and action in ("after-location", "confirm-key")
        if guarded:
            location_token(token, self.native.app.pid)
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
                       action, str(self.native.app.pid)]
            if guarded:
                command.append(json.dumps(token, allow_nan=False))
        try:
            result = subprocess.run(command, encoding="utf-8", stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=30)
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
        try:
            value = json.loads(result.stdout)
        except ValueError:
            raise AssertionError("Native chooser helper returned invalid metadata") from None
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
                try:
                    return Path(json.loads(settings.read_text(encoding="utf-8"))["library"]).samefile(expected or library)
                except (OSError, ValueError, KeyError, TypeError):
                    return False

            def query(index):
                key = f"smoke{index:06d}"
                native.key("ctrl+a" if system != "Darwin" else "super+a")
                native.text(key)
                smoke.wait_for(lambda: query_ready(snapshot(), index), "chosen library accepts a new query and is searchable")

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
                                     lambda: prepare_rename_query(native, snapshot, system))
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
            native.key("ctrl+super+r" if system == "Darwin" else "ctrl+shift+space")
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
    def test_rename_query_requires_verified_hide_then_foreground_show_before_typing(self):
        for system, shortcut in (("Linux", "ctrl+shift+space"), ("Windows", "ctrl+shift+space"), ("Darwin", "ctrl+super+r")):
            actions = []
            class Native:
                def key(self, key): actions.append(key)
            snapshots = iter([{"visible": False}, {"visible": True, "foreground": True, "nodes": [{"name": "Search references"}]}])
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, message: self.assertTrue(predicate(), message)):
                prepare_rename_query(Native(), lambda: next(snapshots), system)
                actions.append("type")
            self.assertEqual(actions, ["Escape", shortcut, "type"])

    def test_rename_query_never_summons_after_failed_hide_or_types_without_ready_picker(self):
        for current, expected_actions in (({"visible": True}, ["Escape"]),
            ({"visible": False, "foreground": False, "nodes": []}, ["Escape", "ctrl+shift+space"]),
            ({"visible": True, "foreground": False, "nodes": [{"name": "Search references"}]}, ["Escape", "ctrl+shift+space"]),
            ({"visible": True, "foreground": True, "nodes": []}, ["Escape", "ctrl+shift+space"])):
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
                rename_library_roundtrip(library, settings, click, snapshot, typed, lambda: actions.append("prepare"))
            self.assertEqual(actions, ["prepare", 0, "prepare", 4, "prepare", 2])

    def rename_case(self, folder, *, stale=False, change_settings=False):
        library = Path(folder) / "example 引用.bib"
        library.write_text(smoke.fixture(), encoding="utf-8")
        renamed = library.with_name("renamed 引用.bib")
        settings = Path(folder) / "settings.json"
        settings.write_text(json.dumps({"library": str(library)}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        state = {"count": 3, "missing": False, "query": None, "queries": []}

        def click(name):
            self.assertEqual(name, "Reload")
            state["missing"] = not library.exists()
            if state["missing"]:
                self.assertTrue(renamed.is_file())
                # A path-identity predicate fails while the selected file is
                # absent. Persisted settings must instead be compared by bytes.
                with self.assertRaises(FileNotFoundError):
                    Path(json.loads(settings.read_text(encoding="utf-8"))["library"]).samefile(library)
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
        return {"owner": {"pid": 10, "started": 100.5},
                "panel": {"window": 20, "bounds": {"X": -100, "Y": 20, "Width": 600, "Height": 500}},
                "sheet": {"window": 21, "bounds": {"X": -90, "Y": 30, "Width": 580, "Height": 200}}}

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
        for section, field, value in (("owner", "pid", True), ("owner", "pid", 11), ("owner", "started", float("nan")),
                ("owner", "started", float("inf")), ("owner", "started", 0), ("panel", "window", True),
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
        native = SimpleNamespace(app=SimpleNamespace(pid=10))
        token = self.macos_token()
        for action, response in (("after-location", '{"ready":true,"closed":true}'), ("confirm-key", '{"invoked":true}')):
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=response)) as run:
                Dialog(native, "Darwin").call(action, token)
            self.assertEqual(run.call_args.args[0][-3:-1], [action, "10"])
            self.assertEqual(json.loads(run.call_args.args[0][-1]), token)

    def test_macos_guarded_confirmation_requires_exact_success_metadata(self):
        from types import SimpleNamespace
        native = SimpleNamespace(app=SimpleNamespace(pid=10))
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
        native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12,
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
