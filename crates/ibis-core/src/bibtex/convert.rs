//! Converts a parsed BibLaTeX entry into a [`Reference`], preserving meaning:
//! protected capitalization, italics, truncated author lists, organizations,
//! date ranges and uncertainty, and proper language tags.

use std::collections::{BTreeMap, HashMap};

use biblatex::{Chunk, ChunksExt, DateValue, EditorType, Entry, PermissiveType, RetrievalError};

use crate::model::{Issued, Name, OTHERS, PartialDate, RecordId, Reference};

/// Convert one entry. Problems that do not prevent loading are pushed to `problems`.
pub(crate) fn convert(
    source: &str,
    kind: &str,
    raw: &str,
    entry: &Entry,
    own_fields: &HashMap<String, String>,
    problems: &mut Vec<String>,
) -> Reference {
    let text = |field: &str| {
        entry
            .get(field)
            .map(|c| clean(&strip_tex(&c.format_verbatim())))
            .filter(|s| !s.is_empty())
    };

    let language = language_tag(entry, problems);
    let english = language.as_deref().is_none_or(|l| l == "en" || l.starts_with("en-"));
    let title = entry.get("title").map(|chunks| {
        let pieces = pieces_from_chunks(chunks.iter().map(|c| &c.v));
        render(&if english { sentence_case(pieces) } else { pieces })
    });
    // `booktitle` names the containing book only for parts of a book or of
    // proceedings; on a whole book or proceedings volume it repeats the title.
    let item_type = csl_type(kind);
    let container_fields: &[&str] = if matches!(item_type, "chapter" | "paper-conference") {
        &["booktitle", "journaltitle", "journal"]
    } else {
        &["journaltitle", "journal"]
    };
    let container_title = container_fields
        .iter()
        .find_map(|f| entry.get(f))
        .map(|chunks| render(&pieces_from_chunks(chunks.iter().map(|c| &c.v))))
        .filter(|s| !s.is_empty());

    let authors = match entry.author() {
        Ok(people) => names(people, own_fields.get("author").map(String::as_str)),
        Err(RetrievalError::Missing(_)) => Vec::new(),
        Err(err) => {
            problems.push(format!("authors could not be read: {err}"));
            Vec::new()
        }
    };
    let editors = match entry.editors() {
        Ok(groups) => groups
            .into_iter()
            .filter(|(_, role)| *role == EditorType::Editor)
            .flat_map(|(people, _)| names(people, own_fields.get("editor").map(String::as_str)))
            .collect(),
        Err(err) => {
            problems.push(format!("editors could not be read: {err}"));
            Vec::new()
        }
    };

    let mut variables = BTreeMap::new();
    let mut set = |csl: &str, fields: &[&str]| {
        if let Some(value) = fields.iter().find_map(|f| text(f)) {
            variables.insert(csl.to_string(), value);
        }
    };
    set("volume", &["volume"]);
    if kind == "article" {
        set("issue", &["number", "issue"]);
    } else {
        set("number", &["number"]);
        set("issue", &["issue"]);
    }
    set("page", &["pages"]);
    set("publisher", &["publisher", "institution", "school", "organization"]);
    set("publisher-place", &["location", "address"]);
    set("edition", &["edition"]);
    set("ISBN", &["isbn"]);
    set("ISSN", &["issn"]);
    set("collection-title", &["series"]);
    set("genre", &["type"]);
    set("note", &["note"]);
    set("event-title", &["eventtitle"]);
    let genre = variables.get("genre").map(String::as_str).or(match kind {
        "phdthesis" => Some("phdthesis"),
        "mastersthesis" => Some("mathesis"),
        "techreport" => Some("techreport"),
        _ => None,
    });
    if let Some(readable) = genre.and_then(readable_genre) {
        variables.insert("genre".to_string(), readable.to_string());
    }

    Reference {
        id: RecordId {
            source: source.to_string(),
            native_key: entry.key.clone(),
        },
        citekey: Some(entry.key.clone()),
        item_type: item_type.to_string(),
        title,
        authors,
        editors,
        issued: issued(entry, problems),
        container_title,
        doi: text("doi"),
        url: entry
            .get("url")
            .map(|c| clean(&c.format_verbatim()))
            .filter(|s| !s.is_empty()),
        abstract_text: text("abstract"),
        keywords: text("keywords")
            .map(|k| {
                k.split([',', ';'])
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
        language,
        variables,
        raw: Some(raw.to_string()),
    }
}

// ---------- Names ----------

/// Convert parsed people, using the raw field to recognize names written in
/// braces (organizations) and the "and others" marker.
fn names(people: Vec<biblatex::Person>, raw: Option<&str>) -> Vec<Name> {
    let braced = raw.map(braced_names).unwrap_or_default();
    people
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let given = clean(&p.given_name);
            let family = clean(&p.name);
            if family == OTHERS && given.is_empty() && p.prefix.is_empty() {
                return Name::literal(OTHERS);
            }
            let is_braced = braced.get(i).copied().unwrap_or(false);
            if is_braced || (raw.is_none() && given.is_empty() && family.contains(' ')) {
                return Name::literal(&family);
            }
            let some = |s: String| (!s.is_empty()).then_some(s);
            Name {
                family: some(family),
                given: some(given),
                dropping_particle: some(clean(&p.prefix)),
                suffix: some(clean(&p.suffix)),
                ..Name::default()
            }
        })
        .collect()
}

