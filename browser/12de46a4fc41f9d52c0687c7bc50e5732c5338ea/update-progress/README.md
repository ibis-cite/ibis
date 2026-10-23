# Synthetic update progress: browser evidence

Current source: `12de46a4fc41f9d52c0687c7bc50e5732c5338ea` (PR #1002).
Before comparison: prior PR candidate `8942f2991142860a287e562202fa7fef04516df7`, before the progress contrast/percentage correction. This is **not a main-branch baseline**.

Chrome on one macOS host rendered three platform looks. These are browser frames, not native Windows/Linux/macOS acceptance. The existing gallery renderer received synthetic provider events; no update command, network package download, signature installation or restart ran. Normal frames are 720×480; the Larger checks used 360×480 with RTL.

All 48 phase checks passed: three looks × light/dark × normal/Larger narrow RTL × known/unknown/checking/failed. They checked percentage semantics, horizontal fit, unchanged pin state and retained focus. See `results.json`. No coarse-input or native screen-reader claim.

| Look | Prior candidate | Current |
| --- | --- | --- |
| macOS light | [before](before-macos-light-known.png) | [current](macos-light-known.png) |
| Windows dark | [before](before-windows-dark-known.png) | [current](windows-dark-known.png) |
| Linux light | [before](before-linux-light-known.png) | [current](linux-light-known.png) |

Each current look also has `unknown`, `checking` and `failed` frames. Known progress shows 25%; unknown/checking never imply completion, and failure exposes the fixed existing-menu recovery direction.

A separate synthetic native-yellow projection measured the raw indicator at 1.739:1 against white before correction and the guarded accent-text indicator at 17.918:1 afterward. This checks browser-computed colors against a synthetic white surface; it is not a claim about native vibrancy or materials. Installed update/restart acceptance remains #493.
