//! A locator typed at the end of a search, as in `smith 2020 p 45` or
//! `garcia, 12-14`.
//!
//! Only two forms are read, so a plain search is never changed by guesswork:
//! a locator label followed by a value (`p 45`, `chap. 3`, `§ 2`), or a value
//! after a comma (`garcia, 12-14`, read as pages). A lone four-digit number
//! after a comma is left as search text, since it is most likely a year. The
//! caller shows what was read (`typed`) so the person can undo it.

use crate::cite::{Locator, LocatorLabel};

/// A search with a locator split off its end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatorQuery {
    /// What remains to search for.
    pub search: String,
    pub locator: Locator,
    /// The text read as the locator, exactly as typed.
    pub typed: String,
}

/// Longer text is searched as written; no locator is that long.
const MAX_LOCATOR_LEN: usize = 64;

/// Split a trailing locator off `query`, or `None` when there is none or
/// nothing would be left to search for.
pub fn split(query: &str) -> Option<LocatorQuery> {
    let q = query.trim_end();
    let floor = q.len().saturating_sub(MAX_LOCATOR_LEN);
    let mut previous = None;
    for (i, c) in q.char_indices() {
        let starts_word = !c.is_whitespace() && matches!(previous, Some(p) if p == ',' || char::is_whitespace(p));
        previous = Some(c);
        if i < floor || !starts_word {
            continue;
        }
        let search = q[..i].trim_end();
        let after_comma = search.ends_with(',');
        let search = search.trim_end_matches(',').trim_end();
        if search.is_empty() {
            continue;
        }
        let tail = &q[i..];
        if let Some(locator) = read(tail, after_comma) {
            return Some(LocatorQuery {
                search: search.to_string(),
                locator,
                typed: tail.to_string(),
            });
        }
    }
    None
}

/// Read `tail` as a whole locator.
fn read(tail: &str, after_comma: bool) -> Option<Locator> {
    if let Some((label, rest)) = label(tail) {
        let value = rest.trim();
        return is_value(value, true).then(|| Locator {
            label,
            value: value.to_string(),
        });
    }
    let year = tail.len() == 4 && tail.bytes().all(|b| b.is_ascii_digit());
    (after_comma && !year && is_value(tail, false)).then(|| Locator {
        label: LocatorLabel::Page,
        value: tail.to_string(),
    })
}

/// A label word at the start of `text`, and the text after it.
fn label(text: &str) -> Option<(LocatorLabel, &str)> {
    for sign in ["§§", "§", "¶"] {
        if let Some(rest) = text.strip_prefix(sign) {
            let kind = if sign == "¶" {
                LocatorLabel::Paragraph
            } else {
                LocatorLabel::Section
            };
            return Some((kind, rest));
        }
    }
    let end = text.find(|c: char| !c.is_alphabetic()).unwrap_or(text.len());
    let kind = match text[..end].to_lowercase().as_str() {
        "p" | "pp" | "pg" | "pgs" | "page" | "pages" => LocatorLabel::Page,
        "ch" | "chap" | "chaps" | "chapter" | "chapters" => LocatorLabel::Chapter,
        "sec" | "sect" | "secs" | "section" | "sections" => LocatorLabel::Section,
        "para" | "paras" | "paragraph" | "paragraphs" => LocatorLabel::Paragraph,
        "fig" | "figs" | "figure" | "figures" => LocatorLabel::Figure,
        "l" | "ll" | "line" | "lines" => LocatorLabel::Line,
        "n" | "nn" | "fn" | "note" | "notes" => LocatorLabel::Note,
        "vol" | "vols" | "volume" | "volumes" => LocatorLabel::Volume,
        "v" | "vv" | "verse" | "verses" => LocatorLabel::Verse,
        _ => return None,
    };
    let rest = &text[end..];
    let rest = rest.strip_prefix('.').unwrap_or(rest);
    // The label must be its own word: `p45` is not read, `p 45` and `p.45` are.
    (rest.starts_with(char::is_whitespace) || end < text.len() && text[end..].starts_with('.')).then_some((kind, rest))
}

