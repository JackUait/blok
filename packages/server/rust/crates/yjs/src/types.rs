use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use blok_jsjson::{Str, Value};

use crate::content::{Content, Subdoc};
use crate::doc::{Doc, DocShared, DocState, Transaction};
use crate::item::{Item, ItemId, Parent};
use crate::text::TextOp;
use crate::{EngineResult, Id, fail};

/// An index into the store's type arena.
pub(crate) type TypeId = usize;

/// Type refs on the wire, plus the root nothing has typed yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TypeKind {
    Array,
    Map,
    Text,
    XmlElement,
    XmlFragment,
    XmlHook,
    XmlText,
    Untyped,
}

pub(crate) const MAX_TYPE_REF: u8 = 6;

impl TypeKind {
    pub(crate) fn from_ref(type_ref: u8) -> Option<TypeKind> {
        Some(match type_ref {
            0 => TypeKind::Array,
            1 => TypeKind::Map,
            2 => TypeKind::Text,
            3 => TypeKind::XmlElement,
            4 => TypeKind::XmlFragment,
            5 => TypeKind::XmlHook,
            6 => TypeKind::XmlText,
            _ => return None,
        })
    }

    /// The wire's type ref. Untyped has none and writes 255, which no
    /// path reaches: an untyped root never sits in an item.
    pub fn ref_number(self) -> u8 {
        match self {
            TypeKind::Array => 0,
            TypeKind::Map => 1,
            TypeKind::Text => 2,
            TypeKind::XmlElement => 3,
            TypeKind::XmlFragment => 4,
            TypeKind::XmlHook => 5,
            TypeKind::XmlText => 6,
            TypeKind::Untyped => 255,
        }
    }
}

/// What every shared type has once it is in a document: the item holding
/// it (None for a root), the map heads for keyed values in insertion
/// order, and the head of the list chain.
#[derive(Clone, Debug)]
pub(crate) struct TypeCore {
    pub kind: TypeKind,
    pub item: Option<ItemId>,
    pub item_id: Option<Id>,
    pub root_name: Option<Str>,
    pub entries: Vec<(Str, ItemId)>,
    pub index: HashMap<Str, usize>,
    pub start: Option<ItemId>,
    pub length: i64,
}

impl TypeCore {
    pub fn new(kind: TypeKind) -> TypeCore {
        TypeCore {
            kind,
            item: None,
            item_id: None,
            root_name: None,
            entries: Vec::new(),
            index: HashMap::new(),
            start: None,
            length: 0,
        }
    }

    pub fn map_get(&self, key: &Str) -> Option<ItemId> {
        self.index.get(key).map(|&at| self.entries[at].1)
    }

    /// Replaces a key's head in place, or adds the key at the end, as a
    /// .NET Dictionary that is never removed from does.
    pub fn map_set_head(&mut self, key: Str, head: ItemId) {
        if let Some(&at) = self.index.get(&key) {
            self.entries[at].1 = head;
            return;
        }
        self.index.insert(key.clone(), self.entries.len());
        self.entries.push((key, head));
    }

    pub fn map_clear(&mut self) {
        self.entries.clear();
        self.index.clear();
    }
}

/// What a prelim type writes when its item integrates.
pub(crate) enum Prelim {
    Empty,
    Map(Vec<(Str, In)>),
    Array(Vec<In>),
    Text(Vec<TextOp>),
}

pub(crate) enum TypeState {
    Prelim(Prelim),
    Attached { doc: Weak<DocShared>, id: TypeId },
}

pub(crate) struct TypeShared {
    kind: TypeKind,
    name: Option<Str>,
    state: Mutex<TypeState>,
}

/// A shared type: a handle that keeps its identity from prelim to
/// integrated. Equality is identity, as Go's pointers and C# references.
#[derive(Clone)]
pub struct TypeRef(Arc<TypeShared>);

impl PartialEq for TypeRef {
    fn eq(&self, other: &TypeRef) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for TypeRef {}

impl fmt::Debug for TypeRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TypeRef({:?}@{:p})", self.0.kind, Arc::as_ptr(&self.0))
    }
}

impl TypeRef {
    pub(crate) fn new_prelim(kind: TypeKind, name: Option<Str>, prelim: Prelim) -> TypeRef {
        TypeRef(Arc::new(TypeShared {
            kind,
            name,
            state: Mutex::new(TypeState::Prelim(prelim)),
        }))
    }

