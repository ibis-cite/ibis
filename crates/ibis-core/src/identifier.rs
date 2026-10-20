//! Recognize DOIs, PubMed IDs, ISBNs and arXiv IDs, so pasting one finds the
//! record that carries it.
//!
//! Each identifier is reduced to one canonical form: DOIs lowercase without a
//! resolver prefix, ISBNs as 13 digits, arXiv IDs lowercase without a version,
//! PubMed IDs as digits. Recognition is strict (checksums, fixed shapes and
//! explicit prefixes), so ordinary search words are never taken for one.

use crate::model::Reference;

/// A recognized identifier in canonical form.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Identifier {
    Doi(String),
    Isbn(String),
    Arxiv(String),
    Pmid(String),
}

/// The identifier a whole search query consists of, if it is one. Bare
/// numbers are not taken for PubMed IDs, because they are usually years or
/// pages; `pmid:` or a PubMed link is needed.
pub fn parse_query(query: &str) -> Option<Identifier> {
    let q = query.trim().trim_end_matches(['.', ',', ';', ')', ']', '>']);
    if q.is_empty() {
        return None;
    }
    doi(q)
        .map(Identifier::Doi)
        .or_else(|| arxiv(q).map(Identifier::Arxiv))
        .or_else(|| pmid(q).map(Identifier::Pmid))
        .or_else(|| isbn(q).map(Identifier::Isbn))
}

/// Every identifier a record carries, from its DOI, link and identifier
/// fields, without duplicates.
pub fn of_reference(r: &Reference) -> Vec<Identifier> {
    let mut ids = Vec::new();
    if let Some(d) = r.doi.as_deref().and_then(doi) {
        if let Some(a) = d.strip_prefix("10.48550/arxiv.") {
            ids.extend(arxiv(a).map(Identifier::Arxiv));
        }
        ids.push(Identifier::Doi(d));
    }
    if let Some(url) = r.url.as_deref() {
        ids.extend(doi(url).map(Identifier::Doi));
        ids.extend(arxiv(url).map(Identifier::Arxiv));
        ids.extend(pmid(url).map(Identifier::Pmid));
    }
    for (name, value) in &r.variables {
        match name.as_str() {
            "ISBN" => ids.extend(value.split([',', ';', ' ']).filter_map(isbn).map(Identifier::Isbn)),
            "PMID" => ids.extend(digits(value.trim()).map(Identifier::Pmid)),
            "number" | "archive_location" => ids.extend(arxiv_prefixed(value.trim()).map(Identifier::Arxiv)),
            _ => {}
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

fn strip_link<'a>(text: &'a str, hosts: &[&str]) -> Option<&'a str> {
    let rest = ["https://", "http://", ""]
        .iter()
        .find_map(|s| strip_prefix_ci(text, s))?;
    let rest = strip_prefix_ci(rest, "www.").unwrap_or(rest);
    hosts.iter().find_map(|h| strip_prefix_ci(rest, h))
}

fn doi(text: &str) -> Option<String> {
    let text = text.trim();
    let body = strip_link(text, &["doi.org/", "dx.doi.org/"])
        .or_else(|| strip_prefix_ci(text, "doi:"))
        .unwrap_or(text)
        .trim();
    let (prefix, suffix) = body.split_once('/')?;
    let registrant = prefix.strip_prefix("10.")?;
    let valid = registrant.len() >= 4
        && registrant.chars().all(|c| c.is_ascii_digit() || c == '.')
        && !suffix.is_empty()
        && !suffix.chars().any(char::is_whitespace);
    valid.then(|| body.to_lowercase())
}

fn arxiv(text: &str) -> Option<String> {
    let text = text.trim();
    if let Some(path) = strip_link(text, &["arxiv.org/abs/", "arxiv.org/pdf/"]) {
        return arxiv_id(path.trim_end_matches(".pdf"));
    }
    arxiv_prefixed(text).or_else(|| arxiv_id(text).filter(|_| text.contains('.') && !text.contains('/')))
}

fn arxiv_prefixed(text: &str) -> Option<String> {
    arxiv_id(strip_prefix_ci(text, "arxiv:")?.trim())
}

/// New-style `2101.00001v2` or old-style `hep-th/9901001`, version dropped.
fn arxiv_id(text: &str) -> Option<String> {
    let id = text.to_lowercase();
    let id = match id.rsplit_once('v') {
        Some((base, version)) if !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()) => base.to_string(),
        _ => id,
    };
    let new_style = id.split_once('.').is_some_and(|(month, number)| {
        month.len() == 4
            && month.chars().all(|c| c.is_ascii_digit())
            && (4..=5).contains(&number.len())
            && number.chars().all(|c| c.is_ascii_digit())
    });
    let old_style = id.split_once('/').is_some_and(|(archive, number)| {
        !archive.is_empty()
            && archive.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c == '.')
            && number.len() == 7
            && number.chars().all(|c| c.is_ascii_digit())
    });
    (new_style || old_style).then_some(id)
}

fn pmid(text: &str) -> Option<String> {
    let text = text.trim();
    let body = strip_link(text, &["pubmed.ncbi.nlm.nih.gov/", "ncbi.nlm.nih.gov/pubmed/"])
        .map(|p| p.trim_end_matches('/'))
        .or_else(|| strip_prefix_ci(text, "pmid:").map(str::trim))
        .or_else(|| strip_prefix_ci(text, "pmid ").map(str::trim))?;
    digits(body)
}

