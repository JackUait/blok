use std::collections::{HashMap, HashSet};
use std::panic::{AssertUnwindSafe, catch_unwind};

use blok_jsjson::{Node, Str, Value};
use blok_lib0::{Reader, read_any};
use blok_yjs::{Array, Doc, EngineError, In, Map, Out, Text, Transaction};

use crate::deepassign::assign_entry;
use crate::editops::{EditError, EditOp, MapPatch};
use crate::error::Error;
use crate::export::{
    BLOCK_FIELD_DEPTH, BLOCKS_ROOT, DataError, ORDER_ROOT, PAGE_MAPS, PAGE_ROOT, RichTextHtml,
    str_value,
};
use crate::fields::RichTextFields;
use crate::richtext::{is, without_nul};
use crate::richtextedit::{apply_rich_text_ops, plan_rich_text_edit};
use crate::richtextinput::RichTextInput;
use crate::seed::{
    Entry, EntryValue, SourceValue, atomic_value, block_data_entries, block_map, edit_value,
    is_source_page_icon, new_rich_text, no_nul, normalize_block_data, plain_to_y_value, screen,
    strict_value, to_data_map,
};
use crate::structure::{encode_any, is_plain_map_value};
use crate::textdiff::diff;

/// Applies block-level edit ops in request order; a later op sees what the
/// earlier ones did. Everything that can refuse runs before the transaction
/// opens, so a refused request (Error::Edit) writes nothing and an applied
/// one emits one update.
pub fn apply_ops(doc: &Doc, ops: &[EditOp], input: &mut RichTextInput<'_>) -> Result<(), Error> {
    apply_ops_counted(doc, ops, input).map(|_| ())
}

/// The HTML the rich fields of ops carry, each once. It plans the request
/// as apply_ops does, writes nothing, and fails where apply_ops would.
pub fn collect_ops_html(
    doc: &Doc,
    ops: &[EditOp],
    fields: &RichTextFields,
) -> Result<Vec<RichTextHtml>, Error> {
    let mut input = RichTextInput::collecting(fields);
    Planner::new(doc, &mut input)?.plan(ops)?;
    Ok(input.found().to_vec())
}

/// apply_ops, also reporting how many blocks the removal walks visited.
pub(crate) fn apply_ops_counted(
    doc: &Doc,
    ops: &[EditOp],
    input: &mut RichTextInput<'_>,
) -> Result<usize, Error> {
    if ops.is_empty() {
        return Ok(0);
    }
    let mut planner = Planner::new(doc, input)?;
    let steps = planner.plan(ops)?;
    let visited = planner.visited;
    run_steps(doc, steps)?;
    Ok(visited)
}

/// One write, already validated and built. It never refuses; an Err (or a
/// panic) is a failure mid-write.
pub(crate) type Step = Box<dyn FnOnce(&Transaction<'_>, &Map, &Array) -> Result<(), Error>>;

/// Writes every step in one transaction. A failing step ends it without
/// cleanup or emit, and what earlier steps wrote stays in the doc.
pub(crate) fn run_steps(doc: &Doc, steps: Vec<Step>) -> Result<(), Error> {
    let block_map = doc.get_map(BLOCKS_ROOT)?;
    let root_order = doc.get_array(ORDER_ROOT)?;
    let mut failure = None;
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        doc.transact(|t| {
            for s in steps {
                if let Err(err) = s(t, &block_map, &root_order) {
                    failure = Some(err);
                    return Err(EngineError::new("a step failed"));
                }
            }
            Ok(())
        })
    }));
    match outcome {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(engine)) => Err(Error::EditFailedMidWrite(Box::new(
            failure.unwrap_or(Error::Engine(engine)),
        ))),
        Err(panic) => {
            let text = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "a step panicked".into());
            Err(Error::EditFailedMidWrite(Box::new(Error::Message(text))))
        }
    }
}

fn remove_first(list: &mut Vec<Str>, id: &Str) {
    if let Some(i) = list.iter().position(|x| x == id) {
        list.remove(i);
    }
}

