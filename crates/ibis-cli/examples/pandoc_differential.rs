//! Bounded engineering runner, intentionally outside the public CLI contract.
#[path = "../tests/support/pandoc.rs"]
mod pandoc;

use std::collections::BTreeSet;
use std::path::Path;

use ibis_core::cite::{self, CiteItem, KeyFormat};
use ibis_core::{bibtex, library};
use serde_json::{Value, json};

fn fields(expected: &Value, actual: &Value, path: &str, output: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: BTreeSet<_> = a.keys().chain(b.keys()).collect();
            for key in keys {
                let nested = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                match (a.get(key), b.get(key)) {
                    (Some(a), Some(b)) => fields(a, b, &nested, output),
                    (Some(_), None) => output.push(format!("missing:{nested}")),
                    (None, Some(_)) => output.push(format!("extra:{nested}")),
                    _ => {}
                }
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                fields(a, b, &format!("{path}[{index}]"), output);
            }
        }
        _ if expected != actual => output.push(format!("value:{path}")),
        _ => {}
    }
}

fn run(input: &Path, directory: &Path) -> Result<Value, String> {
    if std::fs::metadata(input).map_err(|_| "cannot stat input")?.len() > 16_384 {
        return Err("input exceeds 16 KiB".into());
    }
    std::fs::create_dir_all(directory).map_err(|_| "cannot create run directory")?;
    let input_path = std::fs::canonicalize(input).map_err(|_| "cannot resolve input")?;
    let output_path = std::fs::canonicalize(directory).map_err(|_| "cannot resolve output directory")?;
    if input_path.parent() == Some(output_path.as_path()) {
        return Err("output directory must differ from the input directory".into());
    }
    let source = std::fs::read(input).map_err(|_| "cannot read input")?;
    if std::str::from_utf8(&source).is_err() {
        return Ok(json!({"entries":0, "unrenderable":true, "warnings":0, "differences":[]}));
    }
    let bibliography = directory.join("original.bib");
    std::fs::write(&bibliography, &source).map_err(|_| "cannot write original bibliography")?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let loaded = bibtex::load_str("differential", &String::from_utf8_lossy(&source));
    if loaded.references.len() > 64 {
        return Ok(
            json!({"entries":0, "unrenderable":false, "warnings":loaded.warnings.len(), "over_limit":true, "differences":[]}),
        );
    }
    let exported = library::csl_items(loaded.references.iter()).map_err(|_| "CSL export rejected identities")?;
    let json_path = directory.join("ibis.json");
    std::fs::write(
        &json_path,
        serde_json::to_vec(&exported).map_err(|_| "cannot encode export")?,
    )
    .map_err(|_| "cannot write export")?;
    let (accepted, parsed) = pandoc::invoke(
        &[
            "-f".as_ref(),
            "biblatex".as_ref(),
            "-t".as_ref(),
            "csljson".as_ref(),
            bibliography.as_os_str(),
        ],
        directory,
        "parse",
    )?;
    let expected: Vec<Value> = if accepted {
        serde_json::from_str(&parsed).map_err(|_| "Pandoc returned invalid CSL-JSON")?
    } else {
        vec![]
    };
    let keys: BTreeSet<String> = exported
        .iter()
        .chain(&expected)
        .filter_map(|item| item["id"].as_str().map(str::to_string))
        .collect();
    if keys.len() > 64 {
        return Ok(
            json!({"entries":0, "unrenderable":false, "warnings":loaded.warnings.len(), "over_limit":true, "differences":[]}),
        );
    }
    let mut differences = vec![];
    let mut compared = 0;
    let mut unrenderable_entries = 0;
    for key in keys {
        if std::time::Instant::now() >= deadline {
            return Err("input comparison exceeded twenty-second budget".into());
        }
        let original = expected.iter().find(|item| item["id"] == key);
        let actual = exported.iter().find(|item| item["id"] == key);
        let item_type = original
            .or(actual)
            .and_then(|item| item["type"].as_str())
            .unwrap_or("unknown");
        let doc = directory.join("document.md");
        let rendered = match cite::render(
            KeyFormat::Pandoc,
            &[CiteItem {
                key: key.clone(),
                ..CiteItem::default()
            }],
        ) {
            Ok(rendered) => rendered,
            Err(_) => {
                unrenderable_entries += 1;
                continue;
            }
        };
        let cite = serde_json::to_string(&rendered.text).map_err(|_| "cannot encode citation")?;
        std::fs::write(&doc, format!("---\nnocite: {cite}\n---\n")).map_err(|_| "cannot write document")?;
        let (original_ok, original_rendering) = pandoc::render_attempt(&bibliography, &doc, directory, "original")?;
        let (actual_ok, actual_rendering) = pandoc::render_attempt(&json_path, &doc, directory, "exported")?;
        if !original_ok && !actual_ok {
            unrenderable_entries += 1;
            continue;
        }
        compared += 1;
        if !original_ok || !actual_ok || original_rendering != actual_rendering {
            let mut changed = vec![];
            let kind = if !accepted || original.is_none() || actual.is_none() {
                changed.push(
                    if actual.is_none() {
                        "missing:entry"
                    } else {
                        "extra:entry"
                    }
                    .into(),
                );
                "parser"
            } else {
                fields(
                    original.unwrap_or(&Value::Null),
                    actual.unwrap_or(&Value::Null),
                    "",
                    &mut changed,
                );
                "render"
            };
            if !original_ok {
                changed.push("unrenderable:original".into());
            }
            if !actual_ok {
                changed.push("unrenderable:export".into());
            }
            let warnings = pandoc::warnings_for(&loaded.warnings, &key, kind == "parser" && !original_ok);
            let diagnostics = format!(
                "{}\n{}",
                std::fs::read_to_string(directory.join("original.err")).unwrap_or_default(),
                std::fs::read_to_string(directory.join("parse.err")).unwrap_or_default()
            );
            let titles = (
                original.and_then(|item| item["title"].as_str()),
                actual.and_then(|item| item["title"].as_str()),
            );
            let disposition = pandoc::category(
                kind,
                &changed,
                &warnings,
                (original_ok, actual_ok),
                &diagnostics,
                titles,
            );
            differences.push(
                json!({"kind":kind, "disposition":disposition, "key":key, "entry_type":item_type, "fields":changed,
                "bib_rendering":original_rendering, "ibis_rendering":actual_rendering}),
            );
        }
    }
    Ok(
        json!({"entries":compared, "unrenderable":expected.is_empty() && loaded.references.is_empty(),
        "unrenderable_entries":unrenderable_entries, "warnings":loaded.warnings.len(), "differences":differences}),
    )
}

