//! The item-chain text logic Y.Text and Y.XmlText share, ported line for
//! line from yjs's YText.js because each step decides which neighbours a
//! new item names, and so its bytes. The after-transaction format cleanup
//! is NOT ported: Blok clients run it and send the result.

use std::sync::Arc;

use blok_jsjson::{Member, Object, Str, Value};

use crate::content::{Content, FormatContent, parse_validated};
use crate::doc::{DocState, Transaction};
use crate::item::ItemId;
use crate::types::{Prelim, Text, TypeId, TypeRef, TypeState, XmlText};
use crate::{EngineResult, Id, fail};

/// One toDelta op: text, an embed value or a shared type, with the marks in
/// force (None when none).
#[derive(Clone, Debug, PartialEq)]
pub struct Delta {
    pub insert: crate::Out,
    pub attributes: Option<Object>,
}

/// A write queued on a text with no document.
pub(crate) enum TextOp {
    Insert {
        index: usize,
        chunk: Str,
        attributes: Option<Marks>,
    },
    Embed {
        index: usize,
        embed: Value,
        attributes: Option<Marks>,
    },
    Format {
        index: usize,
        // Signed: C# passes a negative length through to format_text.
        length: i64,
        attributes: Marks,
    },
    Delete {
        index: usize,
        length: usize,
    },
}

/// The marks in force: an ordered map with JS Map semantics (.NET
/// OrderedDictionary): setting an existing key keeps its place, a removed
/// key re-added goes to the end. A missing key reads as null.
#[derive(Clone, Default)]
struct Attrs(Vec<(Str, Arc<Value>)>);

impl Attrs {
    fn find(&self, key: &Str) -> Option<usize> {
        self.0.iter().position(|(k, _)| k == key)
    }

    fn get(&self, key: &Str) -> Option<Arc<Value>> {
        self.find(key).map(|i| self.0[i].1.clone())
    }

    fn get_or_null(&self, key: &Str) -> Arc<Value> {
        self.get(key).unwrap_or_else(null)
    }

    fn set(&mut self, key: Str, value: Arc<Value>) {
        match self.find(&key) {
            Some(i) => self.0[i].1 = value,
            None => self.0.push((key, value)),
        }
    }

    fn try_add(&mut self, key: Str, value: Arc<Value>) {
        if self.find(&key).is_none() {
            self.0.push((key, value));
        }
    }

    fn remove(&mut self, key: &Str) {
        if let Some(i) = self.find(key) {
            self.0.remove(i);
        }
    }
}

fn null() -> Arc<Value> {
    Arc::new(Value::Null)
}

struct TextPosition {
    left: Option<ItemId>,
    right: Option<ItemId>,
    index: usize,
    current: Attrs,
}

fn check_index(index: i64) -> EngineResult<usize> {
    if index < 0 {
        fail!("yjs: negative index.");
    }
    Ok(index as usize)
}

/// Mark values as the caller holds them. A value's identity is its Arc: a
/// mark compares === (C# ReferenceEquals) with what the caller passed, so
/// the same Arc passed again is the same object.
pub type Marks = Object<Arc<Value>>;

/// Marks with a fresh identity per value, as new C# objects would have.
pub fn marks(attributes: &Object) -> Marks {
    let mut out = Marks::default();
    for member in attributes.members() {
        out.set(member.key.clone(), Arc::new(member.value.clone()));
    }
    out
}

fn marks_of(attributes: &Marks) -> EngineResult<Attrs> {
    let mut marks = Attrs::default();
    for member in attributes.members() {
        if let Value::Undefined = *member.value {
            fail!(
                "yjs: the mark \"{}\" is undefined; use null to remove it.",
                member.key
            );
        }
        marks.set(member.key.clone(), Arc::clone(&member.value));
    }
    Ok(marks)
}

impl TypeRef {
    /// Queues op on a text with no document, or runs it in txn's.
    fn text_write(&self, txn: Option<&Transaction<'_>>, op: TextOp) -> EngineResult<()> {
        {
            let mut state = self.state();
            if let TypeState::Prelim(prelim) = &mut *state {
                match prelim {
                    Prelim::Text(ops) => ops.push(op),
                    _ => *prelim = Prelim::Text(vec![op]),
                }
                return Ok(());
            }
        }
        let Some(txn) = txn else {
            fail!("yjs: a text in a document needs a transaction.");
        };
        self.write(txn, |st, id| st.run_text_op(id, op))
    }

