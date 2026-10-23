# Ibis website

Static HTML and CSS for ibiscite.org, hosted on the existing Hostinger plan.
Source lives here; installers stay on GitHub Releases. No framework, database,
remote fonts, browser scripts or paid website service is needed.

## Edit and preview

Edit `index.html` for words and links, `style.css` for layout. Keep today's
features separate from roadmap plans. The app README remains the source for
installation limitations; review website copy when those change. Downloads use
the maintained channel URLs, without a second version-number list.

Run `node website/build.mjs` from the repository root, then
`python3 -m http.server 8094 --bind 127.0.0.1 --directory website/dist`.
Open http://127.0.0.1:8094. Check light/dark, keyboard navigation, 320px reflow,
200%/400% zoom, VoiceOver, and the real download/help links before publishing.
Run `node --test scripts/website.test.mjs` for the public deployment check.

Brand files are copied unchanged from `brand/exports/`. After changing the
brand, run `python3 brand/build.py`, then rebuild the website. Never edit the
copied files. The build replaces `website/dist/` with only public site assets.

## Publish and recover

After review and merge, rebuild from clean `main`. In Hostinger, select
**ibiscite.org**, confirm its document root and back up that site's existing
files privately. Upload only the **contents** of `website/dist/`, including
`.htaccess`, into that root. Never deploy the checkout or touch another site.
Verify HTTPS, links, assets, security headers and both themes on the live site.
Retain the previous public build and source commit for rollback.

The website and source are public. Hosting credentials, account details, DNS
exports, private feedback and operational backups stay outside the repository.
Keep infrastructure changes and backup locations in the private project record;
export existing DNS before any change. This site requires no mail DNS changes.
Do not add forms or publish an email address until that route actually works.
