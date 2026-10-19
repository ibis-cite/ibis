#!/usr/bin/env python3
"""Verify first-run native library selection and normal Quit with owned fixtures."""
import argparse
import importlib.util
import hashlib
import json
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


def helper_diagnostics(stderr):
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    if not isinstance(stderr, str):
        return []
    safe = []
    for line in stderr[:65536].splitlines():
        prefix = next((value for value in ("NATIVE CHOOSER WINDOWS ", "NATIVE CHOOSER MACOS ") if line.startswith(value)), None)
        if prefix is None:
            continue
        try:
            value = json.loads(line[len(prefix):])
        except ValueError:
            continue
        if not isinstance(value, dict):
            continue
        if prefix == "NATIVE CHOOSER MACOS ":
            valid = set(value) == {"stage"} and value["stage"] in ("identity", "scope", "location", "controls", "invoke")
        else:
            valid = (set(value) == {"stage", "reason", "matches", "enumerated", "owned", "foreground"}
                     and value["stage"] in ("startup", "assembly", "resolve", "tree", "target", "verify", "pattern", "invoke")
                     and value["reason"] in ("provider-unavailable", "picker-identity", "enumeration-bound", "dialog-ambiguous", "dialog-ownership", "owner-bound", "accessibility-identity", "tree-bound", "not-foreground", "target-unavailable", "ownership-changed")
                     and all(type(value[key]) is int and 0 <= value[key] <= 4000 for key in ("matches", "enumerated"))
                     and all(type(value[key]) is bool for key in ("owned", "foreground")))
        if valid:
            safe.append(prefix + json.dumps(value, sort_keys=True))
            if len(safe) == 16:
                break
    return safe


