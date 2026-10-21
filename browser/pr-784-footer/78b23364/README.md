# Footer actions and large-text repair — PR #784

Final source for these captures: `78b23364797aa0b4b88de0fbffa3a4ca40cbda7f`. Main baseline: `47667263c7de94db5bd20daa909863f78cd45a4d`. Overflow regression before: `57bd3acf8565979e0f0838043fbb65ca05701a41`. Final integration/full check and independent review remain pending; this is synthetic browser evidence, not a native check.

All 428 UI tests, 234 focused footer/platform tests, gallery build and the previous TypeScript check passed. The source change after the last type check is CSS only.

## Verified browser behavior

- [72/72 action and geometry cases](after/results.json): three OS appearances, light/dark, normal/1.15 Larger text, 360/480/720 widths, pointer/coarse. Copy succeeds through pointer-down → Search blur → pointer-up/click; alternate Add/Remove works; six wide default-text cases also check shortcut-dialog return focus. Targets remain at least 32/44 px, do not overlap and stay in the scrolled viewport. The coarse target uses 2.75rem so system scaling preserves it.
- [36/36 system-200% geometry cases](system-after/system-text.json): three appearances, light/dark, 360/480/720 widths, pointer/coarse. Every hint stays inside its actual button and there is no horizontal overflow.
- [Before the repair](system-before/system-text.json), **four of those 36 cases fail** (Linux, 360 px, both themes and pointer/coarse). The Add hint's right edge is 382.953 px, beyond its 352 px button edge and the 360 px viewport. Its scrollWidth342 exceeds clientWidth310. [Independent review](https://github.com/ibiscite/ibis/pull/784#issuecomment-6327198880) confirmed old main fits.

Reproduction: open `gallery.html?state=large-text&platform=linux&theme=light` at 360×480, hold Alt, wait two animation frames and scroll the footer into view. Inspect the Add button, its `.key-hint` rectangle and scrollWidth/clientWidth. The repair lets only footer hints wrap inside a width-bounded button; shared menu key labels retain their normal single-line form.

The [earlier measurement notes](../57bd3acf/README.md) explain the intended narrow page scroller, rem scaling and one-pixel integer-scroll tolerance. Those setup corrections did not change product source. This new 200% issue was an actual introduced P2 and is repaired here.

## Reviewed frames

Chromium151.0.7922.34 through the existing repository gallery helper; matching navigator.platform and gallery look. All new PNG signatures/dimensions were checked from bytes and all48 new frames were visually reviewed. The36 unchanged main-baseline frames are linked from the preceding source directory; the36 new final-source standard frames are720×620 and the12 overflow before/after frames are360×480. Synthetic fixtures only. Native OS focus/appearance remains unverified.

| Source | Appearance | Normal | Coarse | Alt | Larger | Menu | Forced colours |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | macos light | [view](../57bd3acf/before/macos-light-normal.png) | [view](../57bd3acf/before/macos-light-coarse.png) | [view](../57bd3acf/before/macos-light-alt.png) | [view](../57bd3acf/before/macos-light-large.png) | [view](../57bd3acf/before/macos-light-menu.png) | [view](../57bd3acf/before/macos-light-forced.png) |
| before | macos dark | [view](../57bd3acf/before/macos-dark-normal.png) | [view](../57bd3acf/before/macos-dark-coarse.png) | [view](../57bd3acf/before/macos-dark-alt.png) | [view](../57bd3acf/before/macos-dark-large.png) | [view](../57bd3acf/before/macos-dark-menu.png) | [view](../57bd3acf/before/macos-dark-forced.png) |
| before | windows light | [view](../57bd3acf/before/windows-light-normal.png) | [view](../57bd3acf/before/windows-light-coarse.png) | [view](../57bd3acf/before/windows-light-alt.png) | [view](../57bd3acf/before/windows-light-large.png) | [view](../57bd3acf/before/windows-light-menu.png) | [view](../57bd3acf/before/windows-light-forced.png) |
| before | windows dark | [view](../57bd3acf/before/windows-dark-normal.png) | [view](../57bd3acf/before/windows-dark-coarse.png) | [view](../57bd3acf/before/windows-dark-alt.png) | [view](../57bd3acf/before/windows-dark-large.png) | [view](../57bd3acf/before/windows-dark-menu.png) | [view](../57bd3acf/before/windows-dark-forced.png) |
| before | linux light | [view](../57bd3acf/before/linux-light-normal.png) | [view](../57bd3acf/before/linux-light-coarse.png) | [view](../57bd3acf/before/linux-light-alt.png) | [view](../57bd3acf/before/linux-light-large.png) | [view](../57bd3acf/before/linux-light-menu.png) | [view](../57bd3acf/before/linux-light-forced.png) |
| before | linux dark | [view](../57bd3acf/before/linux-dark-normal.png) | [view](../57bd3acf/before/linux-dark-coarse.png) | [view](../57bd3acf/before/linux-dark-alt.png) | [view](../57bd3acf/before/linux-dark-large.png) | [view](../57bd3acf/before/linux-dark-menu.png) | [view](../57bd3acf/before/linux-dark-forced.png) |
| after | macos light | [view](after/macos-light-normal.png) | [view](after/macos-light-coarse.png) | [view](after/macos-light-alt.png) | [view](after/macos-light-large.png) | [view](after/macos-light-menu.png) | [view](after/macos-light-forced.png) |
| after | macos dark | [view](after/macos-dark-normal.png) | [view](after/macos-dark-coarse.png) | [view](after/macos-dark-alt.png) | [view](after/macos-dark-large.png) | [view](after/macos-dark-menu.png) | [view](after/macos-dark-forced.png) |
| after | windows light | [view](after/windows-light-normal.png) | [view](after/windows-light-coarse.png) | [view](after/windows-light-alt.png) | [view](after/windows-light-large.png) | [view](after/windows-light-menu.png) | [view](after/windows-light-forced.png) |
| after | windows dark | [view](after/windows-dark-normal.png) | [view](after/windows-dark-coarse.png) | [view](after/windows-dark-alt.png) | [view](after/windows-dark-large.png) | [view](after/windows-dark-menu.png) | [view](after/windows-dark-forced.png) |
| after | linux light | [view](after/linux-light-normal.png) | [view](after/linux-light-coarse.png) | [view](after/linux-light-alt.png) | [view](after/linux-light-large.png) | [view](after/linux-light-menu.png) | [view](after/linux-light-forced.png) |
| after | linux dark | [view](after/linux-dark-normal.png) | [view](after/linux-dark-coarse.png) | [view](after/linux-dark-alt.png) | [view](after/linux-dark-large.png) | [view](after/linux-dark-menu.png) | [view](after/linux-dark-forced.png) |

| System200%,360px/Alt | Before57bd3acf | After78b23364 |
| --- | --- | --- |
| macos light | [view](system-before/macos-light-200.png) | [view](system-after/macos-light-200.png) |
| macos dark | [view](system-before/macos-dark-200.png) | [view](system-after/macos-dark-200.png) |
| windows light | [view](system-before/windows-light-200.png) | [view](system-after/windows-light-200.png) |
| windows dark | [view](system-before/windows-dark-200.png) | [view](system-after/windows-dark-200.png) |
| linux light | [view](system-before/linux-light-200.png) | [view](system-after/linux-light-200.png) |
| linux dark | [view](system-before/linux-dark-200.png) | [view](system-after/linux-dark-200.png) |

This remains only the #788 footer slice. Alt-only Add/Remove does not complete mouse-only selection; row/chip/context/native-opening/outside-click/drag work stays open.