/// A picture of the doc, mutated as it plans so a later op sees an earlier
/// one. parentId is the membership arbiter, as on export. Lists are looked
/// up by key each time: C# shares one List per parent, and a move reads
/// its siblings again after unlinking from them.
struct Planner<'p, 'f> {
    doc: &'p Doc,
    block_map: Map,
    root_order: Array,
    input: &'p mut RichTextInput<'f>,
    parents: HashMap<Str, Option<Str>>,
    not_blocks: HashSet<Str>,
    children: HashMap<Str, Vec<Str>>,
    // The root order as stored: None is a slot that is not an id but still
    // counts, as step indexes are applied to the real array.
    order: Vec<Option<Str>>,
    listed_by: HashMap<Str, Vec<Str>>,
    // None is a block with no contentIds array at all.
    contents: HashMap<Str, Option<Vec<Str>>>,
    types: HashMap<Str, Option<Str>>,
    visited: usize,
}

fn where_(index: usize, message: &str) -> Error {
    EditError::new(format!("collab: op {index}: {message}")).into()
}

fn child_of(parent: Option<&Str>) -> String {
    match parent {
        None => "the document root".into(),
        Some(parent) => format!("\"{parent}\""),
    }
}

fn index_of_slot(order: &[Option<Str>], id: &Str) -> Option<usize> {
    order.iter().position(|slot| slot.as_ref() == Some(id))
}

fn last_index_of_slot(order: &[Option<Str>], id: &Str) -> Option<usize> {
    order.iter().rposition(|slot| slot.as_ref() == Some(id))
}

fn screened(id: &Str, what: &str) -> Result<Str, DataError> {
    no_nul(id, what)?;
    Ok(id.clone())
}

fn screened_opt(id: Option<&Str>, what: &str) -> Result<Option<Str>, DataError> {
    id.map(|id| screened(id, what)).transpose()
}

fn read_content_ids(block: &Map) -> Option<Vec<Str>> {
    let content_ids = block.get("contentIds")?.as_array()?;
    Some(
        content_ids
            .values()
            .into_iter()
            .filter_map(|entry| match entry {
                Out::Any(Value::String(s)) => Some(s),
                _ => None,
            })
            .collect(),
    )
}

impl<'p, 'f> Planner<'p, 'f> {
    fn new(doc: &'p Doc, input: &'p mut RichTextInput<'f>) -> Result<Planner<'p, 'f>, Error> {
        Ok(Planner {
            doc,
            block_map: doc.get_map(BLOCKS_ROOT)?,
            root_order: doc.get_array(ORDER_ROOT)?,
            input,
            parents: HashMap::new(),
            not_blocks: HashSet::new(),
            children: HashMap::new(),
            order: Vec::new(),
            listed_by: HashMap::new(),
            contents: HashMap::new(),
            types: HashMap::new(),
            visited: 0,
        })
    }

    fn plan(&mut self, ops: &[EditOp]) -> Result<Vec<Step>, Error> {
        self.read_doc();
        let mut steps = Vec::new();
        for (index, op) in ops.iter().enumerate() {
            match self.plan_one(op, index) {
                Ok(planned) => steps.extend(planned),
                // The converter's own guards speak about a document; the
                // caller still has to learn which op was refused.
                Err(Error::Data(data)) => return Err(where_(index, &data.message)),
                Err(err) => return Err(err),
            }
        }
        Ok(steps)
    }

    fn read_doc(&mut self) {
        for id in self.block_map.keys() {
            let Some(block) = self.block_map.get(&id[..]).and_then(|v| v.as_map()) else {
                self.not_blocks.insert(id.clone());
                self.parents.insert(id, None);
                continue;
            };
            let parent_id = str_value(&block, "parentId");
            self.parents.insert(id.clone(), parent_id.clone());
            self.types.insert(id.clone(), str_value(&block, "type"));
            self.index(&id, parent_id.as_ref());
            let listed = read_content_ids(&block);
            for child in listed.iter().flatten() {
                self.listed_by_of(child).push(id.clone());
            }
            self.contents.insert(id, listed);
        }
        for entry in self.root_order.values() {
            self.order.push(match entry {
                Out::Any(Value::String(s)) => Some(s),
                _ => None,
            });
        }
    }

    fn listed_by_of(&mut self, child: &Str) -> &mut Vec<Str> {
        self.listed_by.entry(child.clone()).or_default()
    }

    fn index(&mut self, id: &Str, parent_id: Option<&Str>) {
        if let Some(parent_id) = parent_id {
            self.children
                .entry(parent_id.clone())
                .or_default()
                .push(id.clone());
        }
    }

