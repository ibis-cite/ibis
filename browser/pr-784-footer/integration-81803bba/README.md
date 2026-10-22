# Footer integration — PR #784

Source `81803bba2a708b7ec2480666976bc6027c0d7252`, actual main `fc7a81217e30da9ebfc54d91219b6669db03d5e1`. This integrates #730 spacing/contrast, typed errors, preferences hooks, the X11 update and settings-read provenance. No unmerged #794 source was copied or stacked.

## Passed

- TypeScript, the evidence build, all **432 default UI tests**, and **237 focused App/platform/key-cap tests**.
- [108 browser cases](results.json): **72 action/layout** and **36 system-200%** cases. Three appearances, light/dark, widths360/480/720, normal/Larger text, fine/coarse media emulation. Reduced motion was emulated. Pointer activation used Playwright mouse input, including pointer-down → Search blur → pointer-up on the same Copy control. Copy produced the synthetic citation; Add/Remove worked; six wide normal-text fine-pointer cases verified the shortcuts dialog returns focus to its invoking footer button. This is not physical touch or native acceptance.
- Every visible target remained at least32 px (44 with coarse pointer), scaling with text. Targets did not overlap; hint content remained inside its button; footer/main had no horizontal overflow, allowing one pixel for integer scroll dimensions.
- Read-only `git merge-tree --write-tree --messages HEAD bad53073995de43896d836cd0adad6a644c3351c` exited0, result tree `f0253c69545a181a3a414f1bfd2002821035c248`. This checks prospective conflict resolution only; the branch still waits for #794 to reach main.

## Integration regression and repair

The first integrated source `56ed969a` retained both #730's outer library-bar padding and the action group's inner padding. The existing gallery geometry checks measured **48 px normal /55.2 Larger**, failing the specified **40/46** in all six appearance/text combinations. The narrow CSS repair removes only the duplicate inner block padding. All six footer assertions now pass: [before](geometry-before.txt), [after](geometry-after.txt). The existing report has12 other corner-token mismatches; those unrelated checks remain mismatches, so the whole geometry report is not claimed as passing.

Reproduce with the existing evidence gallery and `node scripts/gallery-geometry.mjs --no-build`. For the200% case, open `gallery.html?state=large-text&platform=linux&theme=light` at360×480, hold Alt, wait two animation frames, scroll the footer into view, and measure the Add button and its `.key-hint` content.

The [contact sheet](contact.png) shows12 newly captured Alt-mode frames: six720×480 at normal text and six360×480 at200%. PNG signatures/dimensions were checked and all12 frames were visually reviewed. Synthetic data only. Chromium151.0.7922.34 supplies these CSS appearances; native fonts, materials and OS focus are unverified. Earlier [before/after](../78b23364/README.md) evidence covers the original action slice and repaired Linux large-text overflow.

## Dependency/check status

The first empty offline restore failed `ERR_PNPM_NO_OFFLINE_TARBALL` for `https://registry.npmjs.org/@types/react-dom/-/react-dom-19.3.0.tgz`; no network retry was made. A private copy of the complete existing #794 installation was used. Package and lock hashes match exactly:

- package.json SHA256 `029f3db35d344462f428b730208af06ea7222315053cdb14758388f81ab63a70`
- pnpm-lock.yaml SHA256 `b96d1801e7c62efb22c2e9c36c7478d5cf044dc640d45f7cae46d4bd8cb4f2a7`

The subsequent `npm_config_offline=true pnpm install --frozen-lockfile` passed in319ms. No dependency or lock source changed. At publication the guarded full check and independent exact-head review remain pending; their eventual results belong in the PR evidence comment. Other #788 input-parity slices remain open.
