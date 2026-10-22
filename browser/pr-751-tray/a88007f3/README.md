# Current-main tray integration measurements

Synthetic Chromium browser checks, not native captures.

- Source: PR #751 `a88007f33284697f7bfc838a33ea7a30de8eac58`.
- Integrated main: `30ea730b1fcdb35779049fe22748583f4e7af1ec`.
- The only integration conflict was in platform tests; tray, wrapped-footer and active-row contrast assertions are all retained.
- App, Menu and ToolbarMenu match current main. Only the original nine tray/geometry/docs files differ.

`geometry.txt` records all 84 layout assertions passing. The full report remains
144/156 because the same 12 known corner-radius mismatches (#576) remain;
this is not an overall geometry pass.

`adversarial.json` records 72 passing profiles: three looks × light/dark ×
normal/Larger/system 200% text × 360/720 widths × LTR/RTL. Each checks whole
chip rows, horizontal containment, complete tooltip/removal names, last-chip
focus visibility, keyboard removal with Search return, and fade removal in
focus, increased contrast and forced colours. A temporary Playwright probe
used the existing built gallery; no repository harness or dependency was added.

The earlier [labelled before/after frames](https://github.com/ibiscite/ibis/tree/3c17123bc8d75e1d2bdc011a414d7f3c70be197c/browser/pr-751-tray/fcec761a)
remain evidence for their recorded source commits. No old frames are relabelled
as this integration. Preview typography and #752 follow-ups remain separate.

TypeScript, 36 focused tray/platform tests and six geometry-script tests passed.
Fresh exact-head full verification and independent review are recorded in the
PR separately. Browser results do not certify native materials, screen-reader
speech or OS input methods.
