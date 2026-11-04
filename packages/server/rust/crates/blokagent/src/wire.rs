//! JSON the way the C# executor handles it: JsonNode.Parse with default
//! options (depth 64, repeats kept), JsonObject indexers, ToJsonString.

use blok_jsjson::{
    Kind, Node, NodeMember, Options as JsonOptions, Str, new_array, new_bool, new_member,
    new_object, new_string, parse_node, to_string_lossy,
};

use crate::errors::{Error, from_json, invalid_operation};
use crate::types::{Actor, Execution, Options};

pub(crate) fn parse(text: &str) -> Result<Node, Error> {
    parse_node(text.as_bytes(), JsonOptions::default()).map_err(from_json)
}

/// A member C# reads as non-null: JSON null is null there.
pub(crate) fn present(node: Option<&Node>) -> bool {
    node.is_some_and(|node| node.kind != Kind::Null)
}

pub(crate) fn get<'a>(node: &'a Node, key: &str) -> Result<Option<&'a Node>, Error> {
    let found = node.lookup(key).map_err(from_json)?;
    Ok(found.filter(|found| found.kind != Kind::Null))
}

pub(crate) fn get_mut<'a>(node: &'a mut Node, key: &str) -> Result<Option<&'a mut Node>, Error> {
    let found = node.lookup_mut(key).map_err(from_json)?;
    Ok(found.filter(|found| found.kind != Kind::Null))
}

/// `node?[key]`. Unlike `get`, it fails on a node that is not an object, as
/// the JsonObject indexer throws.
pub(crate) fn field<'a>(node: Option<&'a Node>, key: &str) -> Result<Option<&'a Node>, Error> {
    match node {
        Some(node) if node.kind != Kind::Null => {
            if node.kind != Kind::Object {
                return Err(invalid_operation("The node must be of type 'JsonObject'."));
            }
            get(node, key)
        }
        _ => Ok(None),
    }
}

/// `node?[0]`: a list's first item, or an object's first member. Both
/// throw when empty, and any other kind throws.
pub(crate) fn first(node: Option<&Node>) -> Result<Option<&Node>, Error> {
    let Some(node) = node.filter(|node| node.kind != Kind::Null) else {
        return Ok(None);
    };
    let item = match node.kind {
        Kind::Array => node.items.first().ok_or_else(|| Error::Argument {
            param: "index".to_owned(),
            message: "Index was out of range. Must be non-negative and less than the size of the collection.".to_owned(),
        })?,
        Kind::Object => &node
            .members
            .first()
            .ok_or_else(|| Error::Argument {
                param: "index".to_owned(),
                message: "Specified argument was out of the range of valid values.".to_owned(),
            })?
            .value,
        _ => {
            return Err(invalid_operation(
                "The node must be of type 'JsonArray, JsonObject'.",
            ));
        }
    };
    Ok(Some(item).filter(|item| item.kind != Kind::Null))
}

/// `node[key] as JsonObject`.
pub(crate) fn object<'a>(node: &'a Node, key: &str) -> Result<Option<&'a Node>, Error> {
    Ok(get(node, key)?.filter(|found| found.kind == Kind::Object))
}

pub(crate) fn set(node: &mut Node, key: &str, value: Node) -> Result<(), Error> {
    node.set(key, value).map_err(from_json)
}

