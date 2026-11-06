//! Helpers the ported Go tests share (Go keeps them in decode_test.go,
//! pending_test.go and integration_test.go).

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_jsjson::{Object, Str, Value};
use blok_yjs_yjstest as yjstest;

use crate::{ApplyResult, DecodedUpdate, Doc, Options, decode};

pub const PINNED_CLIENT: u64 = 1000;
pub const PEER: u64 = 7;

pub fn s(text: &str) -> Str {
    Str::from(text)
}

pub fn sv(text: &str) -> Value {
    Value::String(Str::from(text))
}

pub fn num(n: f64) -> Value {
    Value::Number(n)
}

pub fn obj(pairs: Vec<(&str, Value)>) -> Object {
    pairs.into_iter().map(|(k, v)| (Str::from(k), v)).collect()
}

pub fn vobj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(obj(pairs))
}

pub fn fixture_cases(file: &str) -> Vec<Value> {
    yjstest::cases(file).unwrap_or_else(|err| panic!("{err}"))
}

pub fn fixture_case(file: &str, name: &str) -> Value {
    fixture_cases(file)
        .into_iter()
        .find(|c| yjstest::string(c, "name") == name)
        .unwrap_or_else(|| panic!("{file} has no case {name}"))
}

pub fn fixture_bytes(value: &Value, key: &str) -> Vec<u8> {
    yjstest::bytes(value, key).unwrap_or_else(|err| panic!("{err}"))
}

pub fn canonical(value: &Value) -> String {
    yjstest::canonical(value).unwrap_or_else(|err| panic!("{err}"))
}

pub fn must_decode(update: &[u8]) -> DecodedUpdate {
    decode(update).unwrap_or_else(|err| panic!("{err}"))
}

pub fn b64(text: &str) -> Vec<u8> {
    STANDARD.decode(text).unwrap_or_else(|err| panic!("{err}"))
}

pub fn b64_encode(data: &[u8]) -> String {
    STANDARD.encode(data)
}

pub fn doc_with_id(id: u32) -> Doc {
    Doc::new(Options {
        client_id: Some(id),
        no_gc: false,
    })
}

pub fn pinned_doc() -> Doc {
    doc_with_id(PINNED_CLIENT as u32)
}

pub fn apply_bytes(doc: &Doc, update: &[u8]) -> ApplyResult {
    doc.apply_update(update)
        .unwrap_or_else(|err| panic!("{err}"))
}

pub fn encode_state(doc: &Doc, target: &[u8]) -> Vec<u8> {
    doc.encode_state_as_update(target)
        .unwrap_or_else(|err| panic!("{err}"))
}

/// Go's mustEncode: fails the test on an error or an engine panic.
pub fn must_encode(doc: &Doc, target: &[u8]) -> Vec<u8> {
    encode_state(doc, target)
}

pub fn parse_raw(raw: &Str) -> Value {
    blok_jsjson::parse(raw.to_string().as_bytes()).unwrap_or_else(|err| panic!("{err}"))
}

pub const STORE_CLIENT: u64 = 1000;

/// Go's anyItem: a ContentAny item, not yet in any run.
pub fn any_item(client: u64, clock: u64, values: Vec<Value>) -> crate::item::Item {
    item_with(client, clock, crate::content::Content::Any(values))
}

pub fn item_with(client: u64, clock: u64, content: crate::content::Content) -> crate::item::Item {
    crate::item::Item {
        id: crate::Id::new(client, clock),
        length: content.len(),
        origin: None,
        right_origin: None,
        left: None,
        right: None,
        parent: crate::item::Parent::None,
        parent_sub: None,
        wire_parent_sub_bit: false,
        content,
        deleted: false,
        keep: false,
        redone: None,
    }
}

/// Allocates and files an item; panics on a refused add.
pub fn add_item(store: &mut crate::store::Store, item: crate::item::Item) -> crate::item::ItemId {
    let id = store.alloc(item);
    store.add_struct(crate::item::Struct::Item(id)).unwrap();
    id
}

pub fn is_str(value: &crate::Out, want: &str) -> bool {
    matches!(value, crate::Out::Any(Value::String(text)) if text.to_string() == want)
}
