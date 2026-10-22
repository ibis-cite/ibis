# Soft depth: preliminary browser evidence

Actual main `624100a076ee4fe475dfe3e1873c7ebf2ebb87b3` → pushed depth checkpoint `07ac4904c8fc21c292135289571312e65e951408`.

96 paired synthetic browser frames: macOS, Windows and GNOME looks; light/dark; normal/Larger text; results, 50-reference citation shelf, first run, empty library, More, keyboard dialog, long non-Latin titles and right-to-left text. The four comparison sheets group these views in that order. Clock fixed at 09:00 UTC. Browser renders do not certify native fonts, materials or physical platforms.

All 108 preference/state comparisons passed geometry parity, flat paint parity for increased/forced/gallery contrast, disabled new transitions under reduced motion and opaque reduced-transparency fallback. Chromium lacks the reduced-transparency Playwright switch: the real stylesheet media branches were activated through CSSOM. Native attributes are stress models; macOS text contrast uses accepted grayscale backdrop bounds (light 141/255; dark 0/120). Windows Mica and the artificial GNOME native attribute are excluded from contrast claims. System-selected/accent and disabled pairs retain their approved platform-role exceptions. No body, secondary or enabled-neutral text pair fell below 4.5:1 in the supported cases. GNOME neutral labels improve from 4.24 to 10.27; dark macOS inactive writing labels reach 5.88 over the brightest bounded veil.

On prior checkpoint 86eba06f, the unchanged geometry checker **failed** at 146/153 on both commits: seven existing macOS expected-28/current-12 radius mismatches and a Linux normal tray-20 readiness timeout. The prior artifact retains byte-identical logs; this is not a geometry pass. The current head passed all 108 direct before/after geometry comparisons.

97 focused tests, TypeScript and UI import checks passed on this head. The prior checkpoint 86eba06f passed the clean fresh-target full check (594 interface tests, 168 desktop tests plus one ignored, all 11 watchers, both strict Clippy runs and remaining gates). This head has not run the full check: it will be renewed after actual #849 integration.

The stacking-marker images demonstrate a paint-order regression and fix: an opaque magenta shadow marker was hidden by the results sheet before, and visible after assigning the search band relative positioning and the shared chrome stacking role. Its 720 × 56 box stays identical. The marker is synthetic test paint, not a proposed product colour or shadow.

This is preliminary: #849's role values have not landed and were not copied. Whole-depth readiness still needs those actual landed values, renewed evidence, final full verification and independent exact-head review. Native material acceptance remains #8/#627.
