//! Port of Go scenario_test.go (C# ScenarioSupport.cs and JsonRenderer.cs):
//! the scenarios and fuzz seeds replayed against the engine, checked against
//! what real yjs produced.

use std::collections::HashMap;

use blok_jsjson::{Object, Str, Value};
use blok_yjs_yjstest as yjstest;
use sha2::{Digest, Sha256};

use crate::content::Content;
use crate::test_support::*;
use crate::types::{TypeKind, TypeRef};
use crate::{
    ApplyResult, Array, Doc, In, Map, MapEntry, Options, Out, Outcome, Text, Transaction, XmlText,
};

#[derive(Clone, Debug, Default)]
pub struct ScenarioExpect {
    pub sv: Option<Vec<u8>>,
    pub has_pending: Option<bool>,
    pub json: Option<Value>,
    pub json_sha256: String,
    pub diverges: bool,
    pub no_cleanup: Option<Box<ScenarioExpect>>,
}

#[derive(Clone, Debug, Default)]
pub struct ScenarioStep {
    pub kind: String,
    pub id: String,
    pub doc: String,
    pub op: Option<Value>,
    pub update: Option<Vec<u8>>,
    pub update_of: String,
    pub to: Option<Vec<String>>,
    pub expect: Option<ScenarioExpect>,
    pub no_cleanup_update: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct ScenarioCase {
    pub name: String,
    pub gc: bool,
    pub roots: Vec<(String, String)>,
    pub engine: String,
    pub client_id: u32,
    pub steps: Vec<ScenarioStep>,
    pub segments: bool,
}

fn optional_bytes(value: &Value, key: &str) -> Option<Vec<u8>> {
    yjstest::has(value, key).then(|| fixture_bytes(value, key))
}

fn read_expect(value: Option<&Value>) -> Option<ScenarioExpect> {
    let value = value?;
    if !matches!(value, Value::Object(_)) {
        return None;
    }
    Some(ScenarioExpect {
        sv: optional_bytes(value, "sv"),
        has_pending: yjstest::has(value, "hasPending").then(|| yjstest::bool(value, "hasPending")),
        json: yjstest::field(value, "json").cloned(),
        json_sha256: yjstest::string(value, "jsonSha256"),
        ..ScenarioExpect::default()
    })
}

fn names(value: Option<&Value>) -> Option<Vec<String>> {
    match value? {
        Value::Array(items) => Some(
            items
                .iter()
                .map(|item| match item {
                    Value::String(text) => text.to_string(),
                    other => panic!("{other:?} is not a doc name"),
                })
                .collect(),
        ),
        _ => None,
    }
}

pub fn roots_of(value: &Value) -> Vec<(String, String)> {
    let Value::Object(object) = value else {
        panic!("roots is not an object")
    };
    object
        .members()
        .iter()
        .map(|m| (m.key.to_string(), str_of(&m.value).to_string()))
        .collect()
}

fn str_of(value: &Value) -> &Str {
    match value {
        Value::String(text) => text,
        other => panic!("{other:?} is not a string"),
    }
}

fn read_case(name: String, value: &Value, seed: bool) -> ScenarioCase {
    let engine = yjstest::string(value, "engine");
    let mut c = ScenarioCase {
        name,
        gc: !yjstest::has(value, "gc") || yjstest::bool(value, "gc"),
        roots: roots_of(yjstest::field(value, "roots").expect("roots")),
        client_id: yjstest::number(yjstest::field(value, "docs").expect("docs"), &engine) as u32,
        engine,
        steps: Vec::new(),
        segments: false,
    };
    match yjstest::string(value, "compare").as_str() {
        "" => {}
        "segments" => c.segments = true,
        other => panic!("{other:?} is not a compare mode"),
    }
    for raw in yjstest::items(value, "steps") {
        let mut step = ScenarioStep {
            kind: yjstest::string(raw, "kind"),
            id: yjstest::string(raw, "id"),
            doc: yjstest::string(raw, "doc"),
            op: yjstest::field(raw, "op").cloned(),
            update: optional_bytes(raw, "update"),
            update_of: yjstest::string(raw, "updateOf"),
            to: None,
            expect: read_expect(yjstest::field(raw, "expect")),
            no_cleanup_update: optional_bytes(raw, "noCleanupUpdate"),
        };
        if !seed {
            let field = if step.kind == "deliver" {
                "to"
            } else {
                "deliver"
            };
            step.to = names(yjstest::field(raw, field));
            if let Some(expect) = step.expect.as_mut() {
                expect.diverges = yjstest::bool(raw, "diverges");
                expect.no_cleanup = read_expect(yjstest::field(raw, "noCleanup")).map(Box::new);
            }
        }
        c.steps.push(step);
    }
    c
}

pub fn scenarios() -> Vec<ScenarioCase> {
    fixture_cases("scenarios.json")
        .iter()
        .map(|value| read_case(yjstest::string(value, "name"), value, false))
        .collect()
}

pub fn scenario_named(name: &str) -> ScenarioCase {
    scenarios()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no scenario {name}"))
}

pub fn step_update(c: &ScenarioCase, id: &str) -> Vec<u8> {
    c.steps
        .iter()
        .find(|step| step.id == id && step.update.is_some())
        .and_then(|step| step.update.clone())
        .unwrap_or_else(|| panic!("{} has no update {id}", c.name))
}

pub fn fuzz_seeds() -> Vec<ScenarioCase> {
    let dir = yjstest::dir().unwrap().join("fuzz");
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("seed-") && name.ends_with(".json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|file| {
            let value = yjstest::load(&format!("fuzz/{file}")).unwrap();
            read_case(file.trim_end_matches(".json").to_string(), &value, true)
        })
        .collect()
}

