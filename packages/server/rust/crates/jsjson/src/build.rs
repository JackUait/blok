//! Building and editing nodes the way JsonObject and JsonArray do, for
//! hosts that assemble JSON in C#'s key order.

use crate::error::{Error, ErrorKind};
use crate::node::{Kind, Node, NodeMember, append_quoted, decode_for_write};
use crate::str::Str;

fn quoted_inner(s: &[u16]) -> Vec<u8> {
    let mut quoted = Vec::new();
    append_quoted(&mut quoted, s);
    quoted[1..quoted.len() - 1].to_vec()
}

/// JsonValue.Create(string).
pub fn new_string(s: &[u16]) -> Node {
    Node::leaf(Kind::String, quoted_inner(s))
}

/// JsonValue.Create(bool).
pub fn new_bool(value: bool) -> Node {
    Node::leaf(if value { Kind::True } else { Kind::False }, Vec::new())
}

/// A JSON null, as a null member of a JsonObject writes.
pub fn new_null() -> Node {
    Node::leaf(Kind::Null, Vec::new())
}

/// A number written as text, which must be a JSON number.
pub fn new_number(text: &str) -> Node {
    Node::leaf(Kind::Number, text.as_bytes().to_vec())
}

/// A JsonArray of items.
pub fn new_array(items: Vec<Node>) -> Node {
    let mut node = Node::leaf(Kind::Array, Vec::new());
    node.items = items;
    node
}

/// A JsonObject with members in this order.
pub fn new_object(members: Vec<NodeMember>) -> Node {
    let mut node = Node::leaf(Kind::Object, Vec::new());
    node.members = members;
    node
}

/// One object member.
pub fn new_member(key: &str, value: Node) -> NodeMember {
    NodeMember {
        raw: quoted_inner(&Str::from(key)),
        value,
    }
}

impl Node {
    /// Reads every key, as a JsonObject does the first time it is indexed:
    /// a lone-surrogate key or a repeated key fails the whole lookup.
    /// Invalid UTF-8 reads as U+FFFD, as it does in a .NET string.
    fn index(&self, key: &str) -> Result<Option<usize>, Error> {
        let mut seen = std::collections::HashSet::with_capacity(self.members.len());
        let mut at = None;
        for (i, member) in self.members.iter().enumerate() {
            let text = decode_for_write(&member.raw)?.to_string();
            if seen.contains(&text) {
                return Err(Error::new(
                    ErrorKind::Duplicate,
                    format!("An item with the same key has already been added. Key: {text}"),
                ));
            }
            if text == key {
                at = Some(i);
            }
            seen.insert(text);
        }
        Ok(at)
    }

    /// JsonNode?["key"] read as `as JsonObject`-guarded code reads it: None
    /// when the node is not an object or has no such member. A JSON null
    /// member is a `Kind::Null` node, so test for it where C# would see null.
    pub fn lookup(&self, key: &str) -> Result<Option<&Node>, Error> {
        if self.kind != Kind::Object {
            return Ok(None);
        }
        Ok(self.index(key)?.map(|at| &self.members[at].value))
    }

    /// `lookup` for editing in place.
    pub fn lookup_mut(&mut self, key: &str) -> Result<Option<&mut Node>, Error> {
        if self.kind != Kind::Object {
            return Ok(None);
        }
        Ok(self.index(key)?.map(|at| &mut self.members[at].value))
    }

    /// The JsonObject indexer setter: the value replaces the member in
    /// place, or is added at the end.
    pub fn set(&mut self, key: &str, value: Node) -> Result<(), Error> {
        match self.index(key)? {
            Some(at) => self.members[at].value = value,
            None => self.members.push(new_member(key, value)),
        }
        Ok(())
    }

    /// Drops the member named key and reports whether there was one.
    pub fn remove(&mut self, key: &str) -> bool {
        match self.index(key) {
            Ok(Some(at)) => {
                self.members.remove(at);
                true
            }
            _ => false,
        }
    }
}
