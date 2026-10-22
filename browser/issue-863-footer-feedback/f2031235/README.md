# Footer fit feedback on actual main

Synthetic browser reproduction on actual main `f2031235bf9692290abf31171301722df46f77ea`, after #870, independent of the pending depth stylesheet. Chromium 151.0.7922.34; macOS look, light theme, first-run-found state, normal text, 420 × 480 viewport. No native capture or application source change.

`footer-feedback.json` samples 60 consecutive animation frames. The unmodified footer changes its folded state on all 59 adjacent frame transitions. Shortcuts measures 92.078125 px while unfolded and 32 px while folded inside its zero-width optional-only hints row. Footer height alternates 80 / 40 px. Feeding the smaller hidden width into the next fit calculation lets the optional hint return, producing feedback.

A **browser-only counterfactual**, `width: max-content; max-width: none` on the folded Shortcuts button, preserves its natural width and yields zero transitions across the next 60 frames, with the footer consistently 40 px. This demonstrates the cause; it is not a shipped fix or final implementation test.

`footer-repro.json` records six separate unmodified page loads, both actual main and the pending depth candidate, including settled bounds after another 800 ms. The shared issue occurs without depth. `footer-before-0.png` is an unmodified full-page capture during the feedback, including transient excess footer height. `footer-counterfactual.png` shows the settled browser-only counterfactual on actual main. All library names and document content are synthetic.

Reproduce by opening the evidence gallery at `?state=first-run-found&platform=macos&theme=light&text=normal` in a 420 × 480 Chromium viewport, reporting MacIntel before page initialization. Wait for the gallery readiness marker, then sample the footer height, its Shortcuts folded flag and Shortcuts width over successive animation frames. Do not relax geometry assertions to accept the feedback. The UI owner retains application-source ownership.
