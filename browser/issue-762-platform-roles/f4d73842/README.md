# Platform roles: final browser comparison (#762)

[One before/after contact sheet](contact-sheet-comparison.png), with all raw frames and manifests in `before/` and `after/`.

Actual main `48554638cdc1f73571c4c9a0344a3a22a0c25c66` → final source `f4d738425d4fd29ff3edd2387ea42f45bfe1077e`. Chromium 151.0.7922.34; fixed synthetic clock 2026-10-22T09:00:00Z. Existing gallery tools captured 120 frame pairs: three looks × light/dark × normal/Larger text × ten states (menus, disabled items, keys, contrast/forced colours, shelf and Copied notice). No repository harness or dependency was added.

`focus-comparison.json` records 72 passed before/after profiles: keyboard Tab/Shift+Tab, menu/dialog Escape return, focus strokes, geometry, narrow 200% text, RTL, CJK/long titles, increased contrast, forced colours, gallery contrast and advanced-CSS fallback branches. Expected menu/dialog elevation, dialog/search/keycap shapes and scrim differences are allowed; retained measurements match. CSSOM fallback checks are not old-engine emulation.

`notice-bounds/results.json` reruns real notice markup/styles in a browser viewport matching Windows' fixed 420 × 112 window. Card bounds remain x16/y16/388×80. Corrected compact shadows leave bottom-edge alpha 3/6 (light/dark), sides 1, with faint blur tails. The rejected generic shadow28 experiment is retained in the [earlier preparation artifact](https://github.com/ibiscite/ibis/tree/6c9fd0e636900a7b6d8fd577aa34c34a31e75c63/browser/issue-762-platform-roles/c1a2759c/notice-bounds/rejected-shadow28); it is historical evidence, not this final source.

`status-look-contrast.json` explains #762 G18: the old dark material Look colour matched opaque Look. Over the existing 55% dark veil and brightest modeled material channel 120, old #e3b341 already gives 4.80:1; material #f0c25a gives 5.59:1. Over material 0 it gives 9.73→11.33:1. The added regression requires brighter material luminance, retaining every existing >=4.5 role check. This adds headroom and the intended material distinction; it does not claim an old contrast failure.

`resource-sample.json` records capacity while the fresh full check was running: 10 logical cores, 16 GiB RAM, 50% free memory, 22.86 GiB disk available; two Cargo jobs, one test thread, debug/incremental disabled, offline dependencies and a new empty dedicated target. Full-check outcome and independent review belong in the PR evidence comment.

Browser evidence only. Native materials, fonts, OS clipping, accessibility toggles and actual wallpaper readability remain #627. macOS keeps its verified 12 pt native clip; versioned Mac geometry stays #691. Current GNOME follows the agreed libadwaita 1.8+ baseline (15 px window,7 px row,6 px tile), preserving the separate 12 px popover. Known shortcuts layout work stays #766.
