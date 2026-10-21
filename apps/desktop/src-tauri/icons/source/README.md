# App icon B / G1 (#579)

`full.svg` is the approved optical transform and white bird on the exact G1
gradient, full bleed and unmasked. `small.svg` widens the neck to 11 units and
removes the eye. Both retain the original curves. The one-colour symbolic
master uses a 16px grid and a 1.75px neck. Do not centre the bird geometrically.

From the repository root, with the locked `cargo tauri` 2.12.3 and librsvg's
`rsvg-convert` (available in Linux CI):

```sh
python3 apps/desktop/src-tauri/icons/source/generate.py
pnpm -C apps/desktop exec vitest run src-tauri/icons/assets.test.mjs
```

Tauri renders the large PNGs directly from vector art. librsvg renders every
platform size directly from its master; Python's standard library packs those
PNGs into ICO and ICNS. No large bitmap is downscaled for the small entries.
The ICNS face is 824px in a 1024px canvas. Its 16/32px images use the small
master (including the 16pt @2x entry). The Windows 16/24px images use the small
master. The GNOME face has a 4px front profile on the 128px grid.

`Ibis.icon` has three separate parts: the root gradient fill, the bird group,
and the eye group. Xcode 27.1's `actool` compiles it to `Assets.car`; the locked
Tauri CLI/bundler supports that path and discovers `CFBundleIconName` with
`assetutil`. Older macOS keeps the explicit ICNS fallback. These tools require
Xcode 26 or later; never add a guessed compiled catalog.

Two platform adaptations need the maintainer's final look. Windows uses the
same curves in G1 on transparency, with an eye cutout, to satisfy the no-tile
requirement; this is a proposed adaptation, not a recovered board-R master.
Dark explicitly retains G1 and the white bird: the board's darker endpoint colours were not
available in the public specification. Clear and Tinted are Apple's treatment
of the layered source. No custom lighting, shadow or glow is baked into it.

The Linux `deb.files` and `appimage.files` maps install the three named hicolor
PNGs and symbolic SVG. The shared Debian desktop template (also used by the
AppImage bundler) selects that icon name. Native package installation, system
tray resampling and Windows 100/125/150% pixel alignment need native evidence;
source renders and config tests alone do not establish those results.
