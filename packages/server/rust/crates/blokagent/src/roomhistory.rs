//! The undo steps of agents in live rooms, as C# RoomAgentHistory. A room
//! call carries no session, so the steps belong to one actor acting for one
//! person in one room, in this process's memory, and go after
//! ROOM_IDLE_LIMIT without a call. Each step keeps how its blocks and page
//! keys looked before and after it, so undo writes back only those, and
//! only while nobody else changed them.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use blok_collab_convert::{EditOp, PAGE_MAPS, PageMap, is_plain_map_value, plain_json};
use blok_jsjson::{Object, Str, Value};
use blok_yjs::Out;

use crate::errors::Error;
use crate::session::{MAX_CHARS, MAX_STEPS};
use crate::types::Actor;

/// RoomAgentHistory.IdleLimit. The step caps are the session's.
pub(crate) const ROOM_IDLE_LIMIT: Duration = Duration::from_secs(3600);

/// What a step looked like on each side; replays change it.
pub(crate) struct Sides {
    pub before: Option<Object>,
    pub after: Option<Object>,
    pub chars: usize,
}

/// One batch. `other` is a page action, which wrote another document.
/// Steps are kept and compared by pointer: `replayed` checks the top step
/// is the very one a call planned against.
pub(crate) struct RoomStep {
    pub other: bool,
    /// The journal lineage the step was written in; None in a room without
    /// a journal. Set before the step is added, never after.
    pub lineage: Option<String>,
    pub ids: BTreeSet<Str>,
    pub page_keys: BTreeSet<Str>,
    pub page_before: HashMap<Str, Out>,
    pub page_after: HashMap<Str, Out>,
    sides: Mutex<Sides>,
}

impl RoomStep {
    pub(crate) fn new(before: Option<Object>, after: Option<Object>) -> Result<RoomStep, Error> {
        let step = RoomStep {
            other: false,
            lineage: None,
            ids: BTreeSet::new(),
            page_keys: BTreeSet::new(),
            page_before: HashMap::new(),
            page_after: HashMap::new(),
            sides: Mutex::new(Sides {
                before,
                after,
                chars: 0,
            }),
        };
        step.measure()?;
        Ok(step)
    }

    pub(crate) fn sides(&self) -> MutexGuard<'_, Sides> {
        self.sides.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn chars(&self) -> usize {
        self.sides().chars
    }

