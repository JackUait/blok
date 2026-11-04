use std::sync::OnceLock;

use blok_jsjson::{Kind, Node, Options as JsonOptions, parse_node};

use crate::wire::text;
use crate::{Executor, FactoryOptions};

pub(crate) fn must_parse(text: &str) -> Node {
    let options = JsonOptions {
        max_depth: 512,
        ..JsonOptions::default()
    };
    parse_node(text.as_bytes(), options).unwrap_or_else(|err| panic!("parse: {err}"))
}

pub(crate) fn lookup<'a>(node: Option<&'a Node>, key: &str) -> Option<&'a Node> {
    node.and_then(|node| node.lookup(key).ok().flatten())
}

pub(crate) fn string_of(node: Option<&Node>) -> Option<String> {
    text(node).ok().flatten()
}

/// C# Stable: keys sorted by UTF-16 units at every depth.
pub(crate) fn stable(node: Option<&Node>) -> String {
    let Some(node) = node else {
        return "null".to_owned();
    };
    let mut out = Vec::new();
    node.append_canonical(&mut out)
        .unwrap_or_else(|err| panic!("stable: {err}"));
    String::from_utf8_lossy(&out).into_owned()
}

/// Follows a JSON pointer; None when a step is missing.
pub(crate) fn pointer<'a>(root: &'a Node, path: &str) -> Option<&'a Node> {
    let mut found = root;
    for part in path.split('/').skip(1) {
        found = match found.kind {
            Kind::Object => found.lookup(part).ok().flatten()?,
            Kind::Array => found.items.get(part.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(found)
}

/// One pool for the crate's real-bundle tests: each engine parses the bundle.
pub(crate) fn shared_executor() -> &'static Executor {
    static EXECUTOR: OnceLock<Executor> = OnceLock::new();
    EXECUTOR.get_or_init(|| {
        Executor::new(FactoryOptions {
            pool_size: 1,
            ..FactoryOptions::default()
        })
        .expect("new")
    })
}
