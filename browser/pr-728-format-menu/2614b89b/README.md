# Serialized Format command handoff

Synthetic Chromium 151 browser checks at source `2614b89b938e7a2e27ca7bcf0409535e0f55454e`.

All 42 cases passed: three OS looks, ordinary/reduced motion and seven routes (More then Tab, More then Reload, shortcuts dialog then Escape, Format pick, Format Escape, Format Tab and IME composition). Each case keeps the existing search query and returns focus to Search with no inert picker root. IME never invokes the application command.

This is candidate evidence, not final/native acceptance. The separate rapid-reopen P2 waits for #794 on main, followed by final integration, full check and independent final-head review. Earlier image captures in the parent folder are labelled with their own source commits.
