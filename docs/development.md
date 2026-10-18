# Development process

This project favours small, verified, reversible steps.

## Flow of work

1. **Issue.** Every change starts from an issue that states the user-visible outcome and acceptance criteria. Issues belong to a milestone (`0.1 Picker`, `0.2 Zotero and styles`, ...).
2. **Branch.** One short-lived branch per issue, named `<type>/<issue>-<short-description>`, e.g. `feat/12-zotero-snapshot-reader`.
3. **Test first.** Add a failing test or fixture that captures the acceptance criteria, then implement.
4. **Check.** `node scripts/check.mjs` must pass locally. It checks GitHub Actions expressions with actionlint before the Rust and desktop checks. Missing tools report incomplete (exit 2).
5. **Pull request.** Title in Conventional Commits form (`feat: read Zotero libraries while Zotero is closed`), linked to its issue (`Closes #12`). CI runs on Windows, macOS and Linux. The description says what users can now do, how it was verified, and what was not verified.
6. **Review.** One independent review of the final diff; P1 findings and regressions are fixed before merging, other findings become issues.
7. **Merge.** Squash-merge when checks pass. The pull request title becomes the commit on `main`. `main` is protected and always releasable; its history is never rewritten.

## Working quickly and safely

CI takes a few minutes per pull request. Most delay comes from waiting, so work is arranged to overlap:

- **Verify the exact commit.** Before pushing, run the full check in a clean checkout of the commit, so uncommitted files cannot make it pass. Reusing one build directory keeps it fast:

  ```sh
  root=$(git rev-parse --show-toplevel); sha=$(git rev-parse HEAD)
  dir="$(mktemp -d)/ibis-verify"   # a new, empty path: never someone else's work
  git worktree add --detach "$dir" "$sha" &&
    (cd "$dir" && CARGO_TARGET_DIR="$root/target/verify" node scripts/check.mjs) &&
    git push
  git worktree remove --force "$dir" 2>/dev/null; git worktree prune
  ```

- **Stack instead of waiting.** Start the next issue on a branch based on the previous one. After the previous pull request is squash-merged, move the branch onto `main` and confirm the content did not change:

  ```sh
  tree=$(git rev-parse next-branch^{tree})
  git fetch origin
  git rebase --onto origin/main previous-branch next-branch
  test "$(git rev-parse next-branch^{tree})" = "$tree" && echo unchanged
  ```

- **Review in parallel.** Run the one independent review of the final diff while CI runs, and save findings in the pull request (fixed, filed as an issue, or rejected with a reason).
- **Independent work in parallel.** Issues that touch different files can be worked on at the same time, each in its own worktree and branch. Two writers never share a checkout. Shared files (`Cargo.toml`, `Cargo.lock`, `apps/desktop/src-tauri/src/main.rs`, `ROADMAP.md`) are changed by one branch at a time.

## Progress reports

Each milestone has a tracking issue (label `tracking`) with a checklist of its issues, decisions taken, and open questions for the maintainer. After each merge, add one line saying what users can now do and what is next. Questions that need the maintainer carry the label `needs:maintainer`.

## Running the desktop app

```sh
cd apps/desktop
pnpm install
pnpm tauri dev
```

Choose a library from the picker or from the menu bar (tray) item. The choice and other preferences are saved in `settings.json` in the app's configuration folder (on macOS `~/Library/Application Support/io.github.ibis-cite.ibis/`):

```json
{ "schema_version": 1, "shortcut": "Control+Command+R", "library": "/path/to/refs.bib", "copy_format": "pandoc" }
```

Every field is optional. Edits made while the app runs are kept, and a file that cannot be read is reported and never overwritten. For development, `IBIS_LIBRARY=/path/to/file.bib` opens a library without saving it.

The picker opens without a title bar near the top of the usable screen. Drag the search bar edge or search icon to move it; the input remains editable. This uses Tauri's built-in drag region and grants only the window drag permission. Its system colours follow light/dark mode and high contrast; text and controls wrap at larger text sizes. Enter still copies and hides, Shift+Enter selects, and Escape hides. Copy confirmations expire after 2.4 seconds; copy warnings stay until dismissed. The footer keeps the library, compact output format, primary Copy action and Actions. Command+K on macOS or Control+K elsewhere opens the searchable Actions panel; arrows choose an available action and Enter runs it. Command+Enter on macOS or Control+Enter elsewhere toggles the active reference in the selection, including while Actions is filtered; Shift+Enter in search remains an alias. The first two actions show their keyboard equivalents. Escape closes Actions and restores search focus before a later Escape hides the picker. The panel contains copy, selection, library chooser/reload, output format and Quit commands; unavailable commands are disabled. Search and action shortcuts defer to IME composition. The native HTML modal dialog contains keyboard focus, with an explicit close button.