/// A generator value descriptor as an engine value.
pub fn build_value(descriptor: &Value) -> In {
    match descriptor {
        Value::Array(_) => {
            let items = build_values(descriptor)
                .into_iter()
                .map(|item| match item {
                    In::Any(value) => value,
                    In::Type(_) => panic!("a shared type inside an Any array"),
                })
                .collect();
            In::Any(Value::Array(items))
        }
        Value::Object(members) => build_described(members),
        other => In::Any(other.clone()),
    }
}

/// An array descriptor's items, which may be shared types.
pub fn build_values(descriptor: &Value) -> Vec<In> {
    match descriptor {
        Value::Array(items) => items.iter().map(build_value).collect(),
        other => panic!("{other:?} is not an array"),
    }
}

fn single(key: &str, value: &Value) -> Value {
    vobj(vec![(key, value.clone())])
}

fn build_described(members: &Object) -> In {
    let get = |key: &str| members.get(&Str::from(key));
    if let Some(value) = get("$num") {
        return In::Any(yjstest::to_engine(&single("$num", value)).unwrap());
    }
    if let Some(value) = get("$bigint") {
        return In::Any(yjstest::to_engine(&single("$bigint", value)).unwrap());
    }
    if let Some(value) = get("$u8") {
        return In::Any(yjstest::to_engine(&single("$u8", value)).unwrap());
    }
    if get("$undefined").is_some() {
        return In::Any(Value::Undefined);
    }
    if let Some(Value::Object(nested)) = get("$ymap") {
        let entries = nested
            .members()
            .iter()
            .map(|m| MapEntry {
                key: m.key.clone(),
                value: build_value(&m.value),
            })
            .collect();
        return In::Type(Map::new(entries).as_type().clone());
    }
    if let Some(items) = get("$yarray") {
        return In::Type(Array::new(build_values(items)).as_type().clone());
    }
    if let Some(characters) = get("$ytext") {
        return In::Type(
            Text::new(Some(str_of(characters).clone()))
                .as_type()
                .clone(),
        );
    }
    if let Some(characters) = get("$yxmltext") {
        let text = XmlText::new(Some(str_of(characters).clone()));
        if let Some(Value::Array(ops)) = get("ops") {
            for op in ops {
                apply_text_op(&TextHandle::Xml(text.clone()), None, op);
            }
        }
        return In::Type(text.as_type().clone());
    }
    for m in members.members() {
        assert!(
            !m.key.to_string().starts_with("$yxml"),
            "{:?} is a placeholder type the engine never writes",
            m.key.to_string()
        );
    }
    let built = members
        .members()
        .iter()
        .map(|m| match build_value(&m.value) {
            In::Any(value) => (m.key.clone(), value),
            In::Type(_) => panic!("a shared type inside an Any object"),
        })
        .collect();
    In::Any(Value::Object(built))
}

