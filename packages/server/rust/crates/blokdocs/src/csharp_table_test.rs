use std::collections::HashSet;

use crate::converter_test::real_converter;
use crate::csharp_converter_test::field;
use crate::test_json::{self, Json};

// Twins of C# TableDocumentDataLossAuditTests.cs.

const FULL_TABLE: &str = r#"
      {"blocks":[
        { "id": "tb", "type": "table", "content": ["p00", "p01", "p10", "p11", "p12"],
          "data": {
            "withHeadings": true, "withHeadingColumn": true, "stretched": true,
            "colWidths": [120.5, 200, 333.25], "initialColWidth": 217.75, "textSize": "comfortable",
            "content": [
              [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 2, "color": "blue", "textColor": "red", "placement": "middle-center" },
                { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] },
                { "id": "c2", "rowId": "r0", "blocks": ["p01"], "rowspan": 2 } ],
              [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] },
                { "id": "c1", "rowId": "r1", "blocks": ["p12"], "placement": "bottom-right" },
                { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 2] } ]
            ] } },
        { "id": "p00", "type": "paragraph", "parent": "tb", "data": { "text": "origin" } },
        { "id": "p01", "type": "paragraph", "parent": "tb", "data": { "text": "tall" } },
        { "id": "p10", "type": "paragraph", "parent": "tb", "data": { "text": "first" } },
        { "id": "p11", "type": "paragraph", "parent": "tb", "data": { "text": "second" } },
        { "id": "p12", "type": "paragraph", "parent": "tb", "data": { "text": "xcell" } }
      ]}
      "#;

const TEXT_CELL_TABLE: &str = r#"
      {"blocks":[
        { "id": "tb", "type": "table",
          "data": { "withHeadings": false, "withHeadingColumn": false, "colWidths": [10, 20, 30],
            "content": [
              ["plain a", { "blocks": [], "text": "rich <b>b</b>", "color": "red" }, "c"],
              [{ "blocks": [], "text": "wide", "colspan": 2 }, { "blocks": [], "mergedInto": [1, 0] }, "f"]
            ] } }
      ]}
      "#;

const CELL_WORDS: [&str; 5] = ["origin", "tall", "first", "second", "xcell"];

async fn round_trip(document: &str) {
    let converter = real_converter();
    let texts = converter
        .extract_texts(document, false)
        .await
        .expect("extract");
    let injected = converter
        .inject_texts(document, Some(&texts), false)
        .await
        .expect("inject");
    assert_eq!(
        test_json::parse(document),
        test_json::parse(&injected),
        "{injected}"
    );
}

#[tokio::test]
async fn extract_then_inject_the_same_texts_changes_nothing() {
    round_trip(FULL_TABLE).await;
    round_trip(TEXT_CELL_TABLE).await;
}

#[tokio::test]
async fn translating_text_cells_reaches_every_visible_cell_and_keeps_the_grid() {
    let converter = real_converter();
    let texts = converter
        .extract_texts(TEXT_CELL_TABLE, false)
        .await
        .expect("extract");
    let translated: Vec<String> = texts.iter().map(|text| format!("T:{text}")).collect();
    let injected = test_json::parse(
        &converter
            .inject_texts(TEXT_CELL_TABLE, Some(&translated), false)
            .await
            .expect("inject"),
    );
    let content = injected.get("blocks").array()[0].get("data").get("content");
    assert_eq!(texts, ["plain a", "rich <b>b</b>", "c", "wide", "f"]);
    let rows = content.array();
    assert_eq!(rows[0].array()[0].str(), "T:plain a");
    assert_eq!(rows[0].array()[1].get("text").str(), "T:rich <b>b</b>");
    assert_eq!(rows[0].array()[1].get("color").str(), "red");
    assert_eq!(rows[1].array()[0].get("colspan").number(), 2.0);
    assert_eq!(rows[1].array()[2].str(), "T:f");
}

#[tokio::test]
async fn extracting_a_block_cell_table_yields_each_cell_child_once() {
    let texts = real_converter()
        .extract_texts(FULL_TABLE, false)
        .await
        .expect("extract");
    assert_eq!(texts, CELL_WORDS);
}

#[tokio::test]
async fn plain_text_of_a_table_carries_every_cell_block() {
    let text = real_converter()
        .to_plain_text(FULL_TABLE, false)
        .await
        .expect("text");
    for word in CELL_WORDS {
        assert!(text.contains(word), "{word} missing from {text}");
    }
}

#[tokio::test]
async fn markdown_of_a_table_carries_every_cell_block_and_reports_the_merge() {
    let result = real_converter()
        .to_markdown(FULL_TABLE)
        .await
        .expect("markdown");
    for word in CELL_WORDS {
        assert!(result.markdown.contains(word), "{word} missing");
    }
    assert!(!result.warnings.is_empty());
}

#[tokio::test]
async fn validation_accepts_every_saved_table_field() {
    let validation = real_converter()
        .validate(FULL_TABLE)
        .await
        .expect("validate");
    assert!(validation.is_document);
    assert_eq!(validation.malformed_block_count, 0);
    assert!(validation.unrecognized_block_types.is_empty());
    assert!(!validation.is_empty);
}

fn blocks_of(document: &Json) -> &[Json] {
    document.get("blocks").array()
}