    /// Sets chars to Before.ToJsonString().Length +
    /// After.ToJsonString().Length: the .NET form is ASCII, so its bytes are
    /// its UTF-16 units. Run it whenever before or after changes.
    pub(crate) fn measure(&self) -> Result<(), Error> {
        let mut sides = self.sides();
        let before = serialized_object(sides.before.as_ref())?;
        let after = serialized_object(sides.after.as_ref())?;
        sides.chars = before.len() + after.len();
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct RoomSteps {
    pub done: Vec<Arc<RoomStep>>,
    pub undone: Vec<Arc<RoomStep>>,
    last_used: Option<Instant>,
}

/// onBehalfOf is part of it, so one agent id acting for two people keeps
/// two histories.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) struct RoomKey {
    doc_id: String,
    actor_id: String,
    on_behalf_of: Option<String>,
}

pub(crate) fn key_of(doc_id: &str, actor: &Actor) -> RoomKey {
    RoomKey {
        doc_id: doc_id.to_owned(),
        actor_id: actor.id.clone(),
        on_behalf_of: actor.on_behalf_of.clone(),
    }
}

pub(crate) type Clock = Box<dyn Fn() -> Instant + Send + Sync>;
pub(crate) type Added = Box<dyn Fn(&RoomStep) + Send + Sync>;

pub(crate) struct HistoryState {
    pub now: Clock,
    pub rooms: HashMap<RoomKey, RoomSteps>,
    /// Runs inside add with the step.
    pub added: Option<Added>,
}

pub(crate) struct RoomHistory(Mutex<HistoryState>);

impl RoomHistory {
    pub(crate) fn new(now: Clock) -> RoomHistory {
        RoomHistory(Mutex::new(HistoryState {
            now,
            rooms: HashMap::new(),
            added: None,
        }))
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, HistoryState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The step an undo (or redo) would replay now.
    pub(crate) fn top(&self, doc_id: &str, actor: &Actor, undo: bool) -> Option<Arc<RoomStep>> {
        let mut state = self.lock();
        state.prune();
        let now = (state.now)();
        let steps = state.rooms.get_mut(&key_of(doc_id, actor))?;
        steps.last_used = Some(now);
        let from = if undo { &steps.done } else { &steps.undone };
        from.last().cloned()
    }

    /// Moves a replayed step to the other side with what the room now
    /// holds. False, and nothing changes, when the steps were forgotten or
    /// the step is no longer on top. It does not prune.
    pub(crate) fn replayed(
        &self,
        doc_id: &str,
        actor: &Actor,
        step: &Arc<RoomStep>,
        undo: bool,
        actual: Option<Object>,
    ) -> Result<bool, Error> {
        let mut state = self.lock();
        let Some(steps) = state.rooms.get_mut(&key_of(doc_id, actor)) else {
            return Ok(false);
        };
        let (from, to) = if undo {
            (&mut steps.done, &mut steps.undone)
        } else {
            (&mut steps.undone, &mut steps.done)
        };
        if !from.last().is_some_and(|top| Arc::ptr_eq(top, step)) {
            return Ok(false);
        }
        {
            let mut sides = step.sides();
            if undo {
                sides.before = actual;
            } else {
                sides.after = actual;
            }
        }
        step.measure()?;
        let moved = from.pop().expect("the top step");
        to.push(moved);
        Ok(true)
    }

    /// Drops every actor's steps in the room. It does not prune.
    pub(crate) fn forget(&self, doc_id: &str) {
        self.lock().rooms.retain(|key, _| key.doc_id != doc_id);
    }

    /// A new batch: it drops the redo side and the oldest done steps past
    /// the caps. Only done steps are trimmed, so after a page action (which
    /// keeps the redo side) the step just added can be the one dropped.
    pub(crate) fn add(&self, doc_id: &str, actor: &Actor, step: Arc<RoomStep>) {
        let mut state = self.lock();
        if let Some(added) = &state.added {
            added(&step);
        }
        state.prune();
        let now = (state.now)();
        let steps = state.rooms.entry(key_of(doc_id, actor)).or_default();
        steps.last_used = Some(now);
        let other = step.other;
        steps.done.push(step);
        // A page action leaves the redo side, as the stored session's marks do.
        if !other {
            steps.undone.clear();
        }
        while !steps.done.is_empty()
            && (steps.done.len() + steps.undone.len() > MAX_STEPS
                || (steps.done.len() > 1
                    && sum_chars(&steps.done) + sum_chars(&steps.undone) > MAX_CHARS))
        {
            steps.done.remove(0);
        }
    }
}

impl HistoryState {
    fn prune(&mut self) {
        let now = (self.now)();
        self.rooms.retain(|_, steps| {
            steps
                .last_used
                .is_none_or(|used| now.saturating_duration_since(used) <= ROOM_IDLE_LIMIT)
        });
    }
}

fn sum_chars(steps: &[Arc<RoomStep>]) -> usize {
    steps.iter().map(|step| step.chars()).sum()
}

fn entries<'a>(maps: &'a [PageMap], name: &str) -> &'a [(Str, Out)] {
    maps.iter()
        .find(|page| page.name == name)
        .map_or(&[], |page| &page.entries)
}

fn map_value<'a>(maps: &'a [PageMap], name: &str, key: &Str) -> Option<&'a Out> {
    entries(maps, name)
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v)
}