/// For each name in an `a and b and c` list, whether it is wholly in braces.
fn braced_names(raw: &str) -> Vec<bool> {
    let mut result = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth = depth.saturating_sub(1),
            b' ' | b'\t' | b'\n' if depth == 0 => {
                let rest = &raw[i..];
                let trimmed = rest.trim_start();
                let t = trimmed.as_bytes();
                // Byte comparison: "and" is ASCII, so this never splits a character.
                if t.len() >= 4 && t[..3].eq_ignore_ascii_case(b"and") && t[3].is_ascii_whitespace() {
                    result.push(wholly_braced(&raw[start..i]));
                    start = i + (rest.len() - trimmed.len()) + 4;
                    i = start;
                    continue;
                }
            }
            _ => {}
        }
        i += 1;
    }
    result.push(wholly_braced(&raw[start..]));
    result
}

fn wholly_braced(name: &str) -> bool {
    let name = name.trim();
    if !(name.starts_with('{') && name.ends_with('}')) {
        return false;
    }
    let mut depth = 0usize;
    for (i, c) in name.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 && i != name.len() - 1 {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

// ---------- Dates ----------

fn issued(entry: &Entry, problems: &mut Vec<String>) -> Option<Issued> {
    match entry.date() {
        Ok(PermissiveType::Typed(date)) => {
            let to_partial = |d: biblatex::Datetime| PartialDate {
                year: d.year,
                // The parser counts months and days from zero; CSL counts from one.
                month: d.month.map(|m| m + 1),
                day: d.day.map(|day| day + 1),
            };
            let (start, end) = match date.value {
                DateValue::At(d) | DateValue::After(d) | DateValue::Before(d) => (to_partial(d), None),
                DateValue::Between(a, b) => (to_partial(a), Some(to_partial(b))),
            };
            Some(Issued {
                start,
                end,
                circa: date.approximate,
            })
        }
        Ok(PermissiveType::Chunks(chunks)) => {
            let raw = chunks.format_verbatim();
            match lenient_date(&raw) {
                Some((date, complete)) => {
                    if !complete {
                        problems.push(format!(
                            "date `{raw}` is not a valid date; only {} is used",
                            describe(date)
                        ));
                    }
                    Some(Issued {
                        start: date,
                        end: None,
                        circa: false,
                    })
                }
                None => {
                    problems.push(format!("date `{raw}` could not be read; no date is used"));
                    None
                }
            }
        }
        Err(RetrievalError::Missing(_)) => None,
        Err(err) => {
            problems.push(format!("date could not be read: {err}"));
            None
        }
    }
}

/// Read as much of `YYYY[-MM[-DD]]` as is valid. Returns the date and
/// whether the whole text was a valid date.
fn lenient_date(text: &str) -> Option<(PartialDate, bool)> {
    let text = text.trim();
    let year_digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    if year_digits.len() != 4 {
        return None;
    }
    let year: i32 = year_digits.parse().ok()?;
    let mut date = PartialDate::year(year);
    let mut parts = text[4..].split('-').skip(1);
    let rest_is_date = text[4..].chars().all(|c| c.is_ascii_digit() || c == '-');
    let month = parts
        .next()
        .and_then(|m| m.parse::<u8>().ok())
        .filter(|m| (1..=12).contains(m));
    let day_text = parts.next();
    if let Some(m) = month {
        date.month = Some(m);
        if let Some(d) = day_text.and_then(|d| d.parse::<u8>().ok())
            && d >= 1
            && d <= days_in_month(year, m)
        {
            date.day = Some(d);
        }
    }
    let expected = 1 + usize::from(date.month.is_some()) + usize::from(date.day.is_some());
    let given = text.split('-').filter(|s| !s.is_empty()).count();
    Some((date, rest_is_date && expected == given))
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn describe(date: PartialDate) -> String {
    match (date.month, date.day) {
        (Some(m), Some(d)) => format!("{:04}-{m:02}-{d:02}", date.year),
        (Some(m), None) => format!("{:04}-{m:02}", date.year),
        _ => format!("the year {}", date.year),
    }
}

// ---------- Language ----------

/// BCP 47 tag from `langid` or `language`. Babel/polyglossia names are
/// mapped; tags that already look like BCP 47 are kept; anything else is
/// reported and left out rather than passed on as a wrong tag.
fn language_tag(entry: &Entry, problems: &mut Vec<String>) -> Option<String> {
    let raw = ["langid", "language"]
        .iter()
        .find_map(|f| entry.get(f).map(|c| clean(&c.format_verbatim())))
        .filter(|s| !s.is_empty())?;
    let lower = raw.to_ascii_lowercase();
    if let Some(tag) = babel_to_bcp47(&lower) {
        return Some(tag.to_string());
    }
    let looks_like_tag = {
        let mut parts = raw.split('-');
        let primary = parts.next().unwrap_or_default();
        (2..=3).contains(&primary.len())
            && primary.chars().all(|c| c.is_ascii_alphabetic())
            && parts.all(|p| (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
    };
    if looks_like_tag {
        return Some(raw);
    }
    problems.push(format!("language `{raw}` is not recognized; it is left out"));
    None
}

fn babel_to_bcp47(name: &str) -> Option<&'static str> {
    Some(match name {
        "american" | "usenglish" | "english" => "en-US",
        "british" | "ukenglish" => "en-GB",
        "australian" => "en-AU",
        "canadian" => "en-CA",
        "newzealand" => "en-NZ",
        "german" | "ngerman" => "de-DE",
        "austrian" | "naustrian" => "de-AT",
        "swissgerman" | "nswissgerman" => "de-CH",
        "french" | "francais" => "fr-FR",
        "acadian" | "canadien" => "fr-CA",
        "spanish" => "es-ES",
        "mexican" => "es-MX",
        "italian" => "it-IT",
        "portuguese" | "portuges" => "pt-PT",
        "brazil" | "brazilian" => "pt-BR",
        "dutch" => "nl-NL",
        "danish" => "da-DK",
        "swedish" => "sv-SE",
        "norwegian" | "norsk" | "bokmal" => "nb-NO",
        "nynorsk" => "nn-NO",
        "finnish" => "fi-FI",
        "icelandic" => "is-IS",
        "polish" => "pl-PL",
        "czech" => "cs-CZ",
        "slovak" => "sk-SK",
        "slovene" | "slovenian" => "sl-SI",
        "croatian" => "hr-HR",
        "serbian" => "sr-RS",
        "bulgarian" => "bg-BG",
        "russian" => "ru-RU",
        "ukrainian" => "uk-UA",
        "greek" => "el-GR",
        "turkish" => "tr-TR",
        "hungarian" | "magyar" => "hu-HU",
        "romanian" => "ro-RO",
        "catalan" => "ca-AD",
        "basque" => "eu",
        "galician" => "gl",
        "estonian" => "et-EE",
        "latvian" => "lv-LV",
        "lithuanian" => "lt-LT",
        "hebrew" => "he-IL",
        "arabic" => "ar",
        "persian" | "farsi" => "fa-IR",
        "hindi" => "hi-IN",
        "bengali" => "bn-IN",
        "chinese" => "zh-CN",
        "japanese" => "ja-JP",
        "korean" => "ko-KR",
        "vietnamese" => "vi-VN",
        "thai" => "th-TH",
        "indonesian" | "bahasa" => "id-ID",
        "malay" => "ms-MY",
        "latin" => "la",
        "afrikaans" => "af-ZA",
        "welsh" => "cy-GB",
        "irish" => "ga-IE",
        _ => return None,
    })
}

// ---------- Titles: TeX to CSL rich text, sentence case ----------

#[derive(Debug, Clone, PartialEq)]
enum Piece {
    Text { text: String, protected: bool },
    Tag(&'static str),
}

/// Turn parser chunks into text pieces and markup tags. Braced (verbatim)
/// chunks are protected from case changes and wrapped in a `nocase` span.
fn pieces_from_chunks<'a>(chunks: impl Iterator<Item = &'a Chunk>) -> Vec<Piece> {
    let mut pieces = Vec::new();
    for chunk in chunks {
        match chunk {
            Chunk::Normal(s) => tex_pieces(s, false, &mut pieces),
            Chunk::Verbatim(s) => {
                pieces.push(Piece::Tag("<span class=\"nocase\">"));
                tex_pieces(s, true, &mut pieces);
                pieces.push(Piece::Tag("</span>"));
            }
            Chunk::Math(s) => pieces.push(Piece::Text {
                text: s.clone(),
                protected: true,
            }),
        }
    }
    pieces
}

/// Translate formatting commands (`\emph{}`, `\textit{}`, ...) into tags and
/// drop any other command name, keeping its argument.
fn tex_pieces(text: &str, protected: bool, out: &mut Vec<Piece>) {
    let mut buf = String::new();
    let mut chars = text.char_indices().peekable();
    let mut closers: Vec<Option<&'static str>> = Vec::new();
    let flush = |buf: &mut String, out: &mut Vec<Piece>| {
        if !buf.is_empty() {
            out.push(Piece::Text {
                text: std::mem::take(buf),
                protected,
            });
        }
    };
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => {
                let name: String = text[i + 1..].chars().take_while(char::is_ascii_alphabetic).collect();
                if name.is_empty() {
                    // Escaped character such as \& or \%.
                    if let Some((_, next)) = chars.next() {
                        buf.push(next);
                    }
                    continue;
                }
                for _ in 0..name.chars().count() {
                    chars.next();
                }
                let (open, close) = match name.as_str() {
                    "emph" | "textit" | "textsl" | "mkbibemph" | "mkbibitalic" => ("<i>", "</i>"),
                    "textbf" | "mkbibbold" => ("<b>", "</b>"),
                    "textsc" => ("<span style=\"font-variant:small-caps;\">", "</span>"),
                    "textsuperscript" | "mkbibsuperscript" => ("<sup>", "</sup>"),
                    "textsubscript" | "mkbibsubscript" => ("<sub>", "</sub>"),
                    _ => ("", ""),
                };
                while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) && open.is_empty() {
                    chars.next();
                }
                if chars.peek().is_some_and(|(_, c)| *c == '{') {
                    chars.next();
                    flush(&mut buf, out);
                    if open.is_empty() {
                        closers.push(None);
                    } else {
                        out.push(Piece::Tag(open));
                        closers.push(Some(close));
                    }
                }
            }
            '{' => closers.push(None),
            '}' => {
                if let Some(Some(close)) = closers.pop() {
                    flush(&mut buf, out);
                    out.push(Piece::Tag(close));
                }
            }
            _ => buf.push(c),
        }
    }
    flush(&mut buf, out);
    for close in closers.into_iter().rev().flatten() {
        out.push(Piece::Tag(close));
    }
}

/// Convert BibTeX title case to CSL sentence case (English only): capitalized
/// words become lowercase except at the start of the title or after `:`, `?`
/// or `!`. Protected text, acronyms, mixed-case words and initials ("E.")
/// keep their capitalization.
fn sentence_case(pieces: Vec<Piece>) -> Vec<Piece> {
    let mut at_start = true;
    pieces
        .into_iter()
        .map(|piece| match piece {
            Piece::Text { text, protected: true } => {
                if text.chars().any(|c| !c.is_whitespace()) {
                    at_start = false;
                }
                Piece::Text { text, protected: true }
            }
            Piece::Text { text, protected: false } => {
                let mut out = String::with_capacity(text.len());
                let mut word = String::new();
                for c in text.chars() {
                    if c.is_whitespace() {
                        out.push_str(&convert_word(&word, &mut at_start));
                        word.clear();
                        out.push(c);
                    } else {
                        word.push(c);
                    }
                }
                out.push_str(&convert_word(&word, &mut at_start));
                Piece::Text {
                    text: out,
                    protected: false,
                }
            }
            tag => tag,
        })
        .collect()
}

fn convert_word(word: &str, at_start: &mut bool) -> String {
    if word.is_empty() {
        return String::new();
    }
    let start = *at_start;
    *at_start = word.ends_with([':', '?', '!']);
    let mut first_part = true;
    word.split('-')
        .map(|part| {
            let keep = (start && first_part) || !is_plain_capitalized(part);
            first_part = false;
            if keep { part.to_string() } else { lowercase_first(part) }
        })
        .collect::<Vec<_>>()
        .join("-")
}

/// "Memory" or "A": one capital followed only by lowercase letters. Initials
/// such as "E." are excluded.
fn is_plain_capitalized(part: &str) -> bool {
    let mut letters = part.chars().filter(|c| c.is_alphabetic());
    let Some(first) = letters.next() else { return false };
    if !first.is_uppercase() || !part.starts_with(first) {
        return false;
    }
    let rest_lower = letters.all(char::is_lowercase);
    let is_initial = part.chars().filter(|c| c.is_alphabetic()).count() == 1 && part.ends_with('.');
    rest_lower && !is_initial
}

fn lowercase_first(part: &str) -> String {
    let mut chars = part.chars();
    chars
        .next()
        .map(|c| c.to_lowercase().chain(chars).collect())
        .unwrap_or_default()
}

/// Render pieces as CSL rich text, escaping markup characters in text.
fn render(pieces: &[Piece]) -> String {
    let mut out = String::new();
    for piece in pieces {
        match piece {
            Piece::Text { text, .. } => {
                for c in text.chars() {
                    match c {
                        '&' => out.push_str("&amp;"),
                        '<' => out.push_str("&lt;"),
                        '>' => out.push_str("&gt;"),
                        c => out.push(c),
                    }
                }
            }
            Piece::Tag(tag) => out.push_str(tag),
        }
    }
    let out = out.replace("<span class=\"nocase\"></span>", "");
    clean(&out)
}

// ---------- Small helpers ----------

/// Remove TeX command names (keeping arguments) and braces, for plain fields.
fn strip_tex(text: &str) -> String {
    let mut pieces = Vec::new();
    tex_pieces(text, false, &mut pieces);
    pieces
        .into_iter()
        .filter_map(|p| match p {
            Piece::Text { text, .. } => Some(text),
            Piece::Tag(_) => None,
        })
        .collect()
}

/// Collapse internal whitespace (BibTeX values often span lines).
fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// English text for the BibLaTeX type keys that describe theses and reports.
fn readable_genre(key: &str) -> Option<&'static str> {
    Some(match key.to_ascii_lowercase().as_str() {
        "phdthesis" => "PhD thesis",
        "mathesis" | "mastersthesis" => "Master's thesis",
        "candthesis" => "Candidate thesis",
        "techreport" => "Technical report",
        "resreport" => "Research report",
        "software" => "Computer software",
        "datacd" => "CD-ROM",
        "audiocd" => "Audio CD",
        _ => return None,
    })
}

