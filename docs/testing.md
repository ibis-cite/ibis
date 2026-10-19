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
| Differential tests | Loss of meaning, measured against an independent implementation | `crates/ibis-cli/tests/fidelity.rs` (Pandoc); planned nightly on larger corpora (#69) |
| Fuzzing | Crashes and runaway work on arbitrary bytes | `fuzz/fuzz_targets/`, nightly `.github/workflows/fuzz.yml` |
| Open-data corpus | Real names, scripts and records synthetic data misses | `corpus/`, weekly/manual `.github/workflows/corpus.yml`; offline checks on every change |
| Native picker smoke | Real shortcuts, accessibility, clipboard, focus, reloads and 100k measurements | `scripts/smoke-native.py`, platform adapters; requires an interactive runner |

## Rules

- **A bug fix starts with a failing test or fixture.** The smallest input that reproduces the problem is added to `fixtures/` or a test, so it can never return unnoticed.
- **Compare with an established implementation where one exists.** Pandoc for BibTeX reading and CSL rendering today; citeproc-js and the CSL test suite for formatting (0.2). Intentional differences are documented next to the normalization that hides them.
- **Never report success for a step that did not run.** `node scripts/check.mjs` exits with status 2 (incomplete) when a required tool is missing.
- **Bounded work on hostile input.** Any loop or recursion driven by input has a limit, and a test proves the limit holds.
- **Synthetic or openly licensed data only.** No personal libraries. Open-data files record their source and licence.

## Running tests

```sh
node scripts/check.mjs                         # formatting, lints, tests and dependency policy
cargo test -p ibis-core                        # fast core tests
cargo test -p ibis-core --release --locked     # core regressions with release arithmetic
cargo test -p ibis-desktop                     # desktop app tests (not part of plain cargo test)
IBIS_METAMORPHIC_CASES=2048 cargo test -p ibis-core --test metamorphic --locked
IBIS_REQUIRE_PANDOC=1 cargo test -p ibis --test fidelity   # differential tests (needs Pandoc)
cargo insta review                             # review changed snapshots
```

For an optional current-core scale measurement, run
`cargo test -p ibis-core --release --locked --lib owned_index_100000_reference_measurement -- --ignored --nocapture`.
The ignored test builds 100,000 synthetic multilingual records and checks common,
late-key and absent matches at the desktop's 20-result request and 200-result
backend bound. It checks full identities across sources and prints timings with
no machine-dependent threshold. A Linux x86_64 run with Rust 1.99.1 measured
200 ms to index, 31–37 ms mean common searches and 6–9 ms late-key/absent searches
(ten samples each). This measures core indexing/search only: parsing, native IPC,
serialization and rendering are separate; it is not an end-to-end picker claim.

CI tests the core and CLI with the declared Rust 1.90 minimum on Linux. The web interface is checked
and built once on Linux; all three native desktop builds embed that same artifact.

CI also runs the complete core suite in release mode on Linux, covering malformed
dates, private parser-panic containment and the property tests with release arithmetic.

The full check runs the default workspace's `cargo test --locked`, including the
CLI's Pandoc fidelity tests when `pandoc --version` succeeds. Without Pandoc those
comparisons skip; set `IBIS_REQUIRE_PANDOC=1` to require them. Missing optional
Pandoc does not cause the check script's incomplete (exit 2) result. To enforce
fidelity in PowerShell:

```powershell
$env:IBIS_REQUIRE_PANDOC = '1'
node scripts/check.mjs
```

The metamorphic suite generates small synthetic libraries with multilingual
text, inherited metadata and field warnings. Each of seven transformations
runs 64 cases in normal CI and 2,048 weekly (Monday): entry order, field order,
whitespace/CRLF/indentation, equivalent value and entry delimiters, type/field
name case, macro expansion/concatenation, and comments. It compares complete
record identities and normalized fields, plus warning kind/key/message;
verbatim source text, record/warning order and warning line numbers are the
only differences ignored. The generators exclude duplicate keys, duplicate
fields and conflicting macro definitions because their first/last-definition
precedence is meaningful. Quoted values exclude quote/group syntax that would
make delimiters semantically different. Failed weekly runs preserve the
shrunk example and regression seeds as an artifact. Turn reader regressions
into explicit synthetic fixtures or tests before fixing them.

The existing Vitest interface suite runs axe-core structural checks for first-run
and loaded-library states, with a deliberately broken combobox proving violations
are detected. JSDOM has no rendered layout/canvas, so color contrast is excluded
from axe; theme contrast has a numeric test. These checks do not establish text
reflow, native focus behavior or VoiceOver/NVDA acceptance (#8/#79).

## Native picker smoke

`scripts/smoke-native.py` launches the embedded native executable and reads the
OS accessibility tree. It does not use a browser, development server, injected
JavaScript or a test-only IPC command. Build with `--features tauri/custom-protocol`
first. Run only in a disposable desktop session: the suite owns the clipboard,
types synthetic text, opens a temporary editor and sends global shortcuts.
Windows opens Notepad, macOS opens TextEdit, and Linux opens an xterm running
`cat` as a synthetic text destination. The test verifies the copy-then-paste
contract by checking the OS clipboard and that the destination receives focus.
It does not inject a citation into the editor.

```sh
# Ubuntu/Debian runner dependencies (test tools, not app dependencies):
sudo apt-get install xvfb xauth xdotool xclip xterm openbox python3-pyatspi
xvfb-run -a -s '-screen 0 1280x800x24' dbus-run-session -- \
  /usr/bin/python3 scripts/smoke-native.py \
  --app target/debug/ibis-desktop --output screenshots/smoke-Linux

# macOS, in the logged-in runner session:
python3 scripts/smoke-native.py --app target/debug/ibis-desktop \
  --output screenshots/smoke-macOS

# Windows, in the logged-in runner session (PowerShell):
python scripts/smoke-native.py --app target/debug/ibis-desktop.exe \
  --output screenshots/smoke-Windows
```

Windows reads UI Automation through PowerShell and sends keyboard events with
`SendInput`; macOS reads accessibility through `osascript`/System Events and
posts global CoreGraphics HID keyboard events; Linux uses AT-SPI and xdotool
inside Xvfb with Openbox. Windows retains the native picker HWND first identified
by its editable search control; another same-process tray window cannot satisfy
the visibility assertion. Linux waits for both the editor's active-window and
actual X11 input-focus ownership before sending a shortcut. macOS first checks `AXIsProcessTrusted`, System Events
accessibility, Automation access and `CGPreflightPostEventAccess`. No event-posting
permission request is made. A missing TCC grant is **unavailable**,
never a pass; the test does not modify the TCC database or bypass consent.
macOS refuses any existing TextEdit process and opens an owned empty text file
through Launch Services, without sending Apple Events to TextEdit. Cleanup
requires the same PID, bundle identity and owned AXDocument before termination.
The macOS default shortcut is Control+Command+R; use
`--shortcut super+shift+space` when testing older builds. macOS must use a fresh
CI account without saved Ibis preferences. Windows reads its real native roaming
configuration folder through `GetFolderPath(ApplicationData)`; changing `APPDATA`
does not redirect Rust's known-folder lookup. Both platforms refuse existing
settings, backup and temporary preference files, then remove only files their run
can create. Copying can save the format even when `IBIS_LIBRARY` is set. Linux
uses a temporary `XDG_CONFIG_HOME`. Each test library has a synthetic path containing spaces and non-Latin
characters and is deleted on exit. Existing libraries are never opened or edited.

The suite asserts a loaded native window; accessibility names and roles for the
search field and result list, plus a named result-count status; shortcut activation
into the foreground with search focus; a second launch exiting successfully and
activating the original picker with focused search; native typed search; the exact Pandoc
citation on the OS clipboard after Enter, starting from a distinct synthetic
clipboard sentinel so an earlier run cannot satisfy the check; hidden picker and restored editor focus;
preservation of a valid external settings-field edit across the native copy-format
save, with all owned settings/backup bytes restored before later scenarios;
replacement of the previous query on reopening; a watched library edit; a missing
file error; an empty library count; recovery through Reload; damaged-library startup
with valid-record recovery; and invalid/newer settings messages and preservation.
On reopening, AT-SPI may expose the active result option as focused through
`aria-activedescendant`. The test proves search focus and selection by typing
the replacement query without selecting text, checking the exact accessible
search value and expected result. Initial empty-query activation still requires
the named search control to expose focus.
It records each
completed assertion in `smoke.json` and preserves startup logs. Failed runs record
visibility, foreground, search-focus booleans and focused control roles, without
accessible text. Scripted helpers identify their fixed action when they time out;
Windows timeouts retain only allowlisted initialization-stage lines from stderr.
macOS records fixed editor-visibility and foreground-ownership booleans from
System Events, NSWorkspace and NSRunningApplication before activation and after
copy/hide, without recording process IDs, bundle identifiers or document text.
An unexplained timeout is a failure, not evidence of denied permissions. Exit 1 means an
assertion failed, and exit 2 means a required capability was unavailable. A failed
run can contain earlier passed assertions; its overall status still fails.
Do not infer acceptance from merely installing tools or inspecting this code.
`python3 scripts/smoke-native.py --self-test` checks harness contracts; it does
not exercise the native app.

Independent `check-offline` probes in desktop CI establish the network check;
the smoke suite does not duplicate their polling or claim that a UI pass establishes
offline behavior. Screenshot capture likewise remains separate from assertions.

On Linux/macOS, capture the process baseline **before** starting Ibis with
`python3 scripts/check-offline.py --record-baseline screenshots/process-baseline.json`,
then run `python3 scripts/check-offline.py --pid PID --baseline screenshots/process-baseline.json --seconds 60`.
Linux samples numeric TCP/UDP endpoints with `ss` and first checks read access to
the selected processes' `/proc/PID/fd` directories. macOS uses `lsof` on the app
tree plus WebKit networking helpers that appeared after the baseline. Existing
helpers from other apps are excluded. A new reparented XPC helper's ownership is
not proven; any traffic is reported as a failed **session** observation rather
than attributed to Ibis. Use a quiet disposable runner. Permission diagnostics,
missing tools and malformed output fail the check. IPv4/IPv6 loopback and
unspecified binding addresses are allowed; link-local and private network
addresses are external. Sampling cannot prove absence of connections shorter
than the polling interval, and ownerless closed/TIME-WAIT sockets cannot be
attributed to an app. The check makes no packet-capture claim.

### Performance evidence and budgets (#9)

After the behavior checks, the suite creates 100,000 synthetic references and
restarts the app. `smoke.json` records milliseconds from process launch until the
accessible library count reaches 100,000, milliseconds from native query input
until the late key `smoke099999` appears in the native accessibility tree, and
current summed process-tree RSS (Windows: working set) after that result. These
observations include automation overhead and polling. Shared pages may be counted
more than once. WebKit helpers reparented outside the app process tree are not
included; memory is not a peak measurement. Record runner image and architecture
with any baseline. Each run records three fresh app processes against the 100k
fixture, retaining all samples and using each metric's maximum for enforcement.
Operating-system file caches persist between samples; these are not cold-disk
measurements or lifetime peak-memory measurements.

Initial hosted **debug** qualification ceilings are recorded with their evidence
in [smoke-budgets.json](../scripts/smoke-budgets.json). Desktop CI passes
`--budgets scripts/smoke-budgets.json`; every metric must pass for every sample.
The summary uses per-metric maxima, so a faster sample cannot hide a slower one.
A run without `--budgets` explicitly records `measured-without-budget`.

| Hosted runner cell | Observed maximum startup / first result / current tree memory | Initial ceilings |
| --- | --- | --- |
| Ubuntu 24.04 x86_64, Xvfb/Openbox | 21,280.26 ms / 1,945.87 ms / 818.20 MiB | 32,000 ms / 3,000 ms / 1,280 MiB |
| Windows Server 2025 x86_64 | 25,438 ms / 8,657 ms / 482.96 MiB | 40,000 ms / 13,000 ms / 768 MiB |
| macOS 15 arm64 | 20,323.48 ms / 7,871.04 ms / 351.25 MiB | 32,000 ms / 12,000 ms / 576 MiB |

Each ceiling rounds up at least 1.5 times the observed hosted maximum: startup
to two seconds, first result to one second and current tree memory to 64 MiB.
This allows runner variation while rejecting a substantial regression. Three fresh app
processes were observed on each OS; Linux also has repeated successful runs.
[macOS at 8d64d85](https://github.com/ibiscite/ibis/actions/runs/39177722811/job/117823838538)
and [Windows at 8d64d85](https://github.com/ibiscite/ibis/actions/runs/39177722811/job/117823838584)
passed all 13 interaction checks. Earlier Windows evidence comes from the separate
macOS-panel stack based on `bacb54d`; its Windows app and native harness are
unchanged from that baseline. The JSON records the exact runner images and links jobs.
The final source of #217, `9f3a58116fc1013c6be1aa0efc913ff1e7f630a2`,
passed [all three enforced native runs](https://github.com/ibiscite/ibis/actions/runs/39179422161):
thirteen behavior checks and three budgeted samples per OS. Later changes keep
these gates enabled and need their own final integration result; see
[preview validation](preview-validation.md). These ceilings include UIA/accessibility/native-control probing and
input overhead; they do not describe app search latency alone. They qualify
those debug runner cells only. Release packages, other images/architectures,
peak memory and local container/proot observations need separate evidence.

The first enforced Linux run at `8b4f4da` failed its original 20-second startup
ceiling: all three samples were 20,359–21,280 ms, compared with earlier 10,665–13,302 ms.
All 13 interaction checks passed. The apps tree and native harness were identical
to the preceding `8d64d85`; both jobs used Ubuntu 24.04.5 image 20261012.334.1,
the same Rust toolchain and an unoptimized debug build. Runner regions differed,
but no CPU model/core count or load facts were recorded, so a hardware or region
cause is unproven. The initial calibration now includes that observed range:
the same 1.5-times rounding policy yields 32 seconds. This changes the initial
qualification baseline; it is not a runtime optimization or a diagnosed app fix.
An exceeded budget records `performance.status: failed`, the metric and numeric
ceilings, retaining and printing all three samples instead of calling the
attempted gate `measured-without-budget`.

### Native library choice and shutdown

`scripts/check-native-chooser.py` reuses the native smoke adapters in a fresh,
owned desktop session. It starts without `IBIS_LIBRARY` and uses the real file
dialog to cancel, choose a synthetic Unicode path, recover from an unreadable
choice, quit normally and reopen the remembered library. A rename-away check
requires the old filename's missing-file message, searchable retained references
and byte-identical saved preferences. Recovery must load different content and
find a new reference before restoring the original synthetic library.
It also opens an
exactly 64 MiB, 100,000-reference fixture and proves the late record is searchable.
The shutdown scenario requires an observed native Reloading state before Quit;
a settled load or cleanup termination cannot satisfy it. Normal Quit must exit
zero within ten seconds, including the native click, and relaunch must preserve
the saved path and accept a new query.

Use the same disposable-session precautions and Linux Xvfb/D-Bus wrapper as
the smoke suite, passing `--app PATH --output DIRECTORY`. `--self-test` exercises
checker contracts without running the app. `chooser.json` records the executable
SHA256 and each completed assertion. Failed helpers retain only fixed stages,
bounded counts and ownership booleans; no provider error payloads are printed.
Native Windows and macOS acceptance must come from the final hosted reports,
not helper self-tests or another platform's results; see [preview validation](preview-validation.md).

### Remaining hand checks (after all three cloud runs pass)

Once stable packages are ready, use the matching OS artifact from the exact
workflow run linked in [#80](https://github.com/ibiscite/ibis/issues/80), with
[`fixtures/bibtex/real-world.bib`](../fixtures/bibtex/real-world.bib) from that same
source SHA. It contains synthetic records only. For the speech and paste checks,
search `who` to find `who2020`, titled "Synthetic Report on Global Sleep".
The final handoff will
add that run link; no hand testing is requested before then. These lists cover
automation gaps before any tag or publishing authorization. Linux preview
acceptance relies on automation; its optional future checklist is not a
maintainer handoff requirement. Record the package source SHA, OS version and
screen-reader version with the hand-test results in #80.

#### Windows

1. Install the matching Windows build from the linked run. Check the unsigned-app
   prompt and first launch; install Microsoft's WebView2 Runtime first if needed.
2. With NVDA, hear the search label, changed result count and active result.
   Add and remove a selection; hear both changes announced.
3. Check readability and responsiveness at your normal scaling and 200% text,
   with every control reachable and no clipping, in light and dark mode. Also
   try Windows contrast themes (forced colours) and transparency settings.
4. Use your usual keyboard layout and input method. Check the shortcut label,
   compose text if you use an IME, and search without losing entered characters.
5. Paste a copied citation into your actual writing app.
6. Sleep and wake, then search and copy again.
7. If you use several displays, disconnect and reconnect one. Open the picker on
   the remaining screen; move it between different display scales and check readability.
8. If you already use a cloud folder or network drive, put only the synthetic
   library there. Edit it and check recovery after syncing or a brief disconnect.

#### macOS

1. Install the matching Mac build from the linked run. Check the unsigned-app
   prompt and first launch. After verifying the download, use
   [Apple's opening instructions](https://support.apple.com/en-us/102445) if needed:
   try opening Ibis, then System Settings → Privacy & Security → Open Anyway.
2. Check the permission prompts and recovery. Reopen Ibis with its shortcut or
   menu-bar item; the accessory app has no Dock icon.
3. With VoiceOver, hear the search label, changed result count and active result.
   Add and remove a selection; hear both changes announced.
4. From your full-screen writing app, open the picker, copy and paste. Check
   that returning to your document feels natural.
5. Check readability and responsiveness at normal scaling and 200% text, in
   light and dark mode, with every control reachable and no clipping. Also try
   Reduce Transparency and Increase Contrast.
6. Use your usual keyboard layout and input method. Check the shortcut label
   and compose text if you use an IME; the known label limitation is #196.
7. Sleep and wake, then search and copy again.
8. If you use several displays, disconnect and reconnect one. Open the picker
   on the remaining screen and check readability across different display scales.
9. If you already use iCloud or a network drive, put only the synthetic library
   there and check recovery after syncing or a brief disconnect.

#### Linux (optional future coverage)

1. With Orca in your desktop session, hear the search label, changed result count and selected result.
2. In your Wayland desktop, check shortcut/copy behavior and any permission explanation.
3. Check readability at normal scaling and 200% text, in light and dark mode.
   Try your usual keyboard layout and input method.
4. Paste into your writing app.
5. Suspend and resume, then search and copy again.
6. If you use several displays, disconnect and reconnect one and open the
   picker on the remaining screen.
7. If you already use a synced folder or network drive, put only the synthetic
   library there and check recovery after syncing or disconnecting.

These lists are used only after the native chooser, exact-size load and Quit
during reload gates pass on the final packages; those checks stay automated.
Hosted UI automation does not establish real screen-reader speech, interaction
with your own full-screen writing app, mixed-DPI/multiple-monitor behavior,
non-US layouts/IMEs, sleep/wake, display unplugging, cloud/network-drive synchronization, or subjective feel.
Deterministic parser/watcher tests cover underlying data cases; they do not prove
these desktop-session scenarios.

## Picker screenshots

Every CI run builds and launches the real debug app on Windows 2025, macOS 15
and Ubuntu 24.04, including pull requests that change `apps/desktop/`. To capture
another commit, choose **Actions → CI → Run workflow** and select its branch.
No development server or app startup switch is needed: the build embeds the web
interface with `--features tauri/custom-protocol`, and debug windows stay visible
when they lose focus.

Open the run's **Artifacts** and download
`picker-combined-<commit SHA>-attempt-<number>`. The SHA identifies
the checked-out source (the merge commit for a pull request). A complete artifact contains
`picker-Windows.png`, `picker-macOS.png`, `picker-Linux.png` and startup logs, kept
for 14 days. The available platform shards are combined after the desktop jobs finish;
failed jobs or a single-platform retry can leave a partial artifact. Earlier
attempts remain available separately; a later attempt does not certify an OS
whose report it does not contain. A process that exits during the startup
wait fails its job; capture errors produce warnings. Check that all three PNGs
exist and actually show the picker before claiming cross-platform evidence.

The app opens the synthetic `fixtures/bibtex/real-world.bib` through an absolute
`IBIS_LIBRARY` path, without saving a library preference. Screenshots show the
initial empty-query view after the 60-second startup socket observation: review layout, font rendering,
scaling, library status and window edges by eye. There is no pixel comparison or
automated visual verdict. Linux uses a 1280×800 Xvfb display without a desktop
window manager; its theme and shadows may differ from a user's desktop. These
images do not establish result-list behavior, typing, focus, shortcuts, clipboard
integration or screen-reader accessibility; those still need separate checks.

## macOS launcher regression (#198)

The macOS picker uses a non-activating NSPanel so it can appear over an editor's
full-screen Space. The macOS-only `tauri-nspanel` adapter converts the existing
window through safe main-thread APIs; Ibis retains `forbid(unsafe_code)`. The
adapter requires Tauri's macOS private-API feature. `Accessory` activation policy
removes the Dock icon; the shortcut and menu-bar item reopen the picker.

Conversion and activation-policy setup happen while the window is hidden.
Initial presentation waits for both panel setup and the first completed page
load, regardless of which finishes first. It consumes the original visibility/focus intent
once; explicit show or dismissal cancels queued initial presentation. A hidden
startup window is not shown as a side effect. Summoning then makes the panel key
and focuses the actual WKWebView through Tauri's Webview API without activating
the application. Focusing the outer content view alone did not route real typing.

Run the focused scenario in the same disposable, permission-granted macOS
session used by the ordinary smoke suite:

```sh
python3 scripts/check-panel-macos.py --self-test
python3 scripts/check-panel-macos.py --app target/debug/ibis-desktop \
  --output screenshots/panel-macOS
```

The five native checks verify an actual AXFullScreen editor plus on-screen
geometry; shortcut summon without leaving that Space; search and an independently
primed clipboard; Enter/Escape dismissal and editor focus return; and an ordinary
desktop library chooser that receives focus without hiding the picker. Cancel
must return keyboard access to the picker and then to the editor. An unavailable
full-screen attribute is unknown, never proof that the editor left full screen.
This scenario cancels the chooser; the separate chooser suite selects files.

The driver uses global CoreGraphics HID events because a non-activating panel
can own keyboard focus while the editor application stays frontmost. It checks
`CGPreflightPostEventAccess` without requesting permission, retains Unicode
storage through event posting, and attempts every physical key release after
failure. Debug AppKit key-window/responder booleans are diagnostics; actual
query, clipboard and focus assertions establish input. Damaged-library startup
must also accept a fresh typed query.

The final run and exact source are recorded in [#80](https://github.com/ibiscite/ibis/issues/80).
Contract self-tests and Linux compilation do not establish AppKit behavior.
The matching release executable repeats all five checks because release builds
hide on blur. Stage Manager, real writing-app feel, IME composition, speech and
physical display behavior remain in the final hand-check scope.

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