/// A step from what the batch changed between two exports.
pub(crate) fn between(
    before: &Object,
    before_maps: &[PageMap],
    after: &Object,
    after_maps: &[PageMap],
) -> Result<RoomStep, Error> {
    let was = shapes(before)?;
    let now = shapes(after)?;
    let mut ids = BTreeSet::new();
    for (id, shape) in &was {
        if now.get(id) != Some(shape) {
            ids.insert(id.clone());
        }
    }
    for id in now.keys() {
        if !was.contains_key(id) {
            ids.insert(id.clone());
        }
    }
    let mut keys = BTreeSet::new();
    for name in PAGE_MAPS {
        let mut seen = BTreeSet::new();
        for list in [entries(before_maps, name), entries(after_maps, name)] {
            for (key, _) in list {
                if !seen.insert(key.clone()) {
                    continue;
                }
                let left = fingerprint(before_maps, name, key)?;
                let right = fingerprint(after_maps, name, key)?;
                if left != right {
                    keys.insert(page_key(name, key));
                }
            }
        }
    }
    let before_projection = project(before, before_maps, &ids, &keys)?;
    let after_projection = project(after, after_maps, &ids, &keys)?;
    let mut step = RoomStep::new(Some(before_projection), Some(after_projection))?;
    step.page_before = page_values(before_maps, &keys);
    step.page_after = page_values(after_maps, &keys);
    step.ids = ids;
    step.page_keys = keys;
    Ok(step)
}

fn page_key(name: &str, key: &Str) -> Str {
    let mut units = Str::from(name).into_units();
    units.push(u16::from(b'/'));
    units.extend_from_slice(key.units());
    Str(units)
}

fn s(text: &str) -> Str {
    Str::from(text)
}

/// The step's blocks (whole, with their slot) and page keys as an export
/// has them. order lists the present blocks in document order, so a restore
/// puts each one back after a sibling already in place.
pub(crate) fn project(
    export: &Object,
    maps: &[PageMap],
    ids: &BTreeSet<Str>,
    keys: &BTreeSet<Str>,
) -> Result<Object, Error> {
    let exported = export_blocks(Some(export));
    let slots = slots_of(&exported)?;
    let mut order = Vec::new();
    for block in &exported {
        if let Some(id) = id_of_block(block).filter(|id| ids.contains(*id)) {
            order.push(Value::String(id.clone()));
        }
    }
    let mut blocks = Object::new();
    for id in ids {
        let Some(found) = exported.iter().find(|block| id_of_block(block) == Some(id)) else {
            blocks.set(id.clone(), Value::Null);
            continue;
        };
        let mut entry = Object::new();
        entry.set(s("block"), Value::Object(unstamped(found)));
        let slot = match slots.get(id).cloned().flatten() {
            Some(previous) => Value::String(previous),
            None => Value::Null,
        };
        entry.set(s("after"), slot);
        blocks.set(id.clone(), Value::Object(entry));
    }
    let mut page = Object::new();
    for entry in keys {
        let (name, key) = split_page_key(entry);
        let print = fingerprint(maps, &name, &key)?;
        page.set(entry.clone(), Value::String(Str::from(print.as_str())));
    }
    // Kept beside the projection, not in it: a replay restamps, and the
    // next check must still match.
    let mut stamps = Object::new();
    for block in &exported {
        let Some(id) = id_of_block(block).filter(|id| ids.contains(*id)) else {
            continue;
        };
        let Some(at) = block
            .get(&s("lastEditedAt"))
            .filter(|at| **at != Value::Null)
        else {
            continue;
        };
        let mut stamp = Object::new();
        stamp.set(s("at"), at.clone());
        let by = block
            .get(&s("lastEditedBy"))
            .cloned()
            .unwrap_or(Value::Null);
        stamp.set(s("by"), by);
        let with = block
            .get(&s("lastEditedWith"))
            .cloned()
            .unwrap_or(Value::Null);
        stamp.set(s("with"), with);
        stamps.set(id.clone(), Value::Object(stamp));
    }
    let mut projection = Object::new();
    projection.set(s("blocks"), Value::Object(blocks));
    projection.set(s("order"), Value::Array(order));
    projection.set(s("page"), Value::Object(page));
    projection.set(s("stamps"), Value::Object(stamps));
    Ok(projection)
}

