# Ibis website

Static public files for ibiscite.org on the existing Hostinger plan. Installers
stay on GitHub Releases. No framework, database, analytics or outside fonts.
The build/public-files slice lands before the page and demo; publication waits
for all three reviewed changes.

## Change and preview

The [shared rule book](../docs/design.md#website) owns layout and voice.
`apps/desktop/src/tokens.css` owns visual tokens; `keys.ts` owns shortcuts.
The build copies tokens and erases TypeScript types from the shared key module
(Node 22.13 or newer). Neither is duplicated in website source.
Edit `index.html`, layout in `style.css`, and progressive behavior in `site.js`.
Product claims come from ROADMAP.md and the rule book’s Coming features.

Run `node website/build.mjs`, then
`python3 -m http.server 8097 --bind 127.0.0.1 --directory website/dist`.
Run `node --test scripts/website.test.mjs` and `node scripts/style-lint.mjs`.
Check keyboard, narrow screens, zoom, both themes, no scripts and real links.
VoiceOver acceptance is separate; record only checks actually completed.

## Publish and recover

Deploy only `website/dist/`, including `.htaccess`, after review and merge.
Build from clean main. Keep hosting credentials, SSH configuration, DNS exports
and operational backups outside the repository and CI. Back up this domain’s
existing files and DNS before changing them; leave other sites and mail alone.
Set up an `ibis-hosting` alias in the maintainer’s own SSH config (host, user,
port and key), verify its host key, and confirm key-based login. Never paste
credentials into a command, chat, this folder or CI. Set `IBIS_WEB_ROOT` locally
to this domain’s exact document root; optional `IBIS_BACKUP_DIR` chooses a
private backup folder outside the checkout (default: Downloads/Ibis website
backups). No configuration file is tracked.

After fetching, run `node website/deploy.mjs` for a read-only connection/build
preflight, then `node website/deploy.mjs --publish`. It refuses a dirty checkout
or a commit different from origin/main, builds dist, checks the remote real
path, archives the existing site outside its public root, downloads that archive
privately, then syncs only dist (including dotfiles), without deleting unknown remote files or subfolders. Upload failure keeps the
backup. A final checksum dry run must find no differences. It logs no connection
details. SSH and rsync must already be available; this creates no accounts.
To roll back, extract the retained archive into a private folder, inspect it,
then rsync its contents to the same verified root. Keep the deployment record
and pre-change DNS export together in the private project record.
Check live HTTPS, headers, downloads, both themes and logo animation.

Brand assets are copied unchanged from `brand/exports/`; rebuild them with
`python3 brand/build.py`. When wording/features change, check the root README,
GitHub About and organization profile too. Link the domain there only once live.
The site stores only the local appearance choice. Hostinger may keep technical
server logs; downloads and community links open GitHub.