    fn siblings(&mut self, parent: &Str) -> &mut Vec<Str> {
        match self.contents.get_mut(parent) {
            Some(Some(siblings)) => siblings,
            _ => unreachable!("the plan checked the children list"),
        }
    }

    fn plan_one(&mut self, op: &EditOp, index: usize) -> Result<Vec<Step>, Error> {
        match op {
            EditOp::Insert {
                id,
                block,
                after,
                parent,
            } => self.plan_insert(id, block, after.as_ref(), parent.as_ref(), index),
            EditOp::Update { id, data } => self.plan_update(id, data, index),
            EditOp::Remove { id } => self.plan_remove(id, index),
            EditOp::PatchMaps { patches } => self.plan_patch_maps(patches, index),
            EditOp::SetPageField { key, value } => {
                self.plan_set_page_field(key, value.as_ref(), index)
            }
            EditOp::Move { id, after, parent } => {
                self.move_block(id, after.as_ref(), parent.as_ref(), index)
            }
            EditOp::Lift { id } => self.plan_lift(id, index),
            EditOp::Retype { id, kind, data } => self.plan_retype(id, kind, data, index),
            EditOp::SetTunes { id, tunes } => self.plan_set_tunes(id, tunes, index),
            EditOp::SetMetadata {
                id,
                last_edited_at,
                last_edited_by,
                last_edited_with,
            } => self.plan_set_metadata(
                id,
                *last_edited_at,
                last_edited_by,
                last_edited_with.as_ref(),
                index,
            ),
        }
    }

    fn plan_insert(
        &mut self,
        id: &Str,
        block: &Node,
        after: Option<&Str>,
        parent: Option<&Str>,
        index: usize,
    ) -> Result<Vec<Step>, Error> {
        if self.parents.contains_key(id) {
            return Err(where_(
                index,
                &format!("the document already has a block \"{id}\"."),
            ));
        }
        let parent = screened_opt(parent, "a parent id")?;
        if let Some(parent) = &parent
            && !self.parents.contains_key(parent)
        {
            return Err(where_(
                index,
                &format!("there is no block \"{parent}\" to insert under."),
            ));
        }
        let after = screened_opt(after, "a block id")?;
        if let Some(after) = &after {
            match self.parents.get(after) {
                None => {
                    return Err(where_(
                        index,
                        &format!("there is no block \"{after}\" to insert after."),
                    ));
                }
                Some(after_parent) if after_parent != &parent => {
                    return Err(where_(
                        index,
                        &format!(
                            "block \"{after}\" is not a child of {}.",
                            child_of(parent.as_ref())
                        ),
                    ));
                }
                Some(_) => {}
            }
        }
        if let Some(parent) = &parent {
            self.refuse_unless_block_map(parent, parent, index)?;
            let Some(Some(siblings)) = self.contents.get(parent) else {
                return Err(where_(
                    index,
                    &format!(
                        "block \"{parent}\" has no children list, so nothing can be placed under it."
                    ),
                ));
            };
            if let Some(after) = &after
                && !siblings.contains(after)
            {
                return Err(where_(
                    index,
                    &format!(
                        "block \"{after}\" is not in the document order, so nothing can be placed after it."
                    ),
                ));
            }
        }
        // Built now: composing runs the NUL and depth guards before any write.
        let SourceValue::Object(mut block) = strict_value(block)? else {
            return Err(Error::Message(
                "collab: an insert's block is not an object".into(),
            ));
        };
        if let Some(parent) = &parent {
            block.set(Str::from("parent"), SourceValue::String(parent.clone()));
        }
        no_nul(id, "a block id")?;
        let composed = block_map(id, &block, self.input)?;
        self.parents.insert(id.clone(), parent.clone());
        let kind = match block.get(&Str::from("type")) {
            Some(SourceValue::String(kind)) => Some(kind.clone()),
            _ => None,
        };
        self.types.insert(id.clone(), kind);
        self.index(id, parent.as_ref());
        self.contents.insert(id.clone(), Some(Vec::new()));
        if let Some(parent) = &parent {
            self.listed_by_of(id).push(parent.clone());
        }
        let mut steps = vec![put_block(id.clone(), composed)];
        match &parent {
            None => {
                let mut at = 0;
                if let Some(after) = &after {
                    // A root block by its parentId that the root order does not list.
                    let Some(found) = index_of_slot(&self.order, after) else {
                        return Err(where_(
                            index,
                            &format!(
                                "block \"{after}\" is not in the document order, so nothing can be placed after it."
                            ),
                        ));
                    };
                    at = found + 1;
                }
                self.order.insert(at, Some(id.clone()));
                steps.push(insert_root_order(at, id.clone()));
            }
            Some(parent) => {
                let siblings = self.siblings(parent);
                let at = after
                    .as_ref()
                    .and_then(|after| siblings.iter().position(|x| x == after))
                    .map_or(0, |i| i + 1);
                siblings.insert(at, id.clone());
                steps.push(link_child(parent.clone(), id.clone(), after));
            }
        }
        Ok(steps)
    }