#[cfg(not(test))]
fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let result = if args.len() == 3 {
        run(Path::new(&args[1]), Path::new(&args[2]))
    } else {
        Err("usage: pandoc_differential INPUT DIRECTORY".into())
    };
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("Differential runner: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broken_sibling_is_named_recovery_when_pandoc_rejects_the_whole_library() {
        if !std::process::Command::new("pandoc")
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
        {
            assert!(
                std::env::var("IBIS_REQUIRE_PANDOC").is_err(),
                "Pandoc required but missing"
            );
            return;
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("ibis-differential-sibling-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap_or_else(|e| panic!("{e}"));
        let input = directory.join("input.bib");
        std::fs::write(&input, "@book{good,title={Synthetic}}\n@book{broken,title={unclosed")
            .unwrap_or_else(|e| panic!("{e}"));
        let result = run(&input, &directory.join("output")).unwrap_or_else(|e| panic!("{e}"));
        assert!(result["entries"].as_u64().is_some_and(|entries| entries >= 1));
        for difference in result["differences"].as_array().into_iter().flatten() {
            assert_eq!(difference["disposition"], "warned-parser-recovery");
        }
        std::fs::remove_dir_all(directory).unwrap_or_else(|e| panic!("{e}"));
    }

    #[test]
    fn parenthesized_input_is_rendered_or_named_as_a_known_pandoc_limit() {
        if !std::process::Command::new("pandoc")
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
        {
            assert!(
                std::env::var("IBIS_REQUIRE_PANDOC").is_err(),
                "Pandoc required but missing"
            );
            return;
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("ibis-differential-paren-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap_or_else(|e| panic!("{e}"));
        let input = directory.join("input.bib");
        std::fs::write(&input, "@article(x,title={Synthetic})").unwrap_or_else(|e| panic!("{e}"));
        let result = run(&input, &directory.join("output")).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(result["entries"], 1);
        for difference in result["differences"].as_array().into_iter().flatten() {
            assert_eq!(difference["disposition"], "pandoc-parenthesis-rejection");
        }
        std::fs::remove_dir_all(directory).unwrap_or_else(|e| panic!("{e}"));
    }

    #[test]
    fn output_never_overwrites_a_source_in_the_same_directory() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("ibis-differential-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap_or_else(|e| panic!("{e}"));
        let input = directory.join("original.bib");
        let source = b"@book{x,title={Synthetic}}";
        std::fs::write(&input, source).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            run(&input, &directory),
            Err("output directory must differ from the input directory".into())
        );
        assert_eq!(std::fs::read(&input).unwrap_or_default(), source);
        std::fs::remove_dir_all(directory).unwrap_or_else(|e| panic!("{e}"));
    }

    #[test]
    fn changed_paths_distinguish_missing_fields_and_name_parts() {
        let mut changed = vec![];
        fields(
            &json!({"title":"x", "author":[{"family":"A", "given":"B"}]}),
            &json!({"author":[{"family":"C", "given":"B"}]}),
            "",
            &mut changed,
        );
        assert_eq!(changed, ["value:author[0].family", "missing:title"]);
    }
}
