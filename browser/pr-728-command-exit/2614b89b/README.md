# A second app command during Format exit

Source: `2614b89b938e7a2e27ca7bcf0409535e0f55454e`.
Chromium 151.0.7922.34, synthetic browser gallery, not native evidence.

The ordinary 42-case matrix passes (`ordinary-42.json`). This additional probe
uses the real production exit animation without changing its CSS duration:

1. Open Format, filter to Typst, then press the platform More shortcut.
2. Verify Format is still `data-exiting` and its filter still has focus.
3. Immediately press More again, or the shortcuts-dialog shortcut.
4. Close More with Tab, or close the shortcuts dialog with Escape.

All three looks return to the Format trigger, not Search. The second shortcut
cancels the original pending request, but because `open` is already false it
bypasses ToolbarMenu's command classifier and opens the new overlay through App
before the old filter has disappeared. `repeat-results.json` records all nine
probes, including a plain-key cancellation control. The dialog follow-up in
`keys-after-detachment.json` waits for the old Format popover to be detached
before checking final focus; all three still end on the Format trigger.

Build the exact source's evidence gallery first, then run:

```sh
node command-during-exit.mjs path/to/source output.json
```

Use the existing Playwright/Chromium runtime. This evidence script serves only
the built synthetic gallery on loopback and does not modify source.
