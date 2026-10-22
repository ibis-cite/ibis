# Empty-state browser contact sheet

Source: `11afe326562cc50ff7bac4c2c82ce7b863dc9c4b`.
Actual-main baseline: `9456d8096180878457f10c11af174e650f30df43`.

One contact sheet, 24 frames: idle, no-results, empty library and loading,
each in macOS, Windows and Linux browser looks, light and dark, normal text.
Generated with the repository's existing `scripts/gallery-contact-sheet.mjs`
and Chromium 151.0.7922.34, using synthetic gallery data at 720×480.

All 24 frames rendered and were visually inspected. Empty/no-results/loading
have no section heading. Recovery descriptions fit one normal-size line and
the suggested action has a visible fill. Idle key hints retain footer styling.
Unit tests separately cover alternative recovery callbacks, long multilingual
names, complete accessible title text and the older-webview Segmenter fallback.

This establishes browser layout. No native run was dispatched for this UI-only
change; native material, keyboard delivery and screen-reader speech are not
claimed by this sheet. Final check/review status belongs in PR #801's single
current evidence comment.

![Synthetic browser contact sheet](contact-sheet-normal.png)
