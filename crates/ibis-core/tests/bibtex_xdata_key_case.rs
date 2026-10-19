//! Capture distinct exact-case inheritance keys losing metadata (#344).

use ibis_core::bibtex::load_str;

#[test]
#[ignore = "#344: case-distinct xdata keys lose inherited fields"]
fn case_distinct_xdata_keys_both_supply_their_fields() {
    let loaded = load_str(
        "synthetic.bib",
        "@xdata{A,publisher={First}}\n@xdata{a,note={Second}}\n@book{b,xdata={A,a},title={T}}",
    );
    assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
    assert_eq!(loaded.references.len(), 1);
    assert_eq!(
        loaded.references[0].variables.get("publisher").map(String::as_str),
        Some("First")
    );
    assert_eq!(
        loaded.references[0].variables.get("note").map(String::as_str),
        Some("Second")
    );
}
