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

#[test]
fn shared_ancestors_are_not_cycles() {
    // a inherits from b and c (via crossref and xdata); both inherit from d.
    let r = load(
        "@book{d, title={D}, publisher={Shared}, year={2001}}\n@book{b, title={B}, crossref={d}}\n@book{c, title={C}, xdata={d}}\n@book{a, title={A}, crossref={b}, xdata={c}}",
    );
    assert!(!warned(&r, "cycle"), "{:?}", r.warnings);
    let a = only(&r, "a");
    assert_eq!(a.variables.get("publisher").map(String::as_str), Some("Shared"));
    assert_eq!(a.year(), Some(2001));
}

#[test]
fn escaped_quotes_inside_quoted_values_keep_the_record() {
    let r = load("@book(q, title = \"G\\\"odel (test)\", year = 2020)\n@book{after, title={After}}");
    assert!(only(&r, "q").title_plain().is_some_and(|t| t.contains("del (test)")));
    only(&r, "after");
}

#[test]
fn tex_symbols_and_math_are_kept_not_dropped() {
    let r = load(
        "@article{m, title={The \\ensuremath{\\alpha}-Helix and $\\beta$ Sheets at 37\\,\\textdegree C}, langid={american}}",
    );
    let title = only(&r, "m").title_plain().unwrap_or_default();
    assert!(
        title.contains('α') && title.contains('β') && title.contains('°'),
        "{title}"
    );
}

#[test]
fn unknown_tex_commands_are_reported_not_silently_dropped() {
    let r = load("@article{u, title={A \\frobnicate Title}}");
    assert!(only(&r, "u").title_plain().is_some_and(|t| t.contains("frobnicate")));
    assert!(warned(&r, "frobnicate"));
}

#[test]
fn subtitles_are_part_of_the_title() {
    let r = load(
        "@book{s, title={Sleep}, subtitle={A Very Short Introduction}, langid={american}}\n@article{j, title={T}, journaltitle={Memory}, journalsubtitle={Theory and Practice}}",
    );
    assert_eq!(
        only(&r, "s").title_plain().as_deref(),
        Some("Sleep: A very short introduction")
    );
    assert_eq!(
        only(&r, "j").container_title.as_deref(),
        Some("Memory: Theory and Practice")
    );
}

#[test]
fn uncertain_and_open_ended_dates_are_reported() {
    let r = load(
        "@book{u, title={T}, date={2020?}}\n@book{before, title={T}, date={../2020}}\n@book{after, title={T}, date={2020/..}}",
    );
    for key in ["u", "before", "after"] {
        assert!(
            r.warnings.iter().any(|w| w.key.as_deref() == Some(key)),
            "{key}: {:?}",
            r.warnings
        );
    }
}

#[test]
fn exponential_macro_expansion_is_bounded() {
    let mut src = String::from("@string{m0 = \"xxxxxxxxxxxxxxxx\"}\n");
    for i in 1..=24 {
        src.push_str(&format!("@string{{m{i} = m{} # m{}}}\n", i - 1, i - 1));
    }
    src.push_str("@article{boom, title = m24}\n");
    let start = std::time::Instant::now();
    let r = load(&src);
    assert!(start.elapsed().as_secs() < 5, "took {:?}", start.elapsed());
    let title_len = only(&r, "boom").title.map_or(0, |t| t.len());
    assert!(title_len < 1_000_000, "expanded to {title_len} bytes");
    assert!(warned(&r, "too large"), "{:?}", r.warnings);
}

#[test]
fn block_splitting_scales_linearly() {
    let build = |n: usize| {
        (0..n)
            .map(|i| format!("@misc{{k{i}, title={{T{i}}}}}\n"))
            .collect::<String>()
    };
    let time = |src: &str| {
        (0..3)
            .map(|_| {
                let start = std::time::Instant::now();
                let _ = load(src);
                start.elapsed()
            })
            .min()
            .unwrap_or_default()
    };
    let small = time(&build(2_000));
    let large = time(&build(20_000));
    // Ten times the input may take at most ~25x the time; quadratic growth would be ~100x.
    assert!(large < small * 25, "2k: {small:?}, 20k: {large:?}");
}

#[test]
fn xdata_helpers_supply_fields_but_are_not_references() {
    let r = load(
        "@xdata{shared, publisher={Synthetic Press}, date={2024}}\n@book{work, author={Example, Ada}, title={Synthetic Book}, xdata={shared}}",
    );
    assert_eq!(
        r.references.len(),
        1,
        "{:?}",
        r.references.iter().map(|x| &x.id.native_key).collect::<Vec<_>>()
    );
    let work = only(&r, "work");
    assert_eq!(
        work.variables.get("publisher").map(String::as_str),
        Some("Synthetic Press")
    );
    assert_eq!(work.year(), Some(2024));
}

#[test]
fn a_short_path_still_reaches_ancestors_cut_off_on_a_long_path() {
    let mut src = String::from("@book{a,crossref={c1},xdata={shared}}\n");
    for i in 1..15 {
        src.push_str(&format!("@book{{c{i},crossref={{c{}}}}}\n", i + 1));
    }
    src.push_str("@book{c15,crossref={shared}}\n@book{shared,crossref={grand}}\n@book{grand,year={2024}}\n");
    assert_eq!(only(&load(&src), "a").year(), Some(2024));
}

#[test]
fn translators_and_other_roles_reach_csl() {
    let r = only(
        &load(
            "@book{t, author={Tolstoy, Leo}, translator={Garnett, Constance}, bookauthor={Editor, Book}, title={War and Peace}}",
        ),
        "t",
    );
    let csl = r.to_csl_json();
    assert_eq!(csl["translator"][0]["family"], "Garnett");
    assert_eq!(csl["container-author"][0]["family"], "Editor");
}

#[test]
fn math_superscripts_and_subscripts_are_kept() {
    let r = only(
        &load("@article{m, title={Energy as $mc^2$ and $H_{2}O$}, langid={american}}"),
        "m",
    );
    let title = r.title.unwrap_or_default();
    assert!(title.contains("mc<sup>2</sup>"), "{title}");
    assert!(title.contains("H<sub>2</sub>O"), "{title}");
}

#[test]
fn errors_in_inherited_xdata_fields_are_reported_on_the_consumer() {
    let r = load("@xdata{common,publisher=missing}\n@book{a,title={T},xdata={common}}");
    only(&r, "a");
    assert!(
        r.warnings
            .iter()
            .any(|w| w.key.as_deref() == Some("a") && w.message.contains("missing")),
        "{:?}",
        r.warnings
    );
}

#[test]
fn access_and_original_dates_reach_csl() {
    let r = only(
        &load("@online{web,title={Live Status},urldate={2024-05-06},origdate={1999},url={https://example.org/}}"),
        "web",
    );
    let csl = r.to_csl_json();
    assert_eq!(csl["accessed"]["date-parts"][0], serde_json::json!([2024, 5, 6]));
    assert_eq!(csl["original-date"]["date-parts"][0], serde_json::json!([1999]));
}

#[test]
fn newspaper_and_magazine_articles_keep_their_type() {
    let r = load(
        "@article{news,entrysubtype={newspaper},title={H},journaltitle={Example News},date={2020-03-10}}\n@article{mag,entrysubtype={magazine},title={M},journaltitle={Example Monthly},date={2020-04}}",
    );
    assert_eq!(only(&r, "news").item_type, "article-newspaper");
    assert_eq!(only(&r, "mag").item_type, "article-magazine");
}