def query_ready(current, index):
    key = f"smoke{index:06d}"
    text = smoke.strings(current)
    return (any(node.get("value") == key for node in smoke.named(current, "Search references"))
            and f"Ibis smoke reference {index:06d}" in text and "1 result" in text)


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
    def __init__(self, native, system):
        self.native, self.system = native, system
        self.linux = linux.Dialog(native, smoke.run) if system == "Linux" else None

    def call(self, action):
        if self.linux:
            return getattr(self.linux, action.replace("-", "_"))()
        print(f"NATIVE CHOOSER ACTION {action}", flush=True)
        if self.system == "Windows":
            command = ["pwsh", "-NoProfile", "-File", str(ROOT / "dialog-windows.ps1"),
                       "-Action", action, "-AppId", str(self.native.app.pid),
                       "-PickerHandle", str(self.native.picker_handle)]
        else:
            command = ["osascript", "-l", "JavaScript", str(ROOT / "dialog-macos.js"),
                       action, str(self.native.app.pid)]
        try:
            result = subprocess.run(command, encoding="utf-8", stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=30)
        except subprocess.TimeoutExpired as error:
            for line in helper_diagnostics(error.stderr):
                print(line, file=sys.stderr, flush=True)
            raise AssertionError("Native chooser helper timed out") from None
        if result.returncode:
            for line in helper_diagnostics(result.stderr):
                print(line, file=sys.stderr, flush=True)
            raise smoke.Unavailable("Native chooser action unavailable")
        try:
            value = json.loads(result.stdout)
        except ValueError:
            raise AssertionError("Native chooser helper returned invalid metadata") from None
        if action in ("confirm", "cancel"):
            invoked = value is True if self.system == "Windows" else (
                isinstance(value, dict) and set(value) == {"invoked"} and value["invoked"] is True)
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
        smoke.wait_for(lambda: all(flags(self.call("location-state"), ("ready", "owned")).values()),
                       "owned native location field receives focus")
        if self.system != "Darwin":
            self.native.key("ctrl+a")
        if self.system == "Windows":
            self.native.text(str(path))
        else:
            self.native.set_clipboard(str(path))
            self.native.key("super+v" if self.system == "Darwin" else "ctrl+v")
        if self.system == "Darwin":
            self.native.key("Return")
            smoke.wait_for(lambda: not flags(self.call("location-state"), ("ready", "owned"))["ready"],
                           "native Go To Folder sheet closes")
            if not any(self.state().values()):
                return # The caller still verifies the exact loaded/saved library.
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
            subprocess.run(["pwsh", "-NoProfile", "-File", str(ROOT / "dialog-windows.ps1"), "-SelfTest"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
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
            dialog = Dialog(native, system)
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
            dialog = Dialog(native, system)
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
    def test_helper_diagnostics_reject_provider_text_and_untrusted_metadata(self):
        windows = {"stage": "target", "reason": "target-unavailable", "matches": 0, "enumerated": 20, "owned": True, "foreground": True}
        prefix = "NATIVE CHOOSER WINDOWS "
        mac = 'NATIVE CHOOSER MACOS {"stage":"location"}'
        allowed = prefix + json.dumps(windows)
        self.assertEqual(len(helper_diagnostics((allowed + "\n" + mac).encode())), 2)
        rejected = ["private provider failure", prefix + "private provider failure"]
        for field, value in (("stage", "private path"), ("reason", "private payload"), ("matches", True), ("enumerated", 4001), ("owned", 1)):
            rejected.append(prefix + json.dumps({**windows, field: value}))
        rejected += [prefix + json.dumps({**windows, "payload": "private"}), 'NATIVE CHOOSER MACOS {"stage":"private"}', 'NATIVE CHOOSER MACOS {"stage":"location","payload":"private"}']
        self.assertEqual(helper_diagnostics("\n".join(rejected)), [])
        self.assertEqual(len(helper_diagnostics("\n".join([allowed] * 100))), 16)

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

    def test_macos_go_to_file_can_finish_selection_without_a_second_open(self):
        class Native:
            def key(self, _key): pass
            def set_clipboard(self, _text): pass
        dialog = Dialog.__new__(Dialog)
        dialog.native, dialog.system, dialog.linux = Native(), "Darwin", None
        actions = []
        locations = iter([{"ready": True, "owned": True}, {"ready": False, "owned": False}])
        def call(action):
            actions.append(action)
            if action == "location-state": return next(locations)
            if action == "state": return {"visible": False, "foreground": False, "owned": False}
            raise AssertionError("Do not invoke Open after native file selection completed")
        dialog.call = call
        with patch.object(smoke, "wait_for", side_effect=lambda predicate, _description: self.assertTrue(predicate())):
            dialog.select(Path("owned synthetic.bib"))
        self.assertNotIn("confirm", actions)

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
        class Native:
            def key(self, _key): pass
            def set_clipboard(self, _text): pass
        for state in ({"visible": False, "foreground": True, "owned": False},
                      {"visible": False, "foreground": False, "owned": True}):
            dialog = Dialog.__new__(Dialog)
            dialog.native, dialog.system, dialog.linux = Native(), "Darwin", None
            locations = iter([{"ready": True, "owned": True}, {"ready": False, "owned": False}])
            dialog.call = lambda action: next(locations) if action == "location-state" else state
            with patch.object(smoke, "wait_for", side_effect=lambda predicate, _description: self.assertTrue(predicate())):
                with self.assertRaises(AssertionError):
                    dialog.select(Path("owned synthetic.bib"))

    def test_external_actions_require_exact_success_metadata(self):
        from types import SimpleNamespace
        native = SimpleNamespace(app=SimpleNamespace(pid=10), picker_handle=12)
        for system, accepted, rejected in (
            ("Windows", "true", ["false", "1", "null", '{"invoked":true}']),
            ("Darwin", '{"invoked":true}', ["false", "true", '{"invoked":1}', '{"invoked":false}']),
        ):
            dialog = Dialog(native, system)
            for value in rejected:
                with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=value)):
                    with self.assertRaises(AssertionError):
                        dialog.call("confirm")
            with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=accepted)):
                dialog.call("confirm")

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
