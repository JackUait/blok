use crate::converter_test::{is_reason, real_converter};
use crate::csharp_converter_test::field;
use crate::test_json::{self, Json};
use crate::{ACTION_DEGRADED, ACTION_DROPPED, Reason};

// Twins of C# BlokPlainTextReportTests.cs and BlokTabsDocumentTests.cs.

const REPORT_ARTICLE: &str = r#"
      {"blocks":[
        {"id":"h1","type":"header","data":{"text":"Release notes","level":2}},
        {"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b>."}}
      ]}
      "#;

#[tokio::test]
async fn reports_the_same_text_the_bare_reader_returns() {
    let converter = real_converter();
    let bare = converter
        .to_plain_text(REPORT_ARTICLE, false)
        .await
        .expect("text");
    let reported = converter
        .to_plain_text_with_report(REPORT_ARTICLE, false)
        .await
        .expect("report");
    assert_eq!(reported.text, bare);
    assert!(reported.warnings.is_empty());
}

#[tokio::test]
async fn names_a_the_reader_does_not_recognise() {
    let conversion = real_converter()
        .to_plain_text_with_report(
            r#"{"blocks":[{"type":"org-chart","data":{"people":["Ada"]}}]}"#,
            false,
        )
        .await
        .expect("report");
    assert_eq!(conversion.text, "");
    assert_eq!(conversion.warnings.len(), 1, "{:?}", conversion.warnings);
    assert_eq!(conversion.warnings[0].construct, "org-chart");
    assert_eq!(conversion.warnings[0].action, ACTION_DROPPED);
    assert!(!conversion.warnings[0].detail.trim().is_empty());
}

#[tokio::test]
async fn says_nothing_about_a_built_in_block_that_carries_no_text_by_design() {
    let conversion = real_converter()
        .to_plain_text_with_report(
            r#"{"blocks":[{"type":"divider","data":{}},{"type":"spacer","data":{"height":24}}]}"#,
            false,
        )
        .await
        .expect("report");
    assert_eq!(conversion.text, "");
    assert!(conversion.warnings.is_empty());
}

#[tokio::test]
async fn reports_blocks_too_malformed_to_read() {
    let conversion = real_converter()
        .to_plain_text_with_report(
            r#"{"blocks":[{"type":"paragraph","data":{"text":"Kept"}},{"nope":1},{"nope":2}]}"#,
            false,
        )
        .await
        .expect("report");
    assert_eq!(conversion.text, "Kept");
    assert_eq!(conversion.warnings.len(), 1, "{:?}", conversion.warnings);
    assert_eq!(conversion.warnings[0].construct, "block");
    assert!(conversion.warnings[0].detail.contains("2 malformed blocks"));
}

#[tokio::test]
async fn carries_the_hidden_text_option_through() {
    let converter = real_converter();
    let document =
        r#"{"blocks":[{"type":"image","data":{"url":"https://x/y.png","alt":"A chart"}}]}"#;
    assert_eq!(
        converter
            .to_plain_text_with_report(document, false)
            .await
            .expect("report")
            .text,
        ""
    );
    assert_eq!(
        converter
            .to_plain_text_with_report(document, true)
            .await
            .expect("report")
            .text,
        "A chart"
    );
}

#[tokio::test]
async fn refuses_an_input_that_is_not_a_document() {
    let failure = real_converter()
        .to_plain_text_with_report("not a document", false)
        .await;
    assert!(is_reason(&failure, Reason::InvalidDocument), "{failure:?}");
}

const TABS: &str = r#"
      {"blocks":[
        {"id":"tabs","type":"tabs","data":{},"content":["t1","t2","t3"]},
        {"id":"t1","type":"tab","data":{"title":"Fruit & <Veg>","icon":"🍎"},"parent":"tabs","content":["p1","pg"]},
        {"id":"p1","type":"paragraph","data":{"text":"Body <b>one</b>"},"parent":"t1"},
        {"id":"pg","type":"page","data":{"pageId":"page-1"},"parent":"t1"},
        {"id":"t2","type":"tab","data":{"title":""},"parent":"tabs","content":["p2"]},
        {"id":"p2","type":"paragraph","data":{"text":"Body two"},"parent":"t2"},
        {"id":"t3","type":"tab","data":{"title":"Empty"},"parent":"tabs"}
      ]}
      "#;

