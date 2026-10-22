# UI acceptance for #891

Source: `29723eb311541107961aa48b42ebaabd622b8894`. Synthetic data only. **Draft: native system-accent following is blocked on #763.**

- [Before](before-9fa35761): PR base `9fa35761c6e27a589f9da0d8bf887de325031a05`, 84 affected-state browser frames.
- [After](after-29723eb3): frozen head, 84 affected-state browser frames, all three looks × light/dark × normal/Larger text. Includes native-keyword and explicitly simulated fallback colour paths in `color-paths/`.
- [Full browser sheet](full-browser): exact-head hosted Chromium 151 gallery, 576/576 frames, no failed renders. Browser layouts are not native captures. [Verified source job](https://github.com/ibiscite/ibis/actions/runs/39840348380/job/120039488368), [full artifact](https://github.com/ibiscite/ibis/actions/runs/39840348380/artifacts/12452937771).
- [Native macOS 27.0.1](native-macos-27.0.1): real WKWebView in a separately identified local acceptance app; synthetic library and disposable settings. Pointer pin, shortcut, ordinary Tab/Space, menu Escape/focus return, Larger text and Increased Contrast exercised. Native captures are after-only; the [base native gallery](../../9fa35761c6e27a589f9da0d8bf887de325031a05/macOS) is a different synthetic fixture.

## Findings and limits

The native-keyword Chromium pair changed from white/blue (4.21:1) to black on the same blue (4.99:1). Fallback text ratios: macOS 5.23/5.76, Windows 6.31/11.67, GNOME 5.57/9.08 (light/dark). Fallback simulation disables native keyword supports blocks in browser memory; it does not represent an additional native engine.

The real macOS picker remained blue after changing the system accent to Yellow, including after focus return and restart. `dark-yellow-restarted.png` records that failure. This is assigned to #763; no custom-accent conformance is claimed. Auto appearance, Multicolor accent, Increase Contrast off and Reduce Transparency off were restored and verified. The acceptance app and System Settings were closed. No personal library or clipboard content was used.

Geometry is 149/156 on both base and head: the same seven inherited macOS corner mismatches (#691). At 360 px, all 36 touch activations succeeded with 44 px or larger pin targets and no horizontal overflow. Footer ends remain scroll-reachable before and after; heights are unchanged or improved. The existing narrow-height work is #584.

The full native workflow is [run 39840348380](https://github.com/ibiscite/ibis/actions/runs/39840348380), source verified. Linux failed after the missing-library assertion with menu focus and a generic error: [job](https://github.com/ibiscite/ibis/actions/runs/39840348380/job/120041809757), [retained artifact](https://github.com/ibiscite/ibis/actions/runs/39840348380/artifacts/12452863398). No cause or repair is claimed and no retry was requested; #903 holds the diagnosis.

Local guarded full-check status is recorded in the PR evidence comment. The initial invocation failed two updater path-policy tests because its executable path used the `/tmp` symlink. A canonical-path focused correction passed all seven updater tests. The guarded full rerun uses the same initially fresh exact-commit source/target through canonical `/private/tmp` paths; no target is shared across checkouts.
