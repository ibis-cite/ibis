//! Resolves `@string` macros and `crossref`/`xdata` inheritance as a checked
//! graph, then renders each entry, with its ancestors, as canonical BibLaTeX
//! that the field parser can read without any further lookups.
//!
//! Cycles (`a` → `b` → `a`, or an entry referring to itself) are reported and
//! broken here, so they can never reach the parser, which would otherwise
//! recurse without end.

use std::collections::{HashMap, HashSet};

use super::lexer::{Part, RawEntry};

/// Fields that hold dates; digits in other scripts are converted to ASCII
/// before parsing so every script is read the same way.
const DATE_FIELDS: [&str; 9] = [
    "date",
    "year",
    "month",
    "day",
    "endyear",
    "urldate",
    "origdate",
    "eventdate",
    "pubstate-date",
];

/// Fields that link an entry to the entries it inherits from.
const PARENT_FIELDS: [&str; 2] = ["crossref", "xdata"];

/// Longest inheritance chain (and macro nesting) followed.
const MAX_DEPTH: usize = 16;

/// Deepest nesting of abbreviations defined in terms of other abbreviations.
const MAX_MACRO_DEPTH: usize = 64;

/// Most abbreviation expansions performed for one field value.
const MAX_EXPANSION_STEPS: usize = 100_000;

/// Largest field value accepted after expanding abbreviations.
const MAX_VALUE_BYTES: usize = 64 * 1024;

const MONTHS: [(&str, &str); 12] = [
    ("jan", "January"),
    ("feb", "February"),
    ("mar", "March"),
    ("apr", "April"),
    ("may", "May"),
    ("jun", "June"),
    ("jul", "July"),
    ("aug", "August"),
    ("sep", "September"),
    ("oct", "October"),
    ("nov", "November"),
    ("dec", "December"),
];

/// State of one depth-first inheritance walk.
struct Walk {
    chain: Vec<usize>,
    edges: HashSet<(usize, usize)>,
    /// Shortest path length at which each entry was explored. An entry first
    /// reached through a long path (possibly cut off by the depth limit) is
    /// explored again when a shorter path reaches it.
    explored_at: HashMap<usize, usize>,
    path: Vec<usize>,
}

/// Everything needed to resolve entries from one file.
pub(crate) struct Resolver<'a> {
    macros: HashMap<String, Vec<Part>>,
    entries: &'a [RawEntry],
    index: HashMap<String, usize>,
    index_folded: HashMap<String, usize>,
}

/// An entry ready for parsing, plus problems found while resolving it.
pub(crate) struct Resolved {
    pub source: String,
    /// Resolved field values (macros expanded), for checks that need raw text.
    pub fields: HashMap<String, String>,
    pub problems: Vec<String>,
}

impl<'a> Resolver<'a> {
    pub(crate) fn new(macros: Vec<(String, Vec<Part>)>, entries: &'a [RawEntry]) -> Self {
        let mut index = HashMap::new();
        let mut index_folded = HashMap::new();
        for (i, entry) in entries.iter().enumerate() {
            index.entry(entry.key.clone()).or_insert(i);
            index_folded.entry(entry.key.to_lowercase()).or_insert(i);
        }
        // Later definitions of the same macro replace earlier ones, as in BibTeX.
        Resolver {
            macros: macros.into_iter().collect(),
            entries,
            index,
            index_folded,
        }
    }

    fn find(&self, key: &str) -> Option<usize> {
        self.index
            .get(key)
            .or_else(|| self.index_folded.get(&key.to_lowercase()))
            .copied()
    }