const TEXT_TABS: &str = r#"
      {"blocks":[
        {"id":"tabs","type":"tabs","data":{},"content":["t1","t2"]},
        {"id":"t1","type":"tab","data":{"title":"Fruit & <Veg>","icon":"🍎"},"parent":"tabs","content":["p1"]},
        {"id":"p1","type":"paragraph","data":{"text":"Body <b>one</b>"},"parent":"t1"},
        {"id":"t2","type":"tab","data":{"title":"Empty"},"parent":"tabs"}
      ]}
      "#;

const TEXT_TABS_HTML: &str = "<div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title><span data-blok-tab-icon>🍎</span> Fruit &amp; &lt;Veg&gt;</h4><p>Body <b>one</b></p></section><section data-blok-tab><h4 data-blok-tab-title>Empty</h4></section></div>";

#[tokio::test]
async fn renders_every_tab_in_order_with_its_title_and_icon() {
    assert_eq!(
        real_converter().to_html(TEXT_TABS).await.expect("html"),
        TEXT_TABS_HTML
    );
}

#[tokio::test]
async fn writes_tabs_to_markdown_and_reports_the_lost_switching() {
    let conversion = real_converter()
        .to_markdown(TEXT_TABS)
        .await
        .expect("markdown");
    assert_eq!(
        conversion.markdown,
        "**🍎 Fruit & \\<Veg>**\n\nBody **one**\n\n**Empty**"
    );
    assert_eq!(conversion.warnings.len(), 1, "{:?}", conversion.warnings);
    assert_eq!(conversion.warnings[0].construct, "tabs");
    assert_eq!(conversion.warnings[0].action, ACTION_DEGRADED);
}

#[tokio::test]
async fn reads_tab_titles_as_plain_text_and_recognises_both_types() {
    let converter = real_converter();
    let report = converter
        .to_plain_text_with_report(TEXT_TABS, false)
        .await
        .expect("report");
    let validation = converter.validate(TEXT_TABS).await.expect("validate");
    assert_eq!(report.text, "Fruit & <Veg>\n\nBody one\n\nEmpty");
    assert!(report.warnings.is_empty());
    assert!(validation.unrecognized_block_types.is_empty());
}

#[tokio::test]
async fn translates_tab_titles_and_escapes_them_once() {
    let converter = real_converter();
    let texts = converter
        .extract_texts(TEXT_TABS, false)
        .await
        .expect("extract");
    let translated = converter
        .inject_texts(
            TEXT_TABS,
            Some(&[
                "Obst & <Gemüse>".to_owned(),
                "Körper <b>eins</b>".to_owned(),
                "A & <B>".to_owned(),
            ]),
            false,
        )
        .await
        .expect("inject");
    assert_eq!(texts, ["Fruit & <Veg>", "Body <b>one</b>", "Empty"]);
    let html = converter.to_html(&translated).await.expect("html");
    assert!(
        html.contains("<h4 data-blok-tab-title>A &amp; &lt;B&gt;</h4>"),
        "{html}"
    );
}

#[tokio::test]
async fn indexes_tab_titles_and_the_pages_a_tab_holds() {
    let index = real_converter().page_index(TABS).await.expect("index");
    assert_eq!(index.owners.len(), 1);
    assert_eq!(index.owners[0].page_id, "page-1");
    assert_eq!(index.owners[0].source_block_id, "pg");
    let texts: Vec<&str> = index.text.iter().map(|entry| entry.text.as_str()).collect();
    assert_eq!(
        texts,
        ["", "Fruit & <Veg>", "Body one", "", "", "Body two", "Empty"]
    );
}

#[tokio::test]
async fn remaps_every_block_inside_the_tabs() {
    let ids = ["tabs", "t1", "p1", "pg", "t2", "p2", "t3"];
    let block_ids = ids
        .iter()
        .map(|id| ((*id).to_owned(), format!("n-{id}")))
        .collect();
    let page_ids = [("page-1".to_owned(), "page-2".to_owned())]
        .into_iter()
        .collect();
    let copy = real_converter()
        .remap_page_document(TABS, Some(&block_ids), Some(&page_ids))
        .await
        .expect("remap");
    let document = test_json::parse(&copy);
    let blocks = document.get("blocks").array();
    let content: Vec<&str> = blocks[0]
        .get("content")
        .array()
        .iter()
        .map(Json::str)
        .collect();
    assert_eq!(content, ["n-t1", "n-t2", "n-t3"]);
    assert_eq!(blocks[3].get("parent").str(), "n-t1");
    assert_eq!(blocks[3].get("data").get("pageId").str(), "page-2");
}

