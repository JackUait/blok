use blok_jsjson::Str;
use blok_lib0::Writer;

use crate::content::Content;
use crate::types::{TypeCore, TypeId};
use crate::{EngineResult, Header, Id, fail};

pub(crate) const ORIGIN_BIT: u8 = 0x80;
pub(crate) const RIGHT_ORIGIN_BIT: u8 = 0x40;
pub(crate) const PARENT_SUB_BIT: u8 = 0x20;
pub(crate) const CONTENT_REF_MASK: u8 = 0x1f;

/// An index into the store's item arena.
pub(crate) type ItemId = usize;

/// An item's parent: a resolved type, or before that the root name or the
/// parent item's id as the wire spelled it, or nothing.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Parent {
    None,
    Root(Str),
    Id(Id),
    Type(TypeId),
}

/// One YATA insertion. origin and right_origin are the ids the author saw
/// around it; left and right are the live neighbours.
#[derive(Clone, Debug)]
pub(crate) struct Item {
    pub id: Id,
    pub length: usize,
    pub origin: Option<Id>,
    pub right_origin: Option<Id>,
    pub left: Option<ItemId>,
    pub right: Option<ItemId>,
    pub parent: Parent,
    /// The map key, None for list content.
    pub parent_sub: Option<Str>,
    /// The info byte's parentSub bit: an origin suppresses the parentSub
    /// bytes but yjs still sets the bit.
    pub wire_parent_sub_bit: bool,
    pub content: Content,
    pub deleted: bool,
    pub keep: bool,
    /// Where an undo or redo re-created this item (yjs's Item.redone).
    pub redone: Option<Id>,
}

impl Item {
    pub fn header(&self) -> Header {
        Header {
            id: self.id,
            length: self.length,
        }
    }

    pub fn last_id(&self) -> Id {
        self.header().last_id()
    }

    pub fn end(&self) -> u64 {
        self.header().end()
    }

    pub fn countable(&self) -> bool {
        self.content.countable()
    }

    /// yjs's Item.write. An offset re-origins the item onto the tick before
    /// it. Parent and parentSub are written only when neither origin is.
    pub fn write(&self, w: &mut Writer, offset: usize, types: &[TypeCore]) -> EngineResult<()> {
        let origin = if offset > 0 {
            Some(Id::new(self.id.client, self.id.clock + offset as u64 - 1))
        } else {
            self.origin
        };
        let mut info = self.content.ref_number() & CONTENT_REF_MASK;
        if origin.is_some() {
            info |= ORIGIN_BIT;
        }
        if self.right_origin.is_some() {
            info |= RIGHT_ORIGIN_BIT;
        }
        if self.parent_sub.is_some() || self.wire_parent_sub_bit {
            info |= PARENT_SUB_BIT;
        }
        w.write_uint8(info);
        if let Some(origin) = origin {
            write_id(w, origin);
        }
        if let Some(right_origin) = self.right_origin {
            write_id(w, right_origin);
        }
        if origin.is_none() && self.right_origin.is_none() {
            self.write_parent(w, types)?;
            if let Some(sub) = &self.parent_sub {
                w.write_var_string(sub);
            }
        }
        self.content.write(w, offset);
        Ok(())
    }

    fn write_parent(&self, w: &mut Writer, types: &[TypeCore]) -> EngineResult<()> {
        match &self.parent {
            Parent::Type(tid) => {
                let core = &types[*tid];
                match core.item_id {
                    None => {
                        let Some(name) = &core.root_name else {
                            fail!("yjs: {} has a root parent with no name.", self.id);
                        };
                        w.write_var_uint(1);
                        w.write_var_string(name);
                    }
                    Some(id) => {
                        w.write_var_uint(0);
                        write_id(w, id);
                    }
                }
            }
            Parent::Root(name) => {
                w.write_var_uint(1);
                w.write_var_string(name);
            }
            Parent::Id(id) => {
                w.write_var_uint(0);
                write_id(w, *id);
            }
            Parent::None => fail!("yjs: {} has no parent to write.", self.id),
        }
        Ok(())
    }
}

pub(crate) fn write_id(w: &mut Writer, id: Id) {
    w.write_var_uint(id.client);
    w.write_var_uint(id.clock);
}

/// A struct in the store: an item in the arena or a GC. A Skip is never
/// stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Struct {
    Item(ItemId),
    Gc(Header),
}

/// A struct not integrated yet: decoded, parked, or waiting in a pass.
#[derive(Clone, Debug)]
pub(crate) enum Runtime {
    Item(Box<Item>),
    Gc(Header),
    Skip(Header),
}

impl Runtime {
    pub fn header(&self) -> Header {
        match self {
            Runtime::Item(item) => item.header(),
            Runtime::Gc(h) | Runtime::Skip(h) => *h,
        }
    }

    pub fn is_skip(&self) -> bool {
        matches!(self, Runtime::Skip(_))
    }

    pub fn write(&self, w: &mut Writer, offset: usize, types: &[TypeCore]) -> EngineResult<()> {
        match self {
            Runtime::Item(item) => item.write(w, offset, types)?,
            Runtime::Gc(h) => write_gc(w, h, offset),
            Runtime::Skip(h) => write_skip(w, h, offset),
        }
        Ok(())
    }
}

pub(crate) fn write_gc(w: &mut Writer, h: &Header, offset: usize) {
    w.write_uint8(0);
    w.write_var_uint((h.length - offset) as u64);
}

pub(crate) fn write_skip(w: &mut Writer, h: &Header, offset: usize) {
    w.write_uint8(10);
    w.write_var_uint((h.length - offset) as u64);
}