    fn text_insert(
        &self,
        txn: Option<&Transaction<'_>>,
        index: i64,
        chunk: Str,
        attributes: Option<&Marks>,
    ) -> EngineResult<()> {
        let index = check_index(index)?;
        if chunk.is_empty() {
            return Ok(());
        }
        if let Some(attributes) = attributes {
            marks_of(attributes)?;
        }
        let attributes = attributes.cloned();
        self.text_write(
            txn,
            TextOp::Insert {
                index,
                chunk,
                attributes,
            },
        )
    }

    fn text_insert_embed(
        &self,
        txn: Option<&Transaction<'_>>,
        index: i64,
        embed: Value,
        attributes: Option<&Marks>,
    ) -> EngineResult<()> {
        let index = check_index(index)?;
        match embed {
            Value::Null => fail!("yjs: an embed cannot be null."),
            Value::String(_) => fail!("yjs: an embed is a JSON value other than a string."),
            _ => {}
        }
        if let Err(err) = blok_jsjson::stringify(&embed) {
            fail!("{err}");
        }
        if let Some(attributes) = attributes {
            marks_of(attributes)?;
        }
        let attributes = attributes.cloned();
        self.text_write(
            txn,
            TextOp::Embed {
                index,
                embed,
                attributes,
            },
        )
    }

    fn text_format(
        &self,
        txn: Option<&Transaction<'_>>,
        index: i64,
        length: i64,
        attributes: &Marks,
    ) -> EngineResult<()> {
        let index = check_index(index)?;
        if length == 0 {
            return Ok(());
        }
        marks_of(attributes)?;
        self.text_write(
            txn,
            TextOp::Format {
                index,
                length,
                attributes: attributes.clone(),
            },
        )
    }

    fn text_delete(
        &self,
        txn: Option<&Transaction<'_>>,
        index: i64,
        length: i64,
    ) -> EngineResult<()> {
        if index < 0 || length < 0 {
            fail!("yjs: negative index or length.");
        }
        if length == 0 {
            return Ok(());
        }
        self.text_write(
            txn,
            TextOp::Delete {
                index: index as usize,
                length: length as usize,
            },
        )
    }

    fn text_units(&self) -> Str {
        self.read(Str::new(), |st, id| st.text_units(id))
    }

    fn text_delta(&self) -> Vec<Delta> {
        self.read(Vec::new(), |st, id| st.to_delta(id))
    }
}

macro_rules! text_api {
    ($name:ident, $kind:expr) => {
        impl $name {
            /// A prelim text seeded with initial text.
            pub fn new(initial: Option<Str>) -> $name {
                let handle = TypeRef::new_prelim($kind, None, Prelim::Text(Vec::new()));
                if let Some(initial) = initial
                    && !initial.is_empty()
                {
                    handle
                        .text_write(
                            None,
                            TextOp::Insert {
                                index: 0,
                                chunk: initial,
                                attributes: None,
                            },
                        )
                        .expect("a prelim text queues");
                }
                $name(handle)
            }

            /// YText.insert. None attributes inherit the marks in force at
            /// the index; an object (even empty) sets exactly those. On a
            /// prelim text the write is queued and txn may be None.
            pub fn insert(
                &self,
                txn: Option<&Transaction<'_>>,
                index: i64,
                chunk: impl Into<Str>,
                attributes: Option<&Marks>,
            ) -> EngineResult<()> {
                self.0.text_insert(txn, index, chunk.into(), attributes)
            }

            /// YText.insertEmbed. None attributes mean no marks.
            pub fn insert_embed(
                &self,
                txn: Option<&Transaction<'_>>,
                index: i64,
                embed: Value,
                attributes: Option<&Marks>,
            ) -> EngineResult<()> {
                self.0.text_insert_embed(txn, index, embed, attributes)
            }

            /// Sets marks over a range; a null mark value removes the mark.
            pub fn format(
                &self,
                txn: Option<&Transaction<'_>>,
                index: i64,
                length: i64,
                attributes: &Marks,
            ) -> EngineResult<()> {
                self.0.text_format(txn, index, length, attributes)
            }

            /// Removes length ticks from index.
            pub fn delete(
                &self,
                txn: Option<&Transaction<'_>>,
                index: i64,
                length: i64,
            ) -> EngineResult<()> {
                self.0.text_delete(txn, index, length)
            }

            /// The text of every live ContentString as UTF-16 units; embeds
            /// carry no text.
            pub fn units(&self) -> Str {
                self.0.text_units()
            }

            /// YText.toDelta with no snapshot. Every mark item ends a run.
            pub fn to_delta(&self) -> Vec<Delta> {
                self.0.text_delta()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.units().fmt(f)
            }
        }
    };
}