#[tokio::test]
async fn rebuilds_tabs_from_its_own_html() {
    let converter = real_converter();
    let html = converter.to_html(TEXT_TABS).await.expect("html");
    let import = converter.from_html(&html).await.expect("import");
    let document = test_json::parse(&import.document_json);
    let blocks = document.get("blocks").array();
    let types: Vec<&str> = blocks.iter().map(|block| block.get("type").str()).collect();
    assert_eq!(types, ["tabs", "tab", "paragraph", "tab"]);
    assert_eq!(blocks[1].get("data").get("title").str(), "Fruit & <Veg>");
    assert_eq!(blocks[1].get("data").get("icon").str(), "🍎");
    assert_eq!(
        blocks[2].get("data").get("text"),
        &test_json::parse(r#"[{"text":"Body "},{"text":"one","marks":{"bold":true}}]"#)
    );
    assert!(import.warnings.is_empty());
    assert!(field(&document, "warnings").is_none());
    assert_eq!(
        converter
            .to_html(&import.document_json)
            .await
            .expect("html"),
        html.replace("<b>one</b>", "<strong>one</strong>")
    );
}

#[tokio::test]
async fn renders_a_stray_child_after_the_tabs_in_its_container() {
    let html = real_converter()
        .to_html(
            r#"
        {"blocks":[
          {"id":"tg","type":"toggle","data":{"text":"Tog"},"content":["tabs","after"]},
          {"id":"tabs","type":"tabs","data":{},"parent":"tg","content":["s1","t1"]},
          {"id":"s1","type":"paragraph","data":{"text":"Stray"},"parent":"tabs"},
          {"id":"t1","type":"tab","data":{"title":"Do"},"parent":"tabs","content":["p1"]},
          {"id":"p1","type":"paragraph","data":{"text":"one"},"parent":"t1"},
          {"id":"after","type":"paragraph","data":{"text":"After"},"parent":"tg"}
        ]}
        "#,
        )
        .await
        .expect("html");
    assert_eq!(
        html,
        "<details><summary>Tog</summary><div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title>Do</h4><p>one</p></section></div><p>Stray</p><p>After</p></details>"
    );
}

#[tokio::test]
async fn keeps_a_stray_of_tabs_in_a_table_cell_in_that_cell() {
    let converter = real_converter();
    let document = r#"
        {"blocks":[
          {"id":"tbl","type":"table","data":{"withHeadings":false,"content":[[{"blocks":["tabs"]},{"blocks":["c2"]}]]},"content":["tabs","c2"]},
          {"id":"tabs","type":"tabs","data":{},"parent":"tbl","content":["s1","t1"]},
          {"id":"s1","type":"paragraph","data":{"text":"STRAYTEXT"},"parent":"tabs"},
          {"id":"t1","type":"tab","data":{"title":"Do"},"parent":"tabs","content":["p1"]},
          {"id":"p1","type":"paragraph","data":{"text":"one"},"parent":"t1"},
          {"id":"c2","type":"paragraph","data":{"text":"Two"},"parent":"tbl"}
        ]}
        "#;
    let markdown = converter.to_markdown(document).await.expect("md").markdown;
    let text = converter
        .to_plain_text_with_report(document, false)
        .await
        .expect("report")
        .text;
    assert_eq!(
        converter.to_html(document).await.expect("html"),
        "<table><tbody><tr><td><div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title>Do</h4><p>one</p></section></div><p>STRAYTEXT</p></td><td><p>Two</p></td></tr></tbody></table>"
    );
    for output in [&markdown, &text] {
        assert_eq!(output.matches("STRAYTEXT").count(), 1, "{output}");
        assert!(output.find("one") < output.find("STRAYTEXT"), "{output}");
    }
}
