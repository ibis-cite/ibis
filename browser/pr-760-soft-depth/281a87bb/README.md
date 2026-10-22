# Soft depth on actual merged tray/footer main

Synthetic browser renders, not native captures. Before: `9456d8096180878457f10c11af174e650f30df43`. After: `281a87bb51d63bc9aa4ea0759188e257f95c1309`.

Each source has 48 frames: first run, results, More menu and 50-reference tray/preview; three platform looks, both themes, normal and Larger text. All four contact sheets were visually inspected. Hashes and PNG dimensions are recorded in source-manifest.json.

Geometry and layout output is byte-identical. 144 of 156 report checks pass; the same 12 radius mismatches predate this change. All 84 region-overlap, whole-chip and list-scroll checks pass.

The 72 adversarial cases cover three looks, both themes, normal/115%/200% text, 360/720 px widths and both directions. All pass: no partly cut chips or horizontal overflow, focused last-chip visibility, fade removal on focus, selection removal and Search recovery, increased-contrast and forced-colours fades.

Native materials and broad text-contrast acceptance are separate observations; these captures and geometry results do not establish either. Long formatted previews scroll as before.

Supplementary rendered axe audit: 48 matching frames per source, 71 violation nodes before and 61 after, zero new foreground/background/size failure facts. Existing Chromium system selection and GNOME control/key-cap pairs remain below 4.5:1; unresolved checks remain incomplete. See contrast-comparison.json. This does not establish the issue’s broad 4.5:1 acceptance criterion.
