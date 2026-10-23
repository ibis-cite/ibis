# Header pin, off and on

Synthetic browser comparison for PR #891. Baseline: `605538cb2e096f397d4dcb166f8fdeda28392ded`; candidate: `5ae1bdd713f62f642fc24ffb53f40595ab7e9e3e`. Both versions render the existing synthetic two-reference tray fixture through the real App and gallery renderer, using synthetic providers only.

Every image is Chrome on macOS displaying the named Ibis appearance variant, selected before load. These are browser captures, not native macOS/Windows/Linux screenshots or custom-accent-provider acceptance. No personal library, OS preference or native command is used. The baseline's already-locked react-aria 3.53.1 transitive package was resolved by a private Vite alias because its dependency directory lacked the direct link; no package was installed or changed.

Light comparisons use 720 × 640 CSS pixels, normal text, fine pointer and LTR. Dark comparisons use 360 × 640, Larger text (1.15×), coarse-pointer/touch emulation and RTL. The pointer rests outside the pin and Search has focus. The pin is captured both off and on, with the same query and selected references.

All 18 browser cases passed: 12 normal interaction/geometry cases across three looks, light/dark and the two size/input combinations, plus six forced-color state cases. The always-visible header toggle follows the format control, uses a filled glyph on a neutral pressed fill when selected, and has no footer duplicate. Pin bounds stay fixed across state changes; search glyph bounds and query start match the baseline, with no horizontal overflow. Fine/coarse targets meet 32/44 px scaled with text and own all four edge probes.

Pointer, held Enter/Space, shortcut repeat suppression, immediate Search typing, retained citations and ordered optimistic native-request simulation passed. More retains its checked action and changes between Keep window open and Stop keeping open; Escape never changes the pin. Forced-color keyboard focus remains visible. Native interaction, actual window pinning and system-accent following are separate acceptance gates.

| Appearance, view and pin state | Before | Candidate |
| --- | --- | --- |
| macos · light · normal-fine-ltr · off | ![Before](before-macos-light-normal-fine-ltr-off.png) | ![Candidate](candidate-macos-light-normal-fine-ltr-off.png) |
| macos · light · normal-fine-ltr · on | ![Before](before-macos-light-normal-fine-ltr-on.png) | ![Candidate](candidate-macos-light-normal-fine-ltr-on.png) |
| macos · dark · larger-coarse-rtl · off | ![Before](before-macos-dark-larger-coarse-rtl-off.png) | ![Candidate](candidate-macos-dark-larger-coarse-rtl-off.png) |
| macos · dark · larger-coarse-rtl · on | ![Before](before-macos-dark-larger-coarse-rtl-on.png) | ![Candidate](candidate-macos-dark-larger-coarse-rtl-on.png) |
| windows · light · normal-fine-ltr · off | ![Before](before-windows-light-normal-fine-ltr-off.png) | ![Candidate](candidate-windows-light-normal-fine-ltr-off.png) |
| windows · light · normal-fine-ltr · on | ![Before](before-windows-light-normal-fine-ltr-on.png) | ![Candidate](candidate-windows-light-normal-fine-ltr-on.png) |
| windows · dark · larger-coarse-rtl · off | ![Before](before-windows-dark-larger-coarse-rtl-off.png) | ![Candidate](candidate-windows-dark-larger-coarse-rtl-off.png) |
| windows · dark · larger-coarse-rtl · on | ![Before](before-windows-dark-larger-coarse-rtl-on.png) | ![Candidate](candidate-windows-dark-larger-coarse-rtl-on.png) |
| linux · light · normal-fine-ltr · off | ![Before](before-linux-light-normal-fine-ltr-off.png) | ![Candidate](candidate-linux-light-normal-fine-ltr-off.png) |
| linux · light · normal-fine-ltr · on | ![Before](before-linux-light-normal-fine-ltr-on.png) | ![Candidate](candidate-linux-light-normal-fine-ltr-on.png) |
| linux · dark · larger-coarse-rtl · off | ![Before](before-linux-dark-larger-coarse-rtl-off.png) | ![Candidate](candidate-linux-dark-larger-coarse-rtl-off.png) |
| linux · dark · larger-coarse-rtl · on | ![Before](before-linux-dark-larger-coarse-rtl-on.png) | ![Candidate](candidate-linux-dark-larger-coarse-rtl-on.png) |

## Forced-color focus, selected

| macOS appearance | Windows appearance | Linux appearance |
| --- | --- | --- |
| ![macOS](macos-forced-dark-on-focus.png) | ![Windows](windows-forced-dark-on-focus.png) | ![Linux](linux-forced-dark-on-focus.png) |
