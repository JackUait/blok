use blok_jsjson::Str;
use blok_lib0::Writer;
use blok_yjs::{Doc, Options};

use crate::export::export;
use crate::fields::{RichTextFieldEntry, RichTextFields};

// Twins of C# YDocConverterLoneSurrogateTests: a type or data key matches a
// rich field as exact UTF-16, so a lone surrogate is not its U+FFFD
// replacement.

#[test]
fn a_type_of_a_lone_surrogate_is_not_its_replacements_rich_field() {
    assert_eq!(slot_count(false, &[0xfffd], &units("text")), 0);
    assert_eq!(slot_count(false, &[0xd800], &units("text")), 1);
}

#[test]
fn a_nested_data_key_of_a_lone_surrogate_is_not_its_replacements_rich_field() {
    let callout: Vec<u16> = "callout".encode_utf16().collect();
    assert_eq!(slot_count(true, &callout, &[0xfffd]), 0);
    assert_eq!(slot_count(true, &callout, &[0xd800]), 1);
}

fn slot_count(nested: bool, kind: &[u16], field: &[u16]) -> usize {
    let fields = RichTextFields::new(&[RichTextFieldEntry {
        kind: Str::from(kind),
        fields: Some(vec![Str::from(field)]),
    }])
    .unwrap_or_else(|err| panic!("{err:?}"));
    let (_, slots) = export(&room(nested), &fields, None).unwrap_or_else(|err| panic!("{err}"));
    slots.len()
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

// C# YDocConverterLoneSurrogateTests.Room.
fn room(nested: bool) -> Doc {
    let mut w = Writer::new();
    let field = |w: &mut Writer, key: &str, info: u8, parent_clock: u64| {
        w.write_uint8(info);
        w.write_var_uint(0);
        w.write_var_uint(1);
        w.write_var_uint(parent_clock);
        w.write_var_string(&units(key));
    };
    let any_string = |w: &mut Writer, value: &str| {
        w.write_var_uint(1);
        w.write_uint8(119);
        w.write_var_string(&units(value));
    };
    w.write_var_uint(1);
    w.write_var_uint(if nested { 6 } else { 7 });
    w.write_var_uint(1);
    w.write_var_uint(0);
    w.write_uint8(0x27);
    w.write_var_uint(1);
    w.write_var_string(&units("blocks"));
    w.write_var_string(&units("p"));
    w.write_var_uint(1);
    field(&mut w, "id", 0x28, 0);
    any_string(&mut w, "p");
    if nested {
        field(&mut w, "type", 0x28, 0);
        any_string(&mut w, "database-row");
    } else {
        field(&mut w, "type", 0x22, 0);
        w.write_var_uint(1);
        w.write_var_string(&units(r#""\ud800""#));
    }
    field(&mut w, "data", 0x27, 0);
    w.write_var_uint(1);
    if nested {
        field(&mut w, "properties", 0x22, 3);
        w.write_var_uint(1);
        w.write_var_string(&units(
            r#"{"p":{"blocks":[{"type":"callout","data":{"\ud800":"<b>x</b>"}}]}}"#,
        ));
    } else {
        field(&mut w, "text", 0x27, 3);
        w.write_var_uint(2);
        w.write_uint8(0x04);
        w.write_var_uint(0);
        w.write_var_uint(1);
        w.write_var_uint(4);
        w.write_var_string(&units("<b>x</b>"));
    }
    w.write_uint8(0x08);
    w.write_var_uint(1);
    w.write_var_string(&units("root"));
    any_string(&mut w, "p");
    w.write_var_uint(0);
    let doc = Doc::new(Options {
        client_id: Some(2),
        no_gc: false,
    });
    doc.apply_update(w.bytes())
        .unwrap_or_else(|err| panic!("{err}"));
    doc
}
