# Preview visibility browser evidence

PR #825 source: `e1d4b814a270ba57ab0906c7434be3dde3ae6054`.
Base: actual main `3aec80b4042fa248d4c70689d9b6b056b3c912c1`.

One contact sheet, rendered by `scripts/gallery-contact-sheet.mjs`: preview-on
and preview-off, macOS/Windows/Linux browser looks, light/dark, normal text.
All 12 requested frames rendered and were visually inspected. Synthetic data;
Chromium 151.0.7922.34, 720 × 480. Browser rendering does not prove native
materials, system fonts, clipboard delivery or native shortcut handling.

This checkpoint uses main's existing preview and tray. Integration with the
citation shelf and Format menu waits for their actual-main commits. The final
full check and independent review are still pending.