pub enum TextHandle {
    Text(Text),
    Xml(XmlText),
}

impl TextHandle {
    pub fn of(handle: &TypeRef) -> TextHandle {
        match handle.kind() {
            TypeKind::Text => TextHandle::Text(handle.as_text().unwrap()),
            TypeKind::XmlText => TextHandle::Xml(handle.as_xml_text().unwrap()),
            other => panic!("{other:?} is not a text"),
        }
    }
}

macro_rules! on_text {
    ($handle:expr, $t:ident => $body:expr) => {
        match $handle {
            TextHandle::Text($t) => $body,
            TextHandle::Xml($t) => $body,
        }
    };
}

pub fn apply_text_op(text: &TextHandle, txn: Option<&Transaction<'_>>, op: &Value) {
    let attributes = match yjstest::field(op, "attributes") {
        Some(Value::Null) | None => None,
        Some(descriptor) => match build_value(descriptor) {
            In::Any(Value::Object(object)) => Some(object),
            other => panic!("{other:?} is not an attributes object"),
        },
    };
    let index = yjstest::number(op, "index") as i64;
    let length = yjstest::number(op, "length") as i64;
    let result = match yjstest::string(op, "op").as_str() {
        "text.insert" => {
            let chunk = str_of(yjstest::field(op, "text").unwrap()).clone();
            on_text!(text, t => t.insert(txn, index, chunk, attributes.as_ref()))
        }
        "text.delete" => on_text!(text, t => t.delete(txn, index, length)),
        "text.format" => {
            on_text!(text, t => t.format(txn, index, length, attributes.as_ref().unwrap()))
        }
        "text.embed" => {
            let embed = match build_value(yjstest::field(op, "embed").unwrap()) {
                In::Any(value) => value,
                In::Type(_) => panic!("a shared type embed"),
            };
            on_text!(text, t => t.insert_embed(txn, index, embed, attributes.as_ref()))
        }
        other => panic!("{other:?} is not an op the engine performs"),
    };
    result.unwrap();
}

fn op_target(doc: &Doc, op: &Value) -> TypeRef {
    let root = str_of(yjstest::field(op, "root").unwrap()).clone();
    let mut target = match yjstest::string(op, "rootKind").as_str() {
        "map" => doc.get_map(root).unwrap().as_type().clone(),
        "array" => doc.get_array(root).unwrap().as_type().clone(),
        "text" => doc.get_text(root).unwrap().as_type().clone(),
        other => panic!("{other:?} is not a root kind"),
    };
    for segment in yjstest::items(op, "path") {
        let m = target.as_map().expect("the op's target is not a Y.Map");
        target = m
            .get(str_of(segment).clone())
            .and_then(|nested| nested.as_type().cloned())
            .unwrap_or_else(|| panic!("{segment:?} does not hold a nested shared type"));
    }
    target
}

