use blok_jsjson::{Str, Value};
use blok_yjs::{Array, Doc, In, Map, MapEntry, Options, Text};

use crate::export::{RichTextHtml, export};
use crate::fields::RichTextFields;

fn block(id: &str, kind: &str, data: Map) -> Map {
    Map::new(vec![
        MapEntry::new("id", Value::String(Str::from(id))),
        MapEntry::new("type", Value::String(Str::from(kind))),
        MapEntry::new("data", data),
        MapEntry::new("tunes", Map::new(Vec::new())),
        MapEntry::new("contentIds", Array::new(Vec::new())),
    ])
}

// C# YDocConverterRichTextTests.LegacyHtmlTextUnderARichFieldIsHandedOutForConversion.
// Its last assertion, the slot-free Export overload throwing, has no Go or
// Rust twin: there is no such overload.
#[test]
fn legacy_html_text_under_a_rich_field_is_handed_out_for_conversion() {
    let doc = Doc::new(Options::default());
    let blocks = doc.get_map("blocks").unwrap();
    let root = doc.get_array("root").unwrap();
    doc.transact(|txn| {
        let data = Map::new(vec![MapEntry::new(
            "text",
            Text::new(Some(Str::from("<b>x</b>"))),
        )]);
        blocks.set(txn, "b1", block("b1", "paragraph", data))?;
        root.insert(txn, 0, vec![In::Any(Value::String(Str::from("b1")))])
    })
    .unwrap();

    let (mut exported, slots) = export(&doc, &RichTextFields::built_in(), None).unwrap();
    assert_eq!(slots.len(), 1);
    let slot = &slots[0];
    assert_eq!(
        slot.html,
        RichTextHtml {
            kind: Str::from("paragraph"),
            field: Str::from("text"),
            html: Str::from("<b>x</b>"),
        }
    );
    assert_eq!(slot.key, Str::from("text"));
    let Value::Object(first) = &exported[0] else {
        panic!("not an object: {:?}", exported[0]);
    };
    let want = first.get(&Str::from("data")).cloned();
    let target = slot
        .target_mut(&mut exported)
        .expect("the slot names no object");
    assert_eq!(Some(Value::Object(target.clone())), want);
    target.set(Str::from("marker"), Value::Bool(true));
    let Value::Object(first) = &exported[0] else {
        unreachable!()
    };
    let Some(Value::Object(data)) = first.get(&Str::from("data")) else {
        panic!("no data");
    };
    assert_eq!(data.get(&Str::from("marker")), Some(&Value::Bool(true)));
}
