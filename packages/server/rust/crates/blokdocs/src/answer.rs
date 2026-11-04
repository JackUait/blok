//! Reading the runtime's answers the way System.Text.Json's JsonSerializer
//! reads them into the C# records: case-sensitive names, unknown members
//! ignored, missing ones left zero, a wrong type or a lone-surrogate string
//! refused as JSON.

use blok_jsjson::{Kind, Node, Options, parse_node, to_string_lossy};

use crate::errors::{Error, not_json};
use crate::types::Degradation;

pub(crate) fn parse_answer(output: &str) -> Result<Node, Error> {
    parse_node(output.as_bytes(), Options::default()).map_err(|_| not_json())
}

/// The last member of that name, as a JsonSerializer read keeps it.
pub(crate) fn member<'a>(object: &'a Node, name: &str) -> Option<&'a Node> {
    let mut found = None;
    for m in &object.members {
        if let Ok(key) = m.key()
            && to_string_lossy(key.units()) == name
        {
            found = Some(&m.value);
        }
    }
    found
}

pub(crate) fn read_string(node: Option<&Node>) -> Result<String, Error> {
    match node {
        None => Ok(String::new()),
        Some(node) if node.kind == Kind::Null => Ok(String::new()),
        Some(node) if node.kind != Kind::String => Err(not_json()),
        Some(node) => {
            let text = node.text().map_err(|_| not_json())?;
            Ok(to_string_lossy(text.units()))
        }
    }
}

pub(crate) fn read_optional_string(node: Option<&Node>) -> Result<Option<String>, Error> {
    match node {
        None => Ok(None),
        Some(node) if node.kind == Kind::Null => Ok(None),
        some => read_string(some).map(Some),
    }
}

pub(crate) fn read_int(node: Option<&Node>) -> Result<i32, Error> {
    let Some(node) = node else { return Ok(0) };
    if node.kind != Kind::Number {
        return Err(not_json());
    }
    std::str::from_utf8(node.raw())
        .ok()
        .and_then(|text| text.parse::<i32>().ok())
        .ok_or_else(not_json)
}

pub(crate) fn read_bool(node: Option<&Node>) -> Result<bool, Error> {
    match node.map(|node| node.kind) {
        None | Some(Kind::False) => Ok(false),
        Some(Kind::True) => Ok(true),
        Some(_) => Err(not_json()),
    }
}

/// Calls `item` for each element. A missing or JSON null array is None.
pub(crate) fn read_array<T>(
    node: Option<&Node>,
    mut item: impl FnMut(&Node) -> Result<T, Error>,
) -> Result<Option<Vec<T>>, Error> {
    let Some(node) = node else { return Ok(None) };
    match node.kind {
        Kind::Null => Ok(None),
        Kind::Array => node
            .items
            .iter()
            .map(&mut item)
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        _ => Err(not_json()),
    }
}

pub(crate) fn read_strings(node: Option<&Node>) -> Result<Vec<String>, Error> {
    Ok(read_array(node, |element| read_string(Some(element)))?.unwrap_or_default())
}

/// None for JSON null, as Deserialize returns null.
pub(crate) fn read_object(node: Option<&Node>) -> Result<Option<&Node>, Error> {
    match node {
        None => Ok(None),
        Some(node) if node.kind == Kind::Null => Ok(None),
        Some(node) if node.kind != Kind::Object => Err(not_json()),
        Some(node) => Ok(Some(node)),
    }
}

pub(crate) fn read_degradations(node: Option<&Node>) -> Result<Vec<Degradation>, Error> {
    Ok(read_array(node, |element| {
        let Some(object) = read_object(Some(element))? else {
            return Ok(Degradation::default());
        };
        Ok(Degradation {
            construct: read_string(member(object, "construct"))?,
            action: read_string(member(object, "action"))?,
            detail: read_string(member(object, "detail"))?,
        })
    })?
    .unwrap_or_default())
}

/// Reads `{<text_key>, warnings}`. None for a JSON null answer.
pub(crate) fn read_report(
    output: &str,
    text_key: &str,
) -> Result<Option<(String, Vec<Degradation>)>, Error> {
    let node = parse_answer(output)?;
    let Some(object) = read_object(Some(&node))? else {
        return Ok(None);
    };
    let text = read_string(member(object, text_key))?;
    let warnings = read_degradations(member(object, "warnings"))?;
    Ok(Some((text, warnings)))
}
