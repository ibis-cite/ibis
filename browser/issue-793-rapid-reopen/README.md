# Rapid menu reopen during exit

Synthetic real-App gallery, Chromium 151.0.7922.34. Source baseline: `6a4031a5cefa360ccc193f5c66202b6c643c1540`; compared Menu runtime: `5f76874f1d96af75c88c73514c13d8f98b904b0b`. Browser OS looks only; no native claim.

1. Build the existing evidence gallery and open `gallery.html?state=many-results&platform=macos&theme=light`.
2. Click More, then Reload.
3. While `.menu-popover[data-exiting]` still exists (the 80 ms exit), click More again.
4. Let two animation frames finish, then press ArrowDown and let two more frames finish.

The baseline and compared runtime both have More expanded and the menu visible, but document.body focused and the app root inert. ArrowDown leaves body focused. The 12-case compared-runtime matrix covers all three OS looks, light/dark, normal/reduced motion: every second click occurred during exit; no case focused the menu or a menu item before/after ArrowDown. The detailed active-tag baseline comparison is macOS/light/normal motion; other baseline combinations and native systems were not exercised.

See [results.json](results.json). This qualifies the #791 evidence: ordinary action focus is fixed there; rapid reopening is a separate baseline defect (#793).
