use std::sync::Mutex;
use std::time::Duration;

use crate::converter_test::{is_reason, real_converter};
use crate::csharp_converter_test::field;
use crate::test_json::{self, Json};
use crate::{
    Error, IdMap, InvokeFuture, PageIcon, PageIndex, PageInfo, PageOwnerEdge, PageReference,
    PageTextEntry, Pages, Reason, Runtime, new_on_runtime,
};

// Twins of C# BlokPageExportTests.cs; `page_functions` holds
// BlokPageFunctionsTests.cs.

const PAGE_DOCUMENT: &str = r#"
      {"blocks":[
        {"id":"b1","type":"page","data":{"pageId":"p-ok"}},
        {"id":"b2","type":"page-link","data":{"pageId":"p-denied"}},
        {"id":"b3","type":"page-link","data":{"pageId":"p-missing"}},
        {"id":"b4","type":"page","data":{"pageId":"p-absent"}},
        {"id":"b5","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"p-ok\">x</a> and <a data-blok-page-id=\"p-denied\">x</a>."}}
      ]}
      "#;

fn pages() -> Pages {
    Vec::from([
        (
            "p-ok".to_owned(),
            Some(PageInfo {
                title: Some("Roadmap".to_owned()),
                icon: Some(PageIcon::Emoji("🚀".to_owned())),
                no_access: false,
            }),
        ),
        (
            "p-denied".to_owned(),
            Some(PageInfo {
                title: Some("Secret".to_owned()),
                icon: None,
                no_access: true,
            }),
        ),
        ("p-missing".to_owned(), None),
    ])
}

/// The page glyph and the lock are SVG; the labels and links are what matter.
fn strip_svg(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(start) = rest.find("<svg") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</svg>") {
            Some(end) => rest = &rest[start + end + "</svg>".len()..],
            None => {
                rest = &rest[start..];
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

#[tokio::test]
async fn renders_allowed_denied_missing_and_unlisted_pages_to_html() {
    let asked = Mutex::new(Vec::new());
    let href = |id: &str| {
        asked.lock().expect("lock").push(id.to_owned());
        format!("/pages/{id}")
    };
    let pages = pages();
    let html = real_converter()
        .to_html_with_pages(PAGE_DOCUMENT, Some(&pages), Some(&href))
        .await
        .expect("html");
    assert_eq!(
        strip_svg(&html),
        "<div><a href=\"/pages/p-ok\"><span aria-hidden=\"true\">🚀</span><span>Roadmap</span></a></div><div><span><span aria-hidden=\"true\"></span><span>No access</span></span></div><div><span><span aria-hidden=\"true\"></span><span>Page not found</span></span></div><div><span><span aria-hidden=\"true\"></span><span>Page</span></span></div><p>See <a data-blok-page-id=\"p-ok\" href=\"/pages/p-ok\">Roadmap</a> and <a data-blok-page-id=\"p-denied\">Page</a>.</p>"
    );
    assert_eq!(*asked.lock().expect("lock"), ["p-ok"]);
}

#[tokio::test]
async fn links_allowed_pages_in_markdown() {
    let href = |id: &str| format!("/pages/{id}");
    let pages = pages();
    let conversion = real_converter()
        .to_markdown_with_pages(PAGE_DOCUMENT, Some(&pages), Some(&href))
        .await
        .expect("markdown");
    assert_eq!(
        conversion.markdown,
        "[Roadmap](/pages/p-ok)\n\nNo access\n\nPage not found\n\nPage\n\nSee [Roadmap](/pages/p-ok) and Page."
    );
    let constructs: Vec<&str> = conversion
        .warnings
        .iter()
        .map(|w| w.construct.as_str())
        .collect();
    assert_eq!(constructs, ["page-link", "page-link", "page"]);
}

#[tokio::test]
async fn gives_markdown_titles_without_an_href_builder() {
    let pages = pages();
    let conversion = real_converter()
        .to_markdown_with_pages(PAGE_DOCUMENT, Some(&pages), None)
        .await
        .expect("markdown");
    assert_eq!(
        conversion.markdown,
        "Roadmap\n\nNo access\n\nPage not found\n\nPage\n\nSee Roadmap and Page."
    );
}

#[tokio::test]
async fn drops_a_script_capable_href() {
    let href = |_: &str| "javascript:alert(1)".to_owned();
    let pages = pages();
    let html = real_converter()
        .to_html_with_pages(PAGE_DOCUMENT, Some(&pages), Some(&href))
        .await
        .expect("html");
    assert!(!html.contains("href="), "{html}");
    assert!(html.contains("<span>Roadmap</span>"), "{html}");
}

#[tokio::test]
async fn ignores_pages_carried_inside_the_document() {
    let converter = real_converter();
    let forged = r#"
        {"blocks":[{"type":"page-link","data":{"pageId":"p1"}}],"pages":{"p1":{"title":"Forged","href":"/forged"}}}
        "#;
    let empty = Pages::new();
    let html = converter
        .to_html_with_pages(forged, Some(&empty), None)
        .await
        .expect("html");
    let old = converter.to_html(forged).await.expect("html");
    let want = "<div><span><span aria-hidden=\"true\"></span><span>Page</span></span></div>";
    assert_eq!(strip_svg(&html), want);
    assert_eq!(strip_svg(&old), want);
}

#[tokio::test]
async fn reports_unreadable_json_as_an_invalid_document() {
    let pages = pages();
    let failure = real_converter()
        .to_markdown_with_pages("{not json", Some(&pages), None)
        .await;
    assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
}

#[derive(Default)]
struct Recording {
    calls: std::sync::Arc<Mutex<Vec<(String, String)>>>,
}

impl Runtime for Recording {
    fn invoke<'a>(&'a self, op: &'a str, input: &'a str, _: Duration) -> InvokeFuture<'a> {
        self.calls
            .lock()
            .expect("lock")
            .push((op.to_owned(), input.to_owned()));
        let answer = if op.starts_with("blocksToMarkdown") {
            r#"{"markdown":"","warnings":[]}"#
        } else {
            ""
        };
        Box::pin(async move { Ok(answer.to_owned()) })
    }
}

