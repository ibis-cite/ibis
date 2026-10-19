import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("appearance", Path(__file__).with_name("check-native-appearance-macos.py"))
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)


class PreferenceTransactionTests(unittest.TestCase):
    def test_replaced_window_between_phases_cannot_produce_more_captures(self):
        from tempfile import TemporaryDirectory
        state = {"window": 12, "position": [20, 30], "size": [720, 480], "screen": [1600, 1000]}
        captures, writes = [], []
        read = appearance.pin_picker_window(lambda: dict(state))
        def resize(window, size):
            writes.append(window)
            state["size"] = list(size)
        with TemporaryDirectory() as folder, patch.object(appearance, "wait_for", side_effect=lambda read, _: read()):
            appearance.capture_sizes("material", Path(folder), read, resize, lambda path: captures.append(path.name))
            state["window"] = 13  # Same PID, dimensions and title; different native window.
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                appearance.capture_sizes("reduce-transparency", Path(folder), read, resize, lambda path: captures.append(path.name))
        self.assertEqual(captures, ["material.png", "material-resized.png"])
        self.assertEqual(writes, [12, 12])

    def test_each_phase_captures_normal_and_verified_resized_window_then_restores(self):
        from tempfile import TemporaryDirectory
        events = []
        state = {"window": 12, "position": [20, 30], "size": [720, 480], "screen": [1600, 1000]}
        def frame(): return dict(state)
        def resize(window, size):
            self.assertEqual(window, 12)
            events.append(("resize", size))
            state["size"] = list(size)
        with TemporaryDirectory() as folder, patch.object(appearance, "wait_for", side_effect=lambda read, _: read() or self.fail("no verified resize")):
            for name in appearance.APPEARANCE_PHASES:
                result = appearance.capture_sizes(name, Path(folder), frame, resize,
                    lambda path: events.append(("capture", path.name)))
                self.assertEqual(result, {"normal": [720, 480], "resized": [840, 560], "restored": True})
        captures = [value for action, value in events if action == "capture"]
        self.assertEqual(len(captures), 10)
        self.assertEqual(state["size"], [720, 480])
        self.assertIn("increase-contrast-resized.png", captures)

    def test_noop_resize_cannot_produce_resized_capture_and_still_restores(self):
        from tempfile import TemporaryDirectory
        captures, resized = [], []
        frame = lambda: {"window": 12, "position": [20, 30], "size": [720, 480], "screen": [1600, 1000]}
        def wait(read, _):
            if not read(): raise AssertionError("unverified resize")
        with TemporaryDirectory() as folder, patch.object(appearance, "wait_for", side_effect=wait):
            with self.assertRaisesRegex(AssertionError, "unverified resize"):
                appearance.capture_sizes("material", Path(folder), frame,
                    lambda window, size: resized.append(size), lambda path: captures.append(path.name))
        self.assertEqual(captures, ["material.png"])
        self.assertEqual(resized[-1], [720, 480])

    def test_failed_resized_capture_restores_geometry_and_both_preferences(self):
        from tempfile import TemporaryDirectory
        state = {"window": 12, "position": [20, 30], "size": [720, 480], "screen": [1600, 1000]}
        prefs = {"contrast": True, "transparency": True}
        def resize(window, size): state["size"] = list(size)
        def capture(path):
            if "resized" in path.name: raise RuntimeError("synthetic capture failure")
        with TemporaryDirectory() as folder, patch.object(appearance, "wait_for", side_effect=lambda read, _: read()):
            with self.assertRaisesRegex(RuntimeError, "synthetic capture failure"):
                with appearance.saved_preferences(lambda: dict(prefs), lambda key, value: prefs.update({key: value})):
                    prefs.update(contrast=False, transparency=False)
                    appearance.capture_sizes("material", Path(folder), lambda: dict(state), resize, capture)
        self.assertEqual(state["size"], [720, 480])
        self.assertEqual(prefs, {"contrast": True, "transparency": True})

    def test_invalid_or_offscreen_geometry_never_authorizes_resize(self):
        frame = {"window": 12, "position": [20, 30], "size": [720, 480], "screen": [1600, 1000]}
        for key, value in (("window", True), ("size", [float("nan"), 480]), ("position", [-1, 30]), ("screen", [700, 500])):
            with self.assertRaises(RuntimeError):
                appearance.picker_frame({**frame, key: value})

    def test_missing_fresh_image_cannot_reuse_prior_png_and_nonpng_is_rejected(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as folder, patch.object(appearance.time, "sleep"):
            path = Path(folder) / "material.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\nold evidence")
            with patch.object(appearance.subprocess, "run"):
                with self.assertRaisesRegex(RuntimeError, "not written"):
                    appearance.capture_screen(path)
            self.assertFalse(path.exists())
            with patch.object(appearance.subprocess, "run", side_effect=lambda *args, **kwargs: path.write_bytes(b"wrong format")):
                with self.assertRaisesRegex(RuntimeError, "not a PNG"):
                    appearance.capture_screen(path)

    def test_false_quit_request_can_still_have_verified_termination(self):
        ui = appearance.NativeUI()
        with patch.object(ui, "call", side_effect=[False, {"requested": False}, True]) as helper:
            ui.close(True)
        self.assertEqual(ui.cleanup_facts, {"requested": False, "terminated": True, "forced": False})
        self.assertFalse(any(call.args[0] == "force-close" for call in helper.call_args_list))

    def test_cleanup_never_forces_without_verified_original_preferences(self):
        ui = appearance.NativeUI()
        with patch.object(ui, "call", side_effect=[False, {"requested": False}, False]) as helper, patch.object(appearance, "wait_for", side_effect=AssertionError):
            with self.assertRaisesRegex(RuntimeError, "requires verified preference restoration"):
                ui.close(False)
        self.assertFalse(any(call.args[0] == "force-close" for call in helper.call_args_list))

    def test_exit_after_quit_deadline_needs_no_force_or_preference_override(self):
        ui = appearance.NativeUI()
        with patch.object(ui, "call", side_effect=[False, {"requested": False}, True]) as helper, patch.object(appearance, "wait_for", side_effect=AssertionError):
            ui.close(False)
        self.assertTrue(ui.cleanup_facts["terminated"])
        self.assertFalse(any(call.args[0] == "force-close" for call in helper.call_args_list))

    def test_native_controls_require_fresh_unique_ownership_before_invoking(self):
        subprocess.run(["node", str(Path(__file__).with_name("appearance-macos.test.cjs"))],
                       check=True, capture_output=True, timeout=20)

    def test_records_actual_final_state_but_still_fails_after_an_attempt_error(self):
        observations, calls = [], []
        def write(key, value):
            calls.append(key)
            if len(calls) == 1:
                raise appearance.HelperTimeout("Native appearance helper timed out")
        with self.assertRaisesRegex(RuntimeError, "Original accessibility preferences could not be restored"):
            with appearance.saved_preferences(lambda: {"contrast": False, "transparency": True}, write,
                                              observe=observations.append):
                pass
        self.assertEqual(observations[0]["final_preferences"], {"contrast": False, "transparency": True})
        self.assertTrue(observations[0]["matches_original"])
        self.assertEqual(observations[0]["attempts"][0]["stage"], "helper-timeout")
        self.assertEqual(len(observations[0]["attempts"]), 3)

    def test_restores_original_preferences_after_failed_observation(self):
        state = {"contrast": True, "transparency": True}
        def write(key, value):
            state[key] = value
        with self.assertRaisesRegex(AssertionError, "synthetic observation"):
            with appearance.saved_preferences(lambda: dict(state), write):
                write("contrast", False)
                write("transparency", False)
                raise AssertionError("synthetic observation")
        self.assertEqual(state, {"contrast": True, "transparency": True})

    def test_attempts_every_restore_after_one_failure(self):
        calls = []
        def write(key, value):
            calls.append((key, value))
            if len(calls) == 1:
                raise RuntimeError("synthetic restore failure")
        with self.assertRaisesRegex(RuntimeError, "Original accessibility preferences could not be restored"):
            with appearance.saved_preferences(lambda: {"contrast": False, "transparency": True}, write):
                pass
        self.assertEqual(calls, [("contrast", False), ("transparency", True), ("contrast", False)])

    def test_requires_boolean_state_before_any_change(self):
        calls = []
        with self.assertRaisesRegex(RuntimeError, "Native accessibility preference state unavailable"):
            with appearance.saved_preferences(lambda: {"contrast": None, "transparency": True}, lambda *args: calls.append(args)):
                self.fail("Invalid initial state entered transaction")
        self.assertEqual(calls, [])

    def test_reports_successful_restoration_even_when_observation_fails(self):
        restored = []
        with self.assertRaises(AssertionError):
            with appearance.saved_preferences(lambda: {"contrast": False, "transparency": True},
                                              lambda *args: None, lambda: restored.append(True)):
                raise AssertionError("synthetic observation")
        self.assertEqual(restored, [True])

    def test_mode_parser_accepts_only_fixed_native_facts(self):
        self.assertEqual(appearance.mode_facts("ibis: native appearance mode=vibrancy reason=applied\n"), [("vibrancy", "applied")])
        self.assertEqual(appearance.mode_facts("untrusted arbitrary error\nibis: native appearance mode=other reason=payload\n"), [])

    def test_contrast_observation_keeps_automatic_transparency_change(self):
        actual = {"contrast": True, "transparency": True}
        self.assertEqual(appearance.checked_preferences(actual, {"contrast": True}), actual)

    def test_material_observation_requires_both_accessibility_settings_off(self):
        with self.assertRaisesRegex(AssertionError, "Native accessibility preferences changed unexpectedly"):
            appearance.checked_preferences({"contrast": False, "transparency": True},
                                           {"contrast": False, "transparency": False})


if __name__ == "__main__":
    unittest.main()