/// One or more numbers or ranges separated by commas or `&`, such as
/// `12`, `24-26`, `3, 7 & 9a`. Roman numerals count only after a label.
fn is_value(text: &str, roman: bool) -> bool {
    !text.is_empty() && text.split([',', '&']).all(|item| is_range(item.trim(), roman))
}

fn is_range(item: &str, roman: bool) -> bool {
    let mut parts = item.split(['-', '–', '—']);
    let first = parts.next().unwrap_or("");
    let second = parts.next();
    parts.next().is_none() && is_number(first.trim(), roman) && second.is_none_or(|s| is_number(s.trim(), roman))
}

/// `45`, `45a`, or with `roman` also `xii`.
fn is_number(text: &str, roman: bool) -> bool {
    let digits = text.bytes().take_while(u8::is_ascii_digit).count();
    let rest = &text[digits..];
    if digits > 0 {
        return digits <= 9 && rest.len() <= 1 && rest.bytes().all(|b| b.is_ascii_alphabetic());
    }
    roman && !text.is_empty() && text.len() <= 8 && text.chars().all(|c| "ivxlcdmIVXLCDM".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(query: &str) -> Option<(String, LocatorLabel, String)> {
        split(query).map(|q| (q.search, q.locator.label, q.locator.value))
    }

    fn page(search: &str, value: &str) -> Option<(String, LocatorLabel, String)> {
        Some((search.into(), LocatorLabel::Page, value.into()))
    }

    #[test]
    fn a_labelled_locator_is_split_off() {
        assert_eq!(read("smith 2020 p 45"), page("smith 2020", "45"));
        assert_eq!(read("smith 2020 p. 45"), page("smith 2020", "45"));
        assert_eq!(read("smith 2020 p.45"), page("smith 2020", "45"));
        assert_eq!(read("Smith PP 12–14"), page("Smith", "12–14"));
        assert_eq!(read("smith pages 3, 7 & 9a"), page("smith", "3, 7 & 9a"));
        assert_eq!(read("smith, p 45  "), page("smith", "45"));
        assert_eq!(read("kant chap. 3").map(|r| r.1), Some(LocatorLabel::Chapter));
        assert_eq!(read("kant § 2").map(|r| r.1), Some(LocatorLabel::Section));
        assert_eq!(
            read("kant §2-4").map(|r| (r.1, r.2)),
            Some((LocatorLabel::Section, "2-4".into()))
        );
        assert_eq!(read("kant ¶ 12").map(|r| r.1), Some(LocatorLabel::Paragraph));
        assert_eq!(read("bible vv 3-5").map(|r| r.1), Some(LocatorLabel::Verse));
        assert_eq!(read("collected vol 2").map(|r| r.1), Some(LocatorLabel::Volume));
        assert_eq!(read("preface p xii"), page("preface", "xii"));
    }

    #[test]
    fn a_value_after_a_comma_is_read_as_pages() {
        assert_eq!(read("garcia, 12-14"), page("garcia", "12-14"));
        assert_eq!(read("garcia 2019, 7"), page("garcia 2019", "7"));
        assert_eq!(read("garcia,12"), page("garcia", "12"));
    }

    #[test]
    fn plain_searches_are_left_alone() {
        for query in [
            "smith 2020",
            "smith, 2020",
            "garcia 12-14",
            "p 45",
            ", 12",
            "smith p45",
            "smith p",
            "smith, xii",
            "trains, planes",
            "vitamin d",
            "smith p 45 onwards",
            "smith p 1-2-3",
            "smith p 1234567890",
            "",
        ] {
            assert_eq!(split(query), None, "{query}");
        }
    }

    #[test]
    fn the_typed_text_is_kept_for_undo() {
        let q = split("smith 2020 chap. 3").map(|q| (q.search, q.typed));
        assert_eq!(q, Some(("smith 2020".into(), "chap. 3".into())));
    }

    #[test]
    fn any_text_is_handled_without_panicking() {
        for query in [
            "§",
            "日本 p 4",
            "ü, 1",
            "a ¶",
            "x §§ 1",
            &"9, ".repeat(10_000),
            &"a ".repeat(10_000),
        ] {
            let _ = split(query);
        }
        assert_eq!(read("日本 p 4"), page("日本", "4"));
    }
}
