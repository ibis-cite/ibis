# Rapid menu reopening — PR #794

Synthetic Chromium browser evidence for source `ac199f06e55c0d395713f96be2e6f4e85a4a246b`, based on main `47667263c7de94db5bd20daa909863f78cd45a4d` after #791. Baseline source: `6a4031a5cefa360ccc193f5c66202b6c643c1540`. The affected More/ToolbarMenu lifecycle predates #791; #793 also records baseline evidence against later main.

Browser: Chromium `151.0.7922.34`, through the repository's existing `openGallery` helper. Each platform uses the gallery's macOS, Windows or Linux appearance and matching `navigator.platform`. These are browser simulations, not native operating system checks. No real library data was used.

## Results and reproduction

| Matrix | Baseline | Final source |
| --- | --- | --- |
| More: 3 looks × 2 themes × 2 motion preferences × Reload/Escape close × pointer/keyboard reopen | 48/48 reproduced body focus and inert ArrowDown | 48/48 applied normal opening focus and ArrowDown navigation |
| Filtered toolbar: 3 looks × 2 themes × 2 motion preferences × action/Escape close × pointer reopen | 24/24 reproduced body focus, lost typing and inert ArrowDown | 24/24 focused filter, typed Prose, navigated and selected Prose |
| Ordinary More actions, Escape, Tab and keyboard-shortcuts dialog | Already recorded with #791 | 96/96 retained expected Search/More/dialog destinations |

The JSON field `passed` means **the expected baseline defect was reproduced** in `before/`, and **the correct behavior passed** in `after/` and `ordinary/`.

More reproduction: open the `many-results` gallery, open More, activate Reload (or press Escape), confirm `.menu-popover[data-exiting]` is present, then reopen immediately. After two animation frames, inspect active element and press ArrowDown. Pointer opening should focus the menu with no row highlighted; ArrowDown enters Choose library. Keyboard opening should focus Choose library; ArrowDown enters Use Zotero.

Toolbar reproduction: open the `toolbar-menu` gallery, choose Markup (or press Escape), confirm `.toolbar-menu-popover[data-exiting]` is present, then click its trigger. After two animation frames, type Prose, press ArrowDown and Enter. The final source focuses the filter, produces one matching item and selects it. Baseline remains body-focused with all eight items and no entered text.

Unit tests cover filtered and unfiltered toolbar variants, action/Escape closes, controlled selection, and the retained outer popover. Their held-animation and inert-focus simulation fails before each runtime fix. All 426 UI tests passed on the final source.

## Screenshots

Each pair uses the action-close/pointer-reopen case, normal motion. More is shown after ArrowDown; toolbar is shown after typing Prose and ArrowDown, before Enter. More captures wait for the enter transition to settle after the focus assertions. PNG signatures and dimensions were checked from their bytes: More 760×620; toolbar 720×480.

| Browser appearance | More before | More after | Toolbar before | Toolbar after |
| --- | --- | --- | --- | --- |
| macOS light | [view](before/more/macos-light.png) | [view](after/more/macos-light.png) | [view](before/toolbar/macos-light.png) | [view](after/toolbar/macos-light.png) |
| macOS dark | [view](before/more/macos-dark.png) | [view](after/more/macos-dark.png) | [view](before/toolbar/macos-dark.png) | [view](after/toolbar/macos-dark.png) |
| Windows light | [view](before/more/windows-light.png) | [view](after/more/windows-light.png) | [view](before/toolbar/windows-light.png) | [view](after/toolbar/windows-light.png) |
| Windows dark | [view](before/more/windows-dark.png) | [view](after/more/windows-dark.png) | [view](before/toolbar/windows-dark.png) | [view](after/toolbar/windows-dark.png) |
| Linux light | [view](before/more/linux-light.png) | [view](after/more/linux-light.png) | [view](before/toolbar/linux-light.png) | [view](after/toolbar/linux-light.png) |
| Linux dark | [view](before/more/linux-dark.png) | [view](after/more/linux-dark.png) | [view](before/toolbar/linux-dark.png) | [view](after/toolbar/linux-dark.png) |

Missing views: native macOS/Windows/Linux focus checks, and an unfiltered toolbar browser gallery (covered by the component regression instead). The Format-to-More shortcut state handoff belongs to #728 and is not claimed here.

Verification commands, immutable review and full-check status are recorded in the PR's canonical evidence comment.
