# Soft depth — PR #760

Synthetic Chromium browser renders, not native material acceptance.

Before: main `2078154ab23e895a6a98b363e5245f8bc605af7f`. After: final `625f7e17568f08cda40ae133d1e67a9db0316040`.

96 frames total: three OS looks, light/dark, normal/larger text; first run, many results, More open, and 50 selected references with preview. Four labelled contact sheets accompany the frames. Every PNG signature/dimension was checked; png-manifest.json records hashes, relative paths and dimensions. Both normal contact sheets and the final larger-text sheet were visually inspected.

The existing clipped-chip/tray layout issue appears on this baseline and is addressed by #751, which must precede #760. These captures do not claim that the combined #751/#760 tree or native vibrancy/Mica was checked. Those integration/native checks remain separate gates where applicable.
