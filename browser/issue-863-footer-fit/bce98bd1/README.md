# Footer fit — synthetic browser evidence

Source: `bce98bd1c77865a9cfc05bbb9a65531a15a6d813`. Chromium browser render; these are not native captures.

The existing contact-sheet runner rendered all 576 frames: 528 picker frames and 48 component previews, across macOS, Windows and Linux looks, light/dark themes and normal/Larger text. `manifest.json` records every frame. Both labelled contact sheets were visually inspected.

`baseline-32dac16a` reproduces the original Linux/light/normal pinned 20-reference failure at 720×480: an 80px footer leaves only 18px of the 58px active row visible. Current `normal/linux-light/tray-20.png` keeps a 40px footer and the whole row visible. All six originally failing Linux normal tray20/40/50 frames render.

`width-attack.json`: 108 passing collapse/growth cases across three looks, counts20/40/50, Pandoc/Chicago/APA, normal/Larger/200% text and RTL. Widths900/721/720/719/520/360 and reverse remain stable, with live unwrapped button measurements, reachable controls, local row visibility and Search focus. Recorded source23cc26be has identical UI blobs to bce98bd1; the intervening merge brings only landed native login-registration code.

`focus-attack.json`: nine passing browser checks across three looks. Folding focused Shortcuts transfers focus to the actual More button; Search and Copy keep focus, and growth does not steal it. The first probe incorrectly assumed More used `aria-haspopup="menu"`; the corrected probe checks actual button identity. Product source did not change.