/// Whether two projections hold the same blocks, slots and page keys,
/// compared as written JSON; edit stamps do not count.
pub(crate) fn same(left: &Object, right: Option<&Object>) -> Result<bool, Error> {
    for key in ["blocks", "order", "page"] {
        let key = s(key);
        let a = left.get(&key).unwrap_or(&Value::Null);
        let b = right.and_then(|r| r.get(&key)).unwrap_or(&Value::Null);
        if serialized(a)? != serialized(b)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// C#'s `?.GetValue<string>()`: None for a missing or null node, an error
/// for any other kind.
pub(crate) fn net_string(value: Option<&Value>) -> Result<Option<Str>, Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(other) => Err(wrong_value_type(other, "System.String")),
    }
}

/// What .NET's GetValue<T> throws on the export model's nodes, which hold
/// CLR values: an integer reads as Int64, any other number as Double.
fn wrong_value_type(value: &Value, target: &str) -> Error {
    let held = match value {
        Value::Object(_) | Value::Array(_) => {
            return Error::InvalidOperation("The node must be of type 'JsonValue'.".to_owned());
        }
        Value::String(_) => "System.String",
        Value::Bool(_) => "System.Boolean",
        Value::Number(n) if *n == n.trunc() && n.abs() < 9_223_372_036_854_775_808.0 => {
            "System.Int64"
        }
        Value::Number(_) => "System.Double",
        // Go prints its own type names here (fmt %T).
        Value::BigInt(_) => "int64",
        Value::Bytes(_) => "[]uint8",
        Value::Undefined => "jsjson.Undefined",
        Value::Null => "<nil>",
    };
    Error::InvalidOperation(format!(
        "A value of type '{held}' cannot be converted to a '{target}'."
    ))
}

/// C#'s `node?[key]` on the JS value model: the indexer throws on a node
/// that is not an object.
fn net_index<'a>(node: Option<&'a Value>, key: &str) -> Result<Option<&'a Value>, Error> {
    match node {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(object)) => Ok(object.get(&s(key))),
        Some(_) => Err(Error::InvalidOperation(
            "The node must be of type 'JsonObject'.".to_owned(),
        )),
    }
}

fn locked(entry: Option<&Value>) -> Result<bool, Error> {
    let Some(Value::Object(object)) = net_index(entry, "block")? else {
        return Ok(false);
    };
    let kind = net_string(object.get(&s("type")))?;
    if kind.as_ref().map(Str::to_string).as_deref() != Some("database") {
        return Ok(false);
    }
    let data = object.get(&s("data"));
    let Some(Value::Array(schema)) = net_index(data, "schema")? else {
        return Ok(false);
    };
    for property in schema {
        let kind = net_string(net_index(Some(property), "type")?)?;
        if kind.as_ref().map(Str::to_string).as_deref() != Some("title") {
            continue;
        }
        match net_index(Some(property), "databaseLocked")? {
            None | Some(Value::Null) => continue,
            Some(Value::Bool(true)) => return Ok(true),
            Some(Value::Bool(false)) => {}
            Some(flag) => return Err(wrong_value_type(flag, "System.Boolean")),
        }
    }
    Ok(false)
}

fn blocks_object(projection: Option<&Object>) -> Option<&Object> {
    match projection?.get(&s("blocks")) {
        Some(Value::Object(blocks)) => Some(blocks),
        _ => None,
    }
}