/// Map a BibTeX/BibLaTeX entry type to the closest CSL item type.
pub fn csl_type(kind: &str) -> &'static str {
    match kind {
        "article" => "article-journal",
        "book" | "mvbook" | "proceedings" | "mvproceedings" | "collection" | "mvcollection" | "booklet" | "manual" => {
            "book"
        }
        "inbook" | "incollection" | "bookinbook" | "suppbook" | "suppcollection" => "chapter",
        "inproceedings" | "conference" => "paper-conference",
        "thesis" | "phdthesis" | "mastersthesis" => "thesis",
        "report" | "techreport" => "report",
        "online" | "www" | "electronic" => "webpage",
        "dataset" => "dataset",
        "software" => "software",
        "patent" => "patent",
        "unpublished" => "manuscript",
        _ => "document",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn title(chunks: &[Chunk], english: bool) -> String {
        let pieces = pieces_from_chunks(chunks.iter());
        render(&if english { sentence_case(pieces) } else { pieces })
    }

    #[test]
    fn sentence_case_keeps_protected_words_acronyms_and_initials() {
        let chunks = [
            Chunk::Normal("Using ".into()),
            Chunk::Verbatim("iPhone".into()),
            Chunk::Normal(" Apps for DNA Repair in E. coli: A Self-Supervised Review".into()),
        ];
        assert_eq!(
            title(&chunks, true),
            "Using <span class=\"nocase\">iPhone</span> apps for DNA repair in E. coli: A self-supervised review"
        );
    }

    #[test]
    fn formatting_commands_become_tags_and_non_english_is_unchanged() {
        let chunks = [
            Chunk::Normal("The Role of ".into()),
            Chunk::Verbatim("\\emph{in vivo}".into()),
            Chunk::Normal(" and \\textit{In Vitro} Tests".into()),
        ];
        assert_eq!(
            title(&chunks, true),
            "The role of <span class=\"nocase\"><i>in vivo</i></span> and <i>in vitro</i> tests"
        );
        assert_eq!(
            title(&[Chunk::Normal("Schlaf und Gedächtnis".into())], false),
            "Schlaf und Gedächtnis"
        );
    }

    #[test]
    fn markup_characters_in_titles_are_escaped() {
        assert_eq!(
            title(&[Chunk::Normal("Less <Than> & More".into())], false),
            "Less &lt;Than&gt; &amp; More"
        );
    }

    #[test]
    fn braced_names_are_detected_per_name() {
        assert_eq!(
            braced_names("{World Health Organization} and van der Berg, Jan AND {A} {B}"),
            [true, false, false]
        );
        assert_eq!(braced_names("Παπαδόπουλος, Νίκος and Ανδρέας"), [false, false]);
    }

    #[test]
    fn lenient_dates_report_what_was_dropped() {
        assert_eq!(
            lenient_date("2021-02-31"),
            Some((
                PartialDate {
                    year: 2021,
                    month: Some(2),
                    day: None
                },
                false
            ))
        );
        assert_eq!(lenient_date("2020-13-45x"), Some((PartialDate::year(2020), false)));
        assert_eq!(lenient_date("sometime"), None);
        assert_eq!(
            lenient_date("2024-02-29").map(|(d, ok)| (d.day, ok)),
            Some((Some(29), true))
        );
    }
}
