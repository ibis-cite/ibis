# Ibis brand

The logo, app icon and other brand files for Ibis. Use the files in [`exports/`](exports/); they are made from one editable master.

## Which file to use

| You need | Use |
|---|---|
| The logo on a web page or README | `exports/ibis-logo.svg` (light backgrounds), `exports/ibis-logo-on-dark.svg` (dark) |
| The logo where SVG is not accepted (slides, documents) | `exports/png/ibis-logo-800.png`, `exports/png/ibis-logo-on-dark-800.png` |
| The bird alone | `exports/ibis-mark.svg`, `exports/ibis-mark-on-dark.svg` |
| One colour (print, stickers, monochrome) | `exports/ibis-mark-flat.svg`, `-black.svg`, `-white.svg` |
| A profile picture (GitHub, social sites) | `exports/png/ibis-avatar-512.png` |
| GitHub's link preview | `exports/png/github-social-preview.png`: repository Settings, General, Social preview, Edit, Upload |
| An app store or download page icon | `exports/ibis-app-icon.svg` or `exports/png/ibis-app-icon-*.png`; dark: `ibis-app-icon-dark` |
| A website favicon | `exports/favicon.svg` (follows light and dark), `exports/favicon.ico` |
| Website icons | `exports/png/apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, listed in `exports/site.webmanifest` |
| A link preview for a website | `exports/png/og-image.png` (1200 × 630) |
| Brand colours | `exports/colors.css` (CSS variables) or `exports/colors.json` |
| The quote mark from the app's citation shelf | `exports/ibis-quote-beak.svg` |

## Rules

M is the height of the bird.

- **Space.** Every file already keeps 0.135 M free on each side for the soft shadow. On a page, keep at least 0.25 M clear around the logo.
- **Logo.** The wordmark's capital height is 0.55 M, centred on the bird, with 0.34 M between the beak tip and "Ibis". Show it about 240 px wide in a README. When the bird would be under 24 px tall, use the bird alone.
- **In a container.** The bird is 62% of the height of an app icon, avatar or maskable icon. Favicons use the largest bird that fits.
- **Optical centre.** The bird's weight is in its head, so its outline's centre looks too far left and too high. Square files and containers centre it halfway between the outline's centre and its centre of mass, which `build.py` measures from the master.
- **Depth.** The soft depth is for 48 px and up; smaller uses the flat bird. Favicons use a slightly thicker neck so the bird still reads at 16 px.
- **Colour.** Scarlet 600 `#C23A1C` on light backgrounds and Scarlet 400 `#FF7A5C` on dark. Text is Ink `#16181D` or Slate `#4C5260` on light, and near-white on dark. The full Scarlet scale (50 to 900) is for websites and videos: tints for backgrounds, 600 to 800 for text and links on light. Never stretch, outline or recolour the bird in other hues, or add effects.
- **Words.** Lead with "Find references. Copy citation keys." Say "early preview" until 1.0, and name only what ships today.

## Changing the brand

`master.svg` holds the three shapes as exact outlines with no padding: the bird (`mark`), the wordmark (`wordmark`, Inter Display SemiBold, outlined) and the quote mark (`beak`). Colours, sizes and spacing are at the top of `build.py`.

After editing either, rebuild every export from the repository root:

```sh
python3 brand/build.py
```

It needs Python 3 and librsvg's `rsvg-convert`; the social preview's text needs the Inter font installed. Never edit files in `exports/` by hand. The desktop app's own icons are built separately from `apps/desktop/src-tauri/icons/source/`.

Design explorations (the design canvas, rejected options, screenshots) stay outside the repository. When one is chosen, record it in `docs/design.md` or `docs/design/system.md` and here.
