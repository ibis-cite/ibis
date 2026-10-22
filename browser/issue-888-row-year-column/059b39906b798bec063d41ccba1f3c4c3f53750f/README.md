# Row trailing-column browser evidence

Synthetic browser renders, not native captures or screen-reader speech.

Before: archived source c6f3f34aaa23c839256a41a5ad12c58ffa9a0461. The baseline contact-sheet script reports unknown commit because it ran from a Git archive; this is the archive source.
After: 059b39906b798bec063d41ccba1f3c4c3f53750f.

Both complete contact sheets rendered 576/576 frames. Each phase retains its manifest and normal/Larger-text sheets.

The six row sheets compare before (left) with after (right), for three platform CSS looks, normal/Larger text, light/dark/increased contrast, 720px/360px, RTL, actual CJK, and a crowded 464px Spacious row with type/key/library/No date/abstract match. All 180 row frames rendered. Per-row geometry proves year centering and no metadata overlap. Keyboard arrows, pointer add, accessible key/year and Search focus passed for each platform/theme/text combination. Reduced-motion media emulated throughout.

Twelve hostile-input probes cover platform/text/direction, 10,000-character and empty keys, 720/640/560/464/360px, LTR citation keys, selectable key text and key truncation before a short byline. See rows/attack.json.

Both geometry reports have 149/156 passes: the same seven macOS radius mismatches exist on the baseline. All row height and region overlap checks pass. Corner work belongs to #691.

Tests: eight ResultList tests pass; metadata regression fails on original source; TypeScript passes. Independent exact-head delta review approves with no remaining P1/P2 after reproducing and fixing the crowded-row overlap in both directions (216 reviewer layout cases).

Local full gate on the earlier superseded head was terminated for the review fix; no final-head local full ran. Maintainer replaced that gate with hosted required CI result on the exact head. Native rendering, native input and screen-reader speech were not run.
