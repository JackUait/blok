use std::collections::BTreeMap;

use blok_collab_collabtest as collabtest;
use blok_jsjson::{Str, Value};

use crate::fields::{RichTextFieldEntry, RichTextFields};

fn s(text: &str) -> Str {
    Str::from(text)
}

fn entry(kind: &str, fields: Option<&[&str]>) -> RichTextFieldEntry {
    RichTextFieldEntry {
        kind: s(kind),
        fields: fields.map(|fields| fields.iter().map(|field| s(field)).collect()),
    }
}

fn rich(fields: &RichTextFields, kind: &str, key: &str) -> bool {
    fields.is_rich(&s(kind), &s(key))
}

// Twin of RichTextFieldsTests: the built-ins equal the client table the TS suite pins.
#[test]
fn built_in_rich_text_fields_equal_the_client_table() {
    let Value::Object(object) = collabtest::read("rich-text-fields.json") else {
        panic!("not an object");
    };
    let fixture: BTreeMap<Str, Vec<Str>> = object
        .members()
        .iter()
        .map(|member| {
            let Value::Array(items) = &member.value else {
                panic!("not an array");
            };
            let fields = items
                .iter()
                .map(|item| match item {
                    Value::String(field) => field.clone(),
                    other => panic!("{other:?}"),
                })
                .collect();
            (member.key.clone(), fields)
        })
        .collect();
    assert_eq!(RichTextFields::built_in().table(), fixture);
    for (kind, key, want) in [
        ("paragraph", "text", true),
        ("header", "text", true),
        ("quote", "text", true),
        ("toggle", "text", true),
        ("list", "text", true),
        ("quote", "caption", false),
        ("code", "code", false),
        ("image", "caption", false),
        ("custom", "text", false),
        ("", "text", false),
    ] {
        assert_eq!(
            rich(&RichTextFields::built_in(), kind, key),
            want,
            "{kind}.{key}"
        );
    }
}

#[test]
fn custom_rich_text_fields_add_to_the_built_ins() {
    let fields = RichTextFields::new(&[
        entry("callout", Some(&["title", "body"])),
        entry("paragraph", Some(&["note"])),
    ])
    .unwrap();
    assert!(
        rich(&fields, "callout", "title")
            && rich(&fields, "callout", "body")
            && rich(&fields, "paragraph", "text")
            && rich(&fields, "paragraph", "note")
            && !rich(&fields, "callout", "text")
            && !rich(&RichTextFields::built_in(), "callout", "title"),
        "custom fields did not add to the built-ins"
    );
    let empty = RichTextFields::new(&[entry("divider", Some(&[]))]).unwrap();
    // C# keeps a type listed with no fields in the table.
    assert_eq!(empty.table().get(&s("divider")), Some(&Vec::new()));
    for bad in [
        entry("", Some(&["text"])),
        entry("callout", Some(&[""])),
        entry("call\0out", Some(&["text"])),
        entry("callout", Some(&["ti\0tle"])),
        entry("callout", None),
    ] {
        assert!(
            RichTextFields::new(std::slice::from_ref(&bad)).is_err(),
            "{:?} accepted",
            bad.kind
        );
    }
}

// C# walks the custom list in its given order and refuses the first bad
// entry (RichTextFields.With), so Rust must report that one too.
#[test]
fn the_first_bad_entry_in_input_order_is_reported() {
    let err = RichTextFields::new(&[entry("z", None), entry("", Some(&["text"]))]).unwrap_err();
    assert_eq!(
        err.to_string(),
        "rich text fields: block type \"z\" has a null field list."
    );
}