/// Performs one generator op in one transaction.
pub fn apply_op(doc: &Doc, op: &Value) -> Option<Vec<u8>> {
    let target = op_target(doc, op);
    doc.transact(|txn| {
        match yjstest::string(op, "op").as_str() {
            "map.set" => target.as_map().unwrap().set(
                txn,
                str_of(yjstest::field(op, "key").unwrap()).clone(),
                build_value(yjstest::field(op, "value").unwrap()),
            )?,
            "map.delete" => target
                .as_map()
                .unwrap()
                .delete(txn, str_of(yjstest::field(op, "key").unwrap()).clone())?,
            "array.insert" => target.as_array().unwrap().insert(
                txn,
                yjstest::number(op, "index") as i64,
                build_values(yjstest::field(op, "values").unwrap()),
            )?,
            "array.delete" => target.as_array().unwrap().delete(
                txn,
                yjstest::number(op, "index") as i64,
                yjstest::number(op, "length") as i64,
            )?,
            _ => apply_text_op(&TextHandle::of(&target), Some(txn), op),
        }
        Ok(())
    })
    .unwrap()
}

/// The twin of scripts/yjs-engine-render.mjs.
pub fn render(doc: &Doc, roots: &[(String, String)]) -> Value {
    let mut rendered = Object::new();
    for (name, kind) in roots {
        let value = match kind.as_str() {
            "map" => doc.get_map(name.as_str()).unwrap().as_type().clone(),
            "array" => doc.get_array(name.as_str()).unwrap().as_type().clone(),
            "text" => doc.get_text(name.as_str()).unwrap().as_type().clone(),
            other => panic!("{other:?} is not a root kind"),
        };
        rendered.set(Str::from(name.as_str()), render_value(&Out::Type(value)));
    }
    Value::Object(rendered)
}

pub fn render_value(value: &Out) -> Value {
    match value {
        Out::Any(value) => render_any(value),
        Out::Subdoc(_) => Value::Object(Object::new()),
        Out::Type(handle) => match handle.kind() {
            TypeKind::Text | TypeKind::XmlText => {
                vobj(vec![("$text", Value::Array(render_delta(handle)))])
            }
            TypeKind::XmlElement | TypeKind::XmlFragment | TypeKind::XmlHook => {
                vobj(vec![("$xml", Value::String(Str::from(render_xml(handle))))])
            }
            TypeKind::Map => {
                let m = handle.as_map().unwrap();
                let mut rendered = Object::new();
                for key in m.keys() {
                    let item = m.get(key.clone()).unwrap();
                    rendered.set(key, render_value(&item));
                }
                Value::Object(rendered)
            }
            TypeKind::Array => Value::Array(
                handle
                    .as_array()
                    .unwrap()
                    .values()
                    .iter()
                    .map(render_value)
                    .collect(),
            ),
            TypeKind::Untyped => panic!("an untyped root has no JSON rendering"),
        },
    }
}

