use blok_jsjson::{Object, Str, Value};
use blok_yjs::{Doc, Options};

use crate::error::Error;
use crate::structure::plain_page_maps;

// C# PlainPageMaps runs RichText.ToJsonNode over a plain map value, which
// throws on a nested bigint a peer can write. Go panics there instead.
#[test]
fn plain_page_maps_refuses_a_nested_bigint_as_csharp_throws() {
    let doc = Doc::new(Options::default());
    let values = doc.get_map("values").unwrap();
    let mut held = Object::new();
    held.set(Str::from("n"), Value::BigInt(1));
    doc.transact(|txn| values.set(txn, "x", Value::Object(held)))
        .unwrap();
    match plain_page_maps(&doc, &[]) {
        Err(Error::Data(err)) => assert_eq!(
            err.message,
            "collab: unsupported value BigInteger in rich text."
        ),
        other => panic!("{other:?}"),
    }
}
