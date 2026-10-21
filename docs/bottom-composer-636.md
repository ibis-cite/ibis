# Slim B bottom-composer concept (#636 / #627)

**Browser prototype only; not implemented or an accepted size policy.** This
continues the maintainer-chosen inset B direction while addressing suggestion
space and moving click targets. It groups the selection count/inspection and
formatted preview below results, immediately above the footer. It adds no
separate visible Preview heading and keeps existing readable body typography.

The result is conditional: the tested 720px-wide views and 360×480 views show
complete active suggestions. **360×320 fails the complete-row requirement at
both text sizes.** Bottom placement alone does not make every geometry fit.
480px is a tested narrow fit point, not a discovered minimum or native default.

## Labelled boards

Actual runtime source: `8b93a8b29db17e3d8aa4caa0aee60448520e70c5`, the corrected
containment checkpoint released by the UI author. Chromium 151.0.7922.34, macOS
browser look, synthetic data, comfortable density. Larger is the app's ×1.15
setting. The two compared heights keep width fixed; no native auto-resize occurs.

- [720×480 / 720×600, normal text, 50 selected](images/bottom-composer-636-720-normal-height-comparison.png)
- [720×480 / 720×600, Larger text, 50 selected](images/bottom-composer-636-720-large-height-comparison.png)
- [360×320 / 360×480, normal text, 50 selected](images/bottom-composer-636-360-normal-height-comparison.png)
- [360×320 / 360×480, Larger text, 50 selected](images/bottom-composer-636-360-large-height-comparison.png)
- [Ordinary two-reference source layout / bottom composer](images/bottom-composer-636-ordinary-source-vs-prototype.png)

The [manifest](images/bottom-composer-636-evidence.json) contains exact prototype
CSS, all measured before/immediate/ready states, original click points, record
identities, control rectangles, disclosure observations and image hashes.
Repeated formatter outputs and ordered selections are stored once in hash-keyed
catalogs; measurements refer to them. Output hashes use UTF-8 formatter innerHTML.
Selection hashes use compact UTF-8 JSON arrays of ordered native keys.

## What the concept changes

The actual App and formatter remain mounted. A one-off browser observer moves
existing tray/preview nodes after the result node **within the same content
parent**, preserving their source DOM and region labels. The actual source tray
is collapsed behind a temporary count/inspection button, rather than displaying
50 wrapping chips. Its complete original list and Remove controls remain in the
DOM and can be revealed by the prototype inspector.

A stable composer has one control/count row and a two-body-line preview viewport.
It is already budgeted before first selection and before pending output completes.
The count changes inside the reserved row rather than inserting a new band above
the clicked result. Body text stays at existing 14/20 tokens, scaled normally by
Larger. Background, border, radius and spacing use existing tokens. No new font,
shadow, clipped output string or ellipsis is introduced into the citation.

The full formatter DOM remains in the preview scrollport. A temporary **Full
citation** button expands that same preview over the central content region,
with a Back to results button and one inspection scroll owner. The selection
inspector similarly reveals the existing full source list. These temporary
buttons are prototype controls, not production features or proven keyboard/AT
contracts. They do not call copy IPC.

Stable footer/control geometry is also necessary. An early exploratory prototype
on `3a6b5a6` let footer focus reflow move Full citation by **29.015625px** between
pointer-down and pointer-up; the click missed. The final concept explicitly
reserves the measured focused footer height and uses stable wide/narrow footer
grid slots. This is additional prototype geometry, **not a production fix for
#640**. The full inspector also explicitly spans every central grid row instead
of remaining confined to the dock's small row.

## Fit and visible suggestions

Counts below are complete option boxes within their actual scrollport and the
viewport, with a successful hit test. They are not just titles, list headings or
partly exposed rows. All final prototype views have no outer document overflow
and keep header/footer controls visible. The long case is the actual 50-reference
`tray-preview` fixture; its selected last result is deliberately at the bottom of
the visible list.

| Fixed size | Text | Complete source option boxes observed | Complete prototype option boxes | Prototype active row complete |
| --- | --- | ---: | ---: | --- |
| 720×480 | normal | 2 | 4 | yes |
| 720×600 | normal | 5 | 6 | yes |
| 720×480 | Larger | 2 | 3 | yes |
| 720×600 | Larger | 3 | 5 | yes |
| 360×320 | normal | 1 | 0 | **no** |
| 360×480 | normal | 1 | 1 | yes |
| 360×320 | Larger | 1 | 0 | **no** |
| 360×480 | Larger | 2 | 1 | yes |

Source counts are baseline observations, not a fresh independent review of #639.
Its central-scrolling policy can put tray/preview above the visible area; the
prototype deliberately keeps a dock visible, so the counts are not equivalent
information presentations. The narrow 320px cases have inadequate room for a
complete long result plus the visible composer and existing controls. A taller
context or a separately designed compact disclosure mode is needed; this artifact
does not claim either is implemented or always permitted by the display work area.

## Click point, active identity and completion

The probe used actual browser Shift-clicks on the source App. It measured the
same record, its rectangle and the original pointer point before/immediately
after the selection, then after deferred formatting completed. Record identity
uses unchanged `synthetic-gallery` source/native keys at revision `gallery`, not
just a reused row index. Search, format control, pin, footer and More rectangles
were also compared.

**All 20 prototype transitions retained the same row top, original point hit and
active record, with stationary measured outer controls.** This includes first
and second ordinary selections, plus 50→49→50 pressure transitions at all eight
size/text combinations. Pending phases also retained the point/row position.
Only **14 of those 20** transitions have a complete target row: the six transitions
in 360×320 contexts remain fit failures despite being stationary.