fn render_any(value: &Value) -> Value {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => value.clone(),
        Value::Number(_) | Value::Undefined | Value::BigInt(_) | Value::Bytes(_) => {
            yjstest::to_fixture(value)
        }
        Value::Object(object) => Value::Object(
            object
                .members()
                .iter()
                .map(|m| (m.key.clone(), render_any(&m.value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(render_any).collect()),
    }
}

/// One live item of a text chain, read under the lock and rendered after.
enum Segment {
    Text(Str),
    Value(Out),
    Format(Str, Str),
}

fn segments(handle: &TypeRef) -> Vec<Segment> {
    handle.read(Vec::new(), |st, id| {
        let mut out = Vec::new();
        let mut current = st.store.types[id].start;
        while let Some(at) = current {
            let item = &st.store.items[at];
            current = item.right;
            if item.deleted {
                continue;
            }
            match &item.content {
                Content::String(text) => out.push(Segment::Text(text.clone())),
                Content::Embed(_) | Content::Type(_) => {
                    out.push(Segment::Value(item.content.values().remove(0)));
                }
                Content::Format(format) => {
                    out.push(Segment::Format(format.key.clone(), format.json.clone()))
                }
                _ => {}
            }
        }
        out
    })
}

fn render_delta(handle: &TypeRef) -> Vec<Value> {
    let mut delta = Vec::new();
    let mut marks: Vec<(Str, Value)> = Vec::new();
    let mut run = Str::new();
    let operation = |delta: &mut Vec<Value>, marks: &[(Str, Value)], insert: Value| {
        let mut op = obj(vec![("insert", insert)]);
        if !marks.is_empty() {
            op.set(
                s("attributes"),
                Value::Object(marks.iter().cloned().collect()),
            );
        }
        delta.push(Value::Object(op));
    };
    for segment in segments(handle) {
        match segment {
            Segment::Text(text) => run.0.extend_from_slice(&text),
            Segment::Value(value) => {
                if !run.is_empty() {
                    operation(&mut delta, &marks, Value::String(std::mem::take(&mut run)));
                }
                operation(&mut delta, &marks, render_value(&value));
            }
            Segment::Format(key, json) => {
                if !run.is_empty() {
                    operation(&mut delta, &marks, Value::String(std::mem::take(&mut run)));
                }
                let value = parse_raw(&json);
                let at = marks.iter().position(|(k, _)| *k == key);
                match (value, at) {
                    (Value::Null, Some(at)) => {
                        marks.remove(at);
                    }
                    (Value::Null, None) => {}
                    (value, Some(at)) => marks[at].1 = value,
                    (value, None) => marks.push((key, value)),
                }
            }
        }
    }
    if !run.is_empty() {
        operation(&mut delta, &marks, Value::String(run));
    }
    delta
}

fn render_xml(handle: &TypeRef) -> String {
    match handle.kind() {
        TypeKind::XmlText => handle.as_xml_text().unwrap().to_string(),
        TypeKind::XmlElement => {
            let name = handle
                .name()
                .map(|n| n.to_string().to_lowercase())
                .unwrap_or_default();
            let mut entries: Vec<(Str, Out)> = handle.read(Vec::new(), |st, id| {
                st.store.types[id]
                    .entries
                    .iter()
                    .filter(|(_, head)| !st.store.items[*head].deleted)
                    .map(|(key, _)| (key.clone(), st.map_value(id, key).unwrap()))
                    .collect()
            });
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut attributes = String::new();
            for (key, value) in entries {
                let Out::Any(value @ Value::String(_)) = value else {
                    panic!("an XML attribute that is not a string");
                };
                attributes.push_str(&format!(
                    " {key}={}",
                    blok_jsjson::stringify(&value).unwrap()
                ));
            }
            format!(
                "<{name}{attributes}>{}</{name}>",
                render_xml_children(handle)
            )
        }
        _ => render_xml_children(handle),
    }
}

fn render_xml_children(handle: &TypeRef) -> String {
    let children: Vec<TypeRef> = handle.read(Vec::new(), |st, id| {
        let mut out = Vec::new();
        let mut current = st.store.types[id].start;
        while let Some(at) = current {
            let item = &st.store.items[at];
            if let (Content::Type(child), false) = (&item.content, item.deleted) {
                out.push(child.clone());
            }
            current = item.right;
        }
        out
    });
    children.iter().map(render_xml).collect()
}

/// Merges neighbouring string runs with equal attributes.
pub fn merge_text_runs(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            if object.len() == 1
                && object.members()[0].key.to_string() == "$text"
                && let Value::Array(delta) = &object.members()[0].value
            {
                return vobj(vec![("$text", Value::Array(merge_delta(delta)))]);
            }
            Value::Object(
                object
                    .members()
                    .iter()
                    .map(|m| (m.key.clone(), merge_text_runs(&m.value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(merge_text_runs).collect()),
        other => other.clone(),
    }
}

fn merge_delta(delta: &[Value]) -> Vec<Value> {
    let attributes_of = |op: &Object| -> String {
        canonical(
            op.get(&s("attributes"))
                .unwrap_or(&Value::Object(Object::new())),
        )
    };
    let mut merged: Vec<Object> = Vec::new();
    for entry in delta {
        let Value::Object(entry) = entry else {
            panic!("a delta op")
        };
        if let (Some(last), Some(Value::String(text))) =
            (merged.last_mut(), entry.get(&s("insert")))
            && let Some(Value::String(before)) = last.get(&s("insert"))
            && attributes_of(last) == attributes_of(entry)
        {
            let mut joined = before.clone();
            joined.0.extend_from_slice(text);
            last.set(s("insert"), Value::String(joined));
            continue;
        }
        merged.push(entry.clone());
    }
    merged.into_iter().map(Value::Object).collect()
}

fn json_sha256(value: &Value) -> String {
    Sha256::digest(canonical(value).as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

type Observer = Box<dyn FnMut(&ScenarioStep, Option<&[u8]>, Option<&ApplyResult>)>;

pub struct ScenarioRunner {
    pub c: ScenarioCase,
    pub doc: Doc,
    emitted: HashMap<String, Vec<u8>>,
    pub checks: usize,
    pub failures: Vec<String>,
    /// Runs after each step; the golden capture hooks in here.
    pub observe: Option<Observer>,
}

impl ScenarioRunner {
    pub fn new(c: ScenarioCase) -> ScenarioRunner {
        let doc = Doc::new(Options {
            client_id: Some(c.client_id),
            no_gc: !c.gc,
        });
        ScenarioRunner {
            c,
            doc,
            emitted: HashMap::new(),
            checks: 0,
            failures: Vec::new(),
            observe: None,
        }
    }

    pub fn run_all(&mut self) {
        for step in self.c.steps.clone() {
            self.run(&step);
        }
    }

    fn engine_in(&self, names: &Option<Vec<String>>) -> bool {
        names
            .as_ref()
            .is_some_and(|names| names.contains(&self.c.engine))
    }

    pub fn run(&mut self, step: &ScenarioStep) {
        // engineWrites files the ENGINE's bytes, so later deliveries replay them.
        if step.kind != "engineWrites"
            && !step.id.is_empty()
            && let Some(update) = &step.update
        {
            self.emitted.insert(step.id.clone(), update.clone());
        }
        let mut written = None;
        let mut result = None;
        match step.kind.as_str() {
            "op" => {
                if self.engine_in(&step.to) {
                    result = Some(self.apply(step, step.update.clone()));
                }
            }
            "engineWrites" => written = Some(self.write(step)),
            "deliver" => {
                if step.to.is_none() || self.engine_in(&step.to) {
                    let update = step
                        .update
                        .clone()
                        .or_else(|| self.emitted.get(&step.update_of).cloned());
                    assert!(
                        update.is_some(),
                        "{}: no step has produced {:?} yet",
                        self.c.name,
                        step.update_of
                    );
                    result = Some(self.apply(step, update));
                }
            }
            "expect" => {}
            other => panic!("{other:?} is not a step kind"),
        }
        if let Some(observe) = self.observe.as_mut() {
            observe(step, written.as_deref(), result.as_ref());
        }
        if let Some(expect) = &step.expect
            && (step.doc.is_empty() || step.doc == self.c.engine)
        {
            self.check(step, expect);
        }
    }

    fn write(&mut self, step: &ScenarioStep) -> Vec<u8> {
        let written = apply_op(&self.doc, step.op.as_ref().expect("an op")).unwrap_or_else(|| {
            panic!("{} step {:?}: the op emitted nothing", self.c.name, step.id)
        });
        let mirror = if self.c.segments {
            &step.no_cleanup_update
        } else {
            &step.update
        };
        if Some(&written) != mirror.as_ref() {
            self.failures.push(format!(
                "{} step {:?}: engine {}, yjs {}",
                self.c.name,
                step.id,
                b64_encode(&written),
                mirror.as_deref().map(b64_encode).unwrap_or_default()
            ));
        }
        self.checks += 1;
        if !step.id.is_empty() {
            self.emitted.insert(step.id.clone(), written.clone());
        }
        written
    }

    fn apply(&mut self, step: &ScenarioStep, update: Option<Vec<u8>>) -> ApplyResult {
        let update = update
            .unwrap_or_else(|| panic!("{} step {:?} carries no update", self.c.name, step.id));
        let result = self.doc.apply_update(&update);
        match result {
            Ok(result) if result.outcome == Outcome::Applied => result,
            other => panic!("{} step {:?}: {other:?}", self.c.name, step.id),
        }
    }

    fn check(&mut self, step: &ScenarioStep, expect: &ScenarioExpect) {
        let at = format!("{} step {:?}", self.c.name, step.id);
        if let Some(sv) = &expect.sv {
            let got = self.doc.encode_state_vector();
            if &got != sv {
                self.failures
                    .push(format!("{at}: sv {got:x?}, want {sv:x?}"));
            }
            self.checks += 1;
        }
        if let Some(pending) = expect.has_pending {
            if self.doc.has_pending() != pending {
                self.failures
                    .push(format!("{at}: hasPending {}", self.doc.has_pending()));
            }
            self.checks += 1;
        }
        if let Some(want) = &expect.json {
            let mut want = want.clone();
            let mut got = render(&self.doc, &self.c.roots);
            if self.c.segments {
                want = merge_text_runs(&want);
                got = merge_text_runs(&got);
            }
            let equal = canonical(&want) == canonical(&got);
            if expect.diverges && equal {
                self.failures.push(format!(
                    "{at}: json should diverge from yjs until a peer's cleanup arrives"
                ));
            }
            if !expect.diverges && !equal {
                self.failures.push(format!(
                    "{at}: json\n got {}\nwant {}",
                    canonical(&got),
                    canonical(&want)
                ));
            }
            self.checks += 1;
        }
        if let Some(no) = &expect.no_cleanup {
            let got = self.doc.encode_state_vector();
            if Some(&got) != no.sv.as_ref() {
                self.failures
                    .push(format!("{at}: no-cleanup sv {got:x?}, want {:x?}", no.sv));
            }
            let got = canonical(&render(&self.doc, &self.c.roots));
            let want = canonical(no.json.as_ref().unwrap_or(&Value::Null));
            if got != want {
                self.failures
                    .push(format!("{at}: no-cleanup json\n got {got}\nwant {want}"));
            }
            self.checks += 1;
        }
        if !expect.json_sha256.is_empty() {
            let rendered = render(&self.doc, &self.c.roots);
            let got = json_sha256(&rendered);
            if got != expect.json_sha256 {
                self.failures.push(format!(
                    "{at}: jsonSha256 {got}, want {} (json {})",
                    expect.json_sha256,
                    canonical(&rendered)
                ));
            }
            self.checks += 1;
        }
    }
}

/// Runs only the case named by BLOK_YJS_CASE when it is set.
pub fn selected(name: &str) -> bool {
    std::env::var("BLOK_YJS_CASE").map_or(true, |only| only.is_empty() || only == name)
}

#[test]
fn every_scenario_matches_the_yjs_oracle() {
    let cases = scenarios();
    assert_eq!(cases.len(), 21, "want 21 scenarios");
    let mut failures = Vec::new();
    for c in cases.into_iter().filter(|c| selected(&c.name)) {
        let mut runner = ScenarioRunner::new(c);
        runner.run_all();
        if runner.checks == 0 {
            failures.push(format!("{}: the scenario checked nothing", runner.c.name));
        }
        failures.extend(runner.failures);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn every_seed_matches_the_yjs_oracle_at_every_step() {
    let seeds = fuzz_seeds();
    assert_eq!(seeds.len(), 50, "want 50 seeds");
    let mut failures = Vec::new();
    for c in seeds.into_iter().filter(|c| selected(&c.name)) {
        let mut runner = ScenarioRunner::new(c);
        runner.run_all();
        if runner.checks == 0 {
            failures.push(format!("{}: the seed checked nothing", runner.c.name));
        }
        failures.extend(runner.failures);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
