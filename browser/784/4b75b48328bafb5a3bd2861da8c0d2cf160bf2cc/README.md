# Footer comparison for PR #784

Synthetic browser renders in Chromium 151.0.7922.34, 720×480 frames, captured on macOS. These render each OS look; they are not native captures.

- Before: `008f3e9a8fbd20458833057219ddf4df3a86d684`.
- After: `4b75b48328bafb5a3bd2861da8c0d2cf160bf2cc`.
- Both contact sheets cover macOS, Windows and Linux in light and dark, with many results and no results, at normal and Larger text sizes. Each contact sheet labels its source commit and browser.
- PNG signatures and dimensions were checked from the file bytes before publication. Every frame rendered without a browser error.
- `measurements.json` records 24 platform/theme/width/text cases (480 and 720 px). All pass spacing, cap size, edge alignment, visibility, wrapping separation, overflow and Alt-hint checks.

Missing views: native captures on all three systems, Alt-held screenshots, menu-open screenshots and forced-colour screenshots are not included. Alt behavior is checked by App tests and the geometry probe; native capture CI remains pending. A later main integration may change depth or menus; these images isolate the footer change at the commits above.