    fn kind_of(&self, id: &Str) -> Option<Str> {
        self.types.get(id).cloned().flatten()
    }

    /// BlockDataEntries over NormalizeBlockData, then the Screen the update
    /// path needs because its values are written later.
    fn data_entries(&mut self, kind: Option<&Str>, data: &Node) -> Result<Vec<Entry>, Error> {
        let SourceValue::Object(data) = edit_value(data)? else {
            return Err(Error::Message("collab: block data is not an object".into()));
        };
        let name = kind.cloned().unwrap_or_default();
        let entries = block_data_entries(
            kind.map(|k| &k[..]),
            &normalize_block_data(&name, data),
            self.input,
        )?;
        screen(&entries)?;
        Ok(entries)
    }

    fn known(&self, id: &Str, index: usize, missing: &str) -> Result<(), Error> {
        if !self.parents.contains_key(id) {
            return Err(where_(
                index,
                &format!("there is no block \"{id}\" to {missing}."),
            ));
        }
        Ok(())
    }

    fn plan_update(&mut self, id: &Str, data: &Node, index: usize) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        self.known(&id, index, "update")?;
        self.refuse_unless_block_map(&id, &id, index)?;
        let entries = self.data_entries(self.kind_of(&id).as_ref(), data)?;
        Ok(vec![replace_data(id, entries)])
    }

    /// Follows parentId, not contentIds, to find the subtree.
    fn plan_remove(&mut self, id: &Str, index: usize) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        self.known(&id, index, "remove")?;
        let mut doomed = vec![id.clone()];
        let mut is_doomed = HashSet::from([id]);
        // Iterative and linear in the subtree: a document may nest thousands deep.
        let mut next = 0;
        while next < doomed.len() {
            self.visited += 1;
            if let Some(bucket) = self.children.get(&doomed[next]) {
                for child in bucket {
                    if is_doomed.insert(child.clone()) {
                        doomed.push(child.clone());
                    }
                }
            }
            next += 1;
        }
        let mut steps = Vec::new();
        for gone in &doomed {
            if let Some(Some(parent_id)) = self.parents.get(gone)
                && let Some(siblings) = self.children.get_mut(parent_id)
            {
                remove_first(siblings, gone);
            }
            self.parents.remove(gone);
            self.children.remove(gone);
            self.types.remove(gone);
            steps.push(remove_block(gone.clone()));
            if let Some(listed) = self.contents.remove(gone) {
                for child in listed.iter().flatten() {
                    if let Some(holders) = self.listed_by.get_mut(child) {
                        remove_first(holders, gone);
                    }
                }
            }
            // Every occurrence: a duplicate left behind is a dangling id for good.
            while let Some(at) = last_index_of_slot(&self.order, gone) {
                self.order.remove(at);
                steps.push(remove_root_order(at));
            }
            // Unlink wherever the doc lists it, not just from its parent.
            if let Some(holders) = self.listed_by.remove(gone) {
                for holder in holders {
                    if !is_doomed.contains(&holder) {
                        if let Some(Some(listed)) = self.contents.get_mut(&holder) {
                            remove_first(listed, gone);
                        }
                        steps.push(unlink_child(holder, gone.clone()));
                    }
                }
            }
        }
        Ok(steps)
    }

    fn plan_patch_maps(&mut self, patches: &[MapPatch], index: usize) -> Result<Vec<Step>, Error> {
        let mut steps = Vec::new();
        for patch in patches {
            if !PAGE_MAPS.iter().any(|name| is(&patch.map, name)) {
                return Err(where_(
                    index,
                    &format!("\"{}\" is not a map a patch may write.", patch.map),
                ));
            }
            let target = self.doc.get_map(patch.map.clone())?;
            if patch.remove {
                steps.push(patch_map(target, patch.key.clone(), None));
                continue;
            }
            let Out::Any(value) = &patch.value else {
                return Err(not_plain(index, patch));
            };
            if !is_plain_map_value(&patch.value) {
                return Err(not_plain(index, patch));
            }
            // C# refuses here only when encoding runs out of stack; this
            // writer has no such limit.
            steps.push(patch_map(
                target,
                patch.key.clone(),
                Some(encode_any(value)),
            ));
        }
        Ok(steps)
    }

    /// DocumentStore.moveBlockTo: the id leaves every order that lists it,
    /// its parentId is rewritten (deleted for the root), and it is placed
    /// after `after`. The block map is never replaced. Ids are taken as the
    /// doc spells them, so Lift can move a child whose id a peer wrote.
    fn move_block(
        &mut self,
        block_id: &Str,
        after_id: Option<&Str>,
        parent_id: Option<&Str>,
        index: usize,
    ) -> Result<Vec<Step>, Error> {
        let id = screened(block_id, "a block id")?;
        let Some(old_parent) = self.parents.get(&id).cloned() else {
            return Err(where_(
                index,
                &format!("there is no block \"{id}\" to move."),
            ));
        };
        self.refuse_unless_block_map(&id, &id, index)?;
        let parent = screened_opt(parent_id, "a parent id")?;
        if let Some(parent) = &parent {
            if !self.parents.contains_key(parent) {
                return Err(where_(
                    index,
                    &format!("there is no block \"{parent}\" to move under."),
                ));
            }
            self.refuse_unless_block_map(parent, parent, index)?;
            // A cycle a peer wrote must not hang the walk.
            let mut seen = HashSet::new();
            let mut cursor = Some(parent.clone());
            while let Some(at) = cursor {
                if !seen.insert(at.clone()) {
                    break;
                }
                if at == id {
                    return Err(where_(
                        index,
                        &format!("block \"{id}\" cannot move inside itself."),
                    ));
                }
                cursor = self.parents.get(&at).cloned().flatten();
            }
            if !matches!(self.contents.get(parent), Some(Some(_))) {
                return Err(where_(
                    index,
                    &format!(
                        "block \"{parent}\" has no children list, so nothing can be placed under it."
                    ),
                ));
            }
        }
        let after = screened_opt(after_id, "a block id")?;
        if let Some(after) = &after {
            let listed = match &parent {
                None => index_of_slot(&self.order, after).is_some(),
                Some(parent) => {
                    matches!(self.contents.get(parent), Some(Some(s)) if s.contains(after))
                }
            };
            if *after == id || self.parents.get(after) != Some(&parent) || !listed {
                return Err(where_(
                    index,
                    &format!(
                        "block \"{after}\" is not a child of {}, so nothing can be placed after it.",
                        child_of(parent.as_ref())
                    ),
                ));
            }
        }
        let mut steps = Vec::new();
        while let Some(at) = last_index_of_slot(&self.order, &id) {
            self.order.remove(at);
            steps.push(remove_root_order(at));
        }
        if let Some(holders) = self.listed_by.remove(&id) {
            for holder in holders {
                if let Some(Some(listed)) = self.contents.get_mut(&holder) {
                    remove_first(listed, &id);
                }
                steps.push(unlink_child(holder, id.clone()));
            }
        }
        // The child index follows parentId, and a later removal walks it.
        if let Some(old_parent) = &old_parent
            && let Some(bucket) = self.children.get_mut(old_parent)
        {
            remove_first(bucket, &id);
        }
        self.parents.insert(id.clone(), parent.clone());
        self.index(&id, parent.as_ref());
        steps.push(set_parent_id(id.clone(), parent.clone()));
        match &parent {
            None => {
                let at = after
                    .as_ref()
                    .and_then(|after| index_of_slot(&self.order, after))
                    .map_or(0, |i| i + 1);
                self.order.insert(at, Some(id.clone()));
                steps.push(insert_root_order(at, id));
            }
            Some(parent) => {
                self.listed_by_of(&id).push(parent.clone());
                let siblings = self.siblings(parent);
                let at = after
                    .as_ref()
                    .and_then(|after| siblings.iter().position(|x| x == after))
                    .map_or(0, |i| i + 1);
                siblings.insert(at, id.clone());
                steps.push(link_child(parent.clone(), id, after));
            }
        }
        Ok(steps)
    }

    /// Moves the children into the block's own slot, in order, right after
    /// it: listed children first, then any only their parentId names.
    fn plan_lift(&mut self, id: &Str, index: usize) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        let Some(parent_id) = self.parents.get(&id).cloned() else {
            return Err(where_(
                index,
                &format!("there is no block \"{id}\" to lift children out of."),
            ));
        };
        let mut lifted = Vec::new();
        let mut seen = HashSet::new();
        let mut add = |child: &Str| {
            if seen.insert(child.clone()) {
                lifted.push(child.clone());
            }
        };
        if let Some(Some(listed)) = self.contents.get(&id) {
            for child in listed {
                if self.parents.get(child).cloned().flatten().as_ref() == Some(&id) {
                    add(child);
                }
            }
        }
        if let Some(bucket) = self.children.get(&id) {
            for child in bucket {
                add(child);
            }
        }
        let mut steps = Vec::new();
        let mut after = id;
        for child in lifted {
            steps.extend(self.move_block(&child, Some(&after), parent_id.as_ref(), index)?);
            after = child;
        }
        Ok(steps)
    }

    fn plan_retype(
        &mut self,
        id: &Str,
        kind: &Str,
        data: &Node,
        index: usize,
    ) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        self.known(&id, index, "retype")?;
        self.refuse_unless_block_map(&id, &id, index)?;
        no_nul(kind, "a block type")?;
        let entries = self.data_entries(Some(kind), data)?;
        self.types.insert(id.clone(), Some(kind.clone()));
        Ok(vec![
            set_block_field(id.clone(), "type", Value::String(kind.clone())),
            replace_data(id, entries),
        ])
    }

    fn plan_set_tunes(&mut self, id: &Str, tunes: &Node, index: usize) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        self.known(&id, index, "set tunes on")?;
        self.refuse_unless_block_map(&id, &id, index)?;
        let mut planned = Vec::new();
        for m in &tunes.members {
            let name = m.key().map_err(Error::NotUnicode)?;
            let v = edit_value(&m.value)?;
            // Screened here: a step must not throw mid-transaction.
            plain_to_y_value(&v, BLOCK_FIELD_DEPTH + 1)?;
            no_nul(&name, "a tune name")?;
            planned.push((name, v));
        }
        Ok(vec![set_tunes(id, planned)])
    }

    fn plan_set_metadata(
        &mut self,
        id: &Str,
        at: f64,
        by: &Str,
        with: Option<&Str>,
        index: usize,
    ) -> Result<Vec<Step>, Error> {
        let id = screened(id, "a block id")?;
        self.known(&id, index, "stamp")?;
        self.refuse_unless_block_map(&id, &id, index)?;
        if !at.is_finite() {
            return Err(where_(index, "\"lastEditedAt\" must be a finite number."));
        }
        no_nul(by, "an editor id")?;
        let mut steps = vec![
            set_block_field(id.clone(), "lastEditedAt", Value::Number(at)),
            set_block_field(id.clone(), "lastEditedBy", Value::String(by.clone())),
        ];
        // LOCKSTEP with DocumentStore.updateBlockMetadata: no co-editor removes the old one.
        match with {
            Some(with) => {
                no_nul(with, "a co-editor id")?;
                steps.push(set_block_field(
                    id,
                    "lastEditedWith",
                    Value::String(with.clone()),
                ));
            }
            None => steps.push(remove_block_field(id, "lastEditedWith")),
        }
        Ok(steps)
    }

    /// writePageField: NULs stripped, null or "" deletes.
    fn plan_set_page_field(
        &mut self,
        key: &Str,
        value: Option<&Node>,
        index: usize,
    ) -> Result<Vec<Step>, Error> {
        let title = is(key, "title");
        if !title && !is(key, "icon") {
            return Err(where_(index, &format!("\"{key}\" is not a page field.")));
        }
        let v = value.map(strict_value).transpose()?.map(clean_page_field);
        let page_map = self.doc.get_map(PAGE_ROOT)?;
        let v = match v {
            None | Some(SourceValue::Null) => None,
            Some(SourceValue::String(text)) if text.is_empty() => None,
            Some(v) => Some(v),
        };
        let Some(v) = v else {
            return Ok(vec![patch_map(page_map, key.clone(), None)]);
        };
        if title {
            if !matches!(v, SourceValue::String(_)) {
                return Err(where_(index, "a page title is a string."));
            }
        } else if !is_source_page_icon(&v) {
            return Err(where_(
                index,
                r#"a page icon is { type: "emoji", value } or { type: "image", url }."#,
            ));
        }
        let atomic = atomic_value(&v, 1)?;
        Ok(vec![patch_map(
            page_map,
            key.clone(),
            Some(encode_any(&atomic)),
        )])
    }

    /// Refuses a target in the blocks map that is not a block: a step that
    /// reads it as a map would fail mid-transaction.
    fn refuse_unless_block_map(&self, id: &Str, name: &Str, index: usize) -> Result<(), Error> {
        if self.not_blocks.contains(id) {
            return Err(where_(
                index,
                &format!("\"{name}\" is in the document but is not a block."),
            ));
        }
        Ok(())
    }
}

