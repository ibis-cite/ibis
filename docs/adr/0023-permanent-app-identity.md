# 0023. Use the owned domain for the app identity and preserve channel settings

Status: accepted (2026-10-22); supersedes the settings location in 0016

## Context

The maintainer owns ibiscite.com and chose `com.ibiscite.ibis` in
[#695](https://github.com/ibiscite/ibis/issues/695). A bundle identifier affects
configuration folders, desktop integration and system permissions. Changing it
after distribution must preserve settings rather than start from defaults.
ADR 0019 keeps Stable and Nightly independent. Login-item state is held by the
operating system, not settings JSON; Apple's
[main-app service](https://developer.apple.com/documentation/servicemanagement/smappservice/mainapp)
controls the running app's registration.

## Decision

- Stable uses `com.ibiscite.ibis`; Nightly uses `com.ibiscite.ibis.nightly`.
  Product names and update feed addresses remain unchanged. Development and
  unknown identifiers never migrate another app's settings.
- Continue using Tauri's `app_config_dir`: Application Support on macOS,
  roaming AppData on Windows, and XDG config on Linux. Replace only the final
  identifier component. No library files or remembered paths move.
- On first use of a new identity, copy `settings.json` and its existing
  `settings.json.bak` from the matching old `io.github.ibiscite.ibis` directory
  (or its `.nightly` directory), only into an absent or empty destination.
  Copy bytes without parsing, converting or dropping unknown fields. Retain
  the old files. Do not copy temporary files or unrelated directory contents.
- An existing new primary or backup always wins, including an empty, invalid
  or newer file. Existing recovery and save-refusal rules remain unchanged.
  A missing old primary means there are no active settings to migrate.
- Stage and flush the complete copy before publishing it. An interrupted copy
  must not expose a partial new primary or lose the old recovery pair. Never
  replace an unrelated nonempty destination. On a failed migration, continue
  reading and saving the old settings and show a fixed notice; retry on a later
  launch. Do not log file contents, paths or operating-system error payloads.
- Preserve each channel's actual start-at-login choice on Windows and Linux.
  Windows retains the product-named Run entry. Linux prepares the corresponding
  Ibis-owned replacement before retiring the old entry and preserves disabled
  overrides; migration must not expose an enabled system entry.
- On macOS, a replaced main-app identity cannot reliably read its former
  OS-owned login choice. The maintainer approved visible one-time reapproval in
  [#695](https://github.com/ibiscite/ibis/issues/695#issuecomment-6345031681): after
  matching legacy migration, explain the new identity and direct the person to
  Open at Login. Leave unknown old consent off. Register only after an explicit
  request, then report the actual enabled, approval-needed or refused state.
  A copied JSON file is never evidence of consent; do not disable a known
  enabled registration under the new identity.
- Keep the reapproval notice separate for Stable and Nightly. Acknowledge it
  only after successful display or explicit dismissal; if acknowledgement
  cannot be saved safely, retain it for a later launch. An undelivered notice
  must not disappear on reopening. Libraries and shortcuts remain preserved.
- Do not switch the shipped identifiers until these transitions are implemented
  and tested for updater and direct replacement paths. Existing system privacy
  permissions may need approval again; reapproval is not installed-upgrade or
  restart/login acceptance evidence.

Special files are unreadable settings, not streams to open: keep regular backup
recovery and refuse writes over a special primary, backup or temporary file.
Ordinary file symlinks retain their existing behavior. Metadata preflight bounds
this failure case; it is not a lock against concurrent external path changes.

## Consequences

The identity no longer depends on the hosting organization. Stable and Nightly
keep their own settings and update feeds. Downgrading leaves the old files
available; changes made under the new identity do not flow back automatically.
Settings format, unknown-field preservation and backup recovery remain governed
by ADRs 0018, 0020 and 0022. Identity migration does not reset system privacy
permissions or enable login items from an unknown state.
