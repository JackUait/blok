use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use blok_jsruntime::InvokeError;

use crate::converter_test::{is_reason, real_converter};
use crate::test_json::{self, Json};
use crate::{
    ACTION_DEGRADED, ACTION_DROPPED, Error, InvokeFuture, Reason, Runtime, new_on_runtime,
};

// Twins of C# Blok.Server.Tests/Documents/BlokDocumentConverterTests.cs.

pub(crate) const ARTICLE: &str = r#"
      {"blocks":[
        {"id":"h1","type":"header","data":{"text":"Release notes","level":2}},
        {"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b> — see <a href=\"https://x.com\">details</a>."}}
      ]}
      "#;

pub(crate) fn field<'a>(json: &'a Json, key: &str) -> Option<&'a Json> {
    match json {
        Json::Object(map) => map.get(key),
        _ => None,
    }
}

struct Fixed {
    answer: &'static str,
    calls: Arc<AtomicUsize>,
}

impl Runtime for Fixed {
    fn invoke<'a>(&'a self, _: &'a str, _: &'a str, _: Option<Duration>) -> InvokeFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let answer = self.answer.to_owned();
        Box::pin(async move { Ok::<_, InvokeError>(answer) })
    }
}

const CALLOUT_AND_SPACER: &str = r#"
        {"blocks":[
          {"id":"c1","type":"callout","data":{"emoji":"🔥"}},
          {"id":"p1","type":"paragraph","data":{"text":"Mind the gap"},"parent":"c1"},
          {"id":"s1","type":"spacer","data":{}}
        ]}
        "#;

#[tokio::test]
async fn reports_the_editors_own_document_version() {
    let version = real_converter().version().await.expect("version");
    assert!(!version.trim().is_empty());
    assert_ne!(version, "dev");
}

