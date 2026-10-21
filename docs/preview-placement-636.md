# Fixed-window preview comparison (#636)

This is a visual concept and bounded browser measurement, **not an implemented
layout or functional acceptance result**. It isolates the formatted preview's
placement before adaptive-height work. Production App, TypeScript, CSS, native
window policy and tray placement are unchanged.

At 720×480, moving the preview below results does not increase results height.
At 360×320 it exposes more results near the top, but puts the preview below the
initial viewport. Finish #639's containment work, then repeat this comparison
with longer result sets and previews before choosing placement for #636. This
experiment does not establish a new product default.

## Matched views

Each board labels current placement on the left and the DOM-relocation concept
on the right. Captures use source
`65748554dd25119dfda05f562bd76bc15e8e16a8`, Chromium 151.0.7922.34, macOS browser
appearance, comfortable density and synthetic data. Larger means the app's ×1.15
preference. The fixed browser viewports are CSS pixels, not native window sizes.

- [720×480, light, normal text](images/preview-placement-636-720-light-normal.png)
- [720×480, dark, Larger text](images/preview-placement-636-720-dark-larger.png)
- [360×320, dark, normal text](images/preview-placement-636-360-dark-normal.png)
- [360×320, light, Larger text](images/preview-placement-636-360-light-larger.png)
- [360×320 Larger, each preview scrolled into view](images/preview-placement-636-360-light-larger-at-preview.png)
- [360×320 Larger, More opened after reaching the footer](images/preview-placement-636-360-light-larger-more.png)

The [manifest](images/preview-placement-636-evidence.json) contains the eight
placement measurements, capture labels, image encoding/dimensions/hashes and
limits. Initial captures have Search focused, pointer outside the page, hover
opacity settled, and document/main/results scroll positions at zero. Each
matched pair uses the same mounted App; only its existing preview DOM node moves.

## Observations

Visible results area includes the heading and padding; it is not a count of
readable references. Values below are CSS pixels, rounded to one decimal.

| Fixed viewport and appearance | Results area height, both placements | Initially visible results area, top → bottom preview | Preview initially visible, top → bottom | Scroll offset to reveal bottom preview |
| --- | ---: | ---: | --- | ---: |
| 720×480 light, normal | 287.7 | 287.7 → 287.7 | yes → yes | 0 |
| 720×480 dark, Larger | 261.3 | 261.3 → 261.3 | yes → yes | 0 |
| 360×320 dark, normal | 353.5 | 146.2 → 181.2 | yes → no | 281 |
| 360×320 light, Larger | 426.2 | 60.7 → 124.1 | yes → no | 476 |

The document height is identical within each pair: 480, 480, 601 and 796 pixels
respectively. Tray rectangles, selected-key order and formatted text also match.
The bottom concept shifts result content upward but does not create more total
space. At the existing narrow breakpoint, results use document scrolling rather
than a bounded results scrollport. Search, tray and footer can leave the viewport
in both narrow variants; relocation alone does not repair that containment.

The same actual APA preview appears in both placements:
`(Example & Sample, 2026; 架空 著者, 2026)`. At narrow sizes, bottom placement separates
it from the unchanged selection tray and requires scrolling to inspect what the
formatted selection would look like. Programmatic scrolling made the preview
fully visible in all eight placements; this does not establish a keyboard or
screen-reader path to it.

After scrolling the footer into view and opening More, its measured rectangle
retains the existing 8px viewport inset in all eight placements. Its rectangle
intersects the bottom preview's region in both narrow cases; the narrow top
preview is then above the viewport. The menu still has a scrollport for its own
long contents. These are overlay geometry observations, not proof that pointer,
keyboard, copy or assistive-technology behavior survives a production relocation.
No containment or z-index adjustment was added to the concept.

## Reproduction without production edits

Use the source commit above and the existing installed dependencies. Run the
existing development gallery on loopback:

```sh
pnpm -C apps/desktop exec vite --host 127.0.0.1 --port 5199 --strictPort
```

Open `/gallery.html?state=tray&platform=macos&theme=light&text=normal` at the desired
fixed viewport. The existing `tray` state seeds two selected references and three
results, but its provider offers only citation-key output. The one-off comparison
therefore extends that provider with synthetic CSL and an APA preference, while
using the actual App, formatter worker, preview component and component styles.
It neither injects a hand-drawn preview nor changes the fixture in source.

After the original gallery is ready, the equivalent browser-console setup is:

```js
const { galleryStates, galleryProvider, withSwitches } =
  await import('/src/gallery-fixtures.ts');
const { renderGalleryState } = await import('/src/gallery.tsx');
const text = 'normal'; // 'large' for the app's Larger preference
const theme = 'light'; // 'dark' for the dark representative
const state = withSwitches(galleryStates.find(s => s.id === 'tray'),
  { platform: 'macos', theme, text });
const provider = galleryProvider(state);
const csl = [
  { id: 'example2026', type: 'article-journal', title: state.results[0].title,
    author: [{ family: 'Example' }, { family: 'Sample' }],
    issued: { 'date-parts': [[2026]] },
    'container-title': state.results[0].container },
  { id: '研究2026', type: 'book', title: state.results[1].title,
    author: [{ literal: '架空 著者' }], issued: { 'date-parts': [[2026]] } },
];
provider.api.cslItems = async ids =>
  JSON.stringify(ids.map(id => csl.find(item => item.id === id.native_key)));
provider.api.copyFormatted = async () => {}; // availability only; never copied
provider.api.pickerPreferences = async () =>
  ({ citation_style: 'apa', density: 'comfortable', larger_text: text === 'large' });
const root = document.createElement('div');
root.id = 'concept-root';
document.getElementById('root').replaceWith(root);
renderGalleryState(root, state, async () => {}, provider);
```

Wait for two selected references and the exact preview text above. Capture the
current layout, then perform only this relocation in the same mounted App:

```js
document.querySelector('main > footer')
  .before(document.querySelector('.format-preview'));
```

For both initial views, focus `#search`, move the pointer outside the page, wait
until `.pin-button` opacity reaches zero, and reset document/main/results scrolling
to zero. Wait two animation frames after layout settles. Measure rectangles with
`getBoundingClientRect()`. Intersect the results rectangle and each option with
the viewport and, when overflow is not `visible`, the results scrollport. The
manifest's full-option counts include option padding, not just text glyphs.

For the reachability view, the one-off browser probe used
`page.locator('.format-preview').scrollIntoViewIfNeeded()` through Playwright. For overlays it
scrolled the footer into view, opened More and recorded menu bounds. It did not
assert new keyboard or assistive-technology acceptance. Labelled paired boards
compose the two actual screenshots in browser HTML; all six exported files are
PNG and their actual dimensions and SHA-256 values are in the manifest.

## Verification and limits

Passed: four matched state/placement comparisons, same tray rectangles, selected
keys, preview text and document heights; no page errors in the eight measured
placements; preview reached by scrolling; eight bounded More rectangles; image
format/extension/dimension/hash checks; repository whitespace check; source diff
confirms only this report and image/measurement data changed.

Not run: Rust/native builds, full repository checks or fuzzing, as excluded by the
coordinator for this data-only concept. No production behavior or native
acceptance is claimed. There is no native capture, auto-height, side pane, PDF,
new harness, dependency, workflow or ADR here.

Coverage is deliberately small: two selected synthetic references, three results,
APA, comfortable density and four representative size/theme/text combinations.
Long previews, many results, pending/stale/error previews, 200% scaling, other
citation styles/densities, Windows/Linux appearance and native keyboard/copy/
screen-reader behavior need separate evaluation after containment is settled.
