use blok_jsjson::Value;
use blok_yjs::{Doc, Options};

use crate::csharp_yrs_compat_test::block_on;
use crate::docconverter_test::{parse, runtime};
use crate::richtext_test::{field, items, text};

// C# CollabDocConverterTests.EscapedMarkupCharactersReadAsText: HTML that
// escapes markup characters reads as those characters.
#[test]
fn escaped_markup_characters_read_as_text() {
    let doc = Doc::new(Options::default());
    let c = runtime();
    block_on(c.seed(
        &doc,
        &parse(
            r#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"a &lt; b &amp;&amp; \"c\" &lt;b&gt;"}}]}"#,
        ),
    ))
    .unwrap_or_else(|err| panic!("{err}"));
    let exported = Value::Object(block_on(c.export(&doc)).unwrap_or_else(|err| panic!("{err}")));
    let segments = items(field(
        field(&items(field(&exported, "blocks"))[0], "data"),
        "text",
    ));
    assert_eq!(segments.len(), 1, "{segments:?}");
    assert_eq!(text(field(&segments[0], "text")), "a < b && \"c\" <b>");
}