The ordinary baseline demonstrates why identity alone is insufficient:

| First selection | Source row-top change | Source original point still hits row | Prototype row-top change | Prototype point still hits row |
| --- | ---: | --- | ---: | --- |
| 720×480 normal | +49.375px | no | 0px | yes |
| 360×320 Larger | −82.0625px | no | 0px | yes, **row still incomplete** |

The narrow source baseline begins after reaching its last result, before a
selection activates containment; its header is initially scrolled away. That
context is recorded rather than presented as a normal fixed-header source view.
The prototype reserves containment/composer space even before first selection.

The first ordinary selection reuses the already formatted highlighted reference,
so it correctly issues **no new CSL request**. The probe records that reuse; it
does not fabricate a pending state. Adding a second reference and the long
49/50 transitions do change the formatted choice, so a temporary deferred-CSL
wrapper measures actual pending→ready completion through the real formatter.

## Output and disclosure checks

Immediately regrouping the source DOM preserved all ten measured source/prototype
output strings, innerHTML and ordered selection arrays. The ordinary adapter maps
fixture IDs to two example references and a title-only synthetic book containing
`Mémoire x<sup>2</sup>`. Its actual APA preview retains `<i>` and `<sup>` markup.
This is synthetic provider data, not a claim about a native library mapper.

All ten prototype full-output inspections preserved that exact formatter DOM/text,
reached the scroll end and exposed the final rendered glyph inside the inspector.
Returning restored results scroll position. The full source list remained present
for each 50-selection case, with 50 original Remove controls and a scrollable end.
Removal, native copy ownership, keyboard operation and AT behavior were not
accepted or comprehensively tested by these observations.

## Relationship to the #639 oracle

The source gallery's `selectionContained` oracle assumes **tray → preview →
results** and checks those bands in that order. This concept intentionally changes
that anatomy to results → count/selection disclosure → preview. Its original
band-order clause therefore fails by design. No production test was weakened or
changed, and the prototype does **not** claim to pass all #639 acceptance gates.

The original oracle can also allow a row clipped to the available viewport. This
report's stricter complete-row test does not turn that allowance into a success
at 360×320. `sourceAck` in the raw records was sampled during dynamic measurement,
not awaited as a final source/native gate; false samples are not failure verdicts.
A production implementation would need an independently reviewed anatomy-aware
oracle while preserving the existing no-overflow, control and hit-test properties.

## Reproduction and scope

Use the source above and existing dependencies, with the existing development
gallery on loopback. Data pages were sequential in one Chromium instance per
bounded run; no mass parallel pages or native build was used. The final export
followed focused diagnostics, and failed exploratory runs are not pass evidence.

1. Load `gallery.html?state=tray-preview` for real 50-selection formatted pressure,
   applying macOS/light-or-dark/normal-or-Larger switches. `tray-50` is the same
   source's key-output pressure control; no new fixture/harness was added.
2. For ordinary transitions, use the existing `tray` fixture with zero initial
   selections and a temporary synthetic CSL/APA adapter, as in the earlier
   [styling](https://github.com/ibiscite/ibis/blob/fcb9358400c82c957a3438ca7361ae10e4fa43c9/docs/preview-styling-636.md) and [placement](https://github.com/ibiscite/ibis/blob/235db855d2246051664301a9eac69722298bae49/docs/preview-placement-636.md)
   concept workflow. The third fixture ID maps to the title-only markup sample.
   Move to that last result, measure its visible point, Shift-click, then measure
   first selection. Add the first result for the second selection.
3. Wrap the provider's CSL function with a controllable promise queue. Hold only
   after the highlighted preview has settled; release all queued calls after the
   immediate measurement. Record zero queued calls as reuse, not a timeout/failure.
4. Apply the manifest's temporary CSS and same-parent DOM regrouping. Reserve
   `--prototype-footer-height` from the focused source footer's measured height.
   Use a MutationObserver to update selected count and re-order newly mounted
   tray/preview nodes after results. Do not remount App or alter formatter HTML.
5. Prototype grid rows are `minmax(0,1fr)`, existing minimum-control height, and
   `2 * body-line + 3 * space-1 + border-width`. The reserved count/inspection row
   exists before selection; the source list is hidden only until its inspector
   is opened. Full inspection spans `grid-row: 1 / -1; grid-column: 1 / -1` in the
   central region. Preserve results scroll on opening/closing inspection.
6. Intersect actual row rectangles with each overflow ancestor and the viewport;
   hit-test the original click point and row centre. Keep incomplete rows, misses,
   control shifts and insufficient size as failures. Record width/height/scale
   rather than claiming an auto-resize policy.

Passed: 20 prototype stationarity/hit/identity observations; unchanged output and
selection during regrouping; ten full-output/end-glyph/scroll-return observations;
no page errors in final data pages; five PNG encoding/dimension/hash checks;
production-source diff and whitespace checks. **Failed fit:** 360×320 normal and
Larger. **Not run:** Rust/native/full/fuzz, full #639/production acceptance,
200% scaling, other densities/styles, display/DPI/manual-resize policy, real
first/middle/last removal or native keyboard/copy/AT acceptance.

No production App/CSS, design policy, font, dependency, repository harness,
workflow or ADR was changed. The count/disclosure and footer grid are temporary
browser controls/layout, pending a focused implementation by the sole UI writer.
