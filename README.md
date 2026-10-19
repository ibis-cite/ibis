# Ibis

**Cite anything, anywhere.** Press a shortcut in any app, find a reference from your libraries in any language, and get a correct citation into whatever you are writing. If Ibis cannot insert it safely, it copies it and tells you why. It never fails silently.

Ibis is free, open source and private by design: everything works offline, nothing is tracked, and your libraries are never changed.

> **Status: early development, working towards the first preview (0.1).** The core engine and the `ibis` command line tool read BibTeX/BibLaTeX files. The desktop picker runs from source: a global shortcut opens it, you search a `.bib` library, automatically reload its changes and copy a citation in Pandoc, BibLaTeX, LaTeX or Typst syntax. Installable preview builds, Zotero support, formatted styles and direct insertion follow. See the [roadmap](ROADMAP.md).

## Planned for 1.0

- Works with **Zotero** (open *or* closed), **BibTeX/BibLaTeX**, **RIS** and **CSL-JSON**, with more managers to follow.
- Every **official citation style** (10,000+, including IEEE and APA), kept current, plus citation keys for **LaTeX**, **Pandoc/Markdown** and **Typst**.
- Page numbers per reference, several references at once, and a preview before inserting.
- Fast search by words, in any language and script.
- Inserts into Word, Google Docs, Overleaf, Obsidian, Notion, email, chat and anything else, with clear fallbacks.
- Gentle library health checks: missing data, odd names, duplicate keys.
- Windows, macOS and Linux. Keyboard, mouse and screen-reader friendly.

## Try the latest build

The newest development build for Windows, macOS and Linux is always at **[Releases → Ibis nightly](https://github.com/ibiscite/ibis/releases/tag/nightly)**. It is rebuilt after every change, so it can be unfinished; numbered preview releases are steadier. Builds are not signed yet, so your system may warn before opening them (the release page says what to click). Tell us what works and what you miss through [a problem report or an idea](https://github.com/ibiscite/ibis/issues/new/choose).

## Try the command line tool (developers)

```sh
cargo run -p ibis -- search "garcia sleep" --bib fixtures/bibtex/real-world.bib
cargo run -p ibis -- cite mueller2021 vanderberg2019 --page mueller2021=12-14 --format autocite
cargo run -p ibis -- check fixtures/bibtex/damaged.bib
```

## Contributing

You do not need to be a programmer to help. Reporting an app where pasting fails, adding a test example, or improving documentation are all valuable. AI-assisted contributions are welcome under clear rules. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Ibis is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). Contributions use the [Developer Certificate of Origin](https://developercertificate.org/). See also [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [GOVERNANCE.md](GOVERNANCE.md) and [TRADEMARKS.md](TRADEMARKS.md).

Citation styles come from the [Citation Style Language](https://citationstyles.org/) project (CC BY-SA 3.0).
