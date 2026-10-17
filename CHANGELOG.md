# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Entries are generated from [Conventional Commits](https://www.conventionalcommits.org/) when a release is made.

## [Unreleased]

### Added

- Core library with a source-neutral reference model that keeps source identity and the raw record.
- BibTeX/BibLaTeX reader that loads every valid entry and reports duplicate keys, unclosed entries, undefined macros and missing keys with line numbers. Entries with an undefined `@string` macro still load, with the affected field left empty.
- CSL-JSON export with full dates, volume, issue, pages, publisher, place, edition, ISBN/ISSN, series and readable thesis and report types.
- Keyword search that ignores case and accents, folds Greek final sigma and German sharp s, works in every script and explains each match.
- Citation output for Pandoc, BibLaTeX (`\autocite`, `\parencite`, `\textcite`), LaTeX `\cite`, Typst and plain keys, with per-reference locators and syntax-specific escaping.
- `ibis` command line tool with `search`, `cite`, `check` and `csl` commands and JSON output. Loading problems are always reported, and a citation key found in more than one file is reported as ambiguous instead of being chosen silently.
- Fixture corpus, snapshot and property tests, and continuous integration on Windows, macOS and Linux.