    /// A type with no content and no document: what the decoder builds.
    pub(crate) fn new_detached(kind: TypeKind, name: Option<Str>) -> TypeRef {
        TypeRef::new_prelim(kind, name, Prelim::Empty)
    }

    pub(crate) fn new_attached(kind: TypeKind, doc: Weak<DocShared>, id: TypeId) -> TypeRef {
        TypeRef(Arc::new(TypeShared {
            kind,
            name: None,
            state: Mutex::new(TypeState::Attached { doc, id }),
        }))
    }

    pub(crate) fn state(&self) -> MutexGuard<'_, TypeState> {
        self.0.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn kind(&self) -> TypeKind {
        self.0.kind
    }

    /// The node name of an XmlElement, the hook name of an XmlHook.
    pub fn name(&self) -> Option<&Str> {
        self.0.name.as_ref()
    }

    pub(crate) fn attached_id(&self) -> Option<TypeId> {
        match &*self.state() {
            TypeState::Attached { id, .. } => Some(*id),
            TypeState::Prelim(_) => None,
        }
    }

    fn attachment(&self) -> Option<(Arc<DocShared>, TypeId)> {
        match &*self.state() {
            TypeState::Attached { doc, id } => doc.upgrade().map(|doc| (doc, *id)),
            TypeState::Prelim(_) => None,
        }
    }

    /// The document the type belongs to, None while prelim.
    pub fn doc(&self) -> Option<Doc> {
        self.attachment()
            .map(|(shared, _)| Doc::from_shared(shared))
    }

    /// Runs read against the attached core, or answers `detached`.
    pub(crate) fn read<R>(&self, detached: R, read: impl FnOnce(&DocState, TypeId) -> R) -> R {
        match self.attachment() {
            Some((shared, id)) => read(&DocShared::lock(&shared), id),
            None => detached,
        }
    }

    /// Runs write in txn's document, refusing a prelim type or one from
    /// another document.
    pub(crate) fn write<R>(
        &self,
        txn: &Transaction<'_>,
        write: impl FnOnce(&mut DocState, TypeId) -> EngineResult<R>,
    ) -> EngineResult<R> {
        let Some((shared, id)) = self.attachment() else {
            fail!(
                "yjs: this type is not in a document; seed a prelim type at construction instead."
            );
        };
        if !txn.doc().is_shared(&shared) {
            fail!("yjs: this type belongs to another document.");
        }
        write(&mut DocShared::lock(&shared), id)
    }

    pub fn as_map(&self) -> Option<Map> {
        (self.kind() == TypeKind::Map).then(|| Map(self.clone()))
    }

    pub fn as_array(&self) -> Option<Array> {
        (self.kind() == TypeKind::Array).then(|| Array(self.clone()))
    }

    pub fn as_text(&self) -> Option<Text> {
        (self.kind() == TypeKind::Text).then(|| Text(self.clone()))
    }

    pub fn as_xml_text(&self) -> Option<XmlText> {
        (self.kind() == TypeKind::XmlText).then(|| XmlText(self.clone()))
    }
}

/// A value a map or a list is given: an Any value (bytes become
/// ContentBinary) or a prelim shared type.
#[derive(Clone, Debug)]
pub enum In {
    Any(Value),
    Type(TypeRef),
}

impl From<Value> for In {
    fn from(value: Value) -> In {
        In::Any(value)
    }
}

impl From<TypeRef> for In {
    fn from(value: TypeRef) -> In {
        In::Type(value)
    }
}

macro_rules! into_in {
    ($($t:ident),*) => {$(
        impl From<$t> for In {
            fn from(value: $t) -> In {
                In::Type(value.0)
            }
        }
        impl From<&$t> for In {
            fn from(value: &$t) -> In {
                In::Type(value.0.clone())
            }
        }
    )*};
}
into_in!(Map, Array, Text, XmlText, XmlElement, XmlFragment, XmlHook);

/// A value read back: an Any value, a shared type, or a subdocument.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    Any(Value),
    Type(TypeRef),
    Subdoc(Subdoc),
}

