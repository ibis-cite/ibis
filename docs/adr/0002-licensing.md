# 0002. AGPL for the app, MIT/Apache for reusable data, DCO

Status: accepted (2026-10-17)

## Context
Ibis must remain free software, including any future hosted or web version, while welcoming contributors and letting other tools reuse its test data and schemas. citeproc-js is CPAL/AGPL dual-licensed; Zotero is AGPL; CSL styles are CC BY-SA 3.0.

## Decision
- Application code: AGPL-3.0-or-later. A hosted or web version must also share its source.
- `fixtures/`, `schemas/`, `profiles/` and a future plugin SDK: additionally MIT OR Apache-2.0.
- Contributions under the Developer Certificate of Origin (`git commit -s`). Never a CLA.
- CSL styles and locales are shipped as separate, unmodified data with attribution to citationstyles.org.
- `cargo deny` enforces AGPL-compatible dependency licenses in CI.

## Consequences
No one, including the maintainer, can relicense contributors' work as closed source. Some companies avoid AGPL contributions; accepted. Third-party plugins that run out of process are not derivative works; in-process plugins will need an explicit exception if introduced (separate ADR).