fn not_plain(index: usize, patch: &MapPatch) -> Error {
    where_(
        index,
        &format!(
            "the value for \"{}.{}\" is not plain JSON.",
            patch.map, patch.key
        ),
    )
}

/// A string, or an object's top-level strings, without U+0000.
fn clean_page_field(v: SourceValue) -> SourceValue {
    let clean = |v: &SourceValue| match v {
        SourceValue::String(s) => SourceValue::String(without_nul(s)),
        other => other.clone(),
    };
    match &v {
        SourceValue::Object(object) => SourceValue::Object(
            object
                .members()
                .iter()
                .map(|m| (m.key.clone(), clean(&m.value)))
                .collect(),
        ),
        other => clean(other),
    }
}

fn block_of(block_map: &Map, id: &Str) -> Option<Map> {
    block_map.get(&id[..]).and_then(|v| v.as_map())
}

pub(crate) fn put_block(id: Str, block: Map) -> Step {
    Box::new(move |t, block_map, _| Ok(block_map.set(t, id, block)?))
}

fn remove_block(id: Str) -> Step {
    Box::new(move |t, block_map, _| Ok(block_map.delete(t, id)?))
}

/// Rewrites a block's data key by key and each key in place, so a peer's
/// live text or container keeps its identity. Keys the new data lacks are
/// still removed.
fn replace_data(id: Str, data: Vec<Entry>) -> Step {
    Box::new(move |t, block_map, _| {
        let Some(block) = block_of(block_map, &id) else {
            return Ok(());
        };
        let Some(existing) = block.get("data").and_then(|v| v.as_map()) else {
            block.set(t, "data", to_data_map(&data)?)?;
            return Ok(());
        };
        let keep: HashSet<&Str> = data.iter().map(|e| &e.key).collect();
        for key in existing.keys() {
            if !keep.contains(&key) {
                existing.delete(t, key)?;
            }
        }
        for e in &data {
            let live = existing.get(&e.key[..]);
            match &e.value {
                EntryValue::Rich(segments) => match live.and_then(|v| v.as_xml_text()) {
                    Some(live) => apply_rich_text_ops(
                        t,
                        &live,
                        &plan_rich_text_edit(&live.to_delta(), segments),
                    )?,
                    None => existing.set(t, e.key.clone(), new_rich_text(segments)?)?,
                },
                EntryValue::Text(value) => match live.and_then(|v| v.as_text()) {
                    Some(live) => edit_text(t, &live, value)?,
                    None => existing.set(t, e.key.clone(), Text::new(Some(value.clone())))?,
                },
                // Top level: the ordered-id rule is a nested rule on both sides.
                EntryValue::Plain(v) => {
                    assign_entry(t, &existing, &e.key, v, BLOCK_FIELD_DEPTH + 1, false, false)?
                }
            }
        }
        Ok(())
    })
}

