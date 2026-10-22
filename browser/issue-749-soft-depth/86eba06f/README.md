# Soft depth: preliminary browser evidence

Actual main `624100a076ee4fe475dfe3e1873c7ebf2ebb87b3` → pushed depth checkpoint `86eba06f4e3ec7b2cd3aab10c3fcd62b680c498c`.

96 paired synthetic browser frames: macOS, Windows and GNOME looks; light/dark; normal/Larger text; results, 50-reference citation shelf, first run, empty library, More, keyboard dialog, long non-Latin titles and right-to-left text. The four comparison sheets group these views in that order. Clock fixed at 09:00 UTC. Browser renders do not certify native fonts, materials or physical platforms.

All 108 preference/state comparisons passed geometry parity, flat paint parity for increased/forced/gallery contrast, disabled new transitions under reduced motion and opaque reduced-transparency fallback. Chromium lacks the reduced-transparency Playwright switch: the real stylesheet media branches were activated through CSSOM. Native attributes are stress models; macOS text contrast uses accepted grayscale backdrop bounds (light 141/255; dark 0/120). Windows Mica and the artificial GNOME native attribute are excluded from contrast claims. System-selected/accent and disabled pairs retain their approved platform-role exceptions. No body, secondary or enabled-neutral text pair fell below 4.5:1 in the supported cases. GNOME neutral labels improve from 4.24 to 10.27; dark macOS inactive writing labels reach 5.88 over the brightest bounded veil.

The unchanged geometry checker **failed** at 146/153 on both commits: seven existing macOS expected-28/current-12 radius mismatches and a Linux normal tray-20 readiness timeout. Complete logs are byte-identical; this is not a geometry pass. Other measured layout, row, search and alignment checks agree.

96 focused tests, TypeScript and UI import checks passed. The clean fresh-target exact-commit full check is running, not yet passed. The prior checkpoint's all-interface suite passed 592 tests; it is not a final-head full verdict.

This is preliminary: #849's role values have not landed and were not copied. Whole-depth readiness still needs those actual landed values, renewed evidence, final full verification and independent exact-head review. Native material acceptance remains #8/#627.