pub(crate) fn write(node: &Node) -> Result<String, Error> {
    let mut out = Vec::new();
    node.append_json(&mut out).map_err(from_json)?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// `TryGetValue<string>`: a string's value, or None. A lone surrogate
/// escape throws there, as it does here.
pub(crate) fn text(node: Option<&Node>) -> Result<Option<String>, Error> {
    let Some(node) = node.filter(|node| node.kind == Kind::String) else {
        return Ok(None);
    };
    match node.text() {
        Ok(value) => Ok(Some(to_string_lossy(value.units()))),
        Err(err) if err.is(blok_jsjson::ErrorKind::LoneSurrogate) => Err(from_json(err)),
        Err(_) => Ok(None),
    }
}

/// `?.GetValue<string>()`: "" for null, an error for a non-string.
pub(crate) fn string_value(node: Option<&Node>) -> Result<String, Error> {
    let Some(node) = node.filter(|node| node.kind != Kind::Null) else {
        return Ok(String::new());
    };
    text(Some(node))?.ok_or_else(|| wrong_type(node, "String"))
}

/// `?["ok"]?.GetValue<bool>() == true`.
pub(crate) fn is_true(node: Option<&Node>, key: &str) -> Result<bool, Error> {
    match field(node, key)? {
        None => Ok(false),
        Some(found) => match found.kind {
            Kind::True => Ok(true),
            Kind::False => Ok(false),
            _ => Err(wrong_type(found, "Boolean")),
        },
    }
}

/// `?.GetValue<int>() ?? 0`.
pub(crate) fn int_value(node: Option<&Node>) -> Result<i32, Error> {
    let Some(node) = node.filter(|node| node.kind != Kind::Null) else {
        return Ok(0);
    };
    if node.kind == Kind::Number
        && let Some(value) = std::str::from_utf8(node.raw())
            .ok()
            .and_then(|raw| raw.parse::<i32>().ok())
    {
        return Ok(value);
    }
    Err(wrong_type(node, "Int32"))
}

/// What GetValue<T> throws on a parsed node of another kind.
pub(crate) fn wrong_type(node: &Node, target: &str) -> Error {
    let kind = match node.kind {
        Kind::Array | Kind::Object => {
            return invalid_operation("The node must be of type 'JsonValue'.");
        }
        Kind::False => "False",
        Kind::True => "True",
        Kind::Number => "Number",
        Kind::String => "String",
        Kind::Null => "",
    };
    Error::InvalidOperation(format!(
        "An element of type '{kind}' cannot be converted to a 'System.{target}'."
    ))
}

pub(crate) fn str_node(value: &str) -> Node {
    new_string(Str::from_utf8(value.as_bytes()).units())
}

pub(crate) fn member(key: &str, value: Node) -> NodeMember {
    new_member(key, value)
}

/// C#'s Common: the option keys every operation sends, in order.
pub(crate) fn common(options: Option<&Options>) -> Result<Node, Error> {
    let default = Options::default();
    let options = options.unwrap_or(&default);
    let target = options.page_target.as_deref();
    let mut services = Vec::new();
    if options.page_titles && target.is_some() {
        services.push(str_node("pageBackend"));
    }
    let mut input = new_object(vec![member("services", new_array(services))]);
    // The bundle inserts a page only with ids made first (createdPages), so
    // it lists page as prepared.
    if options.page_titles && target.is_some_and(|target| target.as_creator().is_some()) {
        input
            .members
            .push(member("prepares", new_array(vec![str_node("page")])));
    }
    if let Some(tools) = &options.custom_tools_json {
        input.members.push(member("customTools", parse(tools)?));
    }
    if let Some(overrides) = &options.overrides_json {
        input.members.push(member("overrides", parse(overrides)?));
    }
    if options.disable_built_in_comments {
        input.members.push(member("comments", new_bool(false)));
    }
    Ok(input)
}

pub(crate) fn actor_node(actor: &Actor) -> Node {
    let mut node = new_object(vec![
        member("id", str_node(&actor.id)),
        member("name", str_node(&actor.name)),
        member("kind", str_node("agent")),
    ]);
    if let Some(on_behalf_of) = &actor.on_behalf_of {
        node.members
            .push(member("onBehalfOf", str_node(on_behalf_of)));
    }
    node
}

/// C#'s Failure: ok, error, warnings, then revision when not empty.
pub(crate) fn failure(
    code: &str,
    message: &str,
    retryable: bool,
    details: Option<Node>,
    revision: &str,
) -> Result<Execution, Error> {
    let mut error = new_object(vec![
        member("code", str_node(code)),
        member("message", str_node(message)),
        member("retryable", new_bool(retryable)),
    ]);
    if let Some(details) = details {
        error.members.push(member("details", details));
    }
    let mut result = new_object(vec![
        member("ok", new_bool(false)),
        member("error", error),
        member("warnings", new_array(Vec::new())),
    ]);
    if !revision.is_empty() {
        result.members.push(member("revision", str_node(revision)));
    }
    Ok(Execution {
        result_json: write(&result)?,
        document_json: None,
        revision: revision.to_owned(),
    })
}

/// C#'s Unavailable: ok, error, warnings, never a revision.
pub(crate) fn unavailable(message: &str) -> Result<Execution, Error> {
    failure(
        "COMMAND_UNAVAILABLE",
        message,
        false,
        Some(new_object(vec![member("reason", str_node("runtime"))])),
        "",
    )
}

/// C#'s SourceExecution: the result as written, no document.
pub(crate) fn source_execution(result: &Node) -> Result<Execution, Error> {
    Ok(Execution {
        result_json: write(result)?,
        document_json: None,
        revision: revision_of(result)?,
    })
}

pub(crate) fn revision_of(result: &Node) -> Result<String, Error> {
    string_value(get(result, "revision")?)
}
