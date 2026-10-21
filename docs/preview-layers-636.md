# Citation preview as a distinct layer (#636 / #627)

**Design experiment, not production implementation or native acceptance.** This
responds to the maintainer's screenshot feedback: the previous bottom composer
visually joins the selected result above and the footer below. Its placement is
promising, but its boundary and purpose need to be clearer. Translucency was an
example to explore, not a requirement to hardcode a macOS effect everywhere.

The recommendation is to retain a stable bottom selection/action area, give the
preview a distinct reading surface, and make inspection explicit. A separated
persistent card is useful where space permits; an anchored, dismissible inspector
leaves more suggestion space when closed. The smallest tested window still fails
to show a complete long suggestion. Neither material nor collapse alone resolves
that size policy.

**Missing interaction requirement:** mouse selection must end with an obvious,
clickable Copy action using the existing copy transaction
([#653](https://github.com/ibiscite/ibis/issues/653)). These captures retain
the source's keyboard-oriented footer hint; they do not implement or accept mouse
copy. A future composer must visibly pair the Copy action with preview inspection.
Do not treat either study as a fully usable finished composer.

## Captures

Runtime source: `8b93a8b29db17e3d8aa4caa0aee60448520e70c5`. Browser-only temporary
DOM/CSS experiments against the real App and formatter, Chromium 151.0.7922.34,
synthetic references, existing system font and spacing tokens. Larger uses the
app's ×1.15 setting. No production TS, CSS, native code or design policy changed.

- [720×600 dark, Larger: separated card / opened overlay](images/preview-layers-636-wide-dark-large.png)
- [720×480 light, normal: ordinary rich citation](images/preview-layers-636-wide-light-normal.png)
- [360×480 light, Larger: long selection](images/preview-layers-636-narrow-light-large.png)
- [360×320 dark, Larger: fit failure and explicit reading view](images/preview-layers-636-small-dark-large.png)
- [Compact rail while the overlay is closed](images/preview-layers-636-overlay-closed.png)
- [Windows dark / Linux light browser appearance sketches](images/preview-layers-636-platform-looks.png)

The previous flush composer and its measurements remain in
[the earlier report](bottom-composer-636.md). Its border touching the selected row
is superseded by this experiment, not presented as an accepted visual design.
[Machine-readable evidence](images/preview-layers-636-evidence.json) records the
exact temporary CSS, output, ordered selection, rectangles, click points and image
hashes. These are browser captures, not native screenshots. Windows light, Linux
dark, actual native materials, system accessibility settings and native keyboard/
AT/copy behavior remain unverified here.

## Native guidance and its consequence

| Layer | Guidance checked on 2026-10-20 | Consequence for this study |
| --- | --- | --- |
| macOS controls and content | [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials) distinguishes a floating functional layer from content, recommends restraint, and favors legibility for text-heavy components. | The citation stays readable neutral body text on a substantial reading surface. Material belongs to the semantic layer; it is not a decorative glass effect on every rectangle. |
| macOS anchoring | [NSPopover](https://developer.apple.com/documentation/appkit/nspopover) relates additional content to an anchor and lets the system position it. | A persistent preview control identifies what opens and where it came from. The browser alignment is a sketch, not a substitute for native positioning behavior. |
| Windows transient content | [Microsoft Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) recommends Acrylic for transient surfaces and cautions against adjacent or stacked Acrylic panes. | Use one transient inspector surface, not a glass result row touching a glass preview touching a glass footer. |
| Windows dismissal | [Microsoft Flyouts](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts/flyouts) describes attached placement, Escape/outside dismissal, and normally consuming the dismissing click. | Opening must not reflow the result list. An outside click dismisses without selecting an underlying reference. |
| Linux popovers | [GNOME Popovers](https://developer.gnome.org/hig/patterns/containers/popovers.html) favors small, simple, button-attached overlays, roughly less than a third of the window, and Escape dismissal. | Keep the transient preview bounded. Where even a useful small popover cannot fit, use an explicitly opened central reader rather than overlap the search controls. |
| Accessibility | [Apple Reduce Transparency](https://developer.apple.com/documentation/appkit/nsworkspace/accessibilitydisplayshouldreducetransparency) and Microsoft Acrylic guidance require opaque alternatives in relevant settings. | Preserve hierarchy with spacing, boundaries and readable text when blur is absent. A browser contrast fallback is checked; native settings remain pending. |

These are design inferences from the sources, not OS approval of this layout.
The translucent browser study borrows the existing app menu recipe (94% surface,
30px blur and existing menu shadow). It is **not Liquid Glass or native Acrylic**.
A production implementation should select native/opaque material by capability
and system preferences, not ship this simulation as a native-material claim.

## What changed in the experiment

**A: separated persistent card.** Existing 12px spacing tokens, scaled normally,
separate the reading card from both the results and footer. The count and
“Citation preview” disclosure share the card header; the formatted body has a
bounded two-line scrollport. The exact citation remains available in an explicit
full reader. This retains B's accepted grouping and neutral readable text while
removing the edge-to-edge collision. The additional space has a real row cost.

**B: compact rail and anchored inspector.** The selection count and “Citation
preview” button stay in a reserved bottom row. Pressing the button opens a single
bounded layer above it; the list and footer keep their geometry. The reading
surface sizes to short output and scrolls longer output rather than showing a
large empty panel. Its heading identifies the content, and Expand opens the full
reader. The citation is actual formatter HTML, not a rewritten summary.

The overlay deliberately covers suggestions while open. It is an explicit
inspection state, not a permanently open layer masquerading as free space. Escape
returns to the same results position; an outside click is consumed on dismissal.
At 360×320 Larger, its control opens the central reader directly because a useful
anchored panel cannot fit below the search header. This geometry-dependent study
is not an approved threshold or persisted-window policy.

The source selection tray remains available through the count disclosure. Existing
Remove controls are retained; comprehensive removal/keyboard/AT acceptance was
not repeated. The inherited prototype footer grid and measured height reservation
keep outer control positions stable; this is not a production fix for #640.

## Geometry and output observations

The probe uses real Shift-clicks and the actual source formatting API, with a
controllable deferred CSL request. It records before, immediate and completed
states against the same native record key and original pointer point. All 24
prototype transitions preserve that point, row top and active record; 16 of 24
have a complete target row. This does
not imply that every target row fits completely.

| Window / text / data | A complete rows | A active complete | B closed complete rows | B closed active complete |
| --- | ---: | --- | ---: | --- |
| 720×600 / Larger / 50 references | 4 | yes | 5 | yes |
| 720×480 / normal / ordinary rich citation | 3 | yes | 3 | yes |
| 360×480 / Larger / 50 references | 1 | yes | 1 | yes |
| 360×320 / Larger / 50 references | 0 | **no** | 0 | **no** |
| 600×480 / normal / Windows ordinary | 2 | **no** | 3 | yes |
| 600×480 / normal / Linux ordinary | 2 | **no** | 3 | yes |

The 600px A cases miss the strict complete-row boundary by less than one pixel
after browser scrollIntoView rounding; that remains a failed complete-row
observation, not silently rounded into a pass. The narrow 320px-high case has only
about 91px of result viewport even with B closed, while its wrapped long option
is about 136px tall. The whole window cannot be made usable merely by changing
the preview surface. No font reduction or citation-content truncation was used.

All five tested outside-click dismissals preserve ordered selection and results
scroll, and consume the dismissing click. **Two long-selection cases change the
highlight on pointer movement toward the outside click.** Pointer/hover ownership
is therefore unresolved; dismissing the overlay must not silently change the
active reference. This prototype finding is retained instead of claiming complete
interaction acceptance. All six Escape observations close the relevant inspector.
The browser Increase Contrast observation uses an opaque surface, no blur, and
unchanged formatter markup; native Reduce Transparency remains unverified.

All twelve full-reader observations preserve exact formatter HTML/text, reach the final
rendered glyph, restore results scroll position and preserve active identity.
The ordinary synthetic book retains italic title and superscript markup alongside
Japanese text. The original top tray → preview → results oracle is intentionally
inapplicable after regrouping; no production assertion was weakened.

## Review and implementation handoff

Keep the stable selection/action area and the distinct reading layer. Prefer an
explicit inspector over an always-open overlay when space is tight. A production
proposal must settle the visible mouse Copy action, complete-row sizing policy,
pointer and focus ownership/return, disclosure semantics, native material fallback and actual
copy behavior together. Existing pin discoverability work (#570) remains separate;
these captures do not repair its hover-only affordance.

Passed: bounded sequential browser experiment, formatter preservation and reported
geometry/dismissal observations; PNG signatures, dimensions and hashes are checked
at export. Failed: the complete-row cases identified above. Not run: native input,
copy, AT, native accessibility/material acceptance, Rust/native/full/fuzz checks.
The coordinating resource hold excludes those heavy checks for this data-only
artifact. `node scripts/check.mjs` has not passed for this artifact and no merge
or production acceptance is requested.

The experiment scripts live outside the repository; exact temporary CSS and the
measurement protocol are retained in the evidence. No new workflow, harness,
dependency, ADR, application behavior or public API was introduced.
