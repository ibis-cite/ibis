# Menu action focus — synthetic browser evidence

Source before: `6a4031a5cefa360ccc193f5c66202b6c643c1540`. Source after: `5f76874f1d96af75c88c73514c13d8f98b904b0b`. Chromium 151.0.7922.34; 760 × 620; browser OS looks, not native captures.

All images show More → Reload after the popover fully closes. Before: More has focus. After: Search has focus; typing can resume.

| OS look and appearance | Before | After |
| --- | --- | --- |
| macos light | [Before](before/macos-light.png) | [After](after/macos-light.png) |
| macos dark | [Before](before/macos-dark.png) | [After](after/macos-dark.png) |
| windows light | [Before](before/windows-light.png) | [After](after/windows-light.png) |
| windows dark | [Before](before/windows-dark.png) | [After](after/windows-dark.png) |
| linux light | [Before](before/linux-light.png) | [After](after/linux-light.png) |
| linux dark | [Before](before/linux-dark.png) | [After](after/linux-dark.png) |

The baseline reproduces the regression in 48/48 cases. The final source passes 96/96 checks: Choose library and Reload by pointer/keyboard, Escape → More, Tab → Search, shortcuts dialog → Close and back to Search; all three OS looks, light/dark, normal/reduced motion. See each source's results.json and manifest.json.

Native macOS, Windows and Linux focus checks are still missing from this local browser evidence; this does not claim native verification.