/// The databases the replay would unlock: locked in now, still there and
/// unlocked in wanted. Mirrors unlockedBetween in
/// src/shared/agent/approval.ts.
pub(crate) fn unlocks(now: &Object, wanted: Option<&Object>) -> Result<Vec<Str>, Error> {
    let mut found = Vec::new();
    let (Some(current), Some(target)) = (blocks_object(Some(now)), blocks_object(wanted)) else {
        return Ok(found);
    };
    for m in current.members() {
        if !locked(Some(&m.value))? {
            continue;
        }
        let there = target.get(&m.key);
        if !matches!(net_index(there, "block")?, Some(Value::Object(_))) {
            continue;
        }
        if !locked(there)? {
            found.push(m.key.clone());
        }
    }
    Ok(found)
}

fn try_text(value: Option<&Value>) -> Option<&Str> {
    match value {
        Some(Value::String(text)) => Some(text),
        _ => None,
    }
}

fn share_of(view: Option<&Object>) -> Result<String, Error> {
    let mut form = None;
    let mut form_is_null_or_object = true;
    if let Some(value) = view.and_then(|v| v.get(&s("form"))) {
        match value {
            Value::Null => {}
            Value::Object(object) => form = Some(object),
            _ => form_is_null_or_object = false,
        }
    }
    let mut values = vec![Value::Bool(form_is_null_or_object)];
    for key in ["closed", "public", "anonymous", "submissionAccess"] {
        let value = form
            .and_then(|f| f.get(&s(key)))
            .cloned()
            .unwrap_or(Value::Null);
        values.push(value);
    }
    let sync = view
        .and_then(|v| v.get(&s("calendarSync")))
        .cloned()
        .unwrap_or(Value::Null);
    values.push(sync);
    Ok(String::from_utf8_lossy(&serialized(&Value::Array(values))?).into_owned())
}

fn views(entry: Option<&Value>) -> Result<Vec<&Object>, Error> {
    let Some(Value::Object(object)) = net_index(entry, "block")? else {
        return Ok(Vec::new());
    };
    if try_text(object.get(&s("type")))
        .map(Str::to_string)
        .as_deref()
        != Some("database")
    {
        return Ok(Vec::new());
    }
    let data = object.get(&s("data"));
    let Some(Value::Array(list)) = net_index(data, "views")? else {
        return Ok(Vec::new());
    };
    Ok(list
        .iter()
        .filter_map(|item| match item {
            Value::Object(view) => Some(view),
            _ => None,
        })
        .collect())
}

/// A database view whose sharing the replay would change: who can fill out
/// its form, anonymous answers, access to submissions or calendar sync. Raw
/// values are compared, so a value Blok cannot read still counts, and a
/// view with no id counts against the defaults. Mirrors sharedBetween in
/// src/shared/agent/approval.ts, failing closed where that refuses an
/// unreadable value.
pub(crate) fn shares(now: &Object, wanted: Option<&Object>) -> Result<Option<(Str, Str)>, Error> {
    let (Some(current), Some(target)) = (blocks_object(Some(now)), blocks_object(wanted)) else {
        return Ok(None);
    };
    for m in target.members() {
        let mut before: HashMap<Str, &Object> = HashMap::new();
        for view in views(current.get(&m.key))? {
            if let Some(id) = try_text(view.get(&s("id"))) {
                before.entry(id.clone()).or_insert(view);
            }
        }
        for view in views(Some(&m.value))? {
            let id = try_text(view.get(&s("id"))).cloned().unwrap_or_default();
            let other = if id.units().is_empty() {
                None
            } else {
                before.get(&id).copied()
            };
            if share_of(Some(view))? != share_of(other)? {
                return Ok(Some((m.key.clone(), id)));
            }
        }
    }
    Ok(None)
}