text_api!(Text, crate::TypeKind::Text);
text_api!(XmlText, crate::TypeKind::XmlText);

impl DocState {
    pub(crate) fn run_text_op(&mut self, id: TypeId, op: TextOp) -> EngineResult<()> {
        match op {
            TextOp::Insert {
                index,
                chunk,
                attributes,
            } => {
                let given = attributes.as_ref().map(marks_of).transpose()?;
                let position = self.find_position(id, index)?;
                let marks = given.unwrap_or_else(|| position.current.clone());
                self.insert_text(id, position, Content::String(chunk), marks)
            }
            TextOp::Embed {
                index,
                embed,
                attributes,
            } => {
                let marks = match &attributes {
                    Some(attributes) => marks_of(attributes)?,
                    None => Attrs::default(),
                };
                let json = match blok_jsjson::stringify(&embed) {
                    Ok(json) => json,
                    Err(err) => fail!("{err}"),
                };
                let position = self.find_position(id, index)?;
                self.insert_text(
                    id,
                    position,
                    Content::Embed(Arc::new(Str::from(json))),
                    marks,
                )
            }
            TextOp::Format {
                index,
                length,
                attributes,
            } => {
                let marks = marks_of(&attributes)?;
                let position = self.find_position(id, index)?;
                if position.right.is_none() {
                    return Ok(());
                }
                self.format_text(id, position, length, marks)
            }
            TextOp::Delete { index, length } => {
                let position = self.find_position(id, index)?;
                self.delete_text(position, length)
            }
        }
    }

    pub(crate) fn text_units(&self, id: TypeId) -> Str {
        let mut text = Str::new();
        let mut current = self.store.types[id].start;
        while let Some(at) = current {
            let item = &self.store.items[at];
            if let (Content::String(chunk), false) = (&item.content, item.deleted) {
                text.0.extend_from_slice(chunk);
            }
            current = item.right;
        }
        text
    }

    pub(crate) fn to_delta(&self, id: TypeId) -> Vec<Delta> {
        let mut delta = Vec::new();
        let mut current = Attrs::default();
        let mut run = Str::new();
        let ychange = Str::from("ychange");
        let pack = |delta: &mut Vec<Delta>, run: &mut Str, current: &Attrs| {
            if !run.is_empty() {
                delta.push(Delta {
                    insert: crate::Out::Any(Value::String(std::mem::take(run))),
                    attributes: snapshot(current),
                });
            }
        };
        let mut item = self.store.types[id].start;
        while let Some(at) = item {
            let it = &self.store.items[at];
            item = it.right;
            if it.deleted {
                continue;
            }
            match &it.content {
                Content::String(text) => {
                    // With no snapshot, a "ychange" mark is dropped at the next string.
                    if current.find(&ychange).is_some() {
                        pack(&mut delta, &mut run, &current);
                        current.remove(&ychange);
                    }
                    run.0.extend_from_slice(text);
                }
                Content::Embed(json) => {
                    pack(&mut delta, &mut run, &current);
                    delta.push(Delta {
                        insert: crate::Out::Any(parse_validated(json)),
                        attributes: snapshot(&current),
                    });
                }
                Content::Type(handle) => {
                    pack(&mut delta, &mut run, &current);
                    delta.push(Delta {
                        insert: crate::Out::Type(handle.clone()),
                        attributes: snapshot(&current),
                    });
                }
                Content::Format(format) => {
                    pack(&mut delta, &mut run, &current);
                    update_current_attributes(&mut current, format);
                }
                _ => {}
            }
        }
        pack(&mut delta, &mut run, &current);
        delta
    }

