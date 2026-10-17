//! Regression tests for import correctness: each case once lost or changed
//! bibliographic meaning.

use ibis_core::bibtex::load_str;
use ibis_core::model::{LoadResult, Reference};

fn load(src: &str) -> LoadResult {
    load_str("t", src)
}

fn only(result: &LoadResult, key: &str) -> Reference {
    result
        .references
        .iter()
        .find(|r| r.id.native_key == key)
        .cloned()
        .unwrap_or_else(|| panic!("`{key}` not loaded; warnings: {:?}", result.warnings))
}

fn warned(result: &LoadResult, needle: &str) -> bool {
    result.warnings.iter().any(|w| w.message.contains(needle))
}

#[test]
fn quoted_parentheses_keep_the_record() {
    let r = load("@book(q, title = \"Notes (draft) on sleep\", year = 2020)\n@book{after, title={After}}");
    assert_eq!(only(&r, "q").title_plain().as_deref(), Some("Notes (draft) on sleep"));
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
}

#[test]
fn indented_records_after_damage_are_kept() {
    let r = load("@article{broken, title={Unclosed}\n  @article{indented, title={Indented}}\n");
    only(&r, "indented");
    assert_eq!(r.warnings.len(), 1);
}

#[test]
fn chained_macros_keep_every_part() {
    let r = load("@string{a = \"Alpha\"}\n@string{b = a # \" Beta\"}\n@article{m, title={T}, journal = b}");
    assert_eq!(only(&r, "m").container_title.as_deref(), Some("Alpha Beta"));
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
}

#[test]
fn nested_inheritance_reaches_the_grandparent() {
    let r = load(
        "@proceedings{c, title={Grand}, year={2019}, publisher={P}}\n@proceedings{b, title={Mid}, crossref={c}}\n@inproceedings{a, title={Leaf}, crossref={b}}",
    );
    let a = only(&r, "a");
    assert_eq!(a.year(), Some(2019));
    assert_eq!(a.variables.get("publisher").map(String::as_str), Some("P"));
}

#[test]
fn missing_cross_reference_target_is_reported() {
    let r = load("@inproceedings{a, title={T}, crossref={nowhere}}");
    only(&r, "a");
    assert!(warned(&r, "nowhere"));
}

#[test]
fn equivalent_dates_in_any_script_give_the_same_result() {
    let latin = load("@article{d, title={T}, year={2020}, month=mar}");
    let bengali = load("@article{d, title={T}, year={২০২০}, month=mar}");
    assert_eq!(only(&latin, "d").issued, only(&bengali, "d").issued);
    assert_eq!(only(&bengali, "d").issued.and_then(|i| i.start.month), Some(3));
}

#[test]
fn invalid_or_unreadable_dates_are_reported_not_silently_changed() {
    let r = load(
        "@book{feb, title={T}, date={2021-02-31}}\n@book{junk, title={T}, date={2020-13-45x}}\n@book{none, title={T}, date={sometime}}",
    );
    assert_eq!(
        only(&r, "feb").issued.map(|i| (i.start.month, i.start.day)),
        Some((Some(2), None))
    );
    assert_eq!(only(&r, "junk").year(), Some(2020));
    assert_eq!(only(&r, "none").issued, None);
    assert_eq!(r.warnings.len(), 3, "{:?}", r.warnings);
}

#[test]
fn ranges_and_approximate_dates_are_kept() {
    let r = load("@book{range, title={T}, date={2019/2021}}\n@book{circa, title={T}, date={2020-03~}}");
    let range = only(&r, "range").issued.unwrap_or_else(|| panic!("no date"));
    assert_eq!(range.end.map(|e| e.year), Some(2021));
    assert!(only(&r, "circa").issued.is_some_and(|i| i.circa));
}

#[test]
fn and_others_marks_a_truncated_list_instead_of_an_author() {
    let r = only(&load("@article{o, author={Smith, Alex and others}, title={T}}"), "o");
    assert_eq!(r.authors.len(), 2);
    assert!(r.authors[1].is_others());
    assert_eq!(r.authors[1].display(), "et al.");
    let csl = r.to_csl_json();
    assert_eq!(csl["author"][1]["literal"], "others");
}

#[test]
fn organizations_are_literal_names_and_particles_are_kept() {
    let r = only(
        &load("@book{n, author={{World Health Organization} and van der Berg, Jan and Plato}, title={T}}"),
        "n",
    );
    assert_eq!(r.authors[0].literal.as_deref(), Some("World Health Organization"));
    assert_eq!(r.authors[1].dropping_particle.as_deref(), Some("van der"));
    assert_eq!(r.authors[2].family.as_deref(), Some("Plato"));
}

#[test]
fn language_names_become_bcp47_tags() {
    let r = load(
        "@book{us, title={T}, langid={american}}\n@book{de, title={T}, langid={ngerman}}\n@book{tag, title={T}, langid={pt-BR}}\n@book{odd, title={T}, langid={klingonese}}",
    );
    assert_eq!(only(&r, "us").language.as_deref(), Some("en-US"));
    assert_eq!(only(&r, "de").language.as_deref(), Some("de-DE"));
    assert_eq!(only(&r, "tag").language.as_deref(), Some("pt-BR"));
    assert_eq!(only(&r, "odd").language, None);
    assert!(warned(&r, "klingonese"));
}

#[test]
fn protected_capitalization_survives_into_csl() {
    let r = only(
        &load("@article{p, title={Using {iPhone} Apps for {NASA} Missions}, langid={american}}"),
        "p",
    );
    assert_eq!(
        r.title.as_deref(),
        Some("Using <span class=\"nocase\">iPhone</span> apps for <span class=\"nocase\">NASA</span> missions")
    );
    assert_eq!(r.title_plain().as_deref(), Some("Using iPhone apps for NASA missions"));
}

#[test]
fn non_english_titles_keep_their_capitalization() {
    let r = only(
        &load("@article{g, title={Schlaf und Gedächtnis}, langid={ngerman}}"),
        "g",
    );
    assert_eq!(r.title.as_deref(), Some("Schlaf und Gedächtnis"));
}

#[test]
fn large_libraries_load_in_linear_time() {
    let mut src = String::from("@string{j = \"Journal\"}\n@proceedings{conf, title={Conf}, year={2020}}\n");
    for i in 0..5_000 {
        src.push_str(&format!(
            "@inproceedings{{k{i}, title={{Paper {i}}}, crossref={{conf}}, booktitle = j}}\n"
        ));
    }
    let start = std::time::Instant::now();
    let r = load(&src);
    assert_eq!(r.references.len(), 5_001);
    assert!(start.elapsed().as_secs() < 20, "took {:?}", start.elapsed());
}
