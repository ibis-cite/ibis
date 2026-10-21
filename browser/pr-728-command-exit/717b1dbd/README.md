# Independent exiting-command repair recheck

Exact source: `717b1dbde3e34aa1f1f7f0fbd2e4719486592918`.
Synthetic Chromium 151.0.7922.34 gallery checks, not native captures.

The same genuine-exit probe that failed on `2614b89b` now returns to Search
after repeated More → Tab and competing shortcuts dialog → Escape, on all three
platform looks. It confirms `data-exiting` before the second command and waits
for actual Format detachment before checking final focus. The three plain-key
controls cancel the pending app command and permit ordinary React Aria trigger
restoration, as intended. No CSS animation duration override was used.

The ordinary 42-case handoff/pick/Escape/Tab/IME matrix also passes independently,
along with TypeScript and all 26 ToolbarMenu tests. This covers the scoped repair;
the separate rapid-reopen P2 still awaits #794 and final main integration, full
verification and required hosted checks.
