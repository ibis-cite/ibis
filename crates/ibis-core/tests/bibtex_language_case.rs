//! Capture the case-insensitive language-tag regression in #331.

use ibis_core::bibtex::load_str;

#[test]
#[ignore = "#331: English language tag case changes title casing"]
fn english_language_tag_case_does_not_change_title_conversion() {
    let loaded = load_str(
        "synthetic.bib",
        "@book{a,title={The Second Title},langid={EN-US}}\n@book{b,title={The Second Title},langid={en-US}}",
    );
    assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
    assert_eq!(loaded.references.len(), 2);
    assert_eq!(loaded.references[1].title_plain().as_deref(), Some("The second title"));
    assert_eq!(loaded.references[0].title_plain().as_deref(), Some("The second title"));
}