    fn forward(&self, position: &mut TextPosition) -> EngineResult<()> {
        let Some(right) = position.right else {
            fail!("yjs: nothing to the right to step over.");
        };
        let item = &self.store.items[right];
        if let Content::Format(format) = &item.content {
            if !item.deleted {
                update_current_attributes(&mut position.current, format);
            }
        } else if !item.deleted {
            position.index += item.length;
        }
        position.left = Some(right);
        position.right = item.right;
        Ok(())
    }

    /// yjs's findPosition without the search marker, a cache that lands on
    /// the same item.
    fn find_position(&mut self, id: TypeId, mut count: usize) -> EngineResult<TextPosition> {
        let mut position = TextPosition {
            left: None,
            right: self.store.types[id].start,
            index: 0,
            current: Attrs::default(),
        };
        while let Some(right) = position.right {
            if count == 0 {
                break;
            }
            let item = &self.store.items[right];
            if let Content::Format(format) = &item.content {
                if !item.deleted {
                    update_current_attributes(&mut position.current, format);
                }
            } else if !item.deleted {
                if count < item.length {
                    let split = Id::new(item.id.client, item.id.clock + count as u64);
                    self.store.get_item_clean_start(split)?;
                }
                let length = self.store.items[right].length;
                position.index += length;
                count -= length;
            }
            position.left = Some(right);
            position.right = self.store.items[right].right;
        }
        Ok(position)
    }

    fn place(
        &mut self,
        id: TypeId,
        position: &mut TextPosition,
        content: Content,
    ) -> EngineResult<()> {
        let item = self.new_item(id, position.left, position.right, None, content);
        position.right = self.integrate(item, 0)?;
        self.forward(position)
    }

    /// Switches off every mark in force the insert does not name, then
    /// writes marks, content, and the negations.
    fn insert_text(
        &mut self,
        id: TypeId,
        mut position: TextPosition,
        content: Content,
        mut attributes: Attrs,
    ) -> EngineResult<()> {
        for (key, _) in &position.current.0 {
            attributes.try_add(key.clone(), null());
        }
        self.minimize_attribute_changes(&mut position, &attributes)?;
        let negated = self.insert_attributes(id, &mut position, &attributes)?;
        self.place(id, &mut position, content)?;
        self.insert_negated_attributes(id, &mut position, negated)
    }

    /// Writes the marks, then walks the range deleting every mark it
    /// overrides and remembering what to restore at its end.
    fn format_text(
        &mut self,
        id: TypeId,
        mut position: TextPosition,
        mut length: i64,
        attributes: Attrs,
    ) -> EngineResult<()> {
        self.minimize_attribute_changes(&mut position, &attributes)?;
        let mut negated = self.insert_attributes(id, &mut position, &attributes)?;
        while let Some(right) = position.right {
            let item = &self.store.items[right];
            let is_format = matches!(item.content, Content::Format(_));
            if !(length > 0 || (!negated.0.is_empty() && (item.deleted || is_format))) {
                break;
            }
            if !item.deleted {
                if let Content::Format(format) = &item.content {
                    let format = format.clone();
                    if let Some(wanted) = attributes.get(&format.key) {
                        if equal_attrs(&wanted, &format.value()) {
                            negated.remove(&format.key);
                        } else {
                            if length == 0 {
                                break;
                            }
                            negated.set(format.key.clone(), format.value());
                        }
                        self.delete(right)?;
                    } else {
                        position.current.set(format.key.clone(), format.value());
                    }
                } else {
                    // Only reached with length > 0: otherwise the loop runs on
                    // deleted items and marks alone.
                    if length < item.length as i64 {
                        let split = Id::new(item.id.client, item.id.clock + length as u64);
                        self.store.get_item_clean_start(split)?;
                    }
                    length -= self.store.items[right].length as i64;
                }
            }
            self.forward(&mut position)?;
        }
        // yjs pads with newlines when the range runs past the end (a Quill rule).
        if length > 0 {
            let newlines = Str(vec![u16::from(b'\n'); length as usize]);
            self.place(id, &mut position, Content::String(newlines))?;
        }
        self.insert_negated_attributes(id, &mut position, negated)
    }