    /// Resolve entry `i`: expand macros, follow and validate inheritance, and
    /// render the entry with its ancestors as canonical BibLaTeX.
    pub(crate) fn resolve(&self, i: usize) -> Resolved {
        let mut problems = Vec::new();
        let (chain, mut edges) = self.ancestors(i, &mut problems);
        // Links kept from different paths can still combine into a cycle, so
        // the final graph is checked as a whole before anything is parsed.
        self.break_cycles(i, &mut edges, &mut problems);

        let mut source = String::new();
        let mut own_fields = HashMap::new();
        for &idx in chain.iter().rev().chain([i].iter()) {
            let entry = &self.entries[idx];
            let mut rendered = Vec::new();
            for field in &entry.fields {
                let is_parent = PARENT_FIELDS.contains(&field.name.as_str());
                // Problems in the entry itself, or in an `@xdata` helper it uses
                // (helpers are not loaded on their own), are reported here.
                let report = idx == i || entry.kind == "xdata";
                let mut field_problems = Vec::new();
                let value = self.expand(&field.name, &field.parts, &mut field_problems, report);
                problems.extend(field_problems.into_iter().map(|p| {
                    if idx == i {
                        p
                    } else {
                        format!("in inherited `{}`: {p}", entry.key)
                    }
                }));
                if is_parent {
                    // Keep only links that were followed while building the
                    // acyclic chain; cycles and missing targets are dropped.
                    let keep: Vec<&str> = value
                        .split(',')
                        .map(str::trim)
                        .filter(|k| self.find(k).is_some_and(|t| edges.contains(&(idx, t))))
                        .collect();
                    if keep.is_empty() {
                        continue;
                    }
                    rendered.push(format!("  {} = {{{}}}", field.name, keep.join(", ")));
                    continue;
                }
                if idx == i {
                    own_fields.insert(field.name.clone(), value.clone());
                }
                rendered.push(render_field(&field.name, &field.parts, &value));
            }
            source.push_str(&format!(
                "@{}{{{},\n{}}}\n",
                entry.kind,
                entry.key,
                rendered.join(",\n")
            ));
        }
        // The same problem can be found many times (for example an undefined
        // abbreviation used in several fields); report each one once.
        let mut unique = HashSet::new();
        problems.retain(|p| unique.insert(p.clone()));
        Resolved {
            source,
            fields: own_fields,
            problems,
        }
    }

    /// Remove links that close a cycle in the retained graph reachable from
    /// `root`, using an iterative depth-first search in a fixed order.
    fn break_cycles(&self, root: usize, edges: &mut HashSet<(usize, usize)>, problems: &mut Vec<String>) {
        let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
        for &(from, to) in edges.iter() {
            children.entry(from).or_default().push(to);
        }
        for list in children.values_mut() {
            list.sort_unstable();
        }
        // 1 = on the current path, 2 = finished.
        let mut state: HashMap<usize, u8> = HashMap::from([(root, 1)]);
        let mut stack: Vec<(usize, usize)> = vec![(root, 0)];
        while let Some(&mut (node, ref mut next)) = stack.last_mut() {
            let Some(&child) = children.get(&node).and_then(|c| c.get(*next)) else {
                state.insert(node, 2);
                stack.pop();
                continue;
            };
            *next += 1;
            match state.get(&child) {
                Some(1) => {
                    edges.remove(&(node, child));
                    problems.push(format!(
                        "cross-reference cycle through `{}` and `{}`; the link back is ignored",
                        self.entries[node].key, self.entries[child].key
                    ));
                }
                Some(_) => {}
                None => {
                    state.insert(child, 1);
                    stack.push((child, 0));
                }
            }
        }
    }

    /// Ancestors of entry `i` and the links followed to reach them, found by a
    /// depth-first walk. A link back to an entry on the current path is a
    /// cycle and is dropped; reaching an ancestor again through another path
    /// (a shared ancestor) is valid and keeps the link.
    fn ancestors(&self, i: usize, problems: &mut Vec<String>) -> (Vec<usize>, HashSet<(usize, usize)>) {
        let mut walk = Walk {
            chain: Vec::new(),
            edges: HashSet::new(),
            explored_at: HashMap::from([(i, 0)]),
            path: vec![i],
        };
        self.visit(i, &mut walk, problems);
        (walk.chain, walk.edges)
    }

    fn visit(&self, idx: usize, walk: &mut Walk, problems: &mut Vec<String>) {
        if walk.path.len() > MAX_DEPTH {
            problems.push(format!(
                "inheritance is deeper than {MAX_DEPTH} levels; further levels are ignored"
            ));
            return;
        }
        for target in self.parent_keys(idx) {
            let Some(t) = self.find(&target) else {
                problems.push(format!(
                    "`{}` refers to `{target}`, which is not in this file; nothing is inherited from it",
                    self.entries[idx].key
                ));
                continue;
            };
            if walk.path.contains(&t) {
                problems.push(format!(
                    "cross-reference cycle through `{}` and `{}`; the link back is ignored",
                    self.entries[idx].key, self.entries[t].key
                ));
                continue;
            }
            walk.edges.insert((idx, t));
            let depth = walk.path.len();
            let first_time = !walk.explored_at.contains_key(&t);
            if walk.explored_at.get(&t).is_none_or(|&d| depth < d) {
                walk.explored_at.insert(t, depth);
                if first_time {
                    walk.chain.push(t);
                }
                walk.path.push(t);
                self.visit(t, walk, problems);
                walk.path.pop();
            }
        }
    }

