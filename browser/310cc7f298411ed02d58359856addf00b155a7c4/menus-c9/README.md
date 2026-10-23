# C9 synthetic browser comparisons

Candidate: `310cc7f298411ed02d58359856addf00b155a7c4` (#1019). Baseline: main `223662895d1f70b990a623ffd518987a0f32188b` (#1016). Both source checkouts were clean; the baseline evidence build used a separate output directory. The final source and evidence dist were not rewritten.

These are **Chrome on macOS platform-look simulations**, using existing gallery synthetic references. They do not certify native Windows/Linux, system fonts/materials, physical input methods, OS settings, clipboard or installed-app behavior. Freshness timestamps naturally differ between captures.

## Verified candidate cases

All 24 groups passed: three looks × light/dark × normal/Larger at 720×640; three looks × fine/coarse Larger RTL at 380×640; and each look with wide en-US/CSS-RTL and Arabic/CSS-LTR contexts. Larger uses the application's setting; coarse cases use touch/mobile emulation. Context locale changes are browser-only and do not change OS preferences.

Checks cover computed 10px item padding; 10px/4px separator margins; aligned Format-filter text; the 4px popup gap within integer positioning rounding; logical trailing alignment with the documented viewport shift; Format-only leading checks; More's label-first/trailing check layout and ARIA state; UI-font APA/Chicago versus monospaced key samples; Tab/Escape, filtering and selecting enabled Typst, and subsequent Search typing. Outer shortcut margins follow each menu's inherited direction; inner bdi/keycaps retain LTR visual ⇧⌘P order. Narrow chords remain atomic inside their fill. Representative images were inspected.

Citation styles are intentionally unavailable in these fixture providers; their sample fonts are checked, without claiming APA selection. Private probe assumptions were corrected before the final run: a nonconfigurable navigator override prevented gallery startup, disabled APA was not a valid action target, folded Shortcuts needs its existing keyboard shortcut, and narrow popovers may legitimately shift.

## Matched captures

| Synthetic case | Baseline | Candidate |
|---|---|---|
| macos light Larger LTR 720×640 format | [Before](before-macos-light-large-ltr-720x640-fine-en-US-format.png) | [After](after-macos-light-large-ltr-720x640-fine-en-US-format.png) |
| macos dark Larger LTR 720×640 more | [Before](before-macos-dark-large-ltr-720x640-fine-en-US-more.png) | [After](after-macos-dark-large-ltr-720x640-fine-en-US-more.png) |
| windows light Larger LTR 720×640 format | [Before](before-windows-light-large-ltr-720x640-fine-en-US-format.png) | [After](after-windows-light-large-ltr-720x640-fine-en-US-format.png) |
| windows dark Larger LTR 720×640 more | [Before](before-windows-dark-large-ltr-720x640-fine-en-US-more.png) | [After](after-windows-dark-large-ltr-720x640-fine-en-US-more.png) |
| linux light Larger LTR 720×640 format | [Before](before-linux-light-large-ltr-720x640-fine-en-US-format.png) | [After](after-linux-light-large-ltr-720x640-fine-en-US-format.png) |
| linux dark Larger LTR 720×640 more | [Before](before-linux-dark-large-ltr-720x640-fine-en-US-more.png) | [After](after-linux-dark-large-ltr-720x640-fine-en-US-more.png) |
| macos dark Larger RTL 720×640 format | [Before](before-macos-dark-large-rtl-720x640-fine-en-US-format.png) | [After](after-macos-dark-large-rtl-720x640-fine-en-US-format.png) |
| macos dark Larger RTL 380×640 keys | [Before](before-macos-dark-large-rtl-380x640-coarse-en-US-keys.png) | [After](after-macos-dark-large-rtl-380x640-coarse-en-US-keys.png) |

## Larger literal labels

In the matched macOS-look Chrome captures, `\parencite` and `\textcite` each occupy one line on both sources (root 18.4px; label font 14.95px). C9 reduces available label widths by 4px: 76.125→72.125px and 84.656→80.656px; measured text widths are 68.297px and 55.141px. This does not establish whether observed real-WebKit wrapping is inherited or caused by that width difference. No universal native one-line-label claim is made.