The interaction follows Raycast’s [command Action Panel](https://developers.raycast.com/api-reference/user-interface/action-panel) and [keyboard navigation](https://manual.raycast.com/keyboard-shortcuts): the first contextual action is primary, with a searchable panel for other operations. Citation copy remains Ibis’s primary action. Persistent multi-reference selection is an Ibis adaptation; details and per-reference locators remain in #6. Global activation settings are unchanged.

Visual evidence for #88 uses synthetic references: [browser light](images/picker-browser-light.png), [browser dark](images/picker-browser-dark.png), and [native macOS dark](images/picker-macos-dark.png). The browser checks also covered forced colours and 200% text at a 360-pixel viewport (one vertical scroller keeps controls reachable without horizontal overflow). Theme tokens retain system-colour fallbacks for older system webviews. The native screenshot is a macOS development build; Windows/Linux native screenshots and release-build blur checks remain to be recorded before #88 is complete.

Actions evidence for #103 also uses synthetic references: [browser dark](images/picker-actions-dark.png), [browser light](images/picker-actions-light.png), and [native macOS release](images/picker-actions-macos-dark.png). Real Chrome checks covered modal focus containment and inert background controls, Tab moving from Close to the filter, format execution, the contextual secondary shortcut while filtered, and Escape restoring search focus. At a 360 × 480 viewport with 200% text, the panel and filter remained reachable without horizontal overflow. The macOS release WebKit check covered Command+K, filtering and executing a format action, search focus restoration, Command+Enter selection, Escape closing only Actions, and choosing the synthetic library while keeping the picker open. Windows/Linux native behavior, VoiceOver/NVDA and real IME composition have not been manually verified; simulated composition events are covered by the interface tests.

The reference Details control opens a text-only preview beside the results (below them at narrow widths). It follows the active result; Escape closes details and restores the trigger before another Escape hides the picker. Selected references each have their own Page(s) field, keyed by source and native key across searches. Blank fields mean no locator; Roman pages, ranges and lists pass through the core renderer, which retains warnings when the chosen syntax cannot express them. Detail responses from an earlier record or library snapshot are discarded. URLs are displayed as text and never fetched.

Search requests up to 200 ranked results. At that cap, the picker asks for a narrower query instead of claiming an exact match total. TanStack Virtual measures wrapped rows and retains the active option in the DOM; ordinary layouts use the results scroller and narrow layouts use the document scroller. The search field and focusable multiselect results list have separate roles: Space types in search, and Space toggles the active reference when Results has focus. Home/End and arrows navigate Results; Enter still copies. Locator controls and Details remain outside listbox options.

## Desktop command contract

`apps/desktop/src/bindings.ts` is generated from Rust command signatures and
Serde-aware type definitions. `src-tauri/src/bindings.rs` registers the commands
once for both the runtime handler and Tauri Specta's exporter. After changing a
command or a wire type, regenerate with:

```sh
cargo test -p ibis-desktop bindings::tests::export_contract -- --ignored
```

The normal check script and desktop CI compare a fresh temporary export with the
checked-in file and fail if it is stale; checks never rewrite it. `api.ts` keeps
event adapters, UI labels and the search limit default. Its format-label map is
exhaustive over the generated Rust enum. The core's optional `type-export`
feature enables schema derives only, without Tauri or other GUI dependencies.

Tauri Specta is used because it derives wrappers as well as types, removing the
duplicate command contract without a handwritten schema or generator. Its Tauri
2 support is currently a prerelease, so Specta and Tauri Specta are pinned to
matching exact versions as upstream requires. All added dependencies pass the
existing licence and advisory policy.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, `ci:`, `chore:`. Breaking changes use `!` (`feat!:`) or a `BREAKING CHANGE:` footer. Commits are signed off (`git commit -s`).

## Versions and releases

- [Semantic Versioning](https://semver.org/). While the version is `0.x`, features and fixes raise the patch version (`0.1.3`), and completing a roadmap milestone raises the minor version (`0.2.0`), so version numbers match `ROADMAP.md`. A milestone release is requested by adding `Release-As: 0.N.0` to the body of a commit on `main`.
- [release-please](https://github.com/googleapis/release-please) keeps a release pull request open on GitHub. Merging it updates `CHANGELOG.md` and the version in `Cargo.toml`, creates the tag and the GitHub release. Versions are never edited by hand.
- Release builds are produced only by CI from a tag. Preview builds may be published as GitHub pre-releases.
- Data formats that users keep (settings, destination profiles, history) carry a schema version and a tested migration.

## Workflow linting

Install [actionlint](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/install.md) and make it available on `PATH`. Standard options include `brew install actionlint` on macOS, `go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` with Go installed, or the official release binaries for Linux, macOS and Windows. CI uses the official 1.7.12 Docker image pinned by digest in the required Dependency policy job; updates should review the release and refresh that pin together.

Run `actionlint -shellcheck= -pyflakes=` to validate every workflow's GitHub-specific contexts, expressions and action usage. The full check uses the same flags; optional shellcheck and pyflakes integrations are disabled so installed auxiliary tools do not change the result. Workflow checks read files without editing them.

## Dependencies

`Cargo.lock` is committed. The Rust toolchain is pinned in `rust-toolchain.toml`. Dependabot proposes grouped updates monthly; each is reviewed and merged only with passing checks. `cargo deny` enforces license compatibility and blocks known vulnerabilities.

## Definition of done

- Acceptance criteria are covered by automated tests (or, for platform behaviour that cannot be automated yet, a recorded manual check in the pull request).
- Documentation, `ROADMAP.md` and snapshots are updated.
- No private data in code, tests, logs or text.
