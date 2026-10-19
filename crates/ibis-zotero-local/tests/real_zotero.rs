//! Reads a real, running Zotero through its local API.
//!
//! Ignored by default: `scripts/real-zotero.sh` downloads Zotero, starts it
//! with a fresh profile and the local API turned on, then runs this test with
//! `--ignored`. The test adds synthetic items through Zotero's connector
//! endpoint, so what Ibis reads is exactly what Zotero itself sends, not a
//! hand-written imitation of it.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};

use ibis_core::model::LoadResult;
use ibis_core::zotero::Library;
use ibis_core::zotero::api::{self, Refresh, Snapshot};
use ibis_zotero_local::{DEFAULT_PORT, LocalZotero};

const ARTICLE: &str = r#"{
  "itemType": "journalArticle",
  "title": "Sleep and memory consolidation in synthetic subjects",
  "creators": [
    {"firstName": "Ada", "lastName": "Example", "creatorType": "author"},
    {"firstName": "Ben", "lastName": "Sample", "creatorType": "author"}
  ],
  "date": "2020-03-14",
  "publicationTitle": "Journal of Synthetic Studies",
  "volume": "12",
  "pages": "101-120",
  "DOI": "10.0000/synthetic.1",
  "extra": "Citation Key: example2020sleep"
}"#;

const BOOK: &str = r#"{
  "itemType": "book",
  "title": "Résumé des données: 数据与记忆",
  "creators": [{"name": "Synthetic Institute", "creatorType": "author"}],
  "date": "2019",
  "publisher": "Example Press",
  "extra": "Citation Key: institute2019"
}"#;

const KEYLESS: &str = r#"{
  "itemType": "report",
  "title": "A report without a citation key",
  "creators": [{"firstName": "Chloé", "lastName": "Placeholder", "creatorType": "author"}],
  "date": "2021"
}"#;

const LATER: &str = r#"{
  "itemType": "journalArticle",
  "title": "Added while Ibis was watching",
  "creators": [{"firstName": "Dana", "lastName": "Stand-In", "creatorType": "author"}],
  "date": "2022",
  "extra": "Citation Key: standin2022"
}"#;

fn port() -> u16 {
    std::env::var("IBIS_ZOTERO_PORT")
        .ok()
        .and_then(|port| port.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Saves items the way the browser connector does, into the library
/// selected in Zotero (My Library in a fresh profile).
fn save(items: &[&str], session: &str) {
    let body = format!(
        r#"{{"items": [{}], "uri": "https://example.org/synthetic", "sessionID": "{session}"}}"#,
        items.join(",")
    );
    let mut stream = TcpStream::connect(("127.0.0.1", port())).expect("Zotero is running");
    write!(
        stream,
        "POST /connector/saveItems HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        port(),
        body.len()
    )
    .unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).unwrap();
    let status = answer.split(' ').nth(1).unwrap_or_default();
    assert!(
        status == "201" || status == "200",
        "Zotero refused the synthetic items: {answer}"
    );
}

/// Scans until Zotero lists `count` items; saving finishes after the
/// connector answers.
fn scan_until(count: usize) -> (LoadResult, Snapshot) {
    let started = Instant::now();
    loop {
        let scanned = api::scan(&mut LocalZotero::on_port(port()), Library::User);
        match scanned {
            Ok((result, snapshot)) if result.references.len() >= count => return (result, snapshot),
            other if started.elapsed() > Duration::from_secs(60) => {
                panic!("Zotero did not list {count} items within a minute: {other:?}")
            }
            _ => thread::sleep(Duration::from_millis(500)),
        }
    }
}

#[test]
#[ignore = "needs a running Zotero; see scripts/real-zotero.sh"]
fn ibis_reads_what_a_real_zotero_sends() {
    save(&[ARTICLE, BOOK, KEYLESS], "ibis-synthetic-1");
    let (result, snapshot) = scan_until(3);
    assert_eq!(result.references.len(), 3, "{:#?}", result.references);
    assert!(result.warnings.is_empty(), "{:#?}", result.warnings);

    let article = result
        .references
        .iter()
        .find(|r| r.citekey.as_deref() == Some("example2020sleep"))
        .expect("the article keeps its citation key from Extra");
    assert!(
        article
            .title
            .as_deref()
            .unwrap_or_default()
            .contains("Sleep and memory")
    );
    let families: Vec<_> = article.authors.iter().filter_map(|a| a.family.as_deref()).collect();
    assert_eq!(families, ["Example", "Sample"]);
    assert_eq!(article.issued.as_ref().map(|i| i.start.year), Some(2020));
    assert_eq!(article.item_type, "article-journal");
    assert!(article.id.source.starts_with("zotero"), "{}", article.id.source);

    let book = result
        .references
        .iter()
        .find(|r| r.citekey.as_deref() == Some("institute2019"))
        .expect("the book keeps its citation key");
    assert!(book.title.as_deref().unwrap_or_default().contains("数据与记忆"));
    assert_eq!(book.item_type, "book");

    let keyless = result
        .references
        .iter()
        .find(|r| {
            r.title
                .as_deref()
                .unwrap_or_default()
                .contains("without a citation key")
        })
        .expect("an item without a citation key is still listed");
    assert_eq!(keyless.citekey, None);

    // Nothing changed: the cheap check says so without reading everything.
    let again = api::refresh(&mut LocalZotero::on_port(port()), Library::User, Some(&snapshot)).unwrap();
    assert_eq!(again, Refresh::Unchanged);

    // A new item is noticed and the whole library is read again.
    save(&[LATER], "ibis-synthetic-2");
    let started = Instant::now();
    loop {
        match api::refresh(&mut LocalZotero::on_port(port()), Library::User, Some(&snapshot)).unwrap() {
            Refresh::Loaded {
                result,
                snapshot: newer,
            } => {
                assert_eq!(result.references.len(), 4, "{:#?}", result.references);
                assert!(newer.version > snapshot.version);
                assert!(
                    result
                        .references
                        .iter()
                        .any(|r| r.citekey.as_deref() == Some("standin2022"))
                );
                break;
            }
            Refresh::Unchanged if started.elapsed() < Duration::from_secs(60) => {
                thread::sleep(Duration::from_millis(500))
            }
            Refresh::Unchanged => panic!("Zotero never reported the added item"),
        }
    }
}
