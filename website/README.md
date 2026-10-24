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
The publishing host is being settled separately with the maintainer. No
hosting credentials or automated deployment configuration belong in this slice.
Keep the static build portable; host-specific publishing is a reviewed follow-up.
Check live HTTPS, headers, downloads, both themes and logo animation.

Brand assets are copied unchanged from `brand/exports/`; rebuild them with
`python3 brand/build.py`. When wording/features change, check the root README,
GitHub About and organization profile too. Link the domain there only once live.
The site stores only the local appearance choice. Hostinger may keep technical
server logs; downloads and community links open GitHub.
