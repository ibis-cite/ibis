# Testing strategy

Citation software fails at the edges: unusual names, damaged files, rare item types, other scripts, odd editors. Ibis relies on automated tests, rather than manual review, to find those edges before users do. Layers marked "planned" are tracked in the linked issues and not yet running; all others run in CI on every change.

## Layers

| Layer | What it catches | Where |
| --- | --- | --- |
| Unit tests | Logic errors in one module | `#[cfg(test)]` modules in each crate |
| Specification by example | Exact expected output for each citation syntax and source quirk | `crates/*/tests/*.rs` |
| Fixture corpus with snapshots | Any change in how real-world quirks are read | `fixtures/`, `crates/ibis-core/tests/snapshots/` |
| File watcher integration | Real platform notifications, interrupted writes, rename replacement, deletion, valid empty files, coalesced change bursts and symlink targets | `crates/ibis-core/tests/source_watch.rs` |
| Property tests | Panics, hangs and broken invariants on generated input | `proptest` in `crates/ibis-core/tests/` |
| Metamorphic tests | Different but equivalent inputs giving different results | `crates/ibis-core/tests/metamorphic.rs`; larger run in `.github/workflows/metamorphic.yml` |
| Subprocess tests | Process aborts that in-process guards cannot catch (stack overflow) | `crates/ibis-cli/tests/cli.rs` |
| Differential tests | Loss of meaning, measured against an independent implementation | `crates/ibis-cli/tests/fidelity.rs`; nightly `.github/workflows/differential.yml` |
| Fuzzing | Crashes and runaway work on arbitrary bytes | `fuzz/fuzz_targets/`, nightly `.github/workflows/fuzz.yml` |
| Open-data corpus | Real names, scripts and records synthetic data misses | `corpus/manifest.json`, `scripts/corpus.mjs`, `.github/workflows/corpus.yml` |
| Platform harness | Insertion, shortcuts and accessibility on each OS | planned for 0.3 |

## Rules

- **A bug fix starts with a failing test or fixture.** The smallest input that reproduces the problem is added to `fixtures/` or a test, so it can never return unnoticed.
- **Compare with an established implementation where one exists.** Pandoc for BibTeX reading and CSL rendering today; citeproc-js and the CSL test suite for formatting (0.2). Intentional differences are documented next to the normalization that hides them.
- **Never report success for a step that did not run.** `node scripts/check.mjs` exits with status 2 (incomplete) when a required tool is missing.
- **Bounded work on hostile input.** Any loop or recursion driven by input has a limit, and a test proves the limit holds.
- **Synthetic or openly licensed data only.** No personal libraries. Open-data files record their source and licence.

## Running tests

```sh
node scripts/check.mjs                         # everything CI runs on every change
cargo test -p ibis-core                        # fast core tests
IBIS_METAMORPHIC_CASES=2048 cargo test -p ibis-core --test metamorphic --locked
IBIS_REQUIRE_PANDOC=1 cargo test -p ibis --test fidelity   # differential tests (needs Pandoc)
cargo insta review                             # review changed snapshots
```

The metamorphic suite generates small synthetic libraries with multilingual
text, inherited metadata and field warnings. Each of seven transformations
runs 64 cases in normal CI and 2,048 nightly: entry order, field order,
whitespace/CRLF/indentation, equivalent value and entry delimiters, type/field
name case, macro expansion/concatenation, and comments. It compares complete
record identities and normalized fields, plus warning kind/key/message;
verbatim source text, record/warning order and warning line numbers are the
only differences ignored. The generators exclude duplicate keys, duplicate
fields and conflicting macro definitions because their first/last-definition
precedence is meaningful. Quoted values exclude quote/group syntax that would
make delimiters semantically different. Failed nightly runs preserve the
shrunk example and regression seeds as an artifact. Turn reader regressions
into explicit synthetic fixtures or tests before fixing them.

## Nightly fuzzing

Install `cargo-fuzz` with `cargo install --locked cargo-fuzz --version 0.13.1` and
nightly with `rustup toolchain install nightly --profile minimal`, then run:

```sh
cargo +nightly fuzz run load_str -- -max_total_time=60 -timeout=5 -rss_limit_mb=1024 -max_len=16384
```

