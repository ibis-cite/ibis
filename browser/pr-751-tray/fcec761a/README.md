# Whole-row tray integration

Synthetic browser renders in Chromium 151.0.7922.34, not native captures.

- Before: main `47667263c7de94db5bd20daa909863f78cd45a4d`.
- After: PR #751 `fcec761a7c671451e1d28e14fd0bf176a2536191`.
- Each set contains tray-preview and many-results, all three platform looks,
  both themes, normal text, 720 × 480. The contact sheets label source and browser.

The same proposed geometry assertions ran against both builds. Main reproduces
12 clipped-chip failures; the after build fixes all 12. All 84 after layout
assertions pass. Both builds retain the same 12 corner-radius mismatches tracked
separately by #576. See `geometry-before.txt` and `geometry-after.txt`.

`adversarial.json` records 72 passing cases: three looks × two themes × normal,
Larger and system 200% text × 360/720 widths × LTR/RTL. Each checks whole chip
rows, no horizontal tray overflow, full-key names, keyboard removal and Search
return, the last chip's focus visibility, and fade removal in focus, increased
contrast and forced colors.

TypeScript, 34 focused UI tests and six geometry-script tests passed. A fresh
guarded full check is running separately. These renders do not certify native
appearance, screen-reader speech or OS input methods. Preview typography and the
existing tray follow-ups (#752) remain separate work.
