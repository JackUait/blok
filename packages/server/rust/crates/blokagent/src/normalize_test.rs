use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

use blok_jsjson::{
    Kind, Member, Node, NodeMember, Str, append_quoted, compare, format_number, key_order,
    new_array, new_bool, new_member, new_null, new_number, new_object, to_string_lossy,
};

use crate::host_fixture_test::read_repo_file;
use crate::test_support::{lookup, must_parse, stable, string_of};
use crate::wire::{present, str_node};

// A Rust twin of the C# AgentParityNormalizer (and so of
// test/unit/agent/parity/normalize.ts), ported from Go normalize_test.go.
// Pinned by test/fixtures/agent-commands/normalizer-cases.json, and its
// rich-text step by fixtures/rich-text-canonical.

fn load_defaults(kind: &str) -> Vec<NodeMember> {
    match kind {
        "code" => vec![new_member("lineNumbers", new_bool(true))],
        "quote" => vec![new_member("size", str_node("default"))],
        "callout" => vec![
            new_member("textColor", new_null()),
            new_member("backgroundColor", new_null()),
        ],
        _ => Vec::new(),
    }
}

fn empty_automations() -> Node {
    new_object(vec![
        new_member("version", new_number("1")),
        new_member("definitions", new_array(Vec::new())),
    ])
}

fn key_of(member: &NodeMember) -> String {
    member
        .key()
        .map(|key| to_string_lossy(key.units()))
        .unwrap_or_default()
}

fn units(text: &str) -> Vec<u16> {
    Str::from_utf8(text.as_bytes()).into_units()
}

fn by_units(a: &str, b: &str) -> std::cmp::Ordering {
    compare(&units(a), &units(b))
}

fn set_member(node: &mut Node, key: &str, value: Node) {
    let _ = node.set(key, value);
}

/// Numbers compare by value, as JsonNode.DeepEquals does.
pub(crate) fn deep_equals(a: Option<&Node>, b: Option<&Node>) -> bool {
    let (Some(a), Some(b)) = (a, b) else {
        let null = |n: Option<&Node>| n.is_none_or(|n| n.kind == Kind::Null);
        return null(a) && null(b);
    };
    if a.kind != b.kind {
        return false;
    }
    match a.kind {
        Kind::Number => {
            let value = |n: &Node| {
                std::str::from_utf8(n.raw())
                    .ok()
                    .and_then(|raw| raw.parse::<f64>().ok())
            };
            value(a) == value(b)
        }
        Kind::String => string_of(Some(a)) == string_of(Some(b)),
        Kind::Array => {
            a.items.len() == b.items.len()
                && a.items
                    .iter()
                    .zip(&b.items)
                    .all(|(x, y)| deep_equals(Some(x), Some(y)))
        }
        Kind::Object => {
            a.members.len() == b.members.len()
                && a.members.iter().all(|m| {
                    let other = b.lookup(&key_of(m)).ok().flatten();
                    other.is_some() && deep_equals(Some(&m.value), other)
                })
        }
        _ => true,
    }
}

fn type_of(block: &Node) -> String {
    string_of(lookup(Some(block), "type")).unwrap_or_default()
}

pub(crate) fn id_of(block: &Node) -> Option<String> {
    string_of(lookup(Some(block), "id"))
}

fn parent_of(block: &Node) -> Option<String> {
    string_of(lookup(Some(block), "parent"))
}