/// Turns live into next with the smallest edits, back to front. Insert
/// first, then delete what it replaces: the other order anchors the new
/// text to the tombstones and a peer's keystroke there jumps ahead.
fn edit_text(t: &Transaction<'_>, live: &Text, next: &Str) -> Result<(), EngineError> {
    let before = live.units();
    if before == *next {
        return Ok(());
    }
    for edit in diff(&before, next, true).iter().rev() {
        if !edit.insert.is_empty() {
            live.insert(Some(t), edit.index as i64, edit.insert.clone(), None)?;
        }
        if edit.remove > 0 {
            live.delete(
                Some(t),
                (edit.index + edit.insert.len()) as i64,
                edit.remove as i64,
            )?;
        }
    }
    Ok(())
}

/// Decodes at apply time, so two applies never share a value. None deletes.
fn patch_map(m: Map, key: Str, encoded: Option<Vec<u8>>) -> Step {
    Box::new(move |t, _, _| {
        let Some(encoded) = encoded else {
            return Ok(m.delete(t, key)?);
        };
        let v =
            read_any(&mut Reader::new(&encoded)).map_err(|err| Error::Message(err.to_string()))?;
        Ok(m.set(t, key, v)?)
    })
}

fn set_block_field(id: Str, key: &'static str, v: Value) -> Step {
    Box::new(move |t, block_map, _| {
        if let Some(block) = block_of(block_map, &id) {
            block.set(t, key, v)?;
        }
        Ok(())
    })
}

