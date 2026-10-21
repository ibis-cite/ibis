# Wrapped footer spacing — PR #730

Synthetic Chromium browser renders, not native application acceptance.

- Before: `47667263c7de94db5bd20daa909863f78cd45a4d` (main).
- After: `5148f9e15db43609770517b9d9c0d26bfa6035d4`.
- 24 frames per side: macOS, Windows and Linux looks; light/dark; normal 720 px, narrow 400 px, narrow with larger text 400 px, and high contrast 720 px. Viewport height is 480 px.
- Narrow views are scrolled to the footer so wrapped footer padding can be inspected. They do not show the search header.
- Each manifest records source SHA, browser version, PNG dimensions, SHA-256 and measured footer/library-bar geometry. All 48 PNG signatures and dimensions were checked.
- In all six high-contrast look/theme cases, title offset from the active row changes from 58 px to 56 px, matching the normal 56 px inset. The contrast marker remains visible.
- Linux light narrow/larger-text before/after images were visually inspected after scrolling. Native compositor, installer and accessibility acceptance are outside these browser captures.

Each look/theme folder contains `normal.png`, `narrow.png`, `narrow-large.png` and `contrast.png`.
