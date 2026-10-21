# Native macOS More-menu focus comparison

These are **native WKWebView captures**, not browser renders. Both locally built debug applications use the existing synthetic `many-results` gallery at 720×480 points (1440×960 image pixels) on macOS 27.0.1 arm64. Baseline source is #730 `5148f9e15db43609770517b9d9c0d26bfa6035d4` (main `47667263` plus footer CSS); candidate is #794 `ac199f06e55c0d395713f96be2e6f4e85a4a246b`. CUA returns JPEG screenshot bytes; these are preserved without image conversion.

Supported external Tauri config overrides give each build a distinct identity, all app directories under a disposable temporary root, a nonpersistent/incognito WKWebView, and explicit synthetic `IBIS_LIBRARY`, `IBIS_GALLERY` and ready-file bundle launch environment. Both readiness acknowledgements were checked; synthetic settings stayed byte-identical. No tracked source, real library, real Ibis preferences, OS appearance or accessibility settings were changed.

## Results

| Path | Baseline | Candidate |
| --- | --- | --- |
| Pointer/AX activation → Escape → Space | PASS: More focused; Space reopens | PASS: More focused; Space reopens |
| Shortcut ⌘K → Escape → Space | **FAIL P2**: Space edits Search | **FAIL P2**: Space edits Search |
| Tab → Search, type marker | PASS (Space-opened menu) | PASS (pointer and shortcut opening) |
| Reload → Search, type marker | PASS (shortcut opening) | PASS (pointer and shortcut opening) |
| Keyboard shortcuts → Close focused → Escape → Search, type marker | PASS (shortcut opening) | PASS (pointer and shortcut opening) |

Candidate failure: query changes from `memory` to `memory ` after ⌘K → Escape → Space. Its menu was confirmed open at 467 ms, Escape began at 6570 ms, the closed AX observation returned at 7234 ms and Space was confirmed in Search by 7672 ms. Baseline timed repeat also waited several seconds before Escape. These are settled closes, not rapid-reopen claims. The native AX focused-element summary exposes the active result when Search receives keys; the actual Search value change is the decisive focus proof.

Files include observed native AX as lossless JSON line arrays (preserving typed spaces), CUA action timings, source/binary manifests and six reviewed app-only captures. Candidate matrix preserves before/after query values. A separate actual OS Edit-menu AX probe is included; the app-scoped screenshot API could not capture that menu, so native visual parity is not established. An intermediate probe after the OS menu did not confirm More opening and was excluded; the published timed repetition explicitly confirms More open before Escape.

The native gallery uses an explicit light CSS preview and fake actions. Reload performs no actual library operation; Copy/Hide/Quit callbacks are fake; the displayed global shortcut is fixture data. This does not establish actual global shortcut registration, clipboard output, persistence, installation, screen-reader speech, full-screen Spaces, IMEs, multiple displays, cloud folders or subjective feel. Supported native controls offer no reduced-motion emulation without OS-setting changes; reduced motion was not tested. No native rapid-reopen pass is claimed. Browser evidence retains its own scope.
