# Picker preferences DOM parity

Before: main `47667263c7de94db5bd20daa909863f78cd45a4d`.
After: PR #750 `ef41aa240d4aa769ad1a29664b40221478e2da17`.

Synthetic browser comparison in Chromium 151.0.7922.34, 720 × 480:
all 31 catalog states × macOS/Windows/Linux looks × light/dark × normal/larger
text, **372 cases passed with identical DOM and focus**.

Both evidence builds used the existing gallery renderer, static server and
readiness gate. Each page used a fixed Date value (`1792584000000`) and the
same seeded Math.random sequence (seed 123456789; LCG multiplier 1664525,
increment 1013904223, unsigned 32-bit state). The comparison serialized the
body tree, document-element attributes and focused element. Attributes were
sorted by name; no DOM fields were omitted. The compiled script/link elements
in the document head were outside the picker comparison.

The manifest records both source commits and SHA-256 values for each case.
Manifest SHA-256: `d7e1d7ef58c4e6383e2e8ebd921dd3fc782f1d51f2155e941545654a719a6780`.

This is browser DOM evidence. It does not establish pixel equality, native
materials, native tray/menu-bar behavior or installer acceptance. The exact-head
full check and independent review are recorded in the PR evidence comment.