fn remove_block_field(id: Str, key: &'static str) -> Step {
    Box::new(move |t, block_map, _| {
        if let Some(block) = block_of(block_map, &id)
            && block.get(key).is_some_and(|v| v != Out::Any(Value::Null))
        {
            block.delete(t, key)?;
        }
        Ok(())
    })
}

/// Creates the tunes map when a peer's block has none, as
/// getOrCreateTunesMap does.
fn set_tunes(id: Str, tunes: Vec<(Str, SourceValue)>) -> Step {
    Box::new(move |t, block_map, _| {
        let Some(block) = block_of(block_map, &id) else {
            return Ok(());
        };
        let m = match block.get("tunes").and_then(|v| v.as_map()) {
            Some(m) => m,
            None => {
                let m = Map::new(Vec::new());
                block.set(t, "tunes", m.clone())?;
                m
            }
        };
        for (name, v) in &tunes {
            if *v == SourceValue::Null {
                m.delete(t, name.clone())?;
            } else {
                assign_entry(t, &m, name, v, BLOCK_FIELD_DEPTH + 1, true, false)?;
            }
        }
        Ok(())
    })
}

/// Deletes the key for the root, as applyPlacement does.
fn set_parent_id(id: Str, parent_id: Option<Str>) -> Step {
    Box::new(move |t, block_map, _| {
        let Some(m) = block_of(block_map, &id) else {
            return Ok(());
        };
        match parent_id {
            None => m.delete(t, "parentId")?,
            Some(parent_id) => m.set(t, "parentId", Value::String(parent_id))?,
        }
        Ok(())
    })
}

