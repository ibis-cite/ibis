# Older library check dates

Source: `b0c3eb5a36b6e54eaccbd19708c6d589414dbbf4`.
Synthetic browser renders in Chromium 151.0.7922.34 on macOS; these are not native window or screen-reader captures.

The unchanged standard renderer completed 576/576 frames, with zero failed frames: three looks, light/dark, normal/Larger text; 528 picker and 48 component frames. Individual frame names are in [manifest.json](manifest.json).

- [Normal-text contact sheet](contact-sheet-normal.png)
- [Larger-text contact sheet](contact-sheet-large.png)

## Date regression

[Twelve browser cases](date-probe/results.json) use an explicitly synthetic clock and the Pacific/Kiritimati time zone. A retained Zotero fixture is initially checked on 22 October 2026. Advancing the clock within 2026 yields `checked on Oct 22`; advancing into 2027 yields `checked on Oct 22, 2026`. Both footer age and More's detail contain the correct year; the polite live-region text remains unchanged and the separate age remains hidden from live announcements.

The captured menu detail is text content, not a claim that all detail is simultaneously visible. Existing footer truncation and minimum-height limitations remain separate. Each case retains a settled footer PNG and a menu PNG; the real More click and Escape dismissal are exercised. No page errors occurred.

[capture-date.mjs](date-probe/capture-date.mjs) checks the exact clean source head before running against an already built evidence gallery:

```sh
node capture-date.mjs /path/to/checkout /path/to/output
```

Unit regressions failed twice before the fix, then all 28 tests passed under both Pacific/Kiritimati and America/Los_Angeles. Same-year dates, previous-year dates, local New Year and future timestamps are covered. Existing relative thresholds remain unchanged. The implementation uses the host's local calendar year consistently with the existing [ECMA-402 date formatter](https://tc39.es/ecma402/2026/).

The full guarded source check is recorded in the pull request's single evidence comment. No native GUI job was manually run for this frontend change.
