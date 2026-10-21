# Nix installation

**Draft, not installable yet.** The package is being validated in #664. Its
Nixpkgs revision and pnpm tool tarball are pinned, but the generated flake lock
and pnpm dependency-store hash must be recorded before installation is offered.
No Nix evaluation, package build or graphical runtime check has passed yet.

The first target is `x86_64-linux`. macOS, Windows and other Linux architectures
are not offered by this flake. The package contains the desktop app; its program
is `ibis-desktop`, distinct from the developer CLI named `ibis`.

The package uses the Nixpkgs Tauri and pnpm hooks with the repository's existing
Cargo and pnpm locks. pnpm 11.25.0 matches `packageManager`; its official npm
tarball was checked against npm's integrity value. The pinned Nixpkgs supplies
Rust 1.99.0, which satisfies the workspace's Rust 1.90 minimum. Nix invokes its
own compiler directly, so `rust-toolchain.toml` does not download another Rust
toolchain during the build. Cargo and pnpm install dependencies offline in the
sandbox after their fixed-output fetches have completed.

Nix manages upgrades. This build removes the update key and feed through a
package-only Tauri configuration merge, so the automatic-update question and
manual in-app installer are unavailable. A build check inspects the executable
for the launcher path and rejects the original key or feed.

The desktop launcher includes the GTK/WebKit environment and the dynamically
loaded AppIndicator library. Starting at login uses that public wrapper through
a compile-time package setting. An entry made by Ibis points to this package's
store generation. For automatic changes of generation, prefer a declarative
autostart entry managed alongside the package; its configuration will follow
your NixOS or Home Manager rebuild. Do not configure both methods.

## Validation

The temporary CI bootstrap in the existing CI workflow computes `flake.lock`
and the pnpm store hash using Nixpkgs' `nix-prefetch` with `fetchPnpmDeps`.
Generated inputs are preserved as a workflow artifact, then reviewed and
committed. That job does not claim a working package. Once inputs are recorded,
the final job will evaluate, build in the Nix sandbox and inspect the installed
desktop entry, executable and icon separately from graphical runtime checks.

Graphical validation must use synthetic data and check launch, search/copy,
tray, shortcut, login-entry launcher and absence of update actions. An X11 check
does not establish Wayland shortcut support; see [compatibility.md](compatibility.md).

The packaging contracts come from the pinned upstream
[Tauri hook](https://github.com/NixOS/nixpkgs/blob/02c087f3fe673c9e317f206a627cb6b910336dbe/doc/hooks/tauri.section.md),
[pnpm fetcher](https://github.com/NixOS/nixpkgs/blob/02c087f3fe673c9e317f206a627cb6b910336dbe/pkgs/build-support/node/fetch-pnpm-deps/default.nix)
and [pnpm packaging](https://github.com/NixOS/nixpkgs/blob/02c087f3fe673c9e317f206a627cb6b910336dbe/pkgs/development/tools/pnpm/generic.nix).
