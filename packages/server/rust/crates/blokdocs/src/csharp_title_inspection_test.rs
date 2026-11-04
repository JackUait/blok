use crate::converter_test::real_converter;
use crate::{Pages, Reason, looks_like_a_document, new_on_runtime};

// Twins of C# BlokDocumentConverterTitleTests.cs and
// BlokDocumentInspectionTests.cs.

const TITLED: &str = r#"
      {"title":"Plan","icon":{"type":"emoji","value":"🚀"},"blocks":[
        {"id":"p1","type":"paragraph","data":{"text":"Body"}}
      ]}
      "#;

#[tokio::test]
async fn writes_the_title_as_an_h1() {
    let converter = real_converter();
    let want = "<h1><span aria-hidden=\"true\">🚀</span> Plan</h1><p>Body</p>";
    assert_eq!(
        converter.to_html_with_title(TITLED).await.expect("html"),
        want
    );
    let pages = Pages::new();
    assert_eq!(
        converter
            .to_html_with_title_and_pages(TITLED, Some(&pages), None)
            .await
            .expect("html"),
        want
    );
}

#[tokio::test]
async fn writes_the_title_as_a_markdown_heading() {
    let converter = real_converter();
    let pages = Pages::new();
    let bare = converter
        .to_markdown_with_title(TITLED)
        .await
        .expect("markdown");
    let paged = converter
        .to_markdown_with_title_and_pages(TITLED, Some(&pages), None)
        .await
        .expect("markdown");
    assert_eq!(bare.markdown, "# 🚀 Plan\n\nBody");
    assert_eq!(paged.markdown, "# 🚀 Plan\n\nBody");
}

#[tokio::test]
async fn writes_the_title_as_the_first_plain_text_line() {
    assert_eq!(
        real_converter()
            .to_plain_text_with_title(TITLED, false)
            .await
            .expect("text"),
        "Plan\n\nBody"
    );
}

#[tokio::test]
async fn leaves_the_existing_methods_output_unchanged() {
    let converter = real_converter();
    let pages = Pages::new();
    assert_eq!(
        converter.to_html(TITLED).await.expect("html"),
        "<p>Body</p>"
    );
    assert_eq!(
        converter
            .to_html_with_pages(TITLED, Some(&pages), None)
            .await
            .expect("html"),
        "<p>Body</p>"
    );
    assert_eq!(
        converter.to_markdown(TITLED).await.expect("md").markdown,
        "Body"
    );
    assert_eq!(
        converter
            .to_markdown_with_pages(TITLED, Some(&pages), None)
            .await
            .expect("md")
            .markdown,
        "Body"
    );
    assert_eq!(
        converter.to_plain_text(TITLED, false).await.expect("text"),
        "Body"
    );
}

#[test]
#[ignore = "C# interface default methods; Rust has one concrete Converter, so there is no older implementation to compile"]
fn an_implementation_without_the_title_methods_compiles_and_refuses_them() {}

// C#'s null candidate has no &str form; "" stands in, which C# refuses alike.
#[tokio::test]
async fn refuses_to_call_something_a_document_that_is_not() {
    let converter = real_converter();
    for candidate in [
        "",
        "not json at all",
        "[]",
        "\"a string\"",
        "{\"blocks\":\"not an array\"}",
        "{}",
    ] {
        let validation = converter.validate(candidate).await.expect("validate");
        assert!(!validation.is_document, "{candidate}");
        assert_eq!(
            validation.failure,
            Some(Reason::InvalidDocument),
            "{candidate}"
        );
    }
}

#[tokio::test]
async fn answers_rather_than_throwing_on_rubbish() {
    let validation = real_converter()
        .validate("{\"blocks\":")
        .await
        .expect("validate");
    assert!(!validation.is_document);
    assert!(validation.unrecognized_block_types.is_empty());
}

#[tokio::test]
async fn reads_an_empty_document_as_empty_and_valid() {
    let validation = real_converter()
        .validate(r#"{"blocks":[]}"#)
        .await
        .expect("validate");
    assert!(validation.is_document && validation.is_empty);
    assert_eq!(validation.block_count, 0);
    assert_eq!(validation.failure, None);
}

#[tokio::test]
async fn tells_no_text_apart_from_recognised_nothing() {
    let converter = real_converter();
    let empty = converter
        .validate(r#"{"blocks":[]}"#)
        .await
        .expect("validate");
    let unreadable = converter
        .validate(r#"{"blocks":[{"type":"org-chart","data":{}}]}"#)
        .await
        .expect("validate");
    assert!(empty.is_empty && empty.unrecognized_block_types.is_empty());
    assert!(unreadable.is_empty);
    assert_eq!(unreadable.block_count, 1);
    assert_eq!(unreadable.unrecognized_block_types, ["org-chart"]);
}

#[tokio::test]
async fn does_not_call_a_built_in_textless_block_unrecognised() {
    let validation = real_converter()
        .validate(r#"{"blocks":[{"type":"divider","data":{}}]}"#)
        .await
        .expect("validate");
    assert!(validation.is_document && validation.is_empty);
    assert!(validation.unrecognized_block_types.is_empty());
}

#[tokio::test]
async fn counts_blocks_it_could_not_read_at_all() {
    let validation = real_converter()
        .validate(r#"{"blocks":[{"type":"paragraph","data":{"text":"Body"}},{"nope":1}]}"#)
        .await
        .expect("validate");
    assert!(validation.is_document && !validation.is_empty);
    assert_eq!(validation.block_count, 1);
    assert_eq!(validation.malformed_block_count, 1);
}

struct Counting(std::sync::Arc<std::sync::atomic::AtomicUsize>);

impl crate::Runtime for Counting {
    fn invoke<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: std::time::Duration,
    ) -> crate::InvokeFuture<'a> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async { Ok("{}".to_owned()) })
    }
}

#[tokio::test]
async fn answers_a_non_document_without_touching_the_runtime() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let converter = new_on_runtime(Counting(calls.clone()));
    assert!(
        !converter
            .validate("nonsense")
            .await
            .expect("validate")
            .is_document
    );
    assert!(
        !converter
            .validate("{}")
            .await
            .expect("validate")
            .is_document
    );
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn refuses_the_shape_of_something_that_is_not_a_document() {
    for candidate in [
        "",
        "   ",
        "\t\r\n",
        "not json at all",
        "[]",
        "42",
        "null",
        "\"a string\"",
        "{}",
        "{\"blocks\":null}",
        "{\"blocks\":\"not an array\"}",
        "{\"blocks\":{}}",
        "{\"blocks\":",
    ] {
        assert!(!looks_like_a_document(candidate), "{candidate}");
    }
}

#[test]
fn accepts_the_shape_of_a_saved_document() {
    for candidate in [
        r#"{"blocks":[]}"#,
        r#"{"blocks":[{"type":"paragraph","data":{"text":"Body"}}]}"#,
        r#"{"version":"1.15.1","blocks":[{"type":"divider","data":{}}]}"#,
    ] {
        assert!(looks_like_a_document(candidate), "{candidate}");
    }
}

#[test]
fn says_nothing_about_whether_the_blocks_are_readable() {
    assert!(looks_like_a_document(
        r#"{"blocks":[{"type":"org-chart","data":{}}]}"#
    ));
}

#[tokio::test]
async fn agrees_with_the_full_inspection_on_what_is_not_a_document() {
    let converter = real_converter();
    for candidate in ["", "not json at all", "[]", "{}"] {
        assert_eq!(
            looks_like_a_document(candidate),
            converter
                .validate(candidate)
                .await
                .expect("validate")
                .is_document,
            "{candidate}"
        );
    }
}
