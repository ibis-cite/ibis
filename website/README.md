# Ibis website

Static HTML/CSS for ibiscite.org on the existing Hostinger plan; not live yet.
Source lives here; installers stay on GitHub Releases. No framework or database.

Use typography and spacing, never accent-bar callouts, highlight bars, accordions
or disclosure toggles. Keep information visible and keyboard focus clear. The
thin structural margin rule belongs to the page layout, not to callouts.

## Edit and check

`index.html` is the short introduction; `setup.html` holds installation and
workflow details; `style.css` styles both. Keep current preview behaviour apart
from plans. When a feature ships, update these pages against the released app
README, especially `#how`, `#setup`, `#roadmap` and the setup guide. Use maintained
channel download URLs without duplicating version numbers or promising dates.

From the repository root, run `node website/build.mjs`, then
`python3 -m http.server 8094 --bind 127.0.0.1 --directory website/dist`.
Open http://127.0.0.1:8094. Run `node --test scripts/website.test.mjs`; check
light/dark, keyboard, 320px reflow, 200%/400% zoom, VoiceOver and real links.
Brand assets are copied unchanged from `brand/exports/`; after a brand change,
run `python3 brand/build.py` and rebuild the site. Never edit copied assets.

## Publish and recover

After review/merge, rebuild from clean main. Select **ibiscite.org** in Hostinger,
confirm its document root and back up its existing files privately. Upload only
`website/dist/` contents, including `.htaccess`; never the checkout or another
site. Verify HTTPS, assets, headers, links and both themes. Retain the previous
public build and commit for rollback. Credentials, DNS exports, private feedback
and operational backups stay outside Git. Record infrastructure changes and
backup locations privately; export DNS before changes. No mail DNS change is
needed. Add a form or email address only when that route actually works.
