# Footer fit — synthetic browser evidence

Exact source: `93f64ec2da0f4a627bcb675d42444583bb3be185`, including the landed platform looks and live hint-margin correction. Chromium browser renders, not native captures.

The existing contact-sheet runner rendered all 576 frames: 504 picker frames and 72 component previews, across macOS, Windows and Linux looks, light/dark themes and normal/Larger text. `manifest.json` records every frame. Both labelled contact sheets were visually inspected.

`baseline-32dac16a` reproduces the original Linux/light/normal pinned 20-reference failure at 720×480: an 80px footer leaves 18px of the 58px active row visible. Current `normal/linux-light/tray-20.png` keeps a 40px footer and the whole row visible. All six originally failing Linux normal tray20/40/50 frames render.

`width-attack.json`: 108 passing collapse/growth cases across three looks, counts20/40/50, Pandoc/Chicago/APA, normal/Larger/200% text and RTL. Widths900/721/720/719/520/360 and reverse remain stable, with live unwrapped button measurements, reachable controls, local row visibility and Search focus.

`boundary-attack.json`: 23 passing finer probes, including the Linux744–751 boundary in both directions. The earlier source omitted an existing negative hint margin and folded Shortcuts four pixels early. A failing regression preceded the live-margin correction; no width constant was added to production.

`focus-attack.json`: nine passing checks across three looks. Folding focused Shortcuts transfers focus to More; Search and Copy keep focus, and growth does not steal it. A historical probe incorrectly assumed More used `aria-haspopup="menu"`; the corrected probe checks the actual More button identity.
