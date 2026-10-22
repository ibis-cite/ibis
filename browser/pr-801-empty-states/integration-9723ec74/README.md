# Integrated empty-state evidence

Source: 9723ec740c72c2c96c8fcdad89734ec977200ed1. Actual-main baseline: 9456d8096180878457f10c11af174e650f30df43. Synthetic data; Chromium 151.0.7922.34.

All 452 UI tests, including all 12 EmptyState cases, TypeScript and gallery build passed. All 240 browser cases passed. Final guarded full and independent integration review remain pending. The PR stays draft while paused.

216 normal cases cover three platform looks, light/dark, 360/720 widths, fine/coarse emulation, normal/Larger/200% text and idle/no-results/empty. Another 24 cover long multilingual filenames with combining marks and emoji, empty names, absent Intl.Segmenter and Zotero recovery. Adversarial gallery fixture fields are overridden in memory; product modules are unchanged.

The 36 before/after frames are 720×480; baseline idle is reached by clearing Search. The 12 adversarial frames are 360×480 and intentionally scrolled to reachable recovery actions; full titles can begin above the viewport. All 48 raw frames were visually inspected through the two contact sheets before pause. These browser look/input emulations do not establish native materials, touch, voice or screen-reader acceptance.

Failing-first: idle hint regression failed before wiring. Eight no-results profiles exceeded three description lines before equivalent shorter wording; the expected-copy regression failed first. One whole UI run then had 451 passes and one stale App.test literal failure, corrected without weakening behavior assertions. A font assertion failed at idle 16px versus footer 12px before the hint token fix. Final source passes all those metrics.

Probe correction: six earlier no-results captures followed Clear search; capture ordering was corrected before these final frames. No product change addressed that probe error. The DOM-only wording experiment and earlier misleading frames are omitted.

Results retain separately qualified actual-main #543 checks and remaining #581 menu-row host/look label behavior. They are not native acceptance claims.