    fn parent_keys(&self, idx: usize) -> Vec<String> {
        self.entries[idx]
            .fields
            .iter()
            .filter(|f| PARENT_FIELDS.contains(&f.name.as_str()))
            .flat_map(|f| {
                self.expand(&f.name, &f.parts, &mut Vec::new(), false)
                    .split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// Concatenate parts, expanding macros (and macros used inside macros).
    /// Values larger than [`MAX_VALUE_BYTES`], or needing more than
    /// [`MAX_EXPANSION_STEPS`] expansions, are left empty and reported.
    fn expand(&self, field: &str, parts: &[Part], problems: &mut Vec<String>, report: bool) -> String {
        let mut x = Expansion::default();
        for part in parts {
            match part {
                Part::Text(t) | Part::Number(t) => x.out.push_str(t),
                Part::Macro(name) => self.expand_macro(field, name, problems, report, &mut x),
            }
            x.check_size();
            if x.stopped() {
                break;
            }
        }
        if x.stopped() {
            if report {
                problems.push(if x.too_large {
                    format!(
                        "field `{field}` is too large after expanding abbreviations (over {} KiB); it is left empty",
                        MAX_VALUE_BYTES / 1024
                    )
                } else {
                    format!(
                        "field `{field}` uses abbreviations that are too complex to expand (over {MAX_EXPANSION_STEPS} steps); it is left empty"
                    )
                });
            }
            return String::new();
        }
        let mut out = x.out;
        if DATE_FIELDS.contains(&field) {
            out = ascii_digits(&out);
        }
        dotless_to_plain(&out)
    }

    fn expand_macro(&self, field: &str, name: &str, problems: &mut Vec<String>, report: bool, x: &mut Expansion) {
        x.steps += 1;
        if x.steps > MAX_EXPANSION_STEPS {
            x.too_complex = true;
        }
        if x.stopped() {
            return;
        }
        if x.stack.iter().any(|s| s == name) {
            if report {
                problems.push(format!("abbreviation `{name}` refers to itself; it is left empty"));
            }
            return;
        }
        if x.stack.len() >= MAX_MACRO_DEPTH {
            if report {
                problems.push(format!(
                    "abbreviations are nested more than {MAX_MACRO_DEPTH} levels deep; deeper levels are left empty"
                ));
            }
            return;
        }
        if let Some(parts) = self.macros.get(name) {
            x.stack.push(name.to_string());
            for part in parts {
                match part {
                    Part::Text(t) | Part::Number(t) => x.out.push_str(t),
                    Part::Macro(inner) => self.expand_macro(field, inner, problems, report, x),
                }
                x.check_size();
                if x.stopped() {
                    break;
                }
            }
            x.stack.pop();
            return;
        }
        if let Some((abbr, full)) = MONTHS.iter().find(|(abbr, _)| *abbr == name) {
            // In a month field the parser understands the abbreviation itself.
            x.out.push_str(if field == "month" { abbr } else { full });
            return;
        }
        if report {
            problems.push(format!(
                "undefined abbreviation `{name}`; the field using it is left empty"
            ));
        }
    }
}

/// State of expanding one field value.
#[derive(Default)]
struct Expansion {
    out: String,
    stack: Vec<String>,
    steps: usize,
    too_large: bool,
    too_complex: bool,
}

impl Expansion {
    fn check_size(&mut self) {
        if self.out.len() > MAX_VALUE_BYTES {
            self.too_large = true;
        }
    }

    fn stopped(&self) -> bool {
        self.too_large || self.too_complex
    }
}

/// Render one field canonically. A month given as a bare abbreviation stays
/// bare so the parser reads it as a month; everything else is braced.
fn render_field(name: &str, parts: &[Part], value: &str) -> String {
    let bare_month = name == "month"
        && matches!(parts, [Part::Macro(m)] if MONTHS.iter().any(|(abbr, _)| abbr == m))
        && MONTHS.iter().any(|(abbr, _)| *abbr == value);
    if bare_month {
        format!("  {name} = {value}")
    } else {
        format!("  {name} = {{{value}}}")
    }
}

/// Replace the dotless `\\i` and `\\j` commands with plain letters so accents
/// apply: `{\\'\\i}` becomes `{\\'i}`, which the parser reads as "í".
fn dotless_to_plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find(['\\']) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        let letter = after.chars().next();
        let next = after.chars().nth(1);
        match letter {
            Some(l @ ('i' | 'j')) if next.is_none_or(|c| !c.is_ascii_alphabetic()) => {
                out.push(l);
                // A space after the command only terminates it.
                rest = after[1..].strip_prefix(' ').unwrap_or(&after[1..]);
            }
            _ => {
                out.push('\\');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Convert decimal digits from common scripts (Arabic-Indic, Persian,
/// N'Ko, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu,
/// Thai, full-width) to ASCII digits.
pub(crate) fn ascii_digits(text: &str) -> String {
    const ZEROS: [u32; 12] = [
        0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0E50, 0xFF10,
    ];
    text.chars()
        .map(|c| {
            ZEROS
                .iter()
                .find(|&&zero| (zero..zero + 10).contains(&(c as u32)))
                .and_then(|&zero| char::from_digit(c as u32 - zero, 10))
                .unwrap_or(c)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::lexer::{parse_entry, parse_string, split_blocks};
    use super::*;

    fn resolver_for(src: &str) -> (Vec<(String, Vec<Part>)>, Vec<RawEntry>) {
        let blocks = split_blocks(src);
        let macros = blocks
            .iter()
            .filter(|b| b.kind == "string")
            .filter_map(parse_string)
            .collect();
        let entries = blocks
            .iter()
            .filter(|b| b.kind != "string")
            .filter_map(|b| parse_entry(b).ok())
            .collect();
        (macros, entries)
    }

    #[test]
    fn self_and_mutual_cycles_are_broken_and_reported() {
        for src in [
            "@book{a,title={A},crossref={a}}",
            "@book{a,title={A},crossref={b}}\n@book{b,title={B},crossref={a}}",
        ] {
            let (macros, entries) = resolver_for(src);
            let r = Resolver::new(macros, &entries).resolve(0);
            assert!(
                r.problems.iter().any(|p| p.contains("cycle")),
                "{src}: {:?}",
                r.problems
            );
            // The rendered source must contain no link back into the chain.
            assert!(!r.source.contains("crossref = {a}"), "{}", r.source);
        }
    }

    #[test]
    fn chained_macros_expand_fully() {
        let (macros, entries) =
            resolver_for("@string{a = \"Alpha\"}\n@string{b = a # \" Beta\"}\n@article{m, journal = b}");
        let r = Resolver::new(macros, &entries).resolve(0);
        assert!(r.source.contains("journal = {Alpha Beta}"), "{}", r.source);
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test]
    fn nested_inheritance_includes_every_ancestor() {
        let (macros, entries) = resolver_for(
            "@proceedings{c, title={Grand}, year={2019}}\n@proceedings{b, title={Mid}, crossref={c}}\n@inproceedings{a, title={Leaf}, crossref={b}}",
        );
        let r = Resolver::new(macros, &entries).resolve(2);
        assert!(r.source.contains("@proceedings{c,") && r.source.contains("@proceedings{b,"));
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test]
    fn dotless_i_and_j_become_plain_letters() {
        assert_eq!(dotless_to_plain("Garc{\\'\\i}a"), "Garc{\\'i}a");
        assert_eq!(dotless_to_plain("\\i nt \\item \\j"), "int \\item j");
    }

    #[test]
    fn digits_in_date_fields_are_normalized_but_not_elsewhere() {
        let (macros, entries) = resolver_for("@article{d, title={২০২০ পর্যবেক্ষণ}, year={২০২০}, month=mar}");
        let r = Resolver::new(macros, &entries).resolve(0);
        assert!(r.source.contains("year = {2020}"));
        assert!(r.source.contains("month = mar"));
        assert!(r.source.contains("title = {২০২০ পর্যবেক্ষণ}"));
    }
}