fn digits(text: &str) -> Option<String> {
    let valid = (1..=9).contains(&text.len()) && text.chars().all(|c| c.is_ascii_digit());
    valid
        .then(|| text.trim_start_matches('0').to_string())
        .filter(|d| !d.is_empty())
}

/// An ISBN-10 or ISBN-13 with a valid check digit, as 13 digits.
fn isbn(text: &str) -> Option<String> {
    let text = text.trim();
    let body = strip_prefix_ci(text, "isbn-13:")
        .or_else(|| strip_prefix_ci(text, "isbn-10:"))
        .or_else(|| strip_prefix_ci(text, "isbn:"))
        .or_else(|| strip_prefix_ci(text, "isbn"))
        .unwrap_or(text);
    if body
        .chars()
        .any(|c| !(c.is_ascii_digit() || matches!(c, '-' | ' ' | 'x' | 'X')))
    {
        return None;
    }
    let chars: Vec<char> = body.chars().filter(|c| !matches!(c, '-' | ' ')).collect();
    let value = |c: &char| {
        if matches!(c, 'x' | 'X') {
            10
        } else {
            c.to_digit(10).unwrap_or(0)
        }
    };
    match chars.len() {
        10 if chars[..9].iter().all(char::is_ascii_digit) => {
            let sum: u32 = chars.iter().enumerate().map(|(i, c)| (10 - i as u32) * value(c)).sum();
            if !sum.is_multiple_of(11) {
                return None;
            }
            let mut digits: String = "978".chars().chain(chars[..9].iter().copied()).collect();
            let check = (10 - isbn13_sum(&digits) % 10) % 10;
            digits.push(char::from_digit(check, 10)?);
            Some(digits)
        }
        13 if chars.iter().all(char::is_ascii_digit) && body.chars().filter(char::is_ascii_digit).count() == 13 => {
            let digits: String = chars.iter().collect();
            (matches!(&digits[..3], "978" | "979")
                && (isbn13_sum(&digits[..12]) + value(&chars[12])).is_multiple_of(10))
            .then_some(digits)
        }
        _ => None,
    }
}

fn isbn13_sum(digits: &str) -> u32 {
    digits
        .chars()
        .filter_map(|c| c.to_digit(10))
        .enumerate()
        .map(|(i, d)| if i % 2 == 0 { d } else { 3 * d })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_in_common_written_forms_are_recognized() {
        let doi = Some(Identifier::Doi("10.1000/xyz.123".into()));
        for q in [
            "10.1000/XYZ.123",
            "doi:10.1000/xyz.123",
            "https://doi.org/10.1000/xyz.123",
            "http://dx.doi.org/10.1000/xyz.123.",
            " DOI:10.1000/xyz.123 ",
        ] {
            assert_eq!(parse_query(q), doi, "{q}");
        }
        let arxiv = Some(Identifier::Arxiv("2101.00001".into()));
        for q in [
            "2101.00001",
            "arXiv:2101.00001v3",
            "https://arxiv.org/abs/2101.00001v2",
            "arxiv.org/pdf/2101.00001.pdf",
        ] {
            assert_eq!(parse_query(q), arxiv, "{q}");
        }
        assert_eq!(
            parse_query("arXiv:hep-th/9901001"),
            Some(Identifier::Arxiv("hep-th/9901001".into()))
        );
        let pmid = Some(Identifier::Pmid("12345678".into()));
        for q in [
            "PMID:12345678",
            "pmid 12345678",
            "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        ] {
            assert_eq!(parse_query(q), pmid, "{q}");
        }
        let isbn = Some(Identifier::Isbn("9780306406157".into()));
        for q in [
            "978-0-306-40615-7",
            "0-306-40615-2",
            "ISBN 0306406152",
            "isbn:978 0 306 40615 7",
        ] {
            assert_eq!(parse_query(q), isbn, "{q}");
        }
    }

    #[test]
    fn ordinary_search_words_are_not_identifiers() {
        for q in [
            "",
            "2021",
            "12345678",
            "smith2020",
            "sleep memory",
            "10.5",
            "10.1000/",
            "1.2",
            "978-0-306-40615-8",
            "0-306-40615-3",
            "9790306406157x",
            "2101.001",
            "pmid:",
            "pmid:abc",
            "doi:10.1000/a b",
        ] {
            assert_eq!(parse_query(q), None, "{q:?}");
        }
    }

    #[test]
    fn hostile_text_never_panics() {
        for q in [
            "ü",
            "doi:",
            "https://",
            "arxiv:",
            "isbnü",
            "10.ü/ü",
            "pmid:٣٣",
            "x".repeat(10_000).as_str(),
        ] {
            let _ = parse_query(q);
        }
    }

    #[test]
    fn records_expose_identifiers_from_every_field() {
        let r = &crate::bibtex::load_str(
            "t",
            "@book{a, title={T}, doi={https://doi.org/10.48550/arXiv.2101.00001},
              url={https://pubmed.ncbi.nlm.nih.gov/0012345/}, isbn={0-306-40615-2, 9780306406157},
              number={arXiv:2101.00001}}",
        )
        .references[0];
        assert_eq!(
            of_reference(r),
            [
                Identifier::Doi("10.48550/arxiv.2101.00001".into()),
                Identifier::Isbn("9780306406157".into()),
                Identifier::Arxiv("2101.00001".into()),
                Identifier::Pmid("12345".into()),
            ]
        );
    }
}