impl Out {
    pub fn as_value(&self) -> Option<&Value> {
        match self {
            Out::Any(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_type(&self) -> Option<&TypeRef> {
        match self {
            Out::Type(handle) => Some(handle),
            _ => None,
        }
    }

    pub fn as_map(&self) -> Option<Map> {
        self.as_type().and_then(TypeRef::as_map)
    }

    pub fn as_array(&self) -> Option<Array> {
        self.as_type().and_then(TypeRef::as_array)
    }

    pub fn as_text(&self) -> Option<Text> {
        self.as_type().and_then(TypeRef::as_text)
    }

    pub fn as_xml_text(&self) -> Option<XmlText> {
        self.as_type().and_then(TypeRef::as_xml_text)
    }
}

/// One prelim map entry.
#[derive(Clone, Debug)]
pub struct MapEntry {
    pub key: Str,
    pub value: In,
}

impl MapEntry {
    pub fn new(key: impl Into<Str>, value: impl Into<In>) -> MapEntry {
        MapEntry {
            key: key.into(),
            value: value.into(),
        }
    }
}

macro_rules! handle {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct $name(pub(crate) TypeRef);

        impl $name {
            /// The shared type behind the handle.
            pub fn as_type(&self) -> &TypeRef {
                &self.0
            }

            /// The document the type belongs to, None while prelim.
            pub fn doc(&self) -> Option<Doc> {
                self.0.doc()
            }
        }
    };
}

handle!(
    /// A Y.Map. A key's value is the last element of its head item.
    Map
);
handle!(
    /// A Y.Array.
    Array
);
handle!(
    /// A Y.Text.
    Text
);
handle!(
    /// A Y.XmlText: a text under another type ref, not a Text.
    XmlText
);
handle!(
    /// A placeholder: it integrates and re-encodes.
    XmlElement
);
handle!(
    /// A placeholder.
    XmlFragment
);
handle!(
    /// A placeholder.
    XmlHook
);

impl XmlElement {
    pub fn new(node_name: Option<Str>) -> XmlElement {
        XmlElement(TypeRef::new_detached(TypeKind::XmlElement, node_name))
    }
}

impl XmlFragment {
    pub fn new() -> XmlFragment {
        XmlFragment(TypeRef::new_detached(TypeKind::XmlFragment, None))
    }
}

impl Default for XmlFragment {
    fn default() -> Self {
        XmlFragment::new()
    }
}

impl XmlHook {
    pub fn new(hook_name: Option<Str>) -> XmlHook {
        XmlHook(TypeRef::new_detached(TypeKind::XmlHook, hook_name))
    }
}

impl Map {
    /// A prelim map written when its item integrates. A repeated key
    /// overwrites in place, as a JS Map does.
    pub fn new(entries: Vec<MapEntry>) -> Map {
        let mut prelim: Vec<(Str, In)> = Vec::new();
        for entry in entries {
            match prelim.iter_mut().find(|(key, _)| *key == entry.key) {
                Some(slot) => slot.1 = entry.value,
                None => prelim.push((entry.key, entry.value)),
            }
        }
        Map(TypeRef::new_prelim(
            TypeKind::Map,
            None,
            Prelim::Map(prelim),
        ))
    }

    /// The live keys in the order they were first set.
    pub fn keys(&self) -> Vec<Str> {
        self.0.read(Vec::new(), |st, id| st.map_keys(id))
    }

    /// The id of the item holding key's value: C# YMap.Map[key].Id. None
    /// for an absent or deleted key.
    pub fn head_id(&self, key: impl Into<Str>) -> Option<Id> {
        let key = key.into();
        self.0.read(None, |st, id| {
            let head = st.store.types[id].map_get(&key)?;
            let item = &st.store.items[head];
            (!item.deleted).then_some(item.id)
        })
    }

    /// Counts live keys.
    pub fn len(&self) -> usize {
        self.keys().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The last value of the key's head. A slot with no value reads as
    /// undefined, as JS answers there.
    pub fn get(&self, key: impl Into<Str>) -> Option<Out> {
        let key = key.into();
        self.0.read(None, |st, id| st.map_value(id, &key))
    }

    /// Writes one value under key.
    pub fn set(
        &self,
        txn: &Transaction<'_>,
        key: impl Into<Str>,
        value: impl Into<In>,
    ) -> EngineResult<()> {
        let (key, value) = (key.into(), value.into());
        self.0.write(txn, |st, id| st.map_set(id, key, value))
    }

    /// Removes key. An absent or deleted key is a no-op.
    pub fn delete(&self, txn: &Transaction<'_>, key: impl Into<Str>) -> EngineResult<()> {
        let key = key.into();
        self.0.write(txn, |st, id| st.map_delete(id, &key))
    }

    /// Removes every live key.
    pub fn clear(&self, txn: &Transaction<'_>) -> EngineResult<()> {
        self.0.write(txn, |st, id| {
            for key in st.map_keys(id) {
                st.map_delete(id, &key)?;
            }
            Ok(())
        })
    }
}

impl Array {
    /// A prelim array written when its item integrates.
    pub fn new(values: Vec<In>) -> Array {
        Array(TypeRef::new_prelim(
            TypeKind::Array,
            None,
            Prelim::Array(values),
        ))
    }

    /// The live entries, one per tick.
    pub fn values(&self) -> Vec<Out> {
        self.0.read(Vec::new(), |st, id| st.list_values(id))
    }

    /// Walks the chain rather than reading the integration counter.
    pub fn len(&self) -> usize {
        self.values().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// One entry, or None past the end.
    pub fn get(&self, index: i64) -> Option<Out> {
        self.0.read(None, |st, id| st.list_get(id, index))
    }

    /// YArray.insert: consecutive Any values share one item.
    pub fn insert(&self, txn: &Transaction<'_>, index: i64, values: Vec<In>) -> EngineResult<()> {
        self.0
            .write(txn, |st, id| st.list_insert_generics(id, index, values))
    }

    /// Removes count entries from index.
    pub fn delete(&self, txn: &Transaction<'_>, index: i64, count: i64) -> EngineResult<()> {
        self.0.write(txn, |st, id| st.list_delete(id, index, count))
    }
}

impl DocState {
    pub(crate) fn map_keys(&self, id: TypeId) -> Vec<Str> {
        self.store.types[id]
            .entries
            .iter()
            .filter(|(_, head)| !self.store.items[*head].deleted)
            .map(|(key, _)| key.clone())
            .collect()
    }

    pub(crate) fn map_value(&self, id: TypeId, key: &Str) -> Option<Out> {
        let head = &self.store.items[self.store.types[id].map_get(key)?];
        if head.deleted {
            return None;
        }
        let last = head.length.checked_sub(1);
        Some(
            last.and_then(|last| head.content.value_at(last))
                .unwrap_or(Out::Any(Value::Undefined)),
        )
    }

    pub(crate) fn list_values(&self, id: TypeId) -> Vec<Out> {
        let mut values = Vec::new();
        let mut current = self.store.types[id].start;
        while let Some(at) = current {
            let item = &self.store.items[at];
            if !item.deleted && item.countable() {
                values.extend(item.content.values());
            }
            current = item.right;
        }
        values
    }

    pub(crate) fn list_get(&self, id: TypeId, index: i64) -> Option<Out> {
        if index < 0 {
            return None;
        }
        let mut remaining = index as usize;
        let mut current = self.store.types[id].start;
        while let Some(at) = current {
            let item = &self.store.items[at];
            current = item.right;
            if item.deleted || !item.countable() {
                continue;
            }
            if remaining < item.length {
                return item.content.value_at(remaining);
            }
            remaining -= item.length;
        }
        None
    }

    /// yjs's new Item(createID(own client, state), left, left.lastId,
    /// right, right.id, parent, parentSub, content).
    pub(crate) fn new_item(
        &self,
        parent: TypeId,
        left: Option<ItemId>,
        right: Option<ItemId>,
        parent_sub: Option<Str>,
        content: Content,
    ) -> Box<Item> {
        let client = self.client_id;
        Box::new(Item {
            id: Id::new(client, self.store.get_state(client)),
            length: content.len(),
            origin: left.map(|left| self.store.items[left].last_id()),
            right_origin: right.map(|right| self.store.items[right].id),
            left,
            right,
            parent: Parent::Type(parent),
            wire_parent_sub_bit: parent_sub.is_some(),
            parent_sub,
            content,
            deleted: false,
            keep: false,
            redone: None,
        })
    }

    /// yjs's typeMapSet: the new value's left is the key's current head,
    /// deleted or not.
    pub(crate) fn map_set(&mut self, id: TypeId, key: Str, value: In) -> EngineResult<()> {
        let left = self.store.types[id].map_get(&key);
        let content = map_content(value)?;
        let item = self.new_item(id, left, None, Some(key), content);
        self.integrate(item, 0)?;
        Ok(())
    }

    pub(crate) fn map_delete(&mut self, id: TypeId, key: &Str) -> EngineResult<()> {
        if let Some(head) = self.store.types[id].map_get(key) {
            self.delete(head)?;
        }
        Ok(())
    }

    /// yjs's typeListInsertGenerics.
    pub(crate) fn list_insert_generics(
        &mut self,
        id: TypeId,
        index: i64,
        values: Vec<In>,
    ) -> EngineResult<()> {
        let length = self.store.types[id].length;
        if index < 0 || index > length {
            fail!("yjs: index {index} is outside 0..{length}.");
        }
        if index == 0 {
            return self.list_insert_generics_after(id, None, values);
        }
        let mut index = index as usize;
        let mut current = self.store.types[id].start;
        while let Some(at) = current {
            let item = &self.store.items[at];
            if !item.deleted && item.countable() {
                if index <= item.length {
                    if index < item.length {
                        let split = Id::new(item.id.client, item.id.clock + index as u64);
                        self.store.get_item_clean_start(split)?;
                    }
                    break;
                }
                index -= item.length;
            }
            current = self.store.items[at].right;
        }
        self.list_insert_generics_after(id, current, values)
    }

    /// Packs a run of Any values into one item; a byte array or a shared
    /// type flushes the run and takes an item of its own.
    fn list_insert_generics_after(
        &mut self,
        id: TypeId,
        reference: Option<ItemId>,
        values: Vec<In>,
    ) -> EngineResult<()> {
        let mut left = reference;
        // Every item of this insert shares one right neighbour, as yjs does.
        let right = match reference {
            Some(reference) => self.store.items[reference].right,
            None => self.store.types[id].start,
        };
        let mut packed: Vec<Value> = Vec::new();
        let place =
            |st: &mut DocState, left: &mut Option<ItemId>, content: Content| -> EngineResult<()> {
                let item = st.new_item(id, *left, right, None, content);
                *left = st.integrate(item, 0)?;
                Ok(())
            };
        for value in values {
            match value {
                In::Any(Value::Bytes(bytes)) => {
                    if !packed.is_empty() {
                        place(self, &mut left, Content::Any(std::mem::take(&mut packed)))?;
                    }
                    place(self, &mut left, Content::Binary(Arc::new(bytes)))?;
                }
                In::Any(Value::Undefined) => {
                    fail!("yjs: undefined is not a value a list can hold.")
                }
                In::Any(Value::BigInt(_)) => fail!("yjs: a bigint is not a value a list can hold."),
                In::Any(value) => packed.push(value),
                In::Type(handle) => {
                    if !packed.is_empty() {
                        place(self, &mut left, Content::Any(std::mem::take(&mut packed)))?;
                    }
                    place(self, &mut left, content_type_for(handle)?)?;
                }
            }
        }
        if !packed.is_empty() {
            place(self, &mut left, Content::Any(packed))?;
        }
        Ok(())
    }

    /// yjs's typeListDelete.
    pub(crate) fn list_delete(&mut self, id: TypeId, index: i64, length: i64) -> EngineResult<()> {
        if index < 0 || length < 0 {
            fail!("yjs: negative index or length.");
        }
        if length == 0 {
            return Ok(());
        }
        let (mut index, mut length) = (index as usize, length as usize);
        let mut current = self.store.types[id].start;
        while let Some(at) = current {
            if index == 0 {
                break;
            }
            let item = &self.store.items[at];
            if !item.deleted && item.countable() {
                if index < item.length {
                    let split = Id::new(item.id.client, item.id.clock + index as u64);
                    self.store.get_item_clean_start(split)?;
                }
                index -= self.store.items[at].length;
            }
            current = self.store.items[at].right;
        }
        while length > 0 {
            let Some(at) = current else { break };
            if !self.store.items[at].deleted {
                let item = &self.store.items[at];
                if length < item.length {
                    let split = Id::new(item.id.client, item.id.clock + length as u64);
                    self.store.get_item_clean_start(split)?;
                }
                length -= self.store.items[at].length.min(length);
                self.delete(at)?;
            }
            current = self.store.items[at].right;
        }
        if length > 0 {
            fail!("yjs: the delete runs past the end of the list.");
        }
        Ok(())
    }

    /// ContentType.integrate: the type joins the document, then a prelim
    /// type's content is written, top-down inside the transaction.
    pub(crate) fn attach_type(&mut self, handle: &TypeRef, item: ItemId) -> EngineResult<()> {
        let mut core = TypeCore::new(handle.kind());
        core.item = Some(item);
        core.item_id = Some(self.store.items[item].id);
        let id = self.store.types.len();
        self.store.types.push(core);
        let prelim = {
            let mut state = handle.state();
            let previous = std::mem::replace(
                &mut *state,
                TypeState::Attached {
                    doc: self.self_ref.clone(),
                    id,
                },
            );
            match previous {
                TypeState::Prelim(prelim) => prelim,
                TypeState::Attached { .. } => {
                    fail!("yjs: this shared type already belongs to a document.")
                }
            }
        };
        match prelim {
            Prelim::Empty => Ok(()),
            Prelim::Map(entries) => {
                for (key, value) in entries {
                    self.map_set(id, key, value)?;
                }
                Ok(())
            }
            Prelim::Array(values) => self.list_insert_generics(id, 0, values),
            Prelim::Text(ops) => {
                for op in ops {
                    self.run_text_op(id, op)?;
                }
                Ok(())
            }
        }
    }

    /// The root under name, untyped until something asks for a kind.
    pub(crate) fn root(&mut self, name: &Str) -> (TypeRef, TypeId) {
        if let Some(existing) = self.share.get(name) {
            let id = existing.attached_id().expect("a root is attached");
            return (existing.clone(), id);
        }
        let mut core = TypeCore::new(TypeKind::Untyped);
        core.root_name = Some(name.clone());
        let id = self.store.types.len();
        self.store.types.push(core);
        let handle = TypeRef::new_attached(TypeKind::Untyped, self.self_ref.clone(), id);
        self.share.insert(name.clone(), handle.clone());
        (handle, id)
    }

    /// Upgrades an untyped root, re-pointing the list chain and every map
    /// chain (walked LEFT from each head) at the new type.
    pub(crate) fn root_typed(&mut self, name: &Str, kind: TypeKind) -> EngineResult<TypeRef> {
        let (existing, old) = self.root(name);
        if existing.kind() == kind {
            return Ok(existing);
        }
        if existing.kind() != TypeKind::Untyped {
            fail!(
                "Type with the name {name} has already been defined with a different constructor"
            );
        }
        let mut core = self.store.types[old].clone();
        core.kind = kind;
        let id = self.store.types.len();
        for &(_, head) in &core.entries {
            let mut item = Some(head);
            while let Some(at) = item {
                self.store.items[at].parent = Parent::Type(id);
                item = self.store.items[at].left;
            }
        }
        let mut item = core.start;
        while let Some(at) = item {
            self.store.items[at].parent = Parent::Type(id);
            item = self.store.items[at].right;
        }
        self.store.types.push(core);
        let upgraded = TypeRef::new_attached(kind, self.self_ref.clone(), id);
        self.share.insert(name.clone(), upgraded.clone());
        Ok(upgraded)
    }
}

/// typeMapSet's content switch. A map value is always one tick; undefined
/// is allowed because yjs tests value == null loosely.
fn map_content(value: In) -> EngineResult<Content> {
    Ok(match value {
        In::Any(Value::Bytes(bytes)) => Content::Binary(Arc::new(bytes)),
        In::Any(Value::BigInt(_)) => fail!("yjs: a bigint is not a value a map can hold."),
        In::Any(value) => Content::Any(vec![value]),
        In::Type(handle) => content_type_for(handle)?,
    })
}

/// The write side: the caller's own prelim instance. It must not already
/// be in a document, or yjs would fork its children.
fn content_type_for(handle: TypeRef) -> EngineResult<Content> {
    if !matches!(&*handle.state(), TypeState::Prelim(_)) {
        fail!("yjs: this shared type already belongs to a document.");
    }
    if handle.kind() == TypeKind::Untyped {
        fail!("yjs: an untyped root has no shared type ref.");
    }
    Ok(Content::Type(handle))
}
