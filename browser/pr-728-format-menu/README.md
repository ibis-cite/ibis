# Format menu browser evidence — PR #728

Synthetic browser renders only; Chromium 151.0.7922.34, 720 × 480, scale 1.
These cover layout and colour, not native materials, accessibility speech or operating-system focus.

- Before: main `0dad8170a37faea541d9dfbb78b7af0ac8ac5c86`, `many-results` (native select control rendered by Chromium), 12 frames.
- After: `3944d4fe2b20412fd298f83b239f34c5edf222d0`, `many-results`, `format-menu`, `format-menu-filtered`, 36 frames.
- Each set covers macOS, Windows and Linux looks, light/dark and normal/larger text. All 48 frames rendered; manifests identify every frame and source.
- PNG signature and dimensions were checked from file bytes before publication.
- Native captures and final full-check acceptance remain pending.

| Text size | Before | After |
|---|---|---|
| Normal | [contact sheet](before/contact-sheet-normal.png) | [contact sheet](after/contact-sheet-normal.png) |
| Larger | [contact sheet](before/contact-sheet-large.png) | [contact sheet](after/contact-sheet-large.png) |

The full menu scrolls within the viewport; filtering to APA leaves the Citation styles section and its real sample.

Production builds passed on both sources with the same dependency tree. The main JavaScript chunk is 421.34 → 442.08 kB raw and 133.10 → 139.77 kB gzip (+6.67 kB gzip, below #541's 80 kB ceiling). The formatter worker is unchanged.

Reproduce from each source with:

```sh
node scripts/gallery-contact-sheet.mjs --output /tmp/format-evidence --state many-results
# On the PR source also add: --state format-menu --state format-menu-filtered
pnpm -C apps/desktop exec vite build
```
