use crate::parse::{Metadata, parse};

// Twins of UnfurlMetadataParserTests, which have no Go twin.

fn of(html: &str, final_url: &str) -> Metadata {
    parse(html.as_bytes(), final_url)
}

const PAGE: &str = r#"<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="OpenGraph Title">
<meta name="description" content="Plain description">
<meta property="og:image" content="/img/cover.png">
<link rel="icon" href="/favicon.ico">
</head><body>ignored</body></html>"#;

#[test]
fn prefers_open_graph_and_resolves_relative_urls() {
    let m = of(PAGE, "https://example.com/article?x=1");
    assert_eq!(m.title, "OpenGraph Title");
    assert_eq!(m.description, "Plain description");
    assert_eq!(m.image, "https://example.com/img/cover.png");
    assert_eq!(m.favicon, "https://example.com/favicon.ico");
    assert_eq!(m.domain, "example.com");
}

#[test]
fn falls_back_to_the_title_and_default_favicon() {
    let m = of(
        "<html><head><title>Only Title</title></head></html>",
        "https://example.com/x",
    );
    assert_eq!(m.title, "Only Title");
    assert_eq!(m.favicon, "https://example.com/favicon.ico");
}

#[test]
fn returns_domain_only_when_metadata_is_absent() {
    let m = of("<html><body>nothing</body></html>", "https://example.com/x");
    assert_eq!(m.title, "");
    assert_eq!(m.domain, "example.com");
}

#[test]
fn applies_channel_precedence_after_document_order() {
    let m = of(
        r#"<html><head>
<title>Element Title</title>
<meta name="description" content="Plain description">
<meta name="twitter:title" content="Twitter Title">
<meta name="twitter:description" content="Twitter description">
<meta name="twitter:image" content="/twitter.png">
<meta property="og:image" content="/og.png">
</head></html>"#,
        "https://example.com/x",
    );
    assert_eq!(m.title, "Twitter Title");
    assert_eq!(m.description, "Twitter description");
    assert_eq!(m.image, "https://example.com/og.png");
}

#[test]
fn ignores_foreign_namespace_titles() {
    for (html, want) in [
        (
            "<html><body><svg><title>Icon Label</title></svg><p>hi</p></body></html>",
            "",
        ),
        (
            "<svg><title>Icon Label</title></svg><title>Real Page</title>",
            "Real Page",
        ),
        (
            "<html><head><title>Real Page</title></head><body><svg><title>Icon Label</title></svg></body></html>",
            "Real Page",
        ),
    ] {
        assert_eq!(of(html, "https://example.com/x").title, want, "{html}");
    }
}

#[test]
fn resolves_protocol_relative_images() {
    for (final_url, want) in [
        (
            "https://example.com/article",
            "https://cdn.example.com/i.png",
        ),
        ("http://example.com/article", ""),
    ] {
        let m = of(
            r#"<meta property="og:image" content="//cdn.example.com/i.png">"#,
            final_url,
        );
        assert_eq!(m.image, want, "{final_url}");
    }
}

#[test]
fn selects_only_supported_icon_relations() {
    for (html, want) in [
        (
            r#"<link rel="mask-icon" href="/mask.svg"><link rel="apple-touch-icon" href="/apple.png"><link rel="ICON SHORTCUT" href="/real.ico">"#,
            "https://example.com/real.ico",
        ),
        (
            r#"<link rel="shortcut icon" href="/real.ico">"#,
            "https://example.com/real.ico",
        ),
        (
            r#"<link rel="apple-touch-icon" href="/apple.png">"#,
            "https://example.com/apple.png",
        ),
        (
            r#"<link rel="mask-icon" href="/mask.svg">"#,
            "https://example.com/favicon.ico",
        ),
        (
            r#"<link rel="fluid-icon" href="/fluid.png">"#,
            "https://example.com/favicon.ico",
        ),
    ] {
        assert_eq!(of(html, "https://example.com/x").favicon, want, "{html}");
    }
}

