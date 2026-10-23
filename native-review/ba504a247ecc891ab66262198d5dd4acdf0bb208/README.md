# Native Mac menu focus-ring correction

Candidate: `ba504a247ecc891ab66262198d5dd4acdf0bb208` (PR #1028). Baseline: `6ee2785833cb42731e6b1e20c03bd6a39c449e7d` (PR #1025).

Six CUA captures show the real Mac Tauri/WebKit production entry with committed public `fixtures/bibtex/real-world.bib`, isolated app-only Light/Dark appearance and built-in, non-primary display placement. No OS settings changed. The native check is recorded in [the lead's report](https://github.com/ibiscite/ibis/pull/1028#issuecomment-6377049096): More opened by keyboard, six Down presses moved focus to Larger text, and Tab followed by typing read back `ax` in Search without a click.

## Provenance and limits

- Light raw/bundled executable UUIDs matched: `6C816DD8-CDED-37FA-B8B9-347B09B40876`. Dark UUIDs matched: `ACB9AD77-0A6D-38F2-9B42-52534A1A3134`.
- **Light before/after both use Larger text. Dark baseline uses Normal text; Dark candidate uses Larger.** Dark pairs are not text-size/geometry matches.
- Candidate parent `223662895d1f70b990a623ffd518987a0f32188b` and baseline have identical `nativeAccent.ts`, `nativeAccent.css` and `styles.css` blobs. Candidate changes the global focus-ring selector; baseline #1025 separately adds opaque-overlay guards in `nativeAppearance.css`. Fill/material differences therefore are not isolated proof of this ring fix.
- This pre-integration candidate still shows black native-accent text; the separate #1027 correction owns that behavior. These frames certify neither material appearance nor the combined final-main result.
- Configured window size: 720 × 480. Actual captures: 720 × 481 pixels. Original JPEG bytes were preserved without conversion/cropping, with corrected `.jpg` extensions. [Manifest and hashes](manifest.json).
- Scope: keyboard menu focus-ring behavior in this Mac preview. No live OS accessibility/material certification or other-platform interaction acceptance is implied.

| View | Baseline | Candidate | Text-size qualification |
| --- | --- | --- | --- |
| Light More | [Before](before-6ee-native-light-more.jpg) | [After](after-ba50-native-light-more.jpg) | Larger / Larger |
| Dark More | [Before](before-6ee-native-dark-more.jpg) | [After](after-ba50-native-dark-more.jpg) | Normal / Larger |

Focused Larger text item: [Light](after-ba50-native-light-focus-larger.jpg), [Dark](after-ba50-native-dark-focus-larger.jpg).

## Windows build only

Exact candidate source was clean and passed an offline, locked, two-job custom-protocol dev build with an isolated verification identity. Immutable executable SHA-256: `92F02174AED4418CC368833E331953E49272A6CCE8145AB2E3BCBF0CA6AB4F13`. This proves compilation, not UI acceptance. Jump input failed before delivery with `noWindowsAvailable`; the visible synthetic frame was not proof of a live verification process. No Windows interaction or whole-desktop image is published here.
