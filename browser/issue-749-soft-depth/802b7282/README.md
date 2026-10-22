# Soft depth: exact-head checkpoint and remaining browser blocker

Actual landed main `9fa35761c6e27a589f9da0d8bf887de325031a05` → depth head `802b7282d6f99b5acc8f80bab12b61c38769cda0` (#865, part of #749). The head includes the actual citation-fitting and hidden-footer repairs. The net depth change remains four files, 203 additions / 6 removals.

## Passed

- Both unfiltered galleries rendered **576/576 frames, zero failures, exit 0**. Their manifests identify the correct source commits. Chromium 151.0.7922.34; synthetic clock fixed at 2026-10-22 09:00 UTC.
- Four inspected paired sheets contain 96 selected before/after frame pairs: results/shelf, setup/empty, More/Keys, long/non-Latin/RTL content; three looks × light/dark × normal/Larger text. Selected raw PNGs and complete gallery contact sheets are retained.
- **132 focused tests** in nine suites, **eight geometry contract tests**, TypeScript, UI import boundary, production/evidence builds and diff checks passed.
- **126 preference/state comparisons passed**: normal, increased/forced/gallery contrast, reduced transparency, native-appearance attributes and explicit opaque startup/failure fallback. Compared geometry, flat contrast paint, reduced-motion transitions and modeled text contrast. These selected profiles have no below-4.5 unexcepted text.
- The separate **576-frame text contrast comparison found zero new or worsened violations**. It does not establish that all inherited text passes; see below.

## Failed or incomplete

The original **216-case width/text/state run failed on gallery acknowledgement after 144 logged completed comparisons**. All original geometry/overflow assertions remain intact. This is not a completed 216-case pass.

A separate isolation reproduces a failure on the **baseline**, GNOME/light, **360 × 480**, **Larger text**, `tray-preview`: no rendered marker within the unchanged 30-second limit. No page errors were observed; main/footer/shelf remained mounted, with 50 options and one selected option. `width-failure.json` and the screenshot retain those facts. They do not establish the cause or a depth regression. The isolation completed the earlier Linux cases before failing; no unavailable or failed case was skipped.

The full-gallery model also found **12 inherited GNOME menu key-hint-label cases below 4.5:1**, identical before and after: `file-kept-menu`, `menu-open` and `scope-menu`, normal/Larger text, light **3.8332834577272226** and dark **4.488552970398123**. These are full-precision solid-background DOM color-composition results, not sampled glyph pixels. Thus the absolute all-text contrast requirement is **not passed**, although this patch introduces no new/worsened modeled failures.

The clean exact-head full verifier was prepared with an empty target, but **the full check was not run because the browser blocker remains**. Earlier full-check passes are historical. #865 remains Draft; no Ready or complete acceptance is claimed.

## Reproduction and limits

The `probes/` directory contains portable versions of the one-off evidence collectors; no application or CI harness was added. Set `IBIS_SOURCE` to a source checkout, use its installed Playwright runtime, and pass an evidence directory as the first argument. Build that directory's `base-dist` and `after-dist` from the named clean commits with the existing Vite evidence build. Run `width-probe.mjs`, `probe.mjs` and `frame-contrast.mjs`; `width-isolate.mjs` repeats the remaining Linux portion with failed-ack facts/screenshot capture. Its diagnostic instrumentation preserves the timeout and original assertions. `clock.mjs` is the preload used by the existing unfiltered gallery renderer. The compressed preference JSON preserves full recorded facts; the summary lists every profile.

Contrast calculations preserve the accepted selected/system-accent, suggested/selected writing-choice and disabled-role exceptions. Material contrast is modeled only within the recorded macOS grayscale backdrop bounds; Windows Mica and artificial Linux native-appearance attributes are parity stress cases excluded from native contrast certification. Reduced-transparency CSS branches are activated through CSSOM, not an OS preference emulator. Native fonts, wallpaper, window clipping and OS materials remain separate #8/#627/#691/#79 acceptance.

A first browser launch was refused by the local sandbox before any frame; it was rerun with normal browser permission. This is separate from the retained baseline acknowledgement failure. No assertion, deadline or source was relaxed.