/// The room as it would be with the step's blocks and page keys as wanted
/// has them.
pub(crate) fn restore_target(
    export: &Object,
    maps: &[PageMap],
    step: &RoomStep,
    wanted: Option<&Object>,
    page: &HashMap<Str, Out>,
) -> Result<(Vec<Value>, Vec<PageMap>), Error> {
    let mut target: Vec<Object> = export_blocks(Some(export))
        .into_iter()
        .filter(|block| !id_of_block(block).is_some_and(|id| step.ids.contains(id)))
        .cloned()
        .collect();
    let entries = blocks_object(wanted);
    let order = match wanted.and_then(|w| w.get(&s("order"))) {
        Some(Value::Array(order)) => order.as_slice(),
        _ => &[],
    };
    for item in order {
        let Some(id) = net_string(Some(item))? else {
            continue;
        };
        let Some(entries) = entries else {
            continue;
        };
        let Some(Value::Object(entry)) = entries.get(&id) else {
            continue;
        };
        let Some(Value::Object(block)) = entry.get(&s("block")) else {
            continue;
        };
        let block = block.clone();
        let parent = net_string(block.get(&s("parent")))?;
        let after = net_string(entry.get(&s("after")))?;
        let mut at: isize = -1;
        if let Some(after) = &after {
            at = index_of(&target, |other| id_of_block(other) == Some(after));
        }
        if at < 0 {
            let mut first = -1;
            for (i, other) in target.iter().enumerate() {
                if net_string(other.get(&s("parent")))? == parent {
                    first = i as isize;
                    break;
                }
            }
            at = if first < 0 {
                target.len() as isize - 1
            } else {
                first - 1
            };
        }
        target.insert((at + 1) as usize, block);
    }

    let mut restored: Vec<PageMap> = maps.to_vec();
    for entry in &step.page_keys {
        let (name, key) = split_page_key(entry);
        let at = match restored.iter().position(|m| m.name == name) {
            Some(at) => at,
            None => {
                let Some(name) = PAGE_MAPS.iter().find(|n| **n == name) else {
                    continue;
                };
                restored.push(PageMap {
                    name,
                    entries: Vec::new(),
                });
                restored.len() - 1
            }
        };
        let list = &mut restored[at].entries;
        let index = list.iter().position(|(k, _)| *k == key);
        match (page.get(entry), index) {
            (Some(value), Some(index)) => list[index].1 = value.clone(),
            (Some(value), None) => list.push((key, value.clone())),
            (None, Some(index)) => {
                list.remove(index);
            }
            (None, None) => {}
        }
    }
    Ok((target.into_iter().map(Value::Object).collect(), restored))
}

fn index_of(list: &[Object], matches: impl Fn(&Object) -> bool) -> isize {
    list.iter().position(matches).map_or(-1, |at| at as isize)
}

/// The edit stamps the wanted blocks had, as ops after the restore: the
/// planner writes data and structure only.
pub(crate) fn stamps(wanted: Option<&Object>) -> Result<Vec<EditOp>, Error> {
    let Some(Value::Object(list)) = wanted.and_then(|w| w.get(&s("stamps"))) else {
        return Ok(Vec::new());
    };
    let mut ops = Vec::new();
    for m in list.members() {
        let Value::Object(stamp) = &m.value else {
            continue;
        };
        // C# parses the written number text, so an integer export counts.
        let at = match stamp.get(&s("at")) {
            Some(Value::Number(at)) => *at,
            Some(Value::BigInt(at)) => *at as f64,
            _ => continue,
        };
        let Some(Value::String(by)) = stamp.get(&s("by")) else {
            continue;
        };
        let with = net_string(stamp.get(&s("with")))?;
        ops.push(EditOp::SetMetadata {
            id: m.key.clone(),
            last_edited_at: at,
            last_edited_by: by.clone(),
            last_edited_with: with,
        });
    }
    Ok(ops)
}

/// The block without its edit stamp: a replay writes the data back but
/// stamps the block anew, and the next undo must still find it as the step
/// before left it.
fn unstamped(block: &Object) -> Object {
    let mut copy = Object::new();
    for m in block.members() {
        let key = m.key.to_string();
        if matches!(
            key.as_str(),
            "lastEditedAt" | "lastEditedBy" | "lastEditedWith"
        ) {
            continue;
        }
        copy.set(m.key.clone(), m.value.clone());
    }
    copy
}

