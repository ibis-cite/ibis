# Chip-fit stability: synthetic browser evidence

Source: eed76ae784aba84610a45072b9775136a092dabf. Before: actual main f2031235bf9692290abf31171301722df46f77ea. Browser render in Chromium 151.0.7922.34; synthetic data only, no native-device claim.

## Complete gallery

The unchanged contact-sheet renderer passed all 576 frames: 528 picker and 48 component frames, all three looks, light/dark, normal/Larger text. No frame failed or acknowledgement was relaxed. The two contact sheets and manifest are in gallery/. Local renderer wall time was 80.36 seconds, including serving and contact-sheet creation; this is not hosted timing.

## Genuine interaction attacks

All 12 cases passed: three looks × normal/Larger text × fine/coarse pointer. Each case seeds 20 choices at720×480, resizes to the configured360×320 minimum and delivers genuine ArrowDown/Shift+Enter additions21 through50. The suite checks Search focus, exact membership/order after disclosure, removal and re-addition of choice50, then900→360 width restoration and convergence. At most seven independent sizing probes remain. Normal root is16px; app Larger root is18.4px. Pointer modes are emulated.

The before image/JSON records the original Linux Larger/coarse23rd-choice unmount and React185 error on actual main. Current images show the intact50-choice picker after the same sequence. Tests do not claim to fix the separate32/36.8px minimum-height pressure tracked by#584 or the optional footer-width feedback in#873.

Full source verification and independent review are recorded on the pull request, separately from these browser results.
