# Maintaining and releasing Ibis

Single-maintainer workflow for now. Implement and test by default. Commit, push, tag or release only when the maintainer explicitly asks for that exact action.

## Everyday workflow

1. Describe the user outcome and constraints. The implementation handles routine design, tests, documentation and review.
2. Inspect `git status` before editing; preserve existing work. One writer per checkout; use `git worktree` for concurrent work when asked.
3. Make one focused change. Run `cargo test -p ibis-core` while developing.
4. Run `node scripts/check.mjs`, review the diff, and report results and remaining limits.
5. When asked: commit with sign-off (`git commit -s`), push, and wait for CI on that exact commit.

## Real-library check

When source reading, search or output changes, also test against a **controlled** library, never a personal working library: a synthetic `.bib` file or a dedicated test library in Zotero. Record what was tested in the PR. Do not copy real records into the repository.

## Releases

Not yet set up. Planned (see `ROADMAP.md`):

- Versions follow semantic versioning; `0.x` releases may change behaviour.
- Release notes come from Conventional Commit messages.
- Desktop builds for Windows, macOS and Linux are produced by CI, never on a personal machine. They are signed (Apple Developer ID; SignPath Foundation or Microsoft Store for Windows), with build-provenance attestations and an SBOM.
- Updater and style-bundle signing keys live only in GitHub organization secrets with narrow access; their loss or rotation follows a written procedure before 1.0.
- Distribution: GitHub Releases, Homebrew cask, winget, Flathub/AppImage/.deb/.rpm.
