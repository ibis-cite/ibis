# Solid overlay fallbacks — synthetic browser evidence

Source: `6ee2785833cb42731e6b1e20c03bd6a39c449e7d` (PR #1025, part of #951).

Chrome 155.0.8059.85 on macOS, 720 × 480, synthetic gallery data. Native material mode is injected into the existing dataset; accessibility preferences are emulated in the browser. These are **not native captures, physical material proof or live OS preference acceptance**.

All 140 computed-CSS cases passed: three synthetic OS looks, light/dark, More/Shortcuts, normal/reduced-transparency/increased-contrast/forced-colors/contrast-preview preferences and applicable missing/opaque/confirmed material states. Fallback layers are solid with no backdrop filter. Normal confirmed macOS Vibrancy/Liquid Glass retains the existing 94% surface and 30 px blur. Windows/Linux normal styles remain unchanged by these guards.

Before is a controlled CSS baseline: the same built gallery with only the two candidate fallback guard rules removed. Other runtime/style source blobs are unchanged from main `223662895d1f70b990a623ffd518987a0f32188b`. The baseline reproduces retained menu blur without native material, and retained menu/dialog blur under reduced transparency. The already-solid baseline Shortcuts dialog without native material is an unchanged control. Normal confirmed material pairs are also unchanged controls.

[Computed style results](results.json). Every frame uses public synthetic references. Full C13 composition, material over real desktop content, older macOS fallback and live native accessibility transitions remain unverified.

| Case | Controlled before | Candidate after |
| --- | --- | --- |
| macos-dark-liquid-glass-normal-keys | [Before](macos-dark-liquid-glass-normal-keys-before.png) | [After](macos-dark-liquid-glass-normal-keys-after.png) |
| macos-dark-liquid-glass-normal-menu-open | [Before](macos-dark-liquid-glass-normal-menu-open-before.png) | [After](macos-dark-liquid-glass-normal-menu-open-after.png) |
| macos-dark-liquid-glass-reduce-keys | [Before](macos-dark-liquid-glass-reduce-keys-before.png) | [After](macos-dark-liquid-glass-reduce-keys-after.png) |
| macos-dark-liquid-glass-reduce-menu-open | [Before](macos-dark-liquid-glass-reduce-menu-open-before.png) | [After](macos-dark-liquid-glass-reduce-menu-open-after.png) |
| macos-dark-opaque-normal-keys | [Before](macos-dark-opaque-normal-keys-before.png) | [After](macos-dark-opaque-normal-keys-after.png) |
| macos-dark-opaque-normal-menu-open | [Before](macos-dark-opaque-normal-menu-open-before.png) | [After](macos-dark-opaque-normal-menu-open-after.png) |
| macos-light-liquid-glass-normal-keys | [Before](macos-light-liquid-glass-normal-keys-before.png) | [After](macos-light-liquid-glass-normal-keys-after.png) |
| macos-light-liquid-glass-normal-menu-open | [Before](macos-light-liquid-glass-normal-menu-open-before.png) | [After](macos-light-liquid-glass-normal-menu-open-after.png) |
| macos-light-liquid-glass-reduce-keys | [Before](macos-light-liquid-glass-reduce-keys-before.png) | [After](macos-light-liquid-glass-reduce-keys-after.png) |
| macos-light-liquid-glass-reduce-menu-open | [Before](macos-light-liquid-glass-reduce-menu-open-before.png) | [After](macos-light-liquid-glass-reduce-menu-open-after.png) |
| macos-light-opaque-normal-keys | [Before](macos-light-opaque-normal-keys-before.png) | [After](macos-light-opaque-normal-keys-after.png) |
| macos-light-opaque-normal-menu-open | [Before](macos-light-opaque-normal-menu-open-before.png) | [After](macos-light-opaque-normal-menu-open-after.png) |
