# C5 browser pointer evidence

Candidate: `217792c6f5273e3f0a76f194fe301b05b7ac4ba0` (#1016). Baseline: merged main `e6808a76e1d0778651a400a914138e3d1e7d3fb5` (#1014).

These are **Chrome on macOS synthetic platform looks**, using the existing gallery's generated references. They are not native Windows/Linux screenshots. Native menus, OS focus/blur, actual clipboard writes and picker hiding are not certified by these gallery providers.

Six baseline cases copy on the first row click. Eighteen candidate cases select without copying, toggle through the primary modifier, press all four tile edges, isolate a 2px drag out of the tile, double-click to copy and immediately type into Search. Tile targets are checked against the 32px/44px minimum before actual mouse/touch activation. Normal frames use 720×640; Larger RTL/coarse frames use 400×640 with the app's 1.15× Larger setting and touch/mobile emulation. Forced colors use browser media emulation. Each target is remeasured after selection/reveal scrolling.

Meta-click uses real browser pointer input. Windows/Linux Control-click cases use a synthetic DOM click: the macOS host delivered trusted Control input as mousedown→contextmenu→mouseup, without a click, even with navigator Win32/isMac=false. Those cases do not prove native Control-click on another OS. Other pointer/touch, drag, double-click and typing checks use actual browser input.

A private negative control removed only the second-mousedown word-selection guard; actual double-click then produced no copy, while the candidate produced one. An initial private target calculation misread absent pseudo-element insets, and a later probe reused coordinates after the active row scrolled22px. Both probe assumptions were corrected without a product patch or longer deadline.

## Matched first-click frames

The baseline shows copy feedback; the candidate highlights/previews without copy feedback. All references and output are synthetic.

| Look | Theme | Before | After |
|---|---|---|---|
| macos | light | [Baseline](baseline-macos-light-normal.png) | [Candidate](candidate-macos-light-normal.png) |
| macos | dark | [Baseline](baseline-macos-dark-normal.png) | [Candidate](candidate-macos-dark-normal.png) |
| windows | light | [Baseline](baseline-windows-light-normal.png) | [Candidate](candidate-windows-light-normal.png) |
| windows | dark | [Baseline](baseline-windows-dark-normal.png) | [Candidate](candidate-windows-dark-normal.png) |
| linux | light | [Baseline](baseline-linux-light-normal.png) | [Candidate](candidate-linux-light-normal.png) |
| linux | dark | [Baseline](baseline-linux-dark-normal.png) | [Candidate](candidate-linux-dark-normal.png) |

The remaining candidate PNGs show Larger RTL/coarse and forced-color variants. `baseline-results.json` and `candidate-results.json` record the completed cases and modifier qualification.