fn insert_root_order(at: usize, id: Str) -> Step {
    Box::new(move |t, _, root_order| {
        Ok(root_order.insert(t, at as i64, vec![In::Any(Value::String(id))])?)
    })
}

fn remove_root_order(at: usize) -> Step {
    Box::new(move |t, _, root_order| Ok(root_order.delete(t, at as i64, 1)?))
}

/// Reads the index at apply time: an earlier step in the same transaction
/// may have changed the array.
fn link_child(parent_id: Str, child_id: Str, after_id: Option<Str>) -> Step {
    Box::new(move |t, block_map, _| {
        let Some(content_ids) = content_ids_of(block_map, &parent_id) else {
            return Err(Error::Message(format!(
                "collab: block \"{parent_id}\" has no children list to place \"{child_id}\" in."
            )));
        };
        let at = after_id
            .as_ref()
            .and_then(|after| index_of_id(&content_ids, after))
            .map_or(0, |i| i + 1);
        Ok(content_ids.insert(t, at as i64, vec![In::Any(Value::String(child_id))])?)
    })
}

fn unlink_child(parent_id: Str, child_id: Str) -> Step {
    Box::new(move |t, block_map, _| {
        if let Some(content_ids) = content_ids_of(block_map, &parent_id)
            && let Some(at) = index_of_id(&content_ids, &child_id)
        {
            content_ids.delete(t, at as i64, 1)?;
        }
        Ok(())
    })
}

fn content_ids_of(block_map: &Map, id: &Str) -> Option<Array> {
    block_of(block_map, id)?
        .get("contentIds")
        .and_then(|v| v.as_array())
}

fn index_of_id(content_ids: &Array, id: &Str) -> Option<usize> {
    content_ids
        .values()
        .iter()
        .position(|entry| matches!(entry, Out::Any(Value::String(s)) if s == id))
}
