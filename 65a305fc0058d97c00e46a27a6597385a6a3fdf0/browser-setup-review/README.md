# Browser-only setup comparison

Synthetic browser captures in headless Google Chrome on macOS. The macOS, Windows and Linux switches reproduce application styling; these are not native WebKit, WebView2, GTK, OS materials or installed-app acceptance.

- Current source: `65a305fc0058d97c00e46a27a6597385a6a3fdf0` (#989).
- Before source: `3da2f7f6ed0de07d121f77e7863fb1e967e5cf2f` (the main baseline before this setup migration).
- Matching before/current first-run-found captures: macOS look, dark, Larger picker text, coarse pointer, 720 × 480, initial scroll position and default Markdown/Pandoc choice.
- Current first-run: same switches and viewport.
- Mixed-script found-files detail: current macOS look, dark, Larger, fine pointer, 360 × 480 browser viewport; the section capture includes the synthetic Arabic/Hebrew/CJK/literal-tag and long filename/folder wrapping.
- Pending rescan: current Linux look, dark, Larger, fine pointer, RTL, 360 × 480; Look again retains keyboard focus while unavailable. Found files are temporarily hidden during scanning, as before.

Independent acceptance passed 96 layout cases: first-run/first-run-found × three looks × light/dark × normal/Larger × fine/coarse × 720/360 widths. Each had one primary, a controlled neutral writing toggle selection, no horizontal button overflow, and minimum button heights of 32 px (fine) or 44 px (coarse). Six additional runtime cases verified literal mixed-script wrapping, the exact found-list callback, pending focus/ring, unavailable hover/press paint, and no duplicate scans from pointer/Enter/Space.

Native and installed acceptance remain separate evidence.
