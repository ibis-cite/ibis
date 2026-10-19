# Preview validation

**[Issue #80](https://github.com/ibiscite/ibis/issues/80) is the readiness record:**
it identifies the final source, workflow runs, verified downloads and any pending
checks. Use only a candidate marked ready there. The evidence below applies to
the stated commits and runs; earlier results do not certify a later combined
build. No human acceptance or release authorization is inferred from automation.

## Verified automation

- **Windows network regression (#201):** [without the fix](https://github.com/ibiscite/ibis/actions/runs/39167308725),
  commit `a4303f0e4401da53b92dc1a99f7875b7eff5a7d1`, the checker failed on
  an Ibis-owned WebView2 HTTPS connection. [With the fix](https://github.com/ibiscite/ibis/actions/runs/39168279608),
  commit `2b4e98249695559102196a1d46953b1ec3638fc1`, it checked seven owned
  processes and reported no connections in 60 seconds. This establishes the
  observed regression and its sampled check, not a packet-level network audit.
  The [comparison record](https://github.com/ibiscite/ibis/issues/201#issuecomment-6255505132)
  contains both results. The one-time Windows WebView2 prerequisite download is
  separate from runtime behavior; see [PRIVACY.md](../PRIVACY.md).
- **Exact 64 MiB boundary (#230):** the [synthetic core test](../crates/ibis-core/tests/source_size_boundary.rs)
  uses a CJK filename with a space. Initial load and strict reload retain records
  at both ends of an exactly 64 MiB file without warnings; one extra byte returns
  the size error. [Hosted checks](https://github.com/ibiscite/ibis/actions/runs/39171919839)
  passed on Windows, macOS and Linux. This does not measure native window
  responsiveness or memory at that size.
- **Native smoke and measured budgets (#217):** source
  `9f3a58116fc1013c6be1aa0efc913ff1e7f630a2` passed
  [CI](https://github.com/ibiscite/ibis/actions/runs/39179422161), including
  all 13 native interaction checks and three fresh 100,000-reference samples
  on each OS. Every sample passed the committed startup, first-result and
  current process-tree memory limits. The separate 60-second offline probes
  also passed. The [review and measurements](https://github.com/ibiscite/ibis/pull/217#issuecomment-6256989746)
  retain the earlier failed Linux startup calibration and explain its revised
  limit. These are debug hosted-runner observations, including native-control
  overhead; they do not establish release performance or peak memory.
  This suite is merged and remains a gate for the final combined candidate.
- **Linux chooser and lifecycle (#239/#238):** source
  `9d7ac18a85082b6e8347ffb3b13d74e783b2b424` passed all ten native checks
  on Ubuntu 24.04/Xvfb in [run 402](https://github.com/ibiscite/ibis/actions/runs/39188650943).
  These include rename-away retention with unchanged preferences, recovery to
  different content and distinct queries, an exactly 64 MiB/100k native load,
  and ordinary Quit during an observed reload followed by a valid relaunch.
  This records the Linux job only: Windows and macOS chooser acceptance and
  final combined package verification remain pending.
- **Truthful initial errors (#241):** core errors no longer tell CLI users that
  references were retained before anything loaded. Desktop recovery retains
  that wording only when a prior snapshot actually exists. Exact source
  `a97b69b62e4206393405f83ae900ec1ab4c1e21a` passed
  [hosted checks](https://github.com/ibiscite/ibis/actions/runs/39179749761)
  and an [independent regression review](https://github.com/ibiscite/ibis/pull/241#issuecomment-6256946637).
- **Native materials and live accessibility changes (#232):** merged source
  `aadec973293b4942b81c1bbd326c2dba877397c1` passed
  [all three native suites and five macOS observation phases](https://github.com/ibiscite/ibis/actions/runs/39181173648):
  visible vibrancy, opaque Reduce Transparency, restored vibrancy, opaque
  Increase Contrast and restored vibrancy. Both original preferences were
  read back and restored. The [final JSON and image inspection](https://github.com/ibiscite/ibis/pull/232#issuecomment-6257289917)
  records all five images, every restored preference and verified cleanup.
  Windows Server 2025 and Linux used their opaque fallbacks. This does not
  establish Windows 11 Mica or macOS outer corners.
- **Native outer corners (#236/#248):** source
  `8633f5d66a9e8385bad52c9a8ac6b323435cf475` passed
  [CI 414](https://github.com/ibiscite/ibis/actions/runs/39192097334), including
  all three ordinary native suites and budgeted samples, plus five Mac panel
  checks. The [ten-image inspection](https://github.com/ibiscite/ibis/pull/248#issuecomment-6258866004)
  verifies rounded material/opaque clipping, visible native shadow and intact
  controls at 720×480 and 840×560 in all five appearance phases. Every size and
  original accessibility preference was restored. The 12-point radius is a
  provisional native foundation; it does not implement the future redesign.
- **Full-screen panel and initial focus (#214):** source
  `ba878fe82cf5cade58293c246008d5c725af428a` passed
  [CI 415](https://github.com/ibiscite/ibis/actions/runs/39192986919): all thirteen
  ordinary checks and three budgeted samples on each OS, five macOS panel checks
  and five appearance phases with verified preference restoration. The
  [final evidence](https://github.com/ibiscite/ibis/pull/214#issuecomment-6258941199)
  also records all fourteen Windows gallery states and strict owned-profile
  cleanup. This source is merged; it repairs initial keyboard focus and return
  to the preceding editor. The final combined app still needs the chooser and
  package gates below.
- **Earlier gallery evidence (#221):** all 14 states were captured on macOS
  and Linux at `822a06274f0d22c1ce1ab57be2a91f734b591a43`. The
  [Linux font follow-up](https://github.com/ibiscite/ibis/pull/221#issuecomment-6256219230)
  records the corrected visible multilingual fixtures. These earlier images
  do not replace final Windows captures or inspection of the combined app.
- **Windows gallery evidence (#221):** all 14 states were captured and inspected
  at capture `79f8ae652db603ba9a1edf4ff23fa8eca6566296`.
  The [inspection record](https://github.com/ibiscite/ibis/pull/221#issuecomment-6256269588)
  covers state-specific content, multilingual text, dark and contrast fixtures.
  The gallery implementation is merged; final combined captures remain required.
  The evidence branch retains fifty commits, so historical capture folders may
  be pruned; retain the inspection records and link fresh final-candidate images
  at handoff.

## Final verification gates

Record the final source SHA, successful run and evidence location for each gate
in #80 before marking a candidate ready. Earlier passing builds,
probe self-tests and screenshots alone do not satisfy these gates.
Each package target also retains a small `package-proof-<target>` artifact with
its checksums, source SHA and signed provenance bundle. The build verifies every
package's checksum and provenance against its source commit and workflow before
retaining either artifact. This permits inspection
of the verification record when the package archive is too large to transfer;
it does not mean the archive's bytes were independently downloaded and checked.

| Gate | Required evidence |
| --- | --- |
| [Native smoke #217](https://github.com/ibiscite/ibis/pull/217) | Actual assertions on all three OSes: shortcut/focus, search, copy/dismiss/return, reload/errors, accessibility tree, and measured 100,000-reference performance against the recorded budgets. Separate startup offline probes must also pass; the UI assertions do not perform that sampling. |
| [Native chooser and Quit #238](https://github.com/ibiscite/ibis/issues/238) | All ten native checks on each OS: first-run cancellation, Unicode selection, unreadable-file retention, rename-away recovery with unchanged preferences and distinct restored content, exact 64 MiB/100k loading, observed pending-reload Quit, remembered-library relaunch and a fresh shortcut/query. Earlier nine-check Linux passes do not establish the added rename check. |
| [Gallery #221](https://github.com/ibiscite/ibis/pull/221) | All 14 states on each OS from the final combined candidate, with image inspection and multilingual font coverage. |
| [macOS panel #214](https://github.com/ibiscite/ibis/pull/214) | Actual full-screen Space and chooser/focus interaction, or an explicit documented preview limitation if the known fix cannot be established. |
| [Native materials #232](https://github.com/ibiscite/ibis/pull/232) | Repeat the merged material/accessibility acceptance on the final combined candidate, including verified restoration and preserved window/focus behavior. Earlier five-phase native acceptance is linked above. |
| [macOS outer corners #236](https://github.com/ibiscite/ibis/issues/236) | Actual content clipping and outer silhouette at normal and verified resized dimensions in all five material/accessibility phases, with preserved native input and the OS preference's shadow behavior. Rounding an effect view or compiling safe layer calls does not establish this. |
| [Final packages #228](https://github.com/ibiscite/ibis/pull/228) | Matching Windows, macOS Intel/Apple silicon and Linux artifacts, source SHA, checksums and provenance from the final non-publishing run. Native smoke must also pass against the release executable where its target matches the runner architecture. Cross-target builds establish packaging only. |

## Automation and hand checks

Hosted runners cover their recorded OS images and sessions. They do not establish
Windows 10 or ARM Windows, macOS 13 or every Mac architecture's native behavior,
Fedora/Wayland, mixed-DPI displays, non-English shortcuts/IMEs, screen-reader
speech, sleep/wake, display unplugging, synced folders or network-drive recovery.
Core file tests do not establish those desktop sessions. Package compilation for
an architecture does not establish installed interaction there.

The planned package check runs the existing native smoke and chooser/Quit suites
against the release executable, using the macOS app bundle where available.
On Ubuntu 22.04 it installs the built Debian package in a network namespace with
no external interface, then runs its installed executable in fresh network
namespaces as the ordinary runner user. Native build
prerequisites are already present; this does not establish installation on a
bare system or installation of the AppImage and RPM packages.
The matching macOS build also runs the full-screen panel checks: release builds
hide on blur, so debug-only panel results cannot establish that interaction.
It does not
install each MSI, DMG, AppImage or RPM package or establish installer
permissions and unsigned-app prompts. Keep its release performance observations
separate from the desktop CI debug-runner budgets.

Once the final cloud gates pass, link the exact package run in
[#80](https://github.com/ibiscite/ibis/issues/80) and use the
[remaining per-OS hand checks](testing.md#remaining-hand-checks-after-all-three-cloud-runs-pass)
with the matching [synthetic library](../fixtures/bibtex/real-world.bib) from that
same source SHA. The Windows and macOS checklists cover the remaining human
checks; Linux preview acceptance relies on automation and its future hand list
is optional. Do not ask for hand testing before the stable downloads are ready.

Update the generated changelog and release notes through Release Please to
distinguish automated results, pending checks and actual hand results. A ready
build is not publishing authorization: merging release PR #70, creating a tag
or publishing still requires the maintainer's explicit yes.
