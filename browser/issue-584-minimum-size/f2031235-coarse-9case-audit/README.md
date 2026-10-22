# Minimum-size picker observations for #584

Source: `f2031235bf9692290abf31171301722df46f77ea`, an immutable landed-main checkpoint, **not current main**. Browser: Chromium 151.0.7922.34. All cases use the light theme and synthetic `tray-50` data. Coarse-pointer media is emulated with Playwright `hasTouch: true` and verified in each captured phase. No native validation is claimed.

The nine supplied captures were audited and preserved verbatim under `legacy/`. Their inline probe was not retained: original `main.height`/`main.top`, hit/visibility formulas, interaction methods and PNG phases remain unverified. They are raw observations, not relabelled as the repeat below.

The saved `capture.mjs` performs a bounded repeat against a clean checkout verified by Git to be the source above. The evidence build was freshly rebuilt first. Each case starts at **720 × 480**, awaits the gallery `tray-50` acknowledgement and **50 selected references**, then resizes to **360 × 320** before any root-font override. `repeat/` contains explicit phase-labelled PNGs and named rect/client/scroll measurements.

## Font modes

| Mode | Effective root font | Meaning |
|---|---:|---|
| app115 | 18.4 px | App Larger text only: 16 × 1.15. |
| root200 | 32 px | Explicit root override: 200% of 16 px, **not composed** with Larger text. |
| appLargerTimes2 | 36.8 px | Explicit root override: measured 18.4 px Larger text × 2. |

These are CSS root-font cases, not browser zoom or a native OS text-size claim.

## Defined repeat observations

`main` bounding and client heights stay **320 px** in all nine initial cases. The larger content extent is `main.scrollHeight`, not the window or bounding-box height. Values below are CSS px. The active-result number is its clipped visible vertical intersection, not a claim that the whole result is visible.

| Look | Mode | Main scrollHeight | Header rect height | Shelf rect height | Active visible after ArrowUp |
|---|---|---:|---:|---:|---:|
| macos | app115 | 320 | 119.562 | 47.688 | 23.875 |
| macos | root200 | 560 | 208 | 0 | 24 |
| macos | appLargerTimes2 | 640 | 239.156 | 0 | 24 |
| windows | app115 | 320 | 110.375 | 61.469 | 24 |
| windows | root200 | 538 | 192 | 2 | 24 |
| windows | appLargerTimes2 | 631 | 220.75 | 2 | 23.641 |
| linux | app115 | 320 | 119.562 | 56.875 | 23.875 |
| linux | root200 | 545 | 208 | 1 | 24 |
| linux | appLargerTimes2 | 639 | 239.156 | 1 | 24 |

The initial Search hit is true in all nine cases. In app115, disclosure, Copy and More also have clipped visible hit points. In the six 32/36.8 px cases, all three initially lack such a point; the shelf is reduced to 0–2 px. Hit checks sample the center of the element’s viewport-and-clipping-ancestor intersection using `elementFromPoint`; they do not certify target size or physical touch usability.

Genuine touchscreen taps at recorded hit points expanded the three app115 shelves. Their subsequent Fewer control had no visible hit point in the recorded phase; this audit did not attempt shelf scrolling to recover it. The six larger-font disclosure attempts are recorded as **unavailable-target failures**, with no DOM-click fallback.

Genuine Tab navigation reached More in all nine cases; Enter opened the menu, End focused its last item, and Escape closed it. The last menu item had a visible hit point in all nine. In the six larger-font cases, this keyboard navigation exposes Copy and More while Search leaves the visible region.

| Look | Mode | main.scrollTop at More focus | Active result visible at More focus | Search hit at More focus |
|---|---|---:|---:|---|
| macos | app115 | 0 | 23.875 | true |
| macos | root200 | 240 | 0 | false |
| macos | appLargerTimes2 | 311 | 0 | false |
| windows | app115 | 0 | 24 | true |
| windows | root200 | 218 | 0 | false |
| windows | appLargerTimes2 | 302 | 0 | false |
| linux | app115 | 0 | 23.875 | true |
| linux | root200 | 225 | 7 | false |
| linux | appLargerTimes2 | 310 | 0 | false |

All nine repeats completed their recorded phases without page errors or unmounts on these interaction paths. This does **not** disprove the separately reproduced inherited #874 render loop. The later #876 repair and current-main behavior are outside this immutable-source audit. Six cases retain explicit action failures, so this bundle is **not an acceptance pass**.

## Images and reproducibility

Four inspected contact sheets are in `repeat/sheets/`: initial minimum-size view, after disclosure touch, More keyboard focus, and menu End. Each has the three platform looks in columns and the three font modes in rows. Individual PNG names identify their exact phase; only `setup-720x480.png` uses the initial larger viewport.

To repeat, use a clean checkout at the source commit, install its existing locked web dependencies, make Playwright with Chromium available, then run:

```sh
pnpm -C apps/desktop exec vite build --mode evidence
node capture.mjs --repo <clean-checkout> --output <new-output-directory>
```

No application source, dependency, CI harness or full test run was changed or added. The saved one-off evidence script records unavailable targets, exceptions and unmounts instead of silently skipping them.

## Original report remains open

The original #584 report concerns **461 px**, Linux, `zotero-updated`, reported 200% text at `39cfacd`, with header overlap and tile/title width problems. Neither this 360 px tray-50 repeat nor the supplied raw nine-case bundle verifies that original case. Its exact header/tile report, dark-theme coverage and requested before/after repair acceptance remain **unverified**. This evidence supplements that report; it does not replace it or close the issue.