Targets are `split_parse`, `load_str` and `csl_export`. The nightly workflow gives
each 300 seconds with a persistent corpus seeded from synthetic fixtures, and
minimizes and reports crashes, timeouts and OOMs as deduplicated `area:testing`
issues. Fixed inputs become fixtures with regression coverage. Fuzz targets share
the root lockfile and are outside default application/test members. Only
cargo-fuzz enables nightly instrumentation; the app toolchain stays pinned. See `fuzz/README.md` for
reproduction, reporting and resource limits.

## Nightly Pandoc differential comparison

The differential workflow follows the scheduled **Nightly fuzzing** run and can
also be dispatched on `main`. Run fuzzing first if its caches have never been
populated. It executes trusted current `main` only, restores existing generated
fuzz inputs, and reuses the pinned CC0 metadata cache and converter. It writes
no source libraries. Local execution never creates issues merely because a token
is present; reporting requires a trusted main-branch workflow event.

The explicitly ignored `export_differential_corpus` test reuses the actual
metamorphic generator: eight libraries, each in its original form and all seven
transformations, using ChaCha seed `[69; 32]`. Up to eight generated mutations
from each fuzz target are added; original `seed-` fixtures are excluded. Input
files are limited to 16 KiB, 64 entries and 128 files overall. Skipped sizes,
counts, invalid UTF-8 and empty/unrenderable inputs appear in the summary.
Each Pandoc process has a five-second/1 MiB output budget, each library a
20-second comparison budget, each reduction a 60-second budget, and the complete
comparison a ten-minute budget. Infrastructure failures fail the run and still
produce a summary; input rejection by one parser is preserved distinctly from mutually unrenderable input.

The engineering runner shares `tests/support/pandoc.rs` with the normal fidelity
test. It is the single normalization allowlist: it ignores blank lines and reconciles Pandoc's dotless
ı plus combining accent for `{\'\i}`; title case,
missing data and other rendering differences remain visible. Normalization has
an explicit regression test that keeps multilingual case differences distinct.

Reduction keeps the same native key, entry type, outcome and a subset of the
original differing field paths; it cannot migrate into an unrelated author or
parser failure. Comparable classes use the minimized category/entry type/outcome/changed field paths,
with array indices folded and prose/identities excluded. This is a structural
classification, not a claim that every occurrence has the same root cause.
Only supported renderings with no relevant Ibis warnings auto-file issues.
Known Pandoc parenthesis rejection, explicitly warned syntax/duplicate recovery,
and unknown-language fallback with case-only title differences retain named categories, counts and
original artifacts without auto-filing or failing the run. Unrecognized parser,
renderer or warning cases retain distinct review-required categories and fail
for review; warnings are never normalized away. An unrelated author mismatch
cannot be hidden by an unknown-language warning. These policies share the same
Rust helper as the rendering normalizer, with regression tests. Syntax/duplicate
warnings from sibling entries apply only when Pandoc rejects the entire library;
rendering differences keep warning context scoped to their own key. Title
content loss cannot be hidden by an unknown-language warning.
Open and closed issues are searched for stable markers before creating a report.
Previously reported comparable classes still fail and link the existing issue. Minimal
comparable inputs, original unsupported inputs, both renderings, category/class counts, source/tool versions and CC0 provenance
are uploaded for 30 days; reduction is bounded, not guaranteed globally minimal.

For a local run (Pandoc installed), use fresh temporary output directories:

```sh
IBIS_DIFFERENTIAL_GENERATED=/tmp/ibis-generated cargo test -p ibis-core --test metamorphic export_differential_corpus --locked -- --ignored
cargo build -p ibis --example pandoc_differential --locked
node scripts/differential.mjs target/debug/examples/pandoc_differential /tmp/ibis-differential /tmp/ibis-generated
```

Add the directory produced by `node scripts/corpus.mjs fetch DIRECTORY` and
existing `fuzz/corpus/{load_str,split_parse,csl_export}` directories as additional
arguments to exercise those sources. The regular full check runs synthetic
reporter tests and the existing fixture comparison, without corpus downloads.
