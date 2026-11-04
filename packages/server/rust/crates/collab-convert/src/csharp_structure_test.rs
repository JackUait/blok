use blok_jsjson::{Object, Str, Value};
use blok_yjs::{Doc, Options};

use crate::structure::plain_page_maps;

// C# PlainPageMaps leaves out a plain map value holding one JSON cannot
// (a peer's nested bigint), as ExportPage leaves out such an icon.
#[test]
fn plain_page_maps_leaves_out_a_nested_bigint() {
    let doc = Doc::new(Options::default());
    let values = doc.get_map("values").unwrap();
    let mut held = Object::new();
    held.set(Str::from("n"), Value::BigInt(1));
    doc.transact(|txn| {
        values.set(txn, "x", Value::Object(held))?;
        values.set(txn, "kept", Value::String("plain".into()))
    })
    .unwrap();

    let maps = plain_page_maps(&doc, &[]).unwrap();

    assert_eq!(maps.len(), 1);
    assert_eq!(maps[0].name, "values");
    assert_eq!(
        maps[0]
            .map
            .members()
            .iter()
            .map(|m| m.key.to_string())
            .collect::<Vec<_>>(),
        ["kept"]
    );
}
