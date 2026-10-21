# Tray and soft-depth integration preflight

Synthetic Chromium, 72/72 cases passed: three OS looks, both themes, normal/larger/system-200% text, 360/720 px, LTR/RTL. Checked 50 chosen references: no partly clipped chip, no horizontal overflow, named removal controls, focused last-chip visibility, fade suppression for focus/contrast/forced colours, and Search focus after removal.

The UI-only tree combines main `2078154a`, tray `fcec761a` (#751), and depth `625f7e17` (#760). Source hashes are recorded. Documentation and #760's platform unit-test additions are excluded. This is a preflight, not a final merged tree or a substitute for guarded full checks, exact-head review or queue CI. Native materials are unverified. Repeat bounded integration checks after #751 lands if the actual source differs.
