use blok_jsjson::{Kind, Node};

/// YDocConverter.JsonMaxDepth, the reader bound for edits and the doc endpoint.
pub const JSON_MAX_DEPTH: usize = 512;

/// Looks up a key the way a JsonObject does: its first read decodes every
/// key of the object, so any bad key fails it. None for a non-object.
pub(crate) fn member<'a>(
    object: &'a Node,
    key: &str,
) -> Result<Option<&'a Node>, blok_jsjson::Error> {
    if object.kind != Kind::Object {
        return Ok(None);
    }
    let want: Vec<u16> = key.encode_utf16().collect();
    let mut found = None;
    for m in &object.members {
        let name = m.key()?;
        if found.is_none() && name[..] == want[..] {
            found = Some(&m.value);
        }
    }
    Ok(found)
}