#[test]
fn survives_malformed_input() {
    let deep = format!(
        "{}<meta property=\"og:title\" content=\"Deep\">{}",
        "<div>".repeat(5000),
        "</div>".repeat(5000)
    );
    for (html, title, description) in [
        ("", "", ""),
        ("%%% not html at all %%%", "", ""),
        ("<html><head><meta property=\"og:tit", "", ""),
        (
            "<html><head><meta property=\"og:title\" content=\"Unclosed\"><body><p>text",
            "Unclosed",
            "",
        ),
        (
            "<html><head><meta property=\"og:title\"><meta name=\"description\"><title>Real</title></head>",
            "Real",
            "",
        ),
        (
            "<html><head><title></title></head><body>x</body></html>",
            "",
            "",
        ),
        ("<title>   </title><title>Real</title>", "Real", ""),
        (deep.as_str(), "", ""),
    ] {
        let m = of(html, "https://example.com/x");
        let label = &html[..html.len().min(60)];
        assert_eq!(m.title, title, "{label}");
        assert_eq!(m.description, description, "{label}");
        assert_eq!(m.image, "", "{label}");
        assert_eq!(m.domain, "example.com", "{label}");
        assert_eq!(m.favicon, "https://example.com/favicon.ico", "{label}");
    }
}

fn nested(count: usize) -> String {
    format!(
        "<meta property=\"og:title\" content=\"Boundary Title\">{}deep text{}",
        "<div>".repeat(count),
        "</div>".repeat(count)
    )
}

#[test]
fn keeps_metadata_when_text_follows_the_deepest_allowed_open_element() {
    assert_eq!(
        of(&nested(510), "https://example.com/x").title,
        "Boundary Title"
    );
}

#[test]
fn clears_metadata_at_the_five_hundred_thirteenth_open_element() {
    assert_eq!(of(&nested(511), "https://example.com/x").title, "");
}

#[test]
fn parses_text_but_drops_relative_urls_for_an_unusable_final_url() {
    let html = "<title>Still Parsed</title>\n<meta property=\"og:image\" content=\"/img/cover.png\">\n<link rel=\"icon\" href=\"/site.ico\">";
    for final_url in ["", ":", "http://[::1", "not a url"] {
        let m = of(html, final_url);
        assert_eq!(m.title, "Still Parsed", "{final_url}");
        assert_eq!(m.domain, "", "{final_url}");
        assert_eq!(m.image, "", "{final_url}");
        assert_eq!(m.favicon, "", "{final_url}");
    }
}

#[test]
fn keeps_only_absolute_https_urls_without_a_usable_final_url() {
    let m = of(
        "<meta property=\"og:image\" content=\"https://cdn.example.com/i.png\">\n<link rel=\"icon\" href=\"http://cdn.example.com/icon.ico\">",
        ":",
    );
    assert_eq!(m.image, "https://cdn.example.com/i.png");
    assert_eq!(m.favicon, "");
}

#[test]
fn empty_values_fall_through_and_do_not_overwrite() {
    let m = of(
        r#"<title>Element Title</title>
<meta property="og:title" content="">
<meta property="og:title" content="Real Title">
<meta property="og:title" content=" ">
<meta property="og:description" content="">
<meta name="description" content="Real description">
<meta name="description" content="">"#,
        "https://example.com/x",
    );
    assert_eq!(m.title, "Real Title");
    assert_eq!(m.description, "Real description");
}

#[test]
fn drops_non_http_image_and_favicon_urls_for_the_default_favicon() {
    let m = of(
        r#"<meta property="og:image" content="javascript:alert(1)">
<link rel="icon" href="data:image/svg+xml,&lt;svg onload=alert(1)&gt;">"#,
        "https://example.com/x",
    );
    assert_eq!(m.image, "");
    assert_eq!(m.favicon, "https://example.com/favicon.ico");
}

#[test]
fn lowercases_the_domain_and_removes_one_leading_www() {
    assert_eq!(
        of("", "https://WWW.Example.COM:443/x").domain,
        "example.com"
    );
}

#[test]
fn trims_attributes_decodes_entities_and_matches_selector_values_exactly() {
    let m = of(
        r#"<META PROPERTY="OG:title" CONTENT="Wrong">
<meta property=" og:title " content=" A &amp; B ">
<meta NAME=" twitter:description " CONTENT=" D &amp; E ">"#,
        "https://example.com/x",
    );
    assert_eq!(m.title, "A & B");
    assert_eq!(m.description, "D & E");
}

#[test]
fn ignores_the_document_base_element() {
    let m = of(
        "<base href=\"https://other.example/base/\">\n<meta property=\"og:image\" content=\"image.png\">",
        "https://example.com/article/page.html",
    );
    assert_eq!(m.image, "https://example.com/article/image.png");
}

#[test]
fn decodes_bytes_as_utf8_with_replacement() {
    let mut body = b"<title>".to_vec();
    body.extend_from_slice(&[0xc3, 0x28]);
    body.extend_from_slice(b"</title>");
    assert_eq!(parse(&body, "https://example.com/x").title, "\u{fffd}(");
}