    fn minimize_attribute_changes(
        &self,
        position: &mut TextPosition,
        attributes: &Attrs,
    ) -> EngineResult<()> {
        while let Some(right) = position.right {
            let item = &self.store.items[right];
            if !item.deleted {
                let Content::Format(format) = &item.content else {
                    break;
                };
                if !equal_attrs(&attributes.get_or_null(&format.key), &format.value()) {
                    break;
                }
            }
            self.forward(position)?;
        }
        Ok(())
    }

    /// Writes one mark per attribute that differs from the marks in force,
    /// in JS key order, and answers what was in force before.
    fn insert_attributes(
        &mut self,
        id: TypeId,
        position: &mut TextPosition,
        attributes: &Attrs,
    ) -> EngineResult<Attrs> {
        let mut negated = Attrs::default();
        let members: Vec<Member<Arc<Value>>> = attributes
            .0
            .iter()
            .map(|(key, value)| Member {
                key: key.clone(),
                value: value.clone(),
            })
            .collect();
        for member in blok_jsjson::key_order(&members) {
            let current = position.current.get_or_null(&member.key);
            if !equal_attrs(&current, &member.value) {
                negated.set(member.key.clone(), current);
                self.write_mark(id, position, member.key.clone(), member.value.clone())?;
            }
        }
        Ok(negated)
    }

    /// Skips marks that already restore what is needed, then writes the
    /// rest in the order they were collected. A key missing from negated is
    /// undefined in yjs, never equal to a mark.
    fn insert_negated_attributes(
        &mut self,
        id: TypeId,
        position: &mut TextPosition,
        mut negated: Attrs,
    ) -> EngineResult<()> {
        while let Some(right) = position.right {
            let item = &self.store.items[right];
            if !item.deleted {
                let Content::Format(format) = &item.content else {
                    break;
                };
                match negated.get(&format.key) {
                    Some(wanted) if equal_attrs(&wanted, &format.value()) => {
                        negated.remove(&format.key);
                    }
                    _ => break,
                }
            }
            self.forward(position)?;
        }
        for (key, value) in negated.0 {
            self.write_mark(id, position, key, value)?;
        }
        Ok(())
    }

    fn write_mark(
        &mut self,
        id: TypeId,
        position: &mut TextPosition,
        key: Str,
        value: Arc<Value>,
    ) -> EngineResult<()> {
        let content = Content::Format(Arc::new(FormatContent::local(key, value)?));
        self.place(id, position, content)
    }

    /// Deletes content forward, then cleans up stranded marks.
    fn delete_text(&mut self, mut position: TextPosition, mut length: usize) -> EngineResult<()> {
        let start_attributes = position.current.clone();
        let start = position.right;
        while length > 0 {
            let Some(right) = position.right else { break };
            let item = &self.store.items[right];
            if !item.deleted
                && matches!(
                    item.content,
                    Content::String(_) | Content::Embed(_) | Content::Type(_)
                )
            {
                if length < item.length {
                    let split = Id::new(item.id.client, item.id.clock + length as u64);
                    self.store.get_item_clean_start(split)?;
                }
                length -= self.store.items[right].length;
                self.delete(right)?;
            }
            self.forward(&mut position)?;
        }
        if let Some(start) = start {
            let end = position.right;
            self.cleanup_formatting_gap(start, end, &start_attributes, &mut position.current)?;
        }
        Ok(())
    }

