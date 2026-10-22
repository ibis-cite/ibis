# Preliminary platform-role comparison (#762)

[One before/after contact sheet](contact-sheet-comparison.png), with raw frames and manifests in `before/` and `after/`.

This is preparation evidence, not final PR acceptance. The branch still needs the actual #761 landing, final role-alias integration, a clean exact-head full and independent review. Main recovery currently holds source edits and a PR.

The 120 frame pairs compare actual main `ac20919e` with prototype `c1a2759c`: three looks, light/dark, normal/Larger text, ten existing gallery states. The gallery clock is fixed to 2026-10-22T09:00:00Z. Existing `scripts/gallery-contact-sheet.mjs` captured menus, disabled items, keys, contrast/forced colours, long shelf content, 200% text and the Copied notice. No repository harness or dependency was added.

The 72 focus/layout probes were run on the earlier role prototype `41da261a`, before its toast-only correction. They retain expected focus, geometry and styles while allowing intended menu/dialog shadow, dialog/search/keycap shape and scrim differences. They include narrow 200% text, RTL, CJK/long titles and CSS fallback branches. Final probes will run on the integrated final source.

The notice experiment uses the real rendered notice markup and the existing notice stylesheet in a browser viewport matching the fixed Windows 420 × 112 window. Card bounds stay x16/y16/388×80. The proposed generic shadow28 leaves visible clipped edge alpha28/47 (light/dark); its rejected samples are retained under `notice-bounds/rejected-shadow28/`. The compact corrected role produces bottom-edge alpha3/6, with faint blur tails rather than a strong cut. The nominal shadow/gutter regression test fails before the fix and passes after it.

Browser evidence only. This does not certify native materials, native fonts, OS clipping, live accessibility toggles or every desktop wallpaper. macOS remains at the verified 12pt native clip; versioned Mac geometry stays with #691, and actual native readability/rendering checks stay with #627. Current GNOME geometry follows the cited libadwaita 1.8+ baseline (15px window, 7px row, 6px tile), retaining the separate 12px popover.
