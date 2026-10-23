# Native accent: synthetic browser acceptance

Source: `d68dcc8948a341e587dae01a0500a03ccb141325` (PR #909).

Chrome on macOS, 720 × 600, fine pointer, real React Aria hover/press and shared Button components. All references and names are synthetic. The existing gallery providers render the production App, EmptyState and controls; native RGB snapshots are injected through the production `setNativeAccent` function. Provider cases deliberately remove the gallery theme marker after the fixture settles, leaving the browser light/dark color scheme to select the real CSS roles. Separate guard cases keep the gallery markers.

These are **browser captures, not native OS screenshots or installed-app acceptance**. They do not prove macOS transport, wallpaper/material contrast, unsupported-webview behavior or Windows/GNOME native accent providers.

## Results

All 30 case groups passed: 16 color/theme groups, 12 fallback guards and two shipped recovery-button groups. Eight injected colors (blue, red, yellow, gray, olive, a finite crossover RGB, black and white) × light/dark cover actual rest/hover/pressed primary styles, winning macOS neutrals, pressed-over-hover precedence, disabled painting and selected-row citation tiles.

- Primary text minimum: **4.576:1** across 48 state measurements.
- Selected tile against row minimum: **4.689:1**; check against tile minimum: **3.916:1**.
- Focus cue minimum: **11.199:1** against opaque root/window/raised/overlay and field/menu fills composited over the root surface. Actual Reload keyboard focus also retains its 2 px ring and 1 px gap.
- Forced colors and increased contrast (light/dark), gallery light/dark/contrast, notice window, Windows/Linux looks and invalid-input clearing retain their pre-injection computed primary pair.
- Real Clear search and Reload primary controls pass hover/pressed contrast; releasing Clear search clears the query.

Raw computed values are in [results.json](results.json) and [supplement-results.json](supplement-results.json). Source inspection found no generic frontend contrast poller. `tokens.css` and shared `Button.css` are byte-identical to baseline `605538cb2e096f397d4dcb166f8fdeda28392ded`; this is not a full baseline UI build.

## Before/after labels

`*-unprojected-before.png` shows the browser's default system pair before injecting native RGB into the current UI. It is not the host macOS accent or an old native screenshot.

`*-clear-pressed-negative-before.png` is a deliberate browser-only negative control: force the resting foreground onto the existing pressed fill. The light crossover fails at **4.443:1**, then the unmodified final source switches foreground and passes at **4.727:1**. Dark olive fails at **3.731:1**, then passes at **5.629:1**. These controls isolate the repaired algorithm; they are not captures of a complete earlier commit. The matching `*-corrected-after.png` frames use final source with that temporary diagnostic override removed.

Other `*-after.png` frames show final projected states. `*-guard.png` frames show browser-emulated contrast guards. No real folder data, native settings or OS accent changes were used.