    /// Deletes marks a deletion left overwritten or already true. yjs
    /// compares with === here, not equal_attrs.
    fn cleanup_formatting_gap(
        &mut self,
        start: ItemId,
        current: Option<ItemId>,
        start_attributes: &Attrs,
        current_attributes: &mut Attrs,
    ) -> EngineResult<()> {
        let mut end_formats: Vec<(Str, Arc<FormatContent>)> = Vec::new();
        let mut end = Some(start);
        while let Some(at) = end {
            let item = &self.store.items[at];
            if item.countable() && !item.deleted {
                break;
            }
            if let (Content::Format(format), false) = (&item.content, item.deleted) {
                let mut replaced = false;
                for entry in end_formats.iter_mut().filter(|(key, _)| *key == format.key) {
                    entry.1 = format.clone();
                    replaced = true;
                }
                if !replaced {
                    end_formats.push((format.key.clone(), format.clone()));
                }
            }
            end = item.right;
        }
        let mut reached_current = false;
        let mut walked = Some(start);
        while walked != end {
            let Some(at) = walked else {
                fail!("yjs: the text chain ended before its gap did.");
            };
            if current == Some(at) {
                reached_current = true;
            }
            let item = &self.store.items[at];
            walked = item.right;
            let Content::Format(mark) = &item.content else {
                continue;
            };
            if item.deleted {
                continue;
            }
            let mark = mark.clone();
            let value = mark.value();
            let start_value = start_attributes.get_or_null(&mark.key);
            let started_true = strict_equals(&start_value, &value);
            let end_format = end_formats
                .iter()
                .find(|(key, _)| *key == mark.key)
                .map(|(_, format)| format);
            if !end_format.is_some_and(|format| Arc::ptr_eq(format, &mark)) || started_true {
                self.delete(at)?;
                let current_value = current_attributes.get_or_null(&mark.key);
                if !reached_current && !started_true && strict_equals(&current_value, &value) {
                    if matches!(*start_value, Value::Null) {
                        current_attributes.remove(&mark.key);
                    } else {
                        current_attributes.set(mark.key.clone(), start_value);
                    }
                }
            }
            if !reached_current && !self.store.items[at].deleted {
                update_current_attributes(current_attributes, &mark);
            }
        }
        Ok(())
    }
}

fn snapshot(current: &Attrs) -> Option<Object> {
    if current.0.is_empty() {
        return None;
    }
    Some(
        current
            .0
            .iter()
            .map(|(key, value)| (key.clone(), (**value).clone()))
            .collect(),
    )
}

/// A null mark switches the attribute off.
fn update_current_attributes(current: &mut Attrs, format: &FormatContent) {
    let value = format.value();
    if matches!(*value, Value::Null) {
        current.remove(&format.key);
    } else {
        current.set(format.key.clone(), value);
    }
}

/// yjs's equalAttrs: ===, or two objects (or arrays) with the same keys
/// whose values are === (lib0 equalFlat).
pub(crate) fn equal_attrs(left: &Arc<Value>, right: &Arc<Value>) -> bool {
    if strict_equals(left, right) {
        return true;
    }
    let (Some(left), Some(right)) = (flat_members(left), flat_members(right)) else {
        return false;
    };
    left.len() == right.len()
        && left.iter().all(|(key, value)| {
            right
                .iter()
                .find(|(other, _)| other == key)
                .is_some_and(|(_, other)| nested_strict_equals(other, value))
        })
}

fn flat_members(value: &Value) -> Option<Vec<(Str, &Value)>> {
    match value {
        Value::Object(object) => Some(
            object
                .members()
                .iter()
                .map(|member| (member.key.clone(), &member.value))
                .collect(),
        ),
        Value::Array(items) => Some(
            items
                .iter()
                .enumerate()
                .map(|(i, item)| (Str::from(i.to_string()), item))
                .collect(),
        ),
        _ => None,
    }
}

/// ===: scalars by value (NaN !== NaN, -0 === 0), anything else by
/// identity, as C# ReferenceEquals. A mark value's identity is its Arc.
pub(crate) fn strict_equals(left: &Arc<Value>, right: &Arc<Value>) -> bool {
    scalar_equals(left, right).unwrap_or_else(|| Arc::ptr_eq(left, right))
}

/// === between values nested in two mark values: their identity is their
/// address, which two distinct mark values never share.
fn nested_strict_equals(left: &Value, right: &Value) -> bool {
    scalar_equals(left, right).unwrap_or_else(|| std::ptr::eq(left, right))
}

fn scalar_equals(left: &Value, right: &Value) -> Option<bool> {
    Some(match (left, right) {
        (Value::Null, Value::Null) | (Value::Undefined, Value::Undefined) => true,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Number(a), Value::Number(b)) => a == b,
        (Value::String(a), Value::String(b)) => a == b,
        _ => return None,
    })
}
