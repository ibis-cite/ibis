# Picker spacing: browser evidence

Candidate `72945b1a22370a5207f902832a4afdd406386271` (PR #1000, issue #941). Baseline `b4f434ce2f76f26c21603fc31c683e886b3a2d0d`.

These are **synthetic Chrome-on-macOS captures**, with macOS/Windows/GNOME looks selected before loading. They are not native Windows/Linux screenshots or installed-app acceptance. Native macOS acceptance is recorded separately on the PR.

## Before and after

Six normal-text pairs cover each look in light/dark at 720 × 480. `*-baseline-before.png` reconstructs the baseline using its exact three changed runtime CSS source blobs (tokens, picker styles, toolbar controls) on the unchanged production App/component tree and existing synthetic provider. Vite inlines the unchanged nativeAppearance stylesheet into the picker style node; that import is expanded identically. `*-candidate-after.png` restores the final source CSS in the same document. All other runtime source files match baseline. This is a CSS reconstruction, not a separate baseline build.

Measured normal-text totals:

| Look | Header before → after, including divider | Field before → after | Pin before → after | Footer before → after |
|---|---|---|---|---|
| macOS | 56 → 53 | 40 → 36 | 32 → 36 | 40 → 40 |
| Windows | 48 → 49 | 40 → 32 | 32 → 32 | 40 → 41 |
| GNOME | 56 → 51 | 40 → 34 | 32 → 34 | 40 → 41 |

The nominal header bands are 52/48/50; their outside divider adds 1 px. Windows' trailing inset moves 4 → 8 px. Footer fills stay 24 px with two 8 px gaps; Windows/GNOME add an outside divider.

## Checks and qualifications

- Twelve 720 × 480 cases (three looks × light/dark × normal/Larger) passed spacing and layout checks using the repository's actual `measure`, `compare` and `layout` functions. The results viewport stays 8 px (scaled) from neighboring bands before and after scrolling.
- Six fine-pointer LTR/RTL cases and six narrow coarse/Larger cases passed **192 actual pointer/touch activations** at all four target edges of Pin, format, Clear and More. Expanded macOS pop-up/footer targets were included. Clear returns focus to Search; menu tests wait for their deferred exit before screenshots.
- `*-coarse-large-rtl.png` shows the narrow wrapped header after exercising the controls, at 360 × 640 and the app's Larger scale (1.15). Wrapped bands grow, keep their outer padding, and retain the pin at the logical trailing edge. The inherited XS document scroller is preserved; tests scroll the footer into view before interacting with it.
- `windows-clear-hover.png` retains the platform focus underline with the resized field and hovered Clear control.
- **Existing radius mismatches remain visible in raw results**: the old macOS JSON spec assumes a 28 px window/20 px row while the browser fallback uses 12/6. Larger-text radius differences are likewise retained. No claim that the complete geometry CLI is green: the case `pass` field means spacing/layout only. Radius work remains #943.

Raw data: [results.json](results.json), [before-after-results.json](before-after-results.json), [fine-results.json](fine-results.json), [coarse-results.json](coarse-results.json). No new harness/dependency was committed. No native app, settings, folders or clipboard were accessed by this browser run.
