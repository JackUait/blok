//! Reads the shared fixtures with blok-jsjson, as Go's tests read them with
//! encoding/json: a missing string is "", a missing number is 0.

use blok_jsjson::{Kind, Node, Options, parse_node};

pub(crate) fn load(relative: &str) -> Node {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{relative}",
        env!("CARGO_MANIFEST_DIR")
    );
    parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap()
}

pub(crate) fn get<'a>(node: &'a Node, key: &str) -> Option<&'a Node> {
    node.members
        .iter()
        .rev()
        .find(|m| m.key().unwrap().to_string() == key)
        .map(|m| &m.value)
        .filter(|v| v.kind != Kind::Null)
}

pub(crate) fn at<'a>(node: &'a Node, key: &str) -> &'a Node {
    get(node, key).unwrap_or_else(|| panic!("no {key}"))
}

pub(crate) fn text(node: &Node, key: &str) -> String {
    opt_text(node, key).unwrap_or_default()
}

pub(crate) fn opt_text(node: &Node, key: &str) -> Option<String> {
    let value = get(node, key)?;
    assert_eq!(value.kind, Kind::String, "{key}");
    Some(value.text().unwrap().to_string())
}

pub(crate) fn flag(node: &Node, key: &str) -> bool {
    get(node, key).is_some_and(|v| v.kind == Kind::True)
}

pub(crate) fn number(node: &Node, key: &str) -> i64 {
    get(node, key).map_or(0, |v| {
        assert_eq!(v.kind, Kind::Number, "{key}");
        std::str::from_utf8(v.raw()).unwrap().parse().unwrap()
    })
}

pub(crate) fn items<'a>(node: &'a Node, key: &str) -> &'a [Node] {
    get(node, key).map_or(&[], |v| &v.items)
}

pub(crate) fn unhex(text: &str) -> Vec<u8> {
    assert!(text.len().is_multiple_of(2), "odd hex");
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

pub(crate) fn hex(b: &[u8]) -> String {
    crate::codec::lower_hex(b)
}

pub(crate) fn u64_text(node: &Node, key: &str) -> u64 {
    text(node, key).parse().unwrap()
}

pub(crate) fn i64_text(node: &Node, key: &str) -> i64 {
    text(node, key).parse().unwrap()
}

pub(crate) struct TempDir(pub std::path::PathBuf);

impl TempDir {
    pub(crate) fn new() -> TempDir {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "blok-journal-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        // Canonical, so a path in a log line matches the one the test built.
        TempDir(std::fs::canonicalize(&path).unwrap())
    }

    pub(crate) fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