#[tokio::test]
async fn html_import_keeps_merged_cells() {
    let import = real_converter()
        .from_html("<table><tr><td colspan=\"2\">wide</td><td rowspan=\"2\">tall</td></tr><tr><td>a</td><td>b</td></tr></table>")
        .await
        .expect("import");
    let document = test_json::parse(&import.document_json);
    let tables: Vec<&Json> = blocks_of(&document)
        .iter()
        .filter(|block| block.get("type").str() == "table")
        .collect();
    assert_eq!(tables.len(), 1);
    let rows = tables[0].get("data").get("content").array();
    assert_eq!(rows[0].array()[0].get("colspan").number(), 2.0);
    assert_eq!(
        rows[0].array()[1].get("mergedInto"),
        &test_json::parse("[0,0]")
    );
    assert_eq!(rows[0].array()[2].get("rowspan").number(), 2.0);
    assert_eq!(
        rows[1].array()[2].get("mergedInto"),
        &test_json::parse("[0,2]")
    );
    assert_eq!(rows[1].array()[0].get("blocks").array().len(), 1);
    assert_eq!(rows[1].array()[1].get("blocks").array().len(), 1);
}

#[tokio::test]
async fn html_import_keeps_every_cells_content() {
    let converter = real_converter();
    let cases: [(&str, &[&str]); 5] = [
        (
            "<table><tr><td><ul><li>outer<ul><li>inner</li></ul></li></ul></td></tr></table>",
            &["outer", "inner"],
        ),
        (
            "<table><tr><td><p>one</p><p>two</p></td><td><pre><code>x = 1</code></pre></td></tr></table>",
            &["one", "two", "x = 1"],
        ),
        (
            "<table><tr><td><div><table><tr><td>deep</td></tr></table></div></td></tr></table>",
            &["deep"],
        ),
        (
            "<table><tr><td><h2>title</h2></td></tr></table>",
            &["title"],
        ),
        (
            "<table><tr><td><blockquote>quoted</blockquote><img src=\"https://x.test/a.png\" alt=\"pic\"></td></tr></table>",
            &["quoted"],
        ),
    ];
    for (html, words) in cases {
        let import = converter.from_html(html).await.expect("import");
        let raw = &import.document_json;
        let document = test_json::parse(raw);
        let ids: HashSet<&str> = blocks_of(&document)
            .iter()
            .filter_map(|block| field(block, "id").map(Json::str))
            .collect();
        for table in blocks_of(&document)
            .iter()
            .filter(|block| block.get("type").str() == "table")
        {
            for row in table.get("data").get("content").array() {
                for cell in row.array() {
                    for id in cell.get("blocks").array() {
                        assert!(
                            ids.contains(id.str()),
                            "{html}: cell child {} missing",
                            id.str()
                        );
                    }
                }
            }
        }
        let text = converter.to_plain_text(raw, false).await.expect("text");
        for word in words {
            assert!(raw.contains(word), "{word} missing from {raw}");
            assert!(
                text.contains(word),
                "{word} missing from plain text {text} of {raw}"
            );
        }
    }
}

#[tokio::test]
async fn html_import_never_nests_a_table_in_a_table_cell_silently() {
    let converter = real_converter();
    for html in [
        "<table><tr><td><div><table><tr><td>deep</td></tr></table></div></td></tr></table>",
        "<table><tr><td><section><div><table><tr><td>deep</td></tr></table></div></section></td></tr></table>",
    ] {
        let import = converter.from_html(html).await.expect("import");
        let document = test_json::parse(&import.document_json);
        let table_ids: HashSet<&str> = blocks_of(&document)
            .iter()
            .filter(|block| block.get("type").str() == "table")
            .map(|block| block.get("id").str())
            .collect();
        let nested = blocks_of(&document).iter().any(|block| {
            block.get("type").str() == "table"
                && matches!(field(block, "parent"), Some(Json::String(parent)) if table_ids.contains(parent.as_str()))
        });
        assert!(
            !nested || import.warnings.iter().any(|w| w.construct == "table"),
            "table nested in a cell with no warning: {}",
            import.document_json
        );
    }
}

#[tokio::test]
async fn table_data_survives_the_engine_boundary() {
    let document = r#"
        {"time":1700000000000,"version":"1.0.0","blocks":[
          { "id": "tb", "type": "table", "tunes": { "x": null },
            "data": { "withHeadings": false, "withHeadingColumn": false, "colWidths": [200, 120.125, 0.1, 1e3],
              "initialColWidth": 333.3333333333333,
              "content": [
                ["مرحبا بالعالم", { "blocks": [], "text": "😀 <b>a&amp;b</b>   \"q\" \\ ", "color": null }],
                [{ "blocks": [], "text": "שלום", "colspan": 1 }, "é́ z‍w"]
              ] } }
        ]}
        "#;
    round_trip(document).await;
}

#[tokio::test]
async fn validation_accepts_a_legacy_string_cell_table() {
    let validation = real_converter()
        .validate(TEXT_CELL_TABLE)
        .await
        .expect("validate");
    assert_eq!(validation.malformed_block_count, 0);
    assert!(!validation.is_empty);
}

#[tokio::test]
async fn markdown_import_keeps_every_cell() {
    let converter = real_converter();
    let cases: [(&str, &[&str]); 3] = [
        (
            "| a \\| b | c |\n| --- | --- |\n| d | `e \\| f` |\n",
            &["a | b", "e | f"],
        ),
        ("| h1 | h2 |\n| --- | --- |\n| only one |\n", &["only one"]),
        ("| h1 |\n| --- |\n| x | overflow |\n", &["x"]),
    ];
    for (markdown, words) in cases {
        let import = converter.from_markdown(markdown).await.expect("import");
        let text = converter
            .to_plain_text(&import.document_json, false)
            .await
            .expect("text");
        for word in words {
            assert!(
                text.contains(word),
                "{word} missing from {text} of {}",
                import.document_json
            );
        }
    }
}
