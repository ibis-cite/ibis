# Native macOS selected-text correction

Candidate: `fe89dac755b5eea8034490b19644246f26fb4101` (PR #1027). Baseline capture: `6ee2785833cb42731e6b1e20c03bd6a39c449e7d` (PR #1025).

These nine CUA captures show the real Tauri/WebKit production entry with the committed public `fixtures/bibtex/real-world.bib`, using isolated app-only Light/Dark appearance. They are native window captures, not browser gallery frames; the gallery intentionally opts out of the native accent path. Read-only built-in-display placement kept the picker on the non-primary display. No OS appearance, display or security preferences changed.

The configured picker is 720 × 480. The actual captured images are 720 × 481 pixels. Original JPEG bytes were preserved without conversion or cropping, with their published extension corrected to `.jpg`. File hashes and dimensions are in [manifest.json](manifest.json).

## Provenance and limits

- Baseline `nativeAccent.ts`, `nativeAccent.css` and `styles.css` blobs equal the candidate's parent `223662895d1f70b990a623ffd518987a0f32188b`. The candidate changes selected text to WebKit's native pair while preserving the primary-button contrast choice.
- Baseline #1025 separately adds `nativeAppearance.css` fallback guards absent from the candidate. These images are **not isolated material-fill proof**, even where they show the same normal material state.
- **Light pairs both use Larger text. Dark baseline frames use Normal text; Dark candidate frames use Larger text.** Dark pairs demonstrate the selected-text correction, not matched text size, geometry or layout.
- Candidate Light raw/bundled executable UUID: `D6B95452-A1C9-33E9-86EC-FDCD07D784A0`. Candidate Dark UUID: `BBF43315-424E-343E-B202-32126210AB8E`. Their equality was checked by the lead before capture.
- Scope: selected-row/menu native accent text on this Mac. The additional Dark frame shows the added tile's white fill and scarlet check. This is not live OS material certification, other-OS/version acceptance or complete native acceptance.

The [lead's native report](https://github.com/ibiscite/ibis/pull/1027#issuecomment-6376938595) records observed typing and source/binary checks separately.

| View | Baseline | Candidate | Text-size qualification |
| --- | --- | --- | --- |
| Light rows | [Before](before-6ee-native-light-rows.jpg) | [After](after-fe89-native-light-rows.jpg) | Larger / Larger |
| Light More | [Before](before-6ee-native-light-more.jpg) | [After](after-fe89-native-light-more.jpg) | Larger / Larger |
| Dark rows | [Before](before-6ee-native-dark-rows.jpg) | [After](after-fe89-native-dark-rows.jpg) | Normal / Larger |
| Dark More | [Before](before-6ee-native-dark-more.jpg) | [After](after-fe89-native-dark-more.jpg) | Normal / Larger |

Additional candidate: [Dark added tile, Larger text](after-fe89-native-dark-added.jpg).
