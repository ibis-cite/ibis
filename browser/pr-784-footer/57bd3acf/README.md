# Footer actions — PR #784

Before: `47667263c7de94db5bd20daa909863f78cd45a4d` (current main after #791). After: `57bd3acf8565979e0f0838043fbb65ca05701a41`. Source is pushed as a draft; final integration, clean exact-head full check and independent review remain pending.

All frames are **synthetic browser renders**, Chromium 151.0.7922.34 on the host, using the repository's existing `openGallery` helper and fixture states. The selected platform appearance and navigator.platform agree. Native macOS, Windows and Linux behavior is unverified. PNG magic and 720×620 dimensions were verified from every image's bytes; all 72 frames were visually reviewed. No real library data is used.

## Behavioral and geometry evidence

All 428 interface tests, 234 focused App/KeyCaps/platform-look tests, TypeScript checking, evidence-gallery build and PR conventions passed. Two new footer button regressions fail before the runtime wiring. The pointer regression explicitly blurs Search between pointer-down and pointer-up, checking the same action survives to click. Existing readiness/stale/cancellation/IME guards are reused.

[Raw measurements](after/results.json): **72/72 passed**, from 3 looks × 2 themes × 2 text sizes × 3 widths (360/480/720) × pointer/coarse. Checks cover 32/44 px nonoverlapping targets, viewport containment, scaled 8 px label gaps, successful Copy after Search blur, and alternate Add/Remove selection. Six wide default-text cases also check Shortcuts dialog opening and return focus to its invoking button. The browser uses real pointer events and native button activation.

Narrow windows intentionally scroll the entire page before selection (#543/#726), so the probe scrolls the footer into view before measuring and activating it. Its first raw mouse coordinate was below that viewport; this was diagnosed as a probe setup issue, with no product change. Viewport comparisons allow one pixel for integer scroll offsets: four Larger-text cases end 0.36px below the exact boundary, with intact painted controls, no horizontal overflow and no target overlap. Earlier assertions treated those subpixels as a failure; the measured evidence records the corrected tolerance. Spacing scales with Larger text (8→9.2 px), as the existing rem tokens specify.

This is only #788's footer slice. Alt-only Add/Remove does not complete mouse-only selection; the row/chip/context-menu, native opening, outside-click and drag slices remain open. The old noninteractive/hidden-hint footer prose is reconciled in docs/design.md; the general per-OS geometry/token migration remains #762.

## Source-labelled frames

Normal/coarse/Alt/Larger use `many-results`. Menu uses `menu-open`; forced colours use Chromium's active forced-colours mode with the matching light/dark scheme. Larger means the existing 1.15 setting. Before/after Alt frames both start without a prior copy notice.

| Source | Appearance | Normal | Coarse | Alt | Larger | Menu | Forced colours |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | macos light | [view](before/macos-light-normal.png) | [view](before/macos-light-coarse.png) | [view](before/macos-light-alt.png) | [view](before/macos-light-large.png) | [view](before/macos-light-menu.png) | [view](before/macos-light-forced.png) |
| before | macos dark | [view](before/macos-dark-normal.png) | [view](before/macos-dark-coarse.png) | [view](before/macos-dark-alt.png) | [view](before/macos-dark-large.png) | [view](before/macos-dark-menu.png) | [view](before/macos-dark-forced.png) |
| before | windows light | [view](before/windows-light-normal.png) | [view](before/windows-light-coarse.png) | [view](before/windows-light-alt.png) | [view](before/windows-light-large.png) | [view](before/windows-light-menu.png) | [view](before/windows-light-forced.png) |
| before | windows dark | [view](before/windows-dark-normal.png) | [view](before/windows-dark-coarse.png) | [view](before/windows-dark-alt.png) | [view](before/windows-dark-large.png) | [view](before/windows-dark-menu.png) | [view](before/windows-dark-forced.png) |
| before | linux light | [view](before/linux-light-normal.png) | [view](before/linux-light-coarse.png) | [view](before/linux-light-alt.png) | [view](before/linux-light-large.png) | [view](before/linux-light-menu.png) | [view](before/linux-light-forced.png) |
| before | linux dark | [view](before/linux-dark-normal.png) | [view](before/linux-dark-coarse.png) | [view](before/linux-dark-alt.png) | [view](before/linux-dark-large.png) | [view](before/linux-dark-menu.png) | [view](before/linux-dark-forced.png) |
| after | macos light | [view](after/macos-light-normal.png) | [view](after/macos-light-coarse.png) | [view](after/macos-light-alt.png) | [view](after/macos-light-large.png) | [view](after/macos-light-menu.png) | [view](after/macos-light-forced.png) |
| after | macos dark | [view](after/macos-dark-normal.png) | [view](after/macos-dark-coarse.png) | [view](after/macos-dark-alt.png) | [view](after/macos-dark-large.png) | [view](after/macos-dark-menu.png) | [view](after/macos-dark-forced.png) |
| after | windows light | [view](after/windows-light-normal.png) | [view](after/windows-light-coarse.png) | [view](after/windows-light-alt.png) | [view](after/windows-light-large.png) | [view](after/windows-light-menu.png) | [view](after/windows-light-forced.png) |
| after | windows dark | [view](after/windows-dark-normal.png) | [view](after/windows-dark-coarse.png) | [view](after/windows-dark-alt.png) | [view](after/windows-dark-large.png) | [view](after/windows-dark-menu.png) | [view](after/windows-dark-forced.png) |
| after | linux light | [view](after/linux-light-normal.png) | [view](after/linux-light-coarse.png) | [view](after/linux-light-alt.png) | [view](after/linux-light-large.png) | [view](after/linux-light-menu.png) | [view](after/linux-light-forced.png) |
| after | linux dark | [view](after/linux-dark-normal.png) | [view](after/linux-dark-coarse.png) | [view](after/linux-dark-alt.png) | [view](after/linux-dark-large.png) | [view](after/linux-dark-menu.png) | [view](after/linux-dark-forced.png) |