pub(crate) fn export_blocks(export: Option<&Object>) -> Vec<&Object> {
    match export.and_then(|e| e.get(&s("blocks"))) {
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(|item| match item {
                Value::Object(block) => Some(block),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn id_of_block(block: &Object) -> Option<&Str> {
    try_text(block.get(&s("id")))
}

/// Each block's previous sibling, by parent link and doc order.
fn slots_of(blocks: &[&Object]) -> Result<HashMap<Str, Option<Str>>, Error> {
    let mut last: HashMap<Str, Option<Str>> = HashMap::new();
    let mut slots = HashMap::new();
    for block in blocks {
        let Some(id) = id_of_block(block) else {
            continue;
        };
        let parent = net_string(block.get(&s("parent")))?.unwrap_or_default();
        slots.insert(id.clone(), last.get(&parent).cloned().flatten());
        last.insert(parent, Some(id.clone()));
    }
    Ok(slots)
}

fn shapes(export: &Object) -> Result<HashMap<Str, String>, Error> {
    let blocks = export_blocks(Some(export));
    let slots = slots_of(&blocks)?;
    let mut out = HashMap::new();
    for block in &blocks {
        let Some(id) = id_of_block(block) else {
            continue;
        };
        if out.contains_key(id) {
            continue;
        }
        let slot = slots
            .get(id)
            .cloned()
            .flatten()
            .map(|slot| slot.to_string())
            .unwrap_or_default();
        let written = serialized(&Value::Object(unstamped(block)))?;
        out.insert(
            id.clone(),
            format!("{slot}\n{}", String::from_utf8_lossy(&written)),
        );
    }
    Ok(out)
}

fn split_page_key(entry: &Str) -> (String, Str) {
    let units = entry.units();
    match units.iter().position(|unit| *unit == u16::from(b'/')) {
        Some(at) => (
            Str(units[..at].to_vec()).to_string(),
            Str(units[at + 1..].to_vec()),
        ),
        None => (entry.to_string(), Str::new()),
    }
}

fn page_values(maps: &[PageMap], keys: &BTreeSet<Str>) -> HashMap<Str, Out> {
    let mut values = HashMap::new();
    for entry in keys {
        let (name, key) = split_page_key(entry);
        if let Some(value) = map_value(maps, &name, &key) {
            values.insert(entry.clone(), value.clone());
        }
    }
    values
}

/// A comparable spelling of a page map value; a shared type only says it
/// is one. A value holding one JSON cannot (a peer's bigint) reads as
/// absent, as the version read leaves it out.
fn fingerprint(maps: &[PageMap], name: &str, key: &Str) -> Result<String, Error> {
    let Some(value) = map_value(maps, name, key) else {
        return Ok("absent".to_owned());
    };
    if !is_plain_map_value(value) {
        return Ok(format!("shared:{}", shared_kind(value)));
    }
    let Out::Any(plain) = value else {
        unreachable!("a plain map value is an Any");
    };
    let Ok(plain) = plain_json(plain) else {
        return Ok("absent".to_owned());
    };
    Ok(String::from_utf8_lossy(&serialized(&plain)?).into_owned())
}

fn shared_kind(value: &Out) -> String {
    match value {
        Out::Type(shared) => format!("{:?}", shared.kind()),
        Out::Subdoc(_) => "subdoc".to_owned(),
        Out::Any(Value::BigInt(_)) => "int64".to_owned(),
        Out::Any(Value::Bytes(_)) => "[]uint8".to_owned(),
        Out::Any(_) => "undefined".to_owned(),
    }
}

/// Writes a JS value as System.Text.Json writes the C# node.
pub(crate) fn serialized(value: &Value) -> Result<Vec<u8>, Error> {
    Ok(blok_collab_docendpoint::serialize(value)?)
}

fn serialized_object(object: Option<&Object>) -> Result<Vec<u8>, Error> {
    match object {
        None => Ok(b"null".to_vec()),
        Some(object) => serialized(&Value::Object(object.clone())),
    }
}
