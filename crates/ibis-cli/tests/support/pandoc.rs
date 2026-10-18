//! Shared fidelity rendering and the single allowlist of known Pandoc quirks.
use std::fs::{self, File};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Pandoc's `{\\'\\i}` becomes dotless ı plus an accent instead of í.
/// This is an encoding equivalence, not an ignored bibliographic difference.
pub fn normalize(text: &str) -> String {
    text.replace("ı\u{301}", "í")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Files avoid pipe deadlocks; a timeout bounds each Pandoc process.
pub fn invoke(args: &[&std::ffi::OsStr], directory: &Path, name: &str) -> Result<(bool, String), String> {
    let output = directory.join(format!("{name}.out"));
    let errors = directory.join(format!("{name}.err"));
    let mut child = Command::new("pandoc")
        .args(args)
        .stdout(Stdio::from(
            File::create(&output).map_err(|_| "cannot create Pandoc output")?,
        ))
        .stderr(Stdio::from(
            File::create(&errors).map_err(|_| "cannot create Pandoc diagnostics")?,
        ))
        .spawn()
        .map_err(|_| "cannot start Pandoc")?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        match child.try_wait().map_err(|_| "cannot wait for Pandoc")? {
            Some(status) => break status,
            None if Instant::now() >= deadline
                || [&output, &errors]
                    .iter()
                    .any(|path| fs::metadata(path).is_ok_and(|metadata| metadata.len() > 1024 * 1024)) =>
            {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Pandoc exceeded time/output budget".into());
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    if [&output, &errors]
        .iter()
        .any(|path| fs::metadata(path).is_ok_and(|metadata| metadata.len() > 1024 * 1024))
    {
        return Err("Pandoc output exceeds 1 MiB".into());
    }
    let text = fs::read_to_string(output).map_err(|_| "cannot read Pandoc output")?;
    Ok((status.success(), text))
}

pub fn render_attempt(
    bibliography: &Path,
    document: &Path,
    directory: &Path,
    name: &str,
) -> Result<(bool, String), String> {
    let (success, text) = invoke(
        &[
            "--citeproc".as_ref(),
            "-t".as_ref(),
            "plain".as_ref(),
            "--wrap=none".as_ref(),
            "--bibliography".as_ref(),
            bibliography.as_os_str(),
            document.as_os_str(),
        ],
        directory,
        name,
    )?;
    Ok((success, normalize(&text)))
}

/// Only comparable, supported renderings become automatic bug reports. Known
/// limitations remain named and visible; unknown cases require human review.
pub fn warnings_for<'a>(
    warnings: &'a [ibis_core::model::LoadWarning],
    key: &str,
    whole_input_rejected: bool,
) -> Vec<&'a ibis_core::model::LoadWarning> {
    warnings
        .iter()
        .filter(|warning| {
            warning.key.as_deref() == Some(key)
                || (whole_input_rejected
                    && matches!(
                        warning.kind,
                        ibis_core::model::WarningKind::Syntax | ibis_core::model::WarningKind::DuplicateKey
                    ))
        })
        .collect()
}

pub fn category(
    kind: &str,
    fields: &[String],
    warnings: &[&ibis_core::model::LoadWarning],
    outcomes: (bool, bool),
    diagnostics: &str,
    titles: (Option<&str>, Option<&str>),
) -> &'static str {
    if outcomes == (false, true)
        && diagnostics.contains("unexpected '('")
        && diagnostics.lines().any(|line| {
            line.trim_start().split_once('(').is_some_and(|(head, _)| {
                head.strip_prefix('@').is_some_and(|name| {
                    !name.is_empty()
                        && name
                            .bytes()
                            .all(|byte| byte.is_ascii_alphabetic() || byte.is_ascii_whitespace())
                })
            })
        })
    {
        return "pandoc-parenthesis-rejection";
    }
    if kind == "parser"
        && warnings.iter().any(|warning| {
            matches!(
                warning.kind,
                ibis_core::model::WarningKind::Syntax | ibis_core::model::WarningKind::DuplicateKey
            )
        })
    {
        return "warned-parser-recovery";
    }
    if !warnings.is_empty()
        && fields.iter().any(|field| field == "missing:language")
        && (!fields.iter().any(|field| field == "value:title")
            || titles
                .0
                .zip(titles.1)
                .is_some_and(|(expected, actual)| expected.to_lowercase() == actual.to_lowercase()))
        && warnings.iter().all(|warning| {
            warning.kind == ibis_core::model::WarningKind::Field
                && warning.message.starts_with("language `")
                && warning.message.ends_with("` is not recognized; it is left out")
        })
        && fields
            .iter()
            .all(|field| ["extra:citation-key", "missing:language", "value:title"].contains(&field.as_str()))
    {
        return "warned-language-fallback";
    }
    if !warnings.is_empty() {
        return "review-required-warning";
    }
    if kind == "parser" {
        return "review-required-parser";
    }
    if outcomes != (true, true) {
        return "review-required-renderer";
    }
    "comparable"
}

#[cfg(test)]
mod tests {
    #[test]
    fn categories_keep_supported_bugs_distinct_from_known_and_unrecognized_limits() {
        use ibis_core::model::{LoadWarning, WarningKind};
        let paths = vec!["value:title".to_string()];
        assert_eq!(
            super::category("render", &paths, &[], (true, true), "", (None, None)),
            "comparable"
        );
        assert_eq!(
            super::category(
                "parser",
                &paths,
                &[],
                (false, true),
                "unexpected '('\n@article(x,",
                (None, None)
            ),
            "pandoc-parenthesis-rejection"
        );
        let language = LoadWarning {
            kind: WarningKind::Field,
            key: Some("x".into()),
            line: None,
            message: "language `synthetic-language` is not recognized; it is left out".into(),
        };
        let paths = vec!["missing:language".into(), "value:title".into()];
        assert_eq!(
            super::category(
                "render",
                &paths,
                &[&language],
                (true, true),
                "",
                (Some("বাংলা O"), Some("বাংলা o"))
            ),
            "warned-language-fallback"
        );
        assert_eq!(
            super::category(
                "render",
                &paths,
                &[&language],
                (true, true),
                "",
                (Some("বাংলা Memory"), Some("বাংলা"))
            ),
            "review-required-warning"
        );
        assert_eq!(
            super::category(
                "render",
                &["missing:author".into()],
                &[&language],
                (true, true),
                "",
                (None, None)
            ),
            "review-required-warning"
        );
        assert_eq!(
            super::category(
                "parser",
                &paths,
                &[],
                (false, true),
                "unrecognized diagnostic",
                (None, None)
            ),
            "review-required-parser"
        );
    }

    #[test]
    fn sibling_syntax_warnings_apply_only_to_whole_input_rejection() {
        use ibis_core::model::{LoadWarning, WarningKind};
        let warnings = vec![LoadWarning {
            kind: WarningKind::Syntax,
            key: Some("broken".into()),
            line: None,
            message: "entry is not closed; skipped".into(),
        }];
        assert_eq!(super::warnings_for(&warnings, "good", true).len(), 1);
        assert!(super::warnings_for(&warnings, "good", false).is_empty());
    }

    #[test]
    fn only_documented_encoding_and_blank_lines_are_normalized() {
        assert_eq!(super::normalize("Garcı\u{301}a\n\nMüller\n"), "García\nMüller");
        assert_ne!(super::normalize("বাংলা O"), super::normalize("বাংলা o"));
    }
}