#[tokio::test]
async fn sends_a_missing_page_as_json_null() {
    let runtime = Recording::default();
    let calls = runtime.calls.clone();
    let converter = new_on_runtime(runtime);
    let href = |id: &str| format!("/pages/{id}");
    let pages = pages();
    converter
        .to_html_with_pages(PAGE_DOCUMENT, Some(&pages), Some(&href))
        .await
        .expect("html");
    let calls = calls.lock().expect("lock");
    assert_eq!(calls.len(), 1);
    let (op, input) = &calls[0];
    assert_eq!(op, "blocksToHtmlWithPages");
    let sent = test_json::parse(input);
    let sent = sent.get("pages");
    assert_eq!(field(sent, "p-missing"), Some(&Json::Null));
    assert_eq!(
        sent.get("p-denied"),
        &test_json::parse(r#"{"access":"none"}"#)
    );
    assert_eq!(
        sent.get("p-ok"),
        &test_json::parse(
            r#"{"title":"Roadmap","icon":{"type":"emoji","value":"🚀"},"href":"/pages/p-ok"}"#
        )
    );
    assert!(input.contains(r#""p-denied":{"access":"none"}"#), "{input}");
}

// A repeated id is what assigning it twice into a C# Dictionary gives: one
// entry, at the first position, holding the last value.
#[tokio::test]
async fn a_repeated_id_keeps_its_first_place_and_its_last_value() {
    let runtime = Recording::default();
    let calls = runtime.calls.clone();
    let converter = new_on_runtime(runtime);
    let hrefs = Mutex::new(Vec::new());
    let href = |id: &str| {
        hrefs.lock().expect("lock").push(id.to_owned());
        String::new()
    };
    let titled = |title: &str| {
        Some(PageInfo {
            title: Some(title.to_owned()),
            ..PageInfo::default()
        })
    };
    let pages: Pages = vec![
        ("b".to_owned(), titled("first")),
        ("a".to_owned(), None),
        ("b".to_owned(), titled("last")),
    ];
    converter
        .to_html_with_pages(r#"{"blocks":[]}"#, Some(&pages), Some(&href))
        .await
        .expect("html");
    let ids: IdMap = vec![
        ("y".to_owned(), "1".to_owned()),
        ("x".to_owned(), "2".to_owned()),
        ("y".to_owned(), "3".to_owned()),
    ];
    let _ = converter
        .remap_page_document(r#"{"blocks":[]}"#, Some(&ids), Some(&IdMap::new()))
        .await;
    let calls = calls.lock().expect("lock");
    assert_eq!(
        calls[0].1,
        r#"{"document":{"blocks":[]},"pages":{"b":{"title":"last"},"a":null}}"#
    );
    assert_eq!(*hrefs.lock().expect("lock"), ["b"]);
    assert_eq!(
        calls[1].1,
        r#"{"document":{"blocks":[]},"blockIds":{"y":"3","x":"2"},"pageIds":{}}"#
    );
}

#[tokio::test]
async fn sends_an_image_icon_with_its_url() {
    let runtime = Recording::default();
    let calls = runtime.calls.clone();
    let converter = new_on_runtime(runtime);
    let pages = Vec::from([(
        "p-ok".to_owned(),
        Some(PageInfo {
            icon: Some(PageIcon::Image("https://cdn/i.png".to_owned())),
            ..PageInfo::default()
        }),
    )]);
    converter
        .to_markdown_with_pages(PAGE_DOCUMENT, Some(&pages), None)
        .await
        .expect("markdown");
    let calls = calls.lock().expect("lock");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "blocksToMarkdownWithPages");
    assert!(
        calls[0]
            .1
            .contains(r#""p-ok":{"icon":{"type":"image","url":"https://cdn/i.png"}}"#),
        "{}",
        calls[0].1
    );
}

#[tokio::test]
async fn old_overloads_still_send_the_bare_document_to_the_old_operations() {
    let runtime = Recording::default();
    let calls = runtime.calls.clone();
    let converter = new_on_runtime(runtime);
    converter.to_html("{}").await.expect("html");
    converter.to_markdown("{}").await.expect("markdown");
    converter.to_html(PAGE_DOCUMENT).await.expect("html");
    converter
        .to_markdown(PAGE_DOCUMENT)
        .await
        .expect("markdown");
    let calls = calls.lock().expect("lock");
    let want = [
        ("blocksToHtml", "{}"),
        ("blocksToMarkdown", "{}"),
        ("blocksToHtml", PAGE_DOCUMENT),
        ("blocksToMarkdown", PAGE_DOCUMENT),
    ];
    let got: Vec<(&str, &str)> = calls
        .iter()
        .map(|(o, i)| (o.as_str(), i.as_str()))
        .collect();
    assert_eq!(got, want);
}

mod page_functions {
    use super::*;

    const INDEXED_DOCUMENT: &str = r##"
      {"time":1759670000000,"version":"1.15.2","blocks":[
        {"id":"h1","type":"header","data":{"text":"Roadmap <a href=\"#p2\">jump</a>","level":2},"tunes":{"anchor":{"id":"roadmap"}}},
        {"id":"p1","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"pg-ref\" href=\"/p/pg-ref\">Specs</a> &amp; <b>more</b>"}},
        {"id":"own1","type":"page","data":{"pageId":"pg-child-a","title":"Child A"}},
        {"id":"lnk","type":"page-link","data":{"pageId":"pg-elsewhere"}},
        {"id":"tg","type":"toggle","content":["tgc","own2"],"data":{"text":"Details"}},
        {"id":"tgc","type":"paragraph","parent":"tg","data":{"text":"Nested <a data-blok-page-id=\"pg-ref\">again</a>"}},
        {"id":"own2","type":"page","parent":"tg","data":{"pageId":"pg-child-b"}},
        {"id":"q","type":"quote","data":{"text":"Quoted","caption":"by <a data-blok-page-id=\"pg-cap\">Author</a>"}},
        {"id":"tbl","type":"table","content":["c1","c2"],"data":{"withHeadings":false,"content":[[{"blocks":["c1"]},"legacy <a data-blok-page-id=\"pg-cell-str\">cell</a>"],[{"blocks":["c2"],"text":"x"},{"blocks":[],"text":"Text <a data-blok-page-id=\"pg-cell-txt\">t</a>"}]]}},
        {"id":"c1","type":"paragraph","parent":"tbl","data":{"text":"Cell one <a data-blok-page-id=\"pg-in-cell\">c</a>"}},
        {"id":"c2","type":"page","parent":"tbl","data":{"pageId":"pg-child-c"}},
        {"id":"p2","type":"paragraph","data":{"text":"Tail ünïcödé 日本"}},
        {"type":"paragraph","data":{"text":"idless legacy"}}
      ]}
      "##;

    fn owner(page: &str, block: &str, order: i32) -> PageOwnerEdge {
        PageOwnerEdge {
            page_id: page.to_owned(),
            source_block_id: block.to_owned(),
            order,
        }
    }

    fn reference(page: &str, block: &str, order: i32) -> PageReference {
        PageReference {
            page_id: page.to_owned(),
            source_block_id: Some(block.to_owned()),
            order,
        }
    }

    fn text(block: Option<&str>, order: i32, text: &str) -> PageTextEntry {
        PageTextEntry {
            block_id: block.map(str::to_owned),
            order,
            text: text.to_owned(),
        }
    }

    #[tokio::test]
    async fn indexes_owners_references_and_text_through_the_runtime() {
        let index = real_converter()
            .page_index(INDEXED_DOCUMENT)
            .await
            .expect("index");
        assert_eq!(
            index,
            PageIndex {
                owners: vec![
                    owner("pg-child-a", "own1", 2),
                    owner("pg-child-b", "own2", 6),
                    owner("pg-child-c", "c2", 8),
                ],
                references: vec![
                    reference("pg-ref", "p1", 1),
                    reference("pg-elsewhere", "lnk", 3),
                    reference("pg-ref", "tgc", 5),
                    reference("pg-cap", "q", 7),
                    reference("pg-in-cell", "c1", 8),
                    reference("pg-cell-str", "tbl", 8),
                    reference("pg-cell-txt", "tbl", 8),
                ],
                text: vec![
                    text(Some("h1"), 0, "Roadmap jump"),
                    text(Some("p1"), 1, "See Page & more"),
                    text(Some("own1"), 2, ""),
                    text(Some("lnk"), 3, "Page"),
                    text(Some("tg"), 4, "Details"),
                    text(Some("tgc"), 5, "Nested Page"),
                    text(Some("own2"), 6, ""),
                    text(Some("q"), 7, "Quoted\nby Page"),
                    text(Some("tbl"), 8, "Cell one Page\tlegacy Page\n\tText Page"),
                    text(Some("p2"), 9, "Tail ünïcödé 日本"),
                    text(None, 10, "idless legacy"),
                ],
            }
        );
    }

    #[tokio::test]
    async fn indexes_a_block_typed_like_a_prototype_key_as_an_unknown_block() {
        let converter = real_converter();
        let document = |kind: &str| {
            format!(r#"{{"blocks":[{{"id":"b","type":"{kind}","data":{{"text":"Own text"}}}}]}}"#)
        };
        let unknown = converter
            .page_index(&document("x-unknown"))
            .await
            .expect("index");
        for kind in ["constructor", "toString", "__proto__"] {
            let index = converter.page_index(&document(kind)).await.expect("index");
            assert_eq!(index, unknown, "{kind}");
        }
    }

    #[tokio::test]
    async fn reports_unreadable_json_as_an_invalid_document() {
        let failure = real_converter().page_index("{not json").await;
        assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
    }

    #[tokio::test]
    async fn reports_a_document_with_no_blocks_as_an_invalid_document() {
        let failure = real_converter().page_index(r#"{"notBlocks":[]}"#).await;
        assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
    }

    #[test]
    #[ignore = "A Rust &str document cannot be null"]
    fn refuses_a_null_document() {}

    fn map(entries: &[(&str, &str)]) -> IdMap {
        entries
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[tokio::test]
    async fn remaps_ids_and_keeps_unknown_keys() {
        let document = r##"
        {"time":1759670000000,"version":"1.15.2","blocks":[
          {"id":"h1","type":"header","data":{"text":"Go <a href=\"#p2\">down</a>","level":2},"tunes":{"anchor":{"id":"top"}}},
          {"id":"own","type":"page","data":{"pageId":"pg-a"},"custom":"kept"},
          {"id":"p2","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"pg-ref\">x</a>"}}
        ]}
        "##;
        let copy = real_converter()
            .remap_page_document(
                document,
                Some(&map(&[("h1", "H1"), ("own", "OWN"), ("p2", "P2")])),
                Some(&map(&[("pg-a", "PG-A")])),
            )
            .await
            .expect("remap");
        assert_eq!(
            test_json::parse(&copy),
            test_json::parse(
                r##"
            {"time":1759670000000,"version":"1.15.2","blocks":[
              {"id":"H1","type":"header","data":{"text":"Go <a href=\"#P2\">down</a>","level":2},"tunes":{"anchor":{"id":"top"}}},
              {"id":"OWN","type":"page","data":{"pageId":"PG-A"},"custom":"kept"},
              {"id":"P2","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"pg-ref\">x</a>"}}
            ]}
            "##
            )
        );
    }

    #[tokio::test]
    async fn refuses_id_maps_that_do_not_cover_the_document() {
        let document = r#"
        {"blocks":[
          {"id":"a","type":"paragraph","parent":"gone","data":{"text":""}},
          {"id":"b","type":"paragraph","data":{"text":""}},
          {"type":"paragraph","data":{"text":"idless"}},
          {"id":"co","type":"callout","data":{"body":{"blocks":[{"id":"nested","type":"page","data":{"pageId":"p"}}]}}}
        ]}
        "#;
        let refusal = real_converter()
            .remap_page_document(
                document,
                Some(&map(&[("a", "X"), ("b", "X"), ("co", "CO")])),
                Some(&IdMap::new()),
            )
            .await
            .expect_err("refused");
        assert_eq!(refusal.param(), Some("blockIds"));
        let message = refusal.to_string();
        assert!(message.contains("\"gone\", \"nested\""), "{message}");
        assert!(message.contains("\"X\""), "{message}");
        assert!(message.contains("1 block(s) without an id"), "{message}");
    }

    #[tokio::test]
    async fn names_each_kind_of_id_problem_on_its_own() {
        let converter = real_converter();
        for (document, message) in [
            (
                r#"{"blocks":[{"id":"m","type":"paragraph"}]}"#,
                "No new id for \"m\".",
            ),
            (
                r#"{"blocks":[{"id":"x","type":"paragraph"},{"id":"a","type":"paragraph"}]}"#,
                "More than one block maps to \"A\".",
            ),
            (
                r#"{"blocks":[{"type":"paragraph"},{"type":"paragraph"}]}"#,
                "2 block(s) without an id.",
            ),
        ] {
            let refusal = converter
                .remap_page_document(
                    document,
                    Some(&map(&[("x", "A"), ("a", "A")])),
                    Some(&IdMap::new()),
                )
                .await
                .expect_err("refused");
            assert!(refusal.to_string().starts_with(message), "{refusal}");
        }
    }

    #[tokio::test]
    async fn reports_unreadable_json_to_remap_as_an_invalid_document() {
        let none = IdMap::new();
        let failure = real_converter()
            .remap_page_document("{not json", Some(&none), Some(&none))
            .await;
        assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
    }

    // C#'s null document has no &str form; the two maps are Options.
    #[tokio::test]
    async fn refuses_null_remap_arguments() {
        let converter = real_converter();
        let none = IdMap::new();
        let blocks = converter.remap_page_document("{}", None, Some(&none)).await;
        let pages = converter.remap_page_document("{}", Some(&none), None).await;
        assert!(
            matches!(blocks, Err(Error::NullArgument { name: "blockIds" })),
            "{blocks:?}"
        );
        assert!(
            matches!(pages, Err(Error::NullArgument { name: "pageIds" })),
            "{pages:?}"
        );
    }
}