#[tokio::test]
async fn refuses_to_hand_out_a_version_the_bundle_does_not_have() {
    let calls = Arc::new(AtomicUsize::new(0));
    let converter = new_on_runtime(Fixed {
        answer: "dev",
        calls: calls.clone(),
    });
    for _ in 0..2 {
        assert!(matches!(converter.version().await, Err(Error::Answer(_))));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn describes_the_saved_format_as_json_schema() {
    let schema = test_json::parse(&real_converter().schema().await.expect("schema"));
    assert_eq!(
        schema.get("$schema").str(),
        "https://json-schema.org/draft/2020-12/schema"
    );
    assert!(field(schema.get("$defs"), "paragraph").is_some());
}

#[tokio::test]
async fn the_schema_takes_segments_or_html_in_a_rich_text_field() {
    let schema = test_json::parse(&real_converter().schema().await.expect("schema"));
    let text = schema
        .get("$defs")
        .get("paragraph")
        .get("properties")
        .get("text");
    let types: Vec<&str> = text
        .get("oneOf")
        .array()
        .iter()
        .map(|shape| shape.get("type").str())
        .collect();
    assert_eq!(types, ["array", "string"]);
}

#[tokio::test]
async fn extracts_the_strings_worth_translating() {
    let texts = real_converter()
        .extract_texts(
            r#"
        {"blocks":[
          {"id":"h1","type":"header","data":{"text":"Title","level":2}},
          {"id":"i1","type":"image","data":{"url":"https://cdn/x.png","caption":"A cat"}},
          {"id":"c1","type":"code","data":{"code":"var a = 1;"}}
        ]}
        "#,
            false,
        )
        .await
        .expect("extract");
    assert_eq!(texts, ["Title", "A cat"]);
}

#[tokio::test]
async fn includes_code_only_when_asked() {
    let converter = real_converter();
    let document = r#"{"blocks":[{"id":"c1","type":"code","data":{"code":"var a = 1;"}}]}"#;
    assert!(
        converter
            .extract_texts(document, false)
            .await
            .expect("extract")
            .is_empty()
    );
    assert_eq!(
        converter
            .extract_texts(document, true)
            .await
            .expect("extract"),
        ["var a = 1;"]
    );
}

#[tokio::test]
async fn puts_translations_back_without_losing_anything_else() {
    let translated = real_converter()
        .inject_texts(
            r#"{"time":1700000000000,"version":"9.9.9","blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}},7]}"#,
            Some(&["Привет".to_owned()]),
            false,
        )
        .await
        .expect("inject");
    let root = test_json::parse(&translated);
    assert_eq!(root.get("version").str(), "9.9.9");
    assert_eq!(root.get("time").number(), 1_700_000_000_000.0);
    let blocks = root.get("blocks").array();
    assert_eq!(blocks[0].get("data").get("text").str(), "Привет");
    assert_eq!(blocks[1].number(), 7.0);
}

#[tokio::test]
async fn refuses_a_translation_list_that_does_not_match_the_document() {
    let failure = real_converter()
        .inject_texts(
            r#"{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}}]}"#,
            Some(&["Привет".to_owned(), "Лишнее".to_owned()]),
            false,
        )
        .await;
    match failure {
        Err(err @ Error::TextCount { .. }) => {
            let message = err.to_string();
            assert!(message.contains('1') && message.contains('2'), "{message}");
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn converts_a_document_to_markdown() {
    let conversion = real_converter()
        .to_markdown(ARTICLE)
        .await
        .expect("markdown");
    assert_eq!(
        conversion.markdown,
        "## Release notes\n\nShips **today** — see [details](https://x.com)."
    );
    assert!(conversion.warnings.is_empty());
}

#[tokio::test]
async fn reports_constructs_that_could_not_survive_markdown() {
    let conversion = real_converter()
        .to_markdown(CALLOUT_AND_SPACER)
        .await
        .expect("markdown");
    assert_eq!(conversion.markdown, "> [!CALLOUT]\n> \n> Mind the gap");
    assert_eq!(conversion.warnings.len(), 2);
    assert_eq!(conversion.warnings[0].construct, "callout");
    assert_eq!(conversion.warnings[0].action, "degraded");
    assert!(conversion.warnings[0].detail.contains("emoji"));
    assert_eq!(conversion.warnings[1].construct, "spacer");
    assert_eq!(conversion.warnings[1].action, "dropped");
}

#[tokio::test]
async fn round_trips_markdown_through_blocks() {
    let converter = real_converter();
    let markdown = "# Title\n\nA **bold** claim and a `token`.\n\n- one\n- two";
    let import = converter.from_markdown(markdown).await.expect("import");
    let conversion = converter
        .to_markdown(&import.document_json)
        .await
        .expect("markdown");
    assert_eq!(conversion.markdown, markdown);
    assert!(import.warnings.is_empty());
}

#[tokio::test]
async fn imports_markdown_as_a_document_envelope() {
    let import = real_converter()
        .from_markdown("# Hello")
        .await
        .expect("import");
    let document = test_json::parse(&import.document_json);
    let block = &document.get("blocks").array()[0];
    assert_eq!(block.get("type").str(), "header");
    assert_eq!(
        block.get("data").get("text"),
        &test_json::parse(r#"[{"text":"Hello"}]"#)
    );
    assert!(field(&document, "warnings").is_none());
}

#[tokio::test]
async fn reports_markup_markdown_could_not_carry_in() {
    let import = real_converter()
        .from_markdown("<div class=\"note\">careful</div>")
        .await
        .expect("import");
    assert_eq!(import.warnings.len(), 1, "{:?}", import.warnings);
    assert_eq!(import.warnings[0].construct, "html");
    assert_eq!(import.warnings[0].action, "degraded");
}

#[tokio::test]
async fn reports_a_url_dropped_for_its_scheme() {
    let import = real_converter()
        .from_markdown("![evil](javascript:alert(1))")
        .await
        .expect("import");
    assert_eq!(import.warnings.len(), 1, "{:?}", import.warnings);
    assert_eq!(import.warnings[0].construct, "image");
    assert_eq!(import.warnings[0].action, ACTION_DROPPED);
    assert!(import.warnings[0].detail.contains("javascript:"));
}

#[tokio::test]
async fn reports_a_content_reference_it_could_not_resolve() {
    let conversion = real_converter()
        .to_markdown(
            r#"
        {"blocks":[
          {"id":"l1","type":"list","data":{"text":"item","style":"unordered"},"content":["gone"]}
        ]}
        "#,
        )
        .await
        .expect("markdown");
    assert_eq!(conversion.warnings.len(), 1, "{:?}", conversion.warnings);
    assert_eq!(conversion.warnings[0].construct, "list");
    assert_eq!(conversion.warnings[0].action, ACTION_DROPPED);
    assert!(
        conversion.warnings[0]
            .detail
            .contains("could not be resolved")
    );
}

#[tokio::test]
async fn imports_html_as_a_document_envelope() {
    let import = real_converter()
        .from_html("<h2>Hello</h2><p>A <b>bold</b> claim.</p>")
        .await
        .expect("import");
    let document = test_json::parse(&import.document_json);
    let blocks = document.get("blocks").array();
    assert_eq!(blocks[0].get("type").str(), "header");
    assert_eq!(
        blocks[0].get("data").get("text"),
        &test_json::parse(r#"[{"text":"Hello"}]"#)
    );
    assert_eq!(
        blocks[1].get("data").get("text"),
        &test_json::parse(
            r#"[{"text":"A "},{"text":"bold","marks":{"bold":true}},{"text":" claim."}]"#
        )
    );
    assert!(field(&document, "warnings").is_none());
    assert!(import.warnings.is_empty());
}

#[tokio::test]
async fn reports_what_html_could_not_carry_in() {
    let import = real_converter()
        .from_html("<p>keep</p><iframe src=\"https://x.dev\"></iframe>")
        .await
        .expect("import");
    assert_eq!(import.warnings.len(), 1, "{:?}", import.warnings);
    assert_eq!(import.warnings[0].construct, "iframe");
    assert_eq!(import.warnings[0].action, ACTION_DROPPED);
    assert!(import.warnings[0].detail.contains("iframe"));
}

#[tokio::test]
async fn round_trips_html_through_blocks() {
    let converter = real_converter();
    let html = "<h2>Release notes</h2><p>Ships <strong>today</strong>.</p>";
    let import = converter.from_html(html).await.expect("import");
    assert_eq!(
        converter
            .to_html(&import.document_json)
            .await
            .expect("html"),
        html
    );
}

#[tokio::test]
async fn renders_html_and_plain_text() {
    let converter = real_converter();
    assert_eq!(
        converter.to_html(ARTICLE).await.expect("html"),
        "<h2>Release notes</h2><p>Ships <b>today</b> — see <a href=\"https://x.com\">details</a>.</p>"
    );
    assert_eq!(
        converter.to_plain_text(ARTICLE, false).await.expect("text"),
        "Release notes\n\nShips today — see details."
    );
}

#[tokio::test]
async fn reads_the_last_value_of_a_repeated_key() {
    let converter = real_converter();
    let repeated = r#"{"blocks":[{"id":"p","type":"paragraph","type":"header","data":{"text":"a","text":"b","level":2}}]}"#;
    let repeated_root =
        r#"{"blocks":1,"blocks":[{"id":"p","type":"paragraph","data":{"text":"x"}}]}"#;
    assert_eq!(
        converter.to_html(repeated).await.expect("html"),
        "<h2>b</h2>"
    );
    assert_eq!(
        converter
            .to_markdown(repeated)
            .await
            .expect("markdown")
            .markdown,
        "## b"
    );
    assert_eq!(
        converter
            .to_plain_text(repeated, false)
            .await
            .expect("text"),
        "b"
    );
    assert_eq!(
        converter.to_html(repeated_root).await.expect("html"),
        "<p>x</p>"
    );
    assert_eq!(
        converter
            .to_plain_text(
                r#"{"blocks":[],"blocks":[{"id":"p","type":"paragraph","data":{"text":"x","text":"y"}}]}"#,
                false
            )
            .await
            .expect("text"),
        "y"
    );
}

#[tokio::test]
async fn renders_a_table_of_contents_that_links_to_its_headings() {
    let document = r#"
        {"blocks":[
          {"id":"toc","type":"table_of_contents","data":{}},
          {"id":"h1","type":"header","data":{"text":"Intro","level":2}},
          {"id":"h2","type":"header","data":{"text":"Details","level":3}}
        ]}
        "#;
    assert_eq!(
        real_converter().to_html(document).await.expect("html"),
        "<nav><ol><li data-depth=\"0\"><a href=\"#h1\">Intro</a></li><li data-depth=\"1\"><a href=\"#h2\">Details</a></li></ol></nav><h2 id=\"h1\">Intro</h2><h3 id=\"h2\">Details</h3>"
    );
}

#[tokio::test]
async fn skips_a_malformed_block_and_reports_it() {
    let conversion = real_converter()
        .to_markdown(
            r#"
      {"blocks":[
        {"id":"p1","type":"paragraph","data":{"text":"Kept"}},
        7,
        {"id":"p2","data":{"text":"No type"}}
      ]}
      "#,
        )
        .await
        .expect("markdown");
    assert_eq!(conversion.markdown, "Kept");
    assert_eq!(conversion.warnings.len(), 1, "{:?}", conversion.warnings);
    assert_eq!(conversion.warnings[0].construct, "block");
    assert_eq!(conversion.warnings[0].action, "dropped");
}

#[tokio::test]
async fn reports_every_unusable_document_the_same_way() {
    let converter = real_converter();
    for document in ["not json", "{\"nope\":1}"] {
        let markdown = converter.to_markdown(document).await;
        let html = converter.to_html(document).await;
        let text = converter.to_plain_text(document, false).await;
        assert!(
            is_reason(&markdown, Reason::InvalidDocument),
            "{document}: {markdown:?}"
        );
        assert!(
            is_reason(&html, Reason::InvalidDocument),
            "{document}: {html:?}"
        );
        assert!(
            is_reason(&text, Reason::InvalidDocument),
            "{document}: {text:?}"
        );
    }
}

#[tokio::test]
async fn reports_unreadable_input_the_same_way_on_the_translation_path() {
    let converter = real_converter();
    let failure = converter.extract_texts("not json", false).await;
    assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
    assert!(
        converter
            .extract_texts(r#"{"nope":1}"#, false)
            .await
            .expect("extract")
            .is_empty()
    );
}

// A cancelled token is a future dropped before it ran.
#[tokio::test]
async fn still_reports_the_callers_own_cancellation_as_cancellation() {
    let converter = real_converter();
    let cancelled = tokio::select! {
        biased;
        () = std::future::ready(()) => true,
        _ = converter.to_html(ARTICLE) => false,
    };
    assert!(cancelled);
}

#[tokio::test]
async fn names_the_two_degradation_outcomes_it_reports() {
    let conversion = real_converter()
        .to_markdown(CALLOUT_AND_SPACER)
        .await
        .expect("markdown");
    assert_eq!(conversion.warnings[0].action, ACTION_DEGRADED);
    assert_eq!(conversion.warnings[1].action, ACTION_DROPPED);
    assert_eq!(ACTION_DEGRADED, "degraded");
    assert_eq!(ACTION_DROPPED, "dropped");
}

#[tokio::test]
async fn reads_the_hidden_media_text_only_when_asked() {
    let converter = real_converter();
    let document = r#"
        {"blocks":[
          {"id":"i1","type":"image","data":{"url":"https://cdn/x.png","caption":"A cat","alt":"A tabby asleep"}},
          {"id":"b1","type":"bookmark","data":{"title":"Blok","url":"https://blokeditor.com","description":"Block editor"}}
        ]}
        "#;
    let painted = converter
        .to_plain_text(document, false)
        .await
        .expect("text");
    let indexed = converter.to_plain_text(document, true).await.expect("text");
    assert!(!painted.contains("A tabby asleep") && !painted.contains("Block editor"));
    assert!(painted.contains("A cat"));
    for word in [
        "A cat",
        "A tabby asleep",
        "Block editor",
        "https://blokeditor.com",
    ] {
        assert!(indexed.contains(word), "{word} missing from {indexed}");
    }
}