pub(crate) fn records(node: Option<&Node>) -> Vec<&Node> {
    match node {
        Some(node) if node.kind == Kind::Array => node
            .items
            .iter()
            .filter(|item| item.kind == Kind::Object)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn normalize_document(document: &Node, keep: &HashSet<String>) -> Node {
    let blocks: Vec<Node> = lookup(Some(document), "blocks")
        .map(|list| list.items.clone())
        .unwrap_or_default();
    let blocks = canonical_databases(blocks);
    let mut by_id = HashMap::new();
    for (i, block) in blocks.iter().enumerate() {
        if let Some(id) = id_of(block) {
            by_id.insert(id, i);
        }
    }
    let mut ordered: Vec<(usize, String)> = Vec::new();
    let mut visited = HashSet::new();
    fn walk(
        index: usize,
        label: String,
        blocks: &[Node],
        by_id: &HashMap<String, usize>,
        visited: &mut HashSet<usize>,
        ordered: &mut Vec<(usize, String)>,
    ) {
        if !visited.insert(index) {
            return;
        }
        let block = &blocks[index];
        ordered.push((index, label.clone()));
        let mut children = Vec::new();
        if let Some(content) = lookup(Some(block), "content").filter(|c| c.kind == Kind::Array) {
            for item in &content.items {
                if let Some(child) = string_of(Some(item)).and_then(|id| by_id.get(&id)) {
                    children.push(*child);
                }
            }
        }
        if children.is_empty()
            && let Some(own) = id_of(block)
        {
            for (i, other) in blocks.iter().enumerate() {
                if parent_of(other).as_deref() == Some(own.as_str()) {
                    children.push(i);
                }
            }
        }
        for (i, child) in children.into_iter().enumerate() {
            walk(
                child,
                format!("{label}.{i}"),
                blocks,
                by_id,
                visited,
                ordered,
            );
        }
    }
    let roots: Vec<usize> = blocks
        .iter()
        .enumerate()
        .filter(|(_, block)| !present(lookup(Some(block), "parent")))
        .map(|(i, _)| i)
        .collect();
    for (i, root) in roots.iter().enumerate() {
        walk(
            *root,
            format!("b{i}"),
            &blocks,
            &by_id,
            &mut visited,
            &mut ordered,
        );
    }
    let mut next = roots.len();
    for i in 0..blocks.len() {
        if !visited.contains(&i) {
            walk(
                i,
                format!("b{next}"),
                &blocks,
                &by_id,
                &mut visited,
                &mut ordered,
            );
            next += 1;
        }
    }
    let mut names = HashMap::new();
    for (index, label) in &ordered {
        if let Some(id) = id_of(&blocks[*index])
            && !keep.contains(&id)
        {
            names.insert(id, label.clone());
        }
    }
    let output = new_array(
        ordered
            .iter()
            .map(|(index, _)| clean(&blocks[*index], &names))
            .collect(),
    );
    let mut result = new_object(vec![new_member("blocks", output)]);
    for key in ["title", "icon"] {
        if let Some(value) = lookup(Some(document), key).filter(|v| v.kind != Kind::Null) {
            set_member(&mut result, key, value.clone());
        }
    }
    result
}

// A ranked node's position is replaced in place by this mark and its rank;
// relabel writes the rank without relabelling it, as Go keeps ranks apart.
const RANKED: &str = "\u{0}rank:";

fn rank(siblings: &mut [&mut Node]) {
    let mut keys: Vec<String> = Vec::new();
    for sibling in siblings.iter() {
        if let Some(position) = string_of(lookup(Some(sibling), "position"))
            && !keys.contains(&position)
        {
            keys.push(position);
        }
    }
    keys.sort_by(|a, b| by_units(a, b));
    for sibling in siblings.iter_mut() {
        if let Some(position) = string_of(lookup(Some(sibling), "position")) {
            let at = keys.iter().position(|key| *key == position).unwrap_or(0);
            set_member(sibling, "position", str_node(&format!("{RANKED}pos:{at}")));
        }
    }
}

fn object_records_mut(node: Option<&mut Node>) -> Vec<&mut Node> {
    match node {
        Some(node) if node.kind == Kind::Array => node
            .items
            .iter_mut()
            .filter(|item| item.kind == Kind::Object)
            .collect(),
        _ => Vec::new(),
    }
}

fn canonical_databases(mut blocks: Vec<Node>) -> Vec<Node> {
    let mut labels: HashMap<String, String> = HashMap::new();
    let label = |id: Option<&Node>, labels: &mut HashMap<String, String>| {
        if let Some(text) = string_of(id)
            && !labels.contains_key(&text)
        {
            let next = format!("dbid{}", labels.len() + 1);
            labels.insert(text, next);
        }
    };
    for block in &mut blocks {
        if type_of(block) != "database" {
            continue;
        }
        let Some(data) = block
            .lookup_mut("data")
            .ok()
            .flatten()
            .filter(|data| data.kind == Kind::Object)
        else {
            continue;
        };
        for property in records(lookup(Some(data), "schema")) {
            label(lookup(Some(property), "id"), &mut labels);
            for option in records(lookup(lookup(Some(property), "config"), "options")) {
                label(lookup(Some(option), "id"), &mut labels);
            }
        }
        for view in records(lookup(Some(data), "views")) {
            label(lookup(Some(view), "id"), &mut labels);
        }
        rank(&mut object_records_mut(
            data.lookup_mut("schema").ok().flatten(),
        ));
        rank(&mut object_records_mut(
            data.lookup_mut("views").ok().flatten(),
        ));
        for property in object_records_mut(data.lookup_mut("schema").ok().flatten()) {
            let config = property.lookup_mut("config").ok().flatten();
            let options = config.and_then(|config| config.lookup_mut("options").ok().flatten());
            rank(&mut object_records_mut(options));
        }
    }
    // Templates are their own ordered list beside the rows.
    let mut order: Vec<(String, bool)> = Vec::new();
    let mut groups: HashMap<(String, bool), Vec<usize>> = HashMap::new();
    for (i, block) in blocks.iter().enumerate() {
        if type_of(block) != "database-row" {
            continue;
        }
        let data = lookup(Some(block), "data");
        let key = (
            parent_of(block).unwrap_or_default(),
            lookup(data, "template").is_some_and(|t| t.kind == Kind::True),
        );
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        let entry = groups.entry(key).or_default();
        if data.is_some_and(|d| d.kind == Kind::Object) {
            entry.push(i);
        }
    }
    for key in &order {
        let members: BTreeSet<usize> = groups[key].iter().copied().collect();
        let mut rows: Vec<&mut Node> = blocks
            .iter_mut()
            .enumerate()
            .filter(|(i, _)| members.contains(i))
            .filter_map(|(_, block)| block.lookup_mut("data").ok().flatten())
            .collect();
        rank(&mut rows);
    }
    for block in &mut blocks {
        let kind = type_of(block);
        if kind != "database" && kind != "database-row" {
            continue;
        }
        let Some(data) = lookup(Some(block), "data").filter(|d| d.kind == Kind::Object) else {
            continue;
        };
        let mut relabelled = relabel(data, &labels);
        if kind == "database"
            && deep_equals(
                lookup(Some(&relabelled), "automations"),
                Some(&empty_automations()),
            )
        {
            relabelled.remove("automations");
        }
        set_member(block, "data", relabelled);
    }
    blocks
}

fn relabel(node: &Node, labels: &HashMap<String, String>) -> Node {
    match node.kind {
        Kind::String => {
            let Some(value) = string_of(Some(node)) else {
                return node.clone();
            };
            if let Some(label) = labels.get(&value) {
                return str_node(label);
            }
            if let Some(view) = value.strip_suffix("-filters").and_then(|v| labels.get(v)) {
                return str_node(&format!("{view}-filters"));
            }
            node.clone()
        }
        Kind::Array => new_array(
            node.items
                .iter()
                .map(|item| relabel(item, labels))
                .collect(),
        ),
        Kind::Object => {
            let mut out = new_object(Vec::new());
            for m in &node.members {
                let name = key_of(m);
                let target = labels.get(&name).cloned().unwrap_or_else(|| name.clone());
                let ranked = string_of(Some(&m.value))
                    .and_then(|v| v.strip_prefix(RANKED).map(str::to_owned));
                match ranked {
                    Some(rank) if name == "position" => {
                        set_member(&mut out, &target, str_node(&rank))
                    }
                    _ => set_member(&mut out, &target, relabel(&m.value, labels)),
                }
            }
            out
        }
        _ => node.clone(),
    }
}

fn clean(block: &Node, names: &HashMap<String, String>) -> Node {
    let mut copied = block.clone();
    let kind = type_of(&copied);
    let rename = |id: &str| names.get(id).cloned().unwrap_or_else(|| id.to_owned());
    // Clocks differ per runner: compare that a stamp is there, not its value.
    for stamp in ["lastEditedAt", "createdAt"] {
        if lookup(Some(&copied), stamp).is_some() {
            set_member(&mut copied, stamp, new_number("0"));
        }
    }
    if let Some(own) = id_of(&copied) {
        set_member(&mut copied, "id", str_node(&rename(&own)));
    }
    if let Some(parent) = parent_of(&copied) {
        set_member(&mut copied, "parent", str_node(&rename(&parent)));
    }
    if let Some(content) = lookup(Some(&copied), "content").filter(|c| c.kind == Kind::Array) {
        let out = new_array(
            content
                .items
                .iter()
                .map(|item| match string_of(Some(item)) {
                    Some(id) => str_node(&rename(&id)),
                    None => item.clone(),
                })
                .collect(),
        );
        set_member(&mut copied, "content", out);
    }
    if let Some(data) = lookup(Some(&copied), "data").filter(|d| d.kind == Kind::Object) {
        let cleaned = clean_data(&kind, data.clone(), &rename);
        set_member(&mut copied, "data", cleaned);
    }
    copied
}

fn clean_data(kind: &str, mut data: Node, rename: &dyn Fn(&str) -> String) -> Node {
    for default in load_defaults(kind) {
        let key = key_of(&default);
        if lookup(Some(&data), &key)
            .is_some_and(|actual| deep_equals(Some(actual), Some(&default.value)))
        {
            data.remove(&key);
        }
    }
    // normalizeList saves checked only on a checklist and start only when not 1.
    if kind == "list" {
        let style = string_of(lookup(Some(&data), "style")).unwrap_or_default();
        let checked_false = lookup(Some(&data), "checked").is_some_and(|c| c.kind == Kind::False);
        if style != "checklist" || checked_false {
            data.remove("checked");
        }
        let start_one = lookup(Some(&data), "start").is_some_and(|start| {
            start.kind == Kind::Number
                && std::str::from_utf8(start.raw())
                    .ok()
                    .and_then(|raw| raw.parse::<f64>().ok())
                    == Some(1.0)
        });
        if start_one {
            data.remove("start");
        }
    }
    if kind == "table"
        && let Some(content) = data
            .lookup_mut("content")
            .ok()
            .flatten()
            .filter(|c| c.kind == Kind::Array)
    {
        for row in content
            .items
            .iter_mut()
            .filter(|row| row.kind == Kind::Array)
        {
            for cell in row
                .items
                .iter_mut()
                .filter(|cell| cell.kind == Kind::Object)
            {
                // Random until the table ships ToolRuntime.normalize.
                cell.remove("id");
                cell.remove("rowId");
                if let Some(blocks) = lookup(Some(cell), "blocks").filter(|b| b.kind == Kind::Array)
                {
                    let out = new_array(
                        blocks
                            .items
                            .iter()
                            .map(|item| match string_of(Some(item)) {
                                Some(id) => str_node(&rename(&id)),
                                None => item.clone(),
                            })
                            .collect(),
                    );
                    set_member(cell, "blocks", out);
                }
            }
        }
    }
    let fields = rich_fields();
    for m in data.members.clone() {
        let key = key_of(&m);
        if fields.get(kind).is_some_and(|names| names.contains(&key))
            && m.value.kind == Kind::Array
            && is_rich_text(&m.value)
        {
            set_member(&mut data, &key, canonicalize(&m.value));
        }
    }
    data
}

/// Filled from fixtures/rich-text-fields.json, which pins the C# and TS
/// built-ins.
fn rich_fields() -> &'static BTreeMap<String, HashSet<String>> {
    static FIELDS: OnceLock<BTreeMap<String, HashSet<String>>> = OnceLock::new();
    FIELDS.get_or_init(|| {
        let fields = must_parse(&read_repo_file(
            "test/unit/server-conformance/fixtures/rich-text-fields.json",
        ));
        fields
            .members
            .iter()
            .map(|m| {
                let names = m
                    .value
                    .items
                    .iter()
                    .filter_map(|field| string_of(Some(field)))
                    .collect();
                (key_of(m), names)
            })
            .collect()
    })
}

// Rich text, as C# RichText.IsRichText and Canonicalize.

const MARK_ORDER: [&str; 11] = [
    "link",
    "color",
    "background",
    "highlight",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
    "sup",
    "sub",
];

const BOOLEAN_MARKS: [&str; 8] = [
    "highlight",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
    "sup",
    "sub",
];

fn is_rich_text(array: &Node) -> bool {
    array.items.iter().all(is_segment)
}

fn has_key(node: &Node, key: &str) -> bool {
    lookup(Some(node), key).is_some()
}

fn is_segment(item: &Node) -> bool {
    if item.kind != Kind::Object {
        return false;
    }
    let marks = lookup(Some(item), "marks");
    if (has_key(item, "text") && has_key(item, "embed"))
        || marks.is_some_and(|m| m.kind != Kind::Object)
    {
        return false;
    }
    let is_text = string_of(lookup(Some(item), "text")).is_some();
    (is_text && has_only_keys(item, "text"))
        || (is_embed(lookup(Some(item), "embed")) && has_only_keys(item, "embed"))
}

fn has_only_keys(record: &Node, shape: &str) -> bool {
    record.members.iter().all(|m| {
        let key = key_of(m);
        key == shape || key == "marks"
    })
}

fn is_embed(value: Option<&Node>) -> bool {
    let Some(value) = value.filter(|v| v.kind == Kind::Object && v.members.len() == 1) else {
        return false;
    };
    let inner = &value.members[0].value;
    match key_of(&value.members[0]).as_str() {
        "html" => string_of(Some(inner)).is_some(),
        "equation" => has_one_string(inner, "expression"),
        "page" => has_one_string(inner, "id"),
        _ => false,
    }
}

fn has_one_string(value: &Node, key: &str) -> bool {
    value.kind == Kind::Object
        && value.members.len() == 1
        && key_of(&value.members[0]) == key
        && string_of(Some(&value.members[0].value)).is_some()
}

pub(crate) fn canonicalize(segments: &Node) -> Node {
    let mut result: Vec<Node> = Vec::new();
    for raw in segments.items.iter().filter(|raw| raw.kind == Kind::Object) {
        let mut segment = new_object(Vec::new());
        let content = string_of(lookup(Some(raw), "text"));
        if let Some(content) = &content {
            set_member(&mut segment, "text", str_node(content));
        } else if is_embed(lookup(Some(raw), "embed")) {
            let embed = js_value(lookup(Some(raw), "embed").expect("an embed"));
            set_member(&mut segment, "embed", embed);
        } else {
            continue;
        }
        let empty = new_object(Vec::new());
        let marks = lookup(Some(raw), "marks")
            .filter(|m| m.kind == Kind::Object)
            .unwrap_or(&empty);
        if let Some(ordered) = order_marks(marks) {
            set_member(&mut segment, "marks", ordered);
        }
        if content.as_deref() == Some("") {
            continue;
        }
        if let (Some(content), Some(last)) = (&content, result.last_mut())
            && let Some(previous) = string_of(lookup(Some(last), "text"))
            && same_marks(last, &segment)
        {
            set_member(last, "text", str_node(&format!("{previous}{content}")));
            continue;
        }
        result.push(segment);
    }
    let mut out = new_array(result);
    js_order(&mut out);
    out
}

/// Puts object keys in the order JS writes them (array indexes first), as
/// RichText.ToJsonNode does through JsJson.KeyOrder.
fn js_order(node: &mut Node) {
    for item in &mut node.items {
        js_order(item);
    }
    if node.kind != Kind::Object {
        return;
    }
    for m in &mut node.members {
        js_order(&mut m.value);
    }
    let members: Vec<Member<NodeMember>> = node
        .members
        .iter()
        .map(|m| Member {
            key: m.key().unwrap_or_default(),
            value: m.clone(),
        })
        .collect();
    node.members = key_order(&members)
        .into_iter()
        .map(|m| m.value.clone())
        .collect();
}

fn order_marks(record: &Node) -> Option<Node> {
    let mut unknown: Vec<String> = record
        .members
        .iter()
        .map(key_of)
        .filter(|key| !MARK_ORDER.contains(&key.as_str()))
        .collect();
    unknown.sort_by(|a, b| by_units(a, b));
    let mut ordered = new_object(Vec::new());
    for key in MARK_ORDER.iter().map(|k| (*k).to_owned()).chain(unknown) {
        let Some(raw) = lookup(Some(record), &key) else {
            continue;
        };
        if let Some(value) = mark_value(&key, raw) {
            set_member(&mut ordered, &key, value);
        }
    }
    (!ordered.members.is_empty()).then_some(ordered)
}

/// C# MarkValue; None means the mark is absent.
fn mark_value(key: &str, raw: &Node) -> Option<Node> {
    if key == "link" {
        let href = string_of(lookup(Some(raw), "href"))?;
        if raw.kind != Kind::Object {
            return None;
        }
        let mut link = new_object(vec![new_member("href", str_node(&href))]);
        if let Some(target) = string_of(lookup(Some(raw), "target")) {
            set_member(&mut link, "target", str_node(&target));
        }
        if let Some(rel) = string_of(lookup(Some(raw), "rel")) {
            set_member(&mut link, "rel", str_node(&rel));
        }
        return Some(link);
    }
    if BOOLEAN_MARKS.contains(&key) {
        return (raw.kind == Kind::True).then(|| new_bool(true));
    }
    if raw.kind == Kind::Null {
        return None;
    }
    if key == "color" || key == "background" {
        return string_of(Some(raw)).map(|_| raw.clone());
    }
    if key.starts_with("tag:") {
        if raw.kind != Kind::Object {
            return None;
        }
        let mut names: Vec<String> = raw
            .members
            .iter()
            .filter(|m| string_of(Some(&m.value)).is_some())
            .map(key_of)
            .collect();
        names.sort_by(|a, b| by_units(a, b));
        let mut sorted = new_object(Vec::new());
        for name in names {
            let value = lookup(Some(raw), &name).expect("listed").clone();
            set_member(&mut sorted, &name, value);
        }
        return Some(sorted);
    }
    Some(js_value(raw))
}

/// A value after JsJson.Parse and RichText.ToJsonNode: numbers re-spelled
/// from their double.
fn js_value(node: &Node) -> Node {
    match node.kind {
        Kind::Number => {
            let value = std::str::from_utf8(node.raw())
                .ok()
                .and_then(|raw| raw.parse::<f64>().ok())
                .unwrap_or(0.0);
            if value.is_infinite() {
                return new_null();
            }
            new_number(&format_number(value))
        }
        Kind::Array => new_array(node.items.iter().map(js_value).collect()),
        Kind::Object => {
            let mut out = new_object(Vec::new());
            for m in &node.members {
                set_member(&mut out, &key_of(m), js_value(&m.value));
            }
            out
        }
        _ => node.clone(),
    }
}

/// C# SameMarks: keys sorted at every object depth, array members left as
/// written.
fn same_marks(left: &Node, right: &Node) -> bool {
    sorted_text(lookup(Some(left), "marks"), true)
        == sorted_text(lookup(Some(right), "marks"), true)
}

fn sorted_text(node: Option<&Node>, sort_objects: bool) -> String {
    let Some(node) = node else {
        return "{}".to_owned();
    };
    match node.kind {
        Kind::Object => {
            let mut members: Vec<&NodeMember> = node.members.iter().collect();
            if sort_objects {
                members.sort_by(|a, b| {
                    compare(
                        a.key().unwrap_or_default().units(),
                        b.key().unwrap_or_default().units(),
                    )
                });
            }
            let parts: Vec<String> = members
                .iter()
                .map(|m| {
                    let mut quoted = Vec::new();
                    append_quoted(&mut quoted, m.key().unwrap_or_default().units());
                    format!(
                        "{}:{}",
                        String::from_utf8_lossy(&quoted),
                        sorted_text(Some(&m.value), sort_objects)
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Kind::Array => {
            let parts: Vec<String> = node
                .items
                .iter()
                .map(|item| sorted_text(Some(item), false))
                .collect();
            format!("[{}]", parts.join(","))
        }
        _ => {
            let mut out = Vec::new();
            let _ = js_value(node).append_json(&mut out);
            String::from_utf8_lossy(&out).into_owned()
        }
    }
}

#[test]
fn normalizer_matches_the_type_script_normalizer() {
    let file = must_parse(&read_repo_file(
        "test/fixtures/agent-commands/normalizer-cases.json",
    ));
    let mut ran = 0;
    let mut failures = Vec::new();
    for item in &lookup(Some(&file), "cases").expect("cases").items {
        let name = string_of(lookup(Some(item), "name")).unwrap_or_default();
        if lookup(Some(item), "tsOnly").is_some() {
            continue;
        }
        ran += 1;
        let keep: HashSet<String> = lookup(Some(item), "keepIds")
            .map(|ids| {
                ids.items
                    .iter()
                    .filter_map(|id| string_of(Some(id)))
                    .collect()
            })
            .unwrap_or_default();
        let got = stable(Some(&normalize_document(
            lookup(Some(item), "input").expect("input"),
            &keep,
        )));
        let want = stable(lookup(Some(item), "expected"));
        if got != want {
            failures.push(format!("{name}:\n got  {got}\nwant {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(ran, 8, "ran {ran} normalizer cases, want the 8 C# runs");
}

#[test]
fn canonicalize_matches_the_rich_text_fixture() {
    let inputs = must_parse(&read_repo_file(
        "test/unit/server-conformance/fixtures/rich-text-canonical/inputs.json",
    ));
    let expected = must_parse(&read_repo_file(
        "test/unit/server-conformance/fixtures/rich-text-canonical/expected.json",
    ));
    let inputs = lookup(Some(&inputs), "segments").expect("segments");
    let expected = lookup(Some(&expected), "segments");
    assert!(!inputs.items.is_empty(), "no cases");
    let mut failures = Vec::new();
    for item in &inputs.items {
        let name = string_of(lookup(Some(item), "name")).unwrap_or_default();
        let input = lookup(Some(item), "input").expect("input");
        let mut want = Vec::new();
        if let Some(value) = lookup(expected, &name) {
            let _ = value.append_json(&mut want);
        }
        let mut got = Vec::new();
        if input.kind == Kind::Array {
            let _ = canonicalize(input).append_json(&mut got);
        }
        if got != want {
            failures.push(format!(
                "{name}:\n got  {}\nwant {}",
                String::from_utf8_lossy(&got),
                String::from_utf8_lossy(&want)
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
