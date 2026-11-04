#![allow(dead_code)]

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_jsjson::{Kind, Node, Options, parse_node};

pub fn at(seconds: i64) -> SystemTime {
    if seconds >= 0 {
        UNIX_EPOCH + Duration::from_secs(seconds as u64)
    } else {
        UNIX_EPOCH - Duration::from_secs(seconds.unsigned_abs())
    }
}

pub fn load(name: &str) -> Node {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap()
}

pub fn get<'a>(node: &'a Node, key: &str) -> Option<&'a Node> {
    node.members
        .iter()
        .rev()
        .find(|m| m.key().unwrap().to_string() == key)
        .map(|m| &m.value)
}

pub fn text(node: &Node, key: &str) -> String {
    let value = get(node, key).unwrap_or_else(|| panic!("no {key}"));
    assert_eq!(value.kind, Kind::String, "{key}");
    value.text().unwrap().to_string()
}

pub fn opt_text(node: &Node, key: &str) -> Option<String> {
    match get(node, key) {
        None => None,
        Some(value) if value.kind == Kind::Null => None,
        Some(_) => Some(text(node, key)),
    }
}

pub fn flag(node: &Node, key: &str) -> bool {
    get(node, key).is_some_and(|v| v.kind == Kind::True)
}

pub fn int(node: &Node, key: &str) -> i64 {
    get(node, key).map_or(0, |v| {
        std::str::from_utf8(v.raw()).unwrap().parse().unwrap()
    })
}
