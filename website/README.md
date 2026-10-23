# Ibis website

Static source for ibiscite.org on the existing Hostinger plan. The website is
not live yet. Installers stay on GitHub Releases. No framework, database,
remote fonts or website subscription is needed.

## Edit and check

Edit `index.html` for copy and links, `style.css` for layout. Keep the two-step
setup brief. The app's README is the source for released behavior, installation
limits and shortcuts; review the site when those change. Describe insertion
and customization as plans until released. Downloads use maintained channel
URLs rather than a separate version list.

Run `node website/build.mjs`, then serve `website/dist/` with a static server.
Run `node --test scripts/website.test.mjs` for the public-build check, also
discovered by the existing CI script tests. Before publishing, check light and
dark, keyboard navigation, 320px reflow, 200%/400% zoom, screen-reader behavior
and real download/help links. Record checks actually run.

Brand assets are copied unchanged from `brand/exports/`. After a brand change,
run `python3 brand/build.py` and rebuild the site. Never edit copied assets.
Use plain notes, no accent-bar callouts or accordions. Keep focus visible.

## Publish and recover

After review and merge, build from clean main. In Hostinger select only
**ibiscite.org**, confirm its document root and privately back up existing
files and DNS before changing anything. Upload only the **contents** of
`website/dist/`, including `.htaccess`. Never upload the checkout or touch
another site. Verify HTTPS, headers, links and both themes; retain the previous
public build and its source commit for rollback.

Credentials, account details, DNS exports, private feedback and backups stay
outside this repository, with locations in the private project record. No
email DNS change is needed. Add no form or email address until it works.
