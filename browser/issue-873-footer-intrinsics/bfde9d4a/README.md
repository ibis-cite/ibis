# Stable hidden footer measurements

Source: bfde9d4a0a5347529580a5e2ada90b87a77d4eab, based on actual main 69029c4c. Synthetic Chromium 151.0.7922.34 browser renders; no native-device claim.

## Before

The independent [durable reproduction](https://github.com/ibiscite/ibis/blob/6c8079060cbdd0fbb9fd9ab297f98fc5a2456ddd/browser/issue-863-footer-feedback/f2031235/README.md) records 59 adjacent-frame fold transitions in 60 frames on actual main f2031235. Hidden Shortcuts shrinks inside its zero-width optional-only parent, and the footer alternates between 40 and 80 pixels. The same footer source is present on this branch's main base.

## Current complete gallery

All 576 frames passed: 528 picker and 48 component frames, all three looks, light/dark and normal/Larger text. No acknowledgement was relaxed. Both contact sheets were inspected. The unchanged renderer took 82.69 seconds locally; hosted timing is unverified.

## Stability, focus and width attacks

All 12 cases passed: three looks × normal/Larger text × fine/coarse pointer. Each samples 60 animation frames at 420×480 with zero fold or height transitions, delivers real Tab navigation to Shortcuts at 900px, verifies owned focus transfers to More when folded, and verifies widening restores Shortcuts without stealing focus. Widths 360, 420, 520 and 900 retain Search focus and have no horizontal overflow. The 360px case uses the configured minimum height of 320px. A Linux RTL Larger/coarse case also stays within 360px. Pointer modes are emulated; normal root is 16px and Larger is 18.4px.

Eight additional cases compare baseline and current minimum-size behavior: all three looks plus Linux RTL, Larger/coarse. First-run-found content exceeds 320px on both sources. A genuine wheel scroll makes More hit-testable, touch opens it, End/Escape work, and Search keeps focus while scrolling. Current page heights are 731/713/731px (macOS/Windows/Linux), versus baseline 739/756/774px. No horizontal overflow or page errors occur. This does not claim to solve the broader pressure tracked by #584.

All interaction records are in attacks/. Full checks and independent review are recorded separately on the pull request.
