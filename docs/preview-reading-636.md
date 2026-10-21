# Simplify citation preview and reading (#636 / #627 / #653)

**Data-only browser experiment. No production UI or native behavior changed.**
This iteration replaces the previous floating, right-aligned preview proposal.
The new design keeps results and citation reading in distinct, non-overlapping
states. It also replaces the prominent blue Copy button with a quiet control from
the existing app button family and removes the duplicate keyboard Copy hint from
the concept footer.

## What each state means

| State | Content and size | Controls |
| --- | --- | --- |
| Picker with a short citation | The complete citation appears below results, inside a separated reading/action group. It uses at most two body lines. | Selection count and **Copy citation**. No redundant Read action when everything already fits. |
| Picker with a long citation | A two-line excerpt uses the same reserved space. Exact formatter output remains intact. | Selection count, **Read citation**, and **Copy citation**. |
| Compact picker | The excerpt folds away when it would prevent a complete active row from fitting. The action row stays below results. | Same count, Read and Copy controls. No hidden overlay or hover-only disclosure. |
| Citation reading | The citation replaces the results in the central region, using its full available width and height. One scroll owner exposes the complete output. | **Back to results** or Escape restores the list; Copy stays at the same bottom position. |
| Selected references | The existing selected-reference list replaces the central results region. | Existing Remove controls and Back; no selected-list overlay. Removal acceptance remains separate. |

“Read” means a named view change, not a floating rectangle becoming larger.
There is no side offset, overlapping result row, fixed popover width, material
stack or second preview window. The short citation needs no larger view at all.
The full reader uses remaining central space rather than an arbitrary panel size.

The normal preview/action group has space above it and below it. Its body retains
existing 14/20 type, scaled normally by Larger, with neutral text. Copy uses the
existing quiet surface treatment and regular label weight, with the explicit
label “Copy citation”; it does not compete with the selected result's accent fill.
The copy control occupies the same slot during reading and list management.
The reading scrollport has an explicit spacing-token gap above those controls;
its surrounding navigation supplies the vertical space rather than adding another
layer of inner padding.

## Captures

Runtime source `8b93a8b29db17e3d8aa4caa0aee60448520e70c5`, Chromium
151.0.7922.34, synthetic data, actual mounted App/formatter, temporary DOM/CSS.
These are browser captures, including platform looks, not native screenshots.

- [Wide long citation: picker → reading](images/preview-reading-636-wide-large.png)
- [Narrow long citation: picker → reading](images/preview-reading-636-narrow-light.png)
- [Measured short context: compact controls → reading](images/preview-reading-636-short-context.png)
- [Short complete citation: light and dark](images/preview-reading-636-wide-light.png)
- [Windows light and dark](images/preview-reading-636-windows.png)
- [Linux light and dark](images/preview-reading-636-linux.png)

The [evidence](images/preview-reading-636-evidence.json) includes exact prototype
CSS, measured states, ordered selected keys, formatter content, API arguments,
transition points and asset hashes. The [previous layering study](preview-layers-636.md)
provides the before comparison and its overlay/hover failures. Its floating
inspector and strong blue Copy treatment are not the recommended direction here.

All image metadata is verified from actual file encoding and dimensions. The
ordinary synthetic book preserves italic title and superscript markup alongside
Japanese text. No citation string is rewritten, flattened or shortened; the
summary viewport is bounded and the full reader retains the original DOM.

## Why this structure

[Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
recommends clear grouping and enough space for essential information, with
secondary information available in an additional view. [Apple Panels](https://developer.apple.com/design/human-interface-guidelines/panels)
warns that a HUD should not obscure content it adjusts and prefers standard panels
unless there is a reason for a HUD. [GNOME adaptive guidance](https://developer.gnome.org/hig/guidelines/adaptive.html)
starts with constrained space and cautions against subdividing a window into many
small panels; its [navigation guidance](https://developer.gnome.org/hig/guidelines/navigation.html)
favors clear subjects and views within an existing window.

The design inference is to simplify the states before choosing effects. Native
material can support the settled hierarchy later; it cannot repair obscured
results or unclear navigation. No new glass or Acrylic effect is added here.

## Size policy observations

Summary/compact choice is made once for each mounted context from the available
result viewport and the measured active row, with a small trailing gutter. It is
not recomputed on hover or every selection. Real native resizing, work-area/DPI
caps, manual-resize precedence and pending-search behavior remain the separately
reviewed #636 implementation.

| Browser context | Summary mode | Complete result boxes | Active row complete |
| --- | --- | ---: | --- |
| 720×480 macOS, normal, ordinary citation, light/dark | two-line space; entire citation fits | 3 each | yes |
| 720×600 macOS, Larger, 50 references | bounded excerpt | 4 | yes |
| 360×480 macOS, Larger, 50 references, light/dark | bounded excerpt | 1 each | yes |
| 360×320 macOS, Larger, 50 references | compact controls | 0 | **no** |
| 360×396 measured browser context, Larger, 50 references | compact controls | 1 | yes |
| 600×480 Windows, normal, ordinary citation, light/dark | entire citation fits | 3 each | yes |
| 600×480 Linux, normal, ordinary citation, light/dark | entire citation fits | 3 each | yes |

396px is an illustrative measured fit context, **not a proposed fixed minimum or
native default**. That probe began at 320px and calculated a larger browser
viewport from the actual complete-row deficit plus a small margin, capped at the
illustrative 480px available height. It does not implement a native resize. The
320px case remains a rejected complete-row geometry even after folding the
excerpt. It must not be presented as a polished supported minimum.

The trailing result gutter also removes the earlier fractional scrollIntoView
clipping in the tested 600px ordinary cases. The complete-row assertion was not
weakened. The results, summary, action row and footer have disjoint vertical bounds.
In reading mode results have `display:none`; they are replaced rather than hidden
beneath a new layer.

## Validation and limits

- Passed: 22 real pointer-selection transitions preserve the original point, row
  top, active record and measured outer control geometry through immediate and
  completed formatting. 20 have complete rows; the two 320px transitions do not.
- Passed: exact formatter HTML and ordered selection across view changes, full
  output's final glyph reachable, Back/Escape scroll and active identity restored.
  Short citations expose their final glyph inline without offering a larger view.
- Passed: Copy and footer rectangles stay within half a CSS pixel across the
  picker/reader states; the largest observed difference is subpixel rounding.
- Passed: the count disclosure uses the original selected list and Remove controls
  in the central region. Comprehensive removal/focus/AT acceptance is not claimed.
- Passed: 11 prototype Copy activations reach the existing source transaction once
  with text matching the visible citation and matching text from the rich HTML.
  These are synthetic API observations, not native clipboard or completion tests.
- Passed: two focused wide/narrow hover probes cannot hit hidden result rows or
  change active/selected references while reading. This directly checks the prior
  floating-overlay hover failure. All 22 final PNG signatures, dimensions and
  hashes match their regenerated byte-derived metadata.
- Failed: the original 360×320 long-row fit. Earlier exploratory captures are not
  acceptance evidence; only the final manifest and listed boards describe this
  revision.
- Not run: native materials/input/clipboard/AT, native adaptive resizing, full
  Rust/native/fuzz checks. `node scripts/check.mjs` was not run/passed under the
  coordinating resource hold. No implementation PR or merge acceptance is sought.

The prototype Copy adapter dispatches Enter through the existing source search
handler, which calls the existing copy transaction and its snapshot/formatter
checks. It does not add a clipboard writer. Warnings, pending/error presentation, first-run states and native focus behavior
remain implementation checks; this ready-preview experiment does not accept them.
Production #653 should bind the
visible control directly to that transaction and verify focus-independent
eligibility, pending/failure behavior and completion ownership; this temporary
adapter is not an implementation recommendation.

Continue with this simpler anatomy rather than the floating inspector. The
implementation handoff is #653 for the real Copy action, #627 for preview
composition, and #636 for bounded contextual sizing. Source, keyboard semantics,
native sizing and final appearance still belong to the single UI writer's small,
reviewed changes. No workflow, dependency, harness or ADR was added.
