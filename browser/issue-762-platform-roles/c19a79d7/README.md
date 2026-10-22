# Per-OS role renewal: exact-head browser evidence

Actual main `32dac16af9fbec1de8635db12d4bcd7396e72d6e` → renewed foundations `c19a79d798407d94e8d4b5cfcdd1cc5419ac5fb7`.

All 120 before/after synthetic frame pairs rendered in Chromium 151.0.7922.34: three looks, light/dark, normal/Larger text, ten states. The five paired sheets cover results/More, Format/keyboard dialog, increased/forced contrast, 50-reference/system-large shelves, and toolbar/notice. All five were inspected, plus raw Windows dark keyboard dialog and GNOME light More. Clock fixed at 09:00 UTC. Browser fonts/materials are not native acceptance.

All 72 independent focus/layout profiles passed: normal, increased/forced/gallery contrast, 200% narrow text, right-to-left and non-Latin input, plus advanced-support branches disabled through CSSOM. These compare actual before/after bounds, focus outlines/offsets, Escape/Tab ownership, disabled text, menus, dialogs and key caps. CSSOM removal is a fallback-branch test, not an old-engine certification.

The Windows notice was separately rendered through the actual notice page at its 420 × 112 viewport in both themes. Its body remains x16/y16, 388 × 80. Asserted edge alpha stays bounded: bottom 3 in light and 6 in dark, sides 1. A Gaussian shadow has a faint tail; this does not claim zero pixels at every viewport edge. The earlier overlarge clipped shadow is not restored.

Current source checks passed: 91 focused tests, eight Node geometry-spec tests, TypeScript, UI imports and PR conventions. The two physical constants have their own test-first contract. The leased platform-look assertions are byte-identical to the prior reviewed head. No App/native source is changed by the PR.

The clean checkout/fresh-target full check is still running. Its result and independent exact-head review remain required before queueing. Historical f4d73842 verification is not reused as a current-head pass. Native material/platform acceptance remains #627, versioned macOS corners #691. The material Look-colour arithmetic retains explicit veil bounds and treats the prior amber as passing, with additional headroom from the new colour.
