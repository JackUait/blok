use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::time::SystemTime;

use blok_collab_convert::{
    RichTextHtmlSlot, SlotStep, longest_kept_order, same_value, step_replay,
};
use blok_collab_operation::Record;
use blok_jsjson::{Object, Str, Value, stringify};
use blok_yjs::{Doc, Map, Out};

use crate::error::{Error, is_cancellation, is_transient};
use crate::seams::HistoryConverter;

/// CollabBlockChangeKind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BlockChangeKind {
    Added,
    Removed,
    Changed,
    Moved,
}

/// One block a record touched. `before` is None when added, `after` when
/// removed. `kind_type` is the block's type (Go `Type`).
#[derive(Clone, Debug, PartialEq)]
pub struct BlockChange {
    pub id: Str,
    pub kind_type: Option<Str>,
    pub kind: BlockChangeKind,
    pub before: Option<Object>,
    pub after: Option<Object>,
}

/// One journal record's visible edits. `page` lists changed page keys, then
/// values keys as "values.<key>".
#[derive(Clone, Debug, PartialEq)]
pub struct RecordChanges {
    pub sequence: u64,
    pub committed_at: SystemTime,
    pub actor_id: Option<String>,
    pub blocks: Vec<BlockChange>,
    pub page: Vec<String>,
}

/// A change whose blocks are indexes into the two exports it compares.
struct IndexedChange {
    id: Str,
    kind_type: Option<Str>,
    kind: BlockChangeKind,
    before: Option<usize>,
    after: Option<usize>,
}

struct StepExport {
    /// The visit count, so a block is (step, index) across the replay.
    step: usize,
    blocks: Vec<Value>,
    page: HashMap<Str, String>,
    /// Each top-level block's HTML slots, by block index.
    slots_by_block: HashMap<usize, Vec<RichTextHtmlSlot>>,
    /// Blocks a kept change names; they move to the pool when the step
    /// retires.
    kept: BTreeSet<usize>,
}

fn export_step(
    converter: &dyn HistoryConverter,
    doc: &Doc,
    warned: &mut HashSet<String>,
    step: usize,
) -> Result<StepExport, Error> {
    let (blocks, slots) = match converter.export_blocks(doc, warned) {
        Ok(exported) => exported,
        Err(err) if is_transient(&err) || is_cancellation(&err) => return Err(err),
        Err(err) => return Err(Error::ChangesExport(Box::new(err))),
    };
    let mut slots_by_block: HashMap<usize, Vec<RichTextHtmlSlot>> = HashMap::new();
    for slot in slots {
        if let Some(SlotStep::Index(index)) = slot.path.first()
            && matches!(blocks.get(*index), Some(Value::Object(_)))
        {
            slots_by_block.entry(*index).or_default().push(slot);
        }
    }
    // Outside the export's wrap, as C# reads PageFields outside its catch.
    let page = page_fields(doc)?;
    Ok(StepExport {
        step,
        blocks,
        page,
        slots_by_block,
        kept: BTreeSet::new(),
    })
}

impl StepExport {
    fn keep(&mut self, index: usize, kept: &mut Vec<(usize, RichTextHtmlSlot)>) {
        self.kept.insert(index);
        if let Some(slots) = self.slots_by_block.get(&index) {
            kept.extend(slots.iter().map(|slot| (self.step, slot.clone())));
        }
    }
}

struct Row {
    sequence: u64,
    committed_at: SystemTime,
    actor_id: Option<String>,
    blocks: Vec<(IndexedChange, usize, usize)>,
    page: Vec<String>,
    slots: Vec<(usize, RichTextHtmlSlot)>,
    size: i64,
    before_step: usize,
}

/// The replay's state: Go shares each kept block between the change that
/// shows it and its slot; here kept blocks move into `pool`, keyed by
/// (step, index), once their step stops being diffed.
#[derive(Default)]
struct Replay {
    rows: VecDeque<Row>,
    total: i64,
    pool: BTreeMap<(usize, usize), Value>,
    freed_through: Option<usize>,
    previous: Option<StepExport>,
    steps: usize,
    warned: HashSet<String>,
}

impl Replay {
    fn retire(&mut self, mut step: StepExport) {
        if self.freed_through.is_some_and(|freed| step.step <= freed) {
            return;
        }
        for index in std::mem::take(&mut step.kept) {
            let block = std::mem::take(&mut step.blocks[index]);
            self.pool.insert((step.step, index), block);
        }
    }

    fn visit(
        &mut self,
        record: Option<&Record>,
        doc: &Doc,
        first_before: u64,
        converter: &dyn HistoryConverter,
        max_bytes: i64,
    ) -> Result<(), Error> {
        let sequence = record.map_or(0, |record| record.sequence);
        if sequence < first_before {
            return Ok(());
        }
        let mut current = export_step(converter, doc, &mut self.warned, self.steps)?;
        self.steps += 1;
        if let (Some(record), Some(previous)) = (record, self.previous.as_mut())
            && record.sequence > first_before
        {
            let changes = diff_indexed(&previous.blocks, &current.blocks);
            let mut slots = Vec::new();
            let mut size = 0;
            for change in &changes {
                if let Some(index) = change.before {
                    previous.keep(index, &mut slots);
                    size += json_bytes(&previous.blocks[index]);
                }
                if let Some(index) = change.after {
                    current.keep(index, &mut slots);
                    size += json_bytes(&current.blocks[index]);
                }
            }
            let (before_step, after_step) = (previous.step, current.step);
            self.rows.push_back(Row {
                sequence: record.sequence,
                committed_at: record.committed_at,
                actor_id: record.actor_id.clone(),
                blocks: changes
                    .into_iter()
                    .map(|change| (change, before_step, after_step))
                    .collect(),
                page: diff_page(&previous.page, &current.page),
                slots,
                size,
                before_step,
            });
            self.total += size;
            while self.total > max_bytes && self.rows.len() > 1 {
                let Some(dropped) = self.rows.pop_front() else {
                    break;
                };
                self.total -= dropped.size;
                // Every kept row reads steps after this one.
                self.pool.retain(|&(step, _), _| step > dropped.before_step);
                self.freed_through = Some(dropped.before_step);
            }
        }
        if let Some(previous) = self.previous.take() {
            self.retire(previous);
        }
        self.previous = Some(current);
        Ok(())
    }
}

/// A slot target's place, hashable: Go dedupes by target object and key.
#[derive(PartialEq, Eq, Hash)]
enum Place {
    Index(usize),
    Key(Str),
}

/// CollabVersionChanges.ReplayAsync: one replay from the baseline, each
/// record after `first_before` diffed against the step before it. Past
/// `max_bytes` of block JSON the oldest records are dropped, before any HTML
/// is read; the newest always stays. A block's size is its JSON with any
/// format-1 HTML still raw. `records` is the journal's blocking reader.
pub async fn replay_changes(
    baseline: &[Vec<u8>],
    records: impl IntoIterator<Item = Result<Record, Error>>,
    first_before: u64,
    converter: &dyn HistoryConverter,
    max_bytes: i64,
) -> Result<Vec<RecordChanges>, Error> {
    let mut replay = Replay::default();
    step_replay(
        || Ok(()),
        baseline,
        records,
        |record, doc| replay.visit(record, doc, first_before, converter, max_bytes),
    )?;
    if let Some(previous) = replay.previous.take() {
        replay.retire(previous);
    }

    let mut positions = HashMap::new();
    let mut blocks = Vec::with_capacity(replay.pool.len());
    for (at, block) in std::mem::take(&mut replay.pool) {
        positions.insert(at, blocks.len());
        blocks.push(block);
    }
    // Only the slots of records still kept: a dropped record's HTML is never read.
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    for row in &replay.rows {
        for (step, slot) in &row.slots {
            let Some((SlotStep::Index(index), rest)) = slot.path.split_first() else {
                continue;
            };
            let Some(&position) = positions.get(&(*step, *index)) else {
                continue;
            };
            let place: Vec<Place> = std::iter::once(Place::Index(position))
                .chain(rest.iter().map(|step| match step {
                    SlotStep::Index(index) => Place::Index(*index),
                    SlotStep::Key(key) => Place::Key(key.clone()),
                }))
                .collect();
            if !seen.insert((place, slot.key.clone())) {
                continue;
            }
            let mut moved = slot.clone();
            moved.path[0] = SlotStep::Index(position);
            kept.push(moved);
        }
    }
    match converter.resolve(&mut blocks, &kept).await {
        Ok(()) => {}
        Err(err) if is_transient(&err) || is_cancellation(&err) => return Err(err),
        Err(err) => return Err(Error::ChangesExport(Box::new(err))),
    }

    let block_at = |step: usize, index: Option<usize>| -> Option<Object> {
        let position = positions.get(&(step, index?))?;
        match &blocks[*position] {
            Value::Object(block) => Some(block.clone()),
            _ => None,
        }
    };
    Ok(replay
        .rows
        .into_iter()
        .map(|row| RecordChanges {
            sequence: row.sequence,
            committed_at: row.committed_at,
            actor_id: row.actor_id,
            blocks: row
                .blocks
                .into_iter()
                .map(|(change, before_step, after_step)| BlockChange {
                    before: block_at(before_step, change.before),
                    after: block_at(after_step, change.after),
                    id: change.id,
                    kind_type: change.kind_type,
                    kind: change.kind,
                })
                .collect(),
            page: row.page,
        })
        .collect())
}

fn json_bytes(block: &Value) -> i64 {
    blok_collab_docendpoint::serialize(block).map_or(0, |encoded| encoded.len() as i64)
}

/// CollabVersionChanges.Blocks: added, changed and moved in after order,
/// then removed in before order. Moved follows the client's
/// src/shared/output-diff.ts.
pub fn diff_blocks(before: &[Value], after: &[Value]) -> Vec<BlockChange> {
    let block = |blocks: &[Value], index: Option<usize>| match blocks.get(index?) {
        Some(Value::Object(block)) => Some(block.clone()),
        _ => None,
    };
    diff_indexed(before, after)
        .into_iter()
        .map(|change| BlockChange {
            before: block(before, change.before),
            after: block(after, change.after),
            id: change.id,
            kind_type: change.kind_type,
            kind: change.kind,
        })
        .collect()
}

fn diff_indexed(before: &[Value], after: &[Value]) -> Vec<IndexedChange> {
    let (before_by_id, before_order) = index_by_id(before);
    let (after_by_id, after_order) = index_by_id(after);
    let reordered = reordered_ids(&before_order, &after_order, &before_by_id);
    let mut changes = Vec::new();
    for (id, block) in &after_order {
        let kind = match before_by_id.get(*id) {
            None => BlockChangeKind::Added,
            Some((_, old)) if is_block_changed(old, block.1) => BlockChangeKind::Changed,
            Some((_, old)) if parent_of(old) != parent_of(block.1) || reordered.contains(*id) => {
                BlockChangeKind::Moved
            }
            Some(_) => continue,
        };
        changes.push(IndexedChange {
            id: (*id).clone(),
            kind_type: type_of(block.1).cloned(),
            kind,
            before: before_by_id.get(*id).map(|(index, _)| *index),
            after: Some(block.0),
        });
    }
    for (id, (index, block)) in &before_order {
        if !after_by_id.contains_key(*id) {
            changes.push(IndexedChange {
                id: (*id).clone(),
                kind_type: type_of(block).cloned(),
                kind: BlockChangeKind::Removed,
                before: Some(*index),
                after: None,
            });
        }
    }
    changes
}

type Indexed<'a> = (usize, &'a Object);

/// Matched blocks that keep their parent but leave the longest kept order
/// of its children. Siblings group by parent id with the root as "", as C#
/// and the client's output-diff.ts group them: root blocks and children of
/// a block whose id is "" share one order.
fn reordered_ids<'a>(
    before_order: &[(&'a Str, Indexed<'a>)],
    after_order: &[(&'a Str, Indexed<'a>)],
    before_by_id: &HashMap<&'a Str, Indexed<'a>>,
) -> HashSet<&'a Str> {
    let group = |block: &Object| parent_of(block).cloned().unwrap_or_default();
    let mut position_before: HashMap<&Str, i64> = HashMap::new();
    let mut sibling_counts: HashMap<Str, i64> = HashMap::new();
    for (id, (_, block)) in before_order {
        let count = sibling_counts.entry(group(block)).or_default();
        position_before.insert(id, *count);
        *count += 1;
    }
    let mut parents = Vec::new();
    let mut after_siblings: HashMap<Str, Vec<&'a Str>> = HashMap::new();
    for (id, (_, block)) in after_order {
        let Some((_, old)) = before_by_id.get(*id) else {
            continue;
        };
        if parent_of(old) != parent_of(block) {
            continue;
        }
        let parent = group(block);
        if !after_siblings.contains_key(&parent) {
            parents.push(parent.clone());
        }
        after_siblings.entry(parent).or_default().push(id);
    }
    let mut reordered = HashSet::new();
    for parent in &parents {
        let ids = &after_siblings[parent];
        let positions: Vec<i64> = ids.iter().map(|id| position_before[*id]).collect();
        let kept: HashSet<usize> = longest_kept_order(&positions).into_iter().collect();
        for (index, id) in ids.iter().enumerate() {
            if !kept.contains(&index) {
                reordered.insert(*id);
            }
        }
    }
    reordered
}

/// Keeps the first block per id, in array order.
fn index_by_id(blocks: &[Value]) -> (HashMap<&Str, Indexed<'_>>, Vec<(&Str, Indexed<'_>)>) {
    let mut by_id = HashMap::new();
    let mut order = Vec::new();
    for (index, item) in blocks.iter().enumerate() {
        let Value::Object(block) = item else {
            continue;
        };
        let Some(id) = string_of(block, "id") else {
            continue;
        };
        if by_id.contains_key(id) {
            continue;
        }
        by_id.insert(id, (index, block));
        order.push((id, (index, block)));
    }
    (by_id, order)
}

/// A format-1 rich field is still raw HTML here, so two HTMLs that say the
/// same thing read as changed.
fn is_block_changed(before: &Object, after: &Object) -> bool {
    type_of(before) != type_of(after)
        || !same_value(data_of(before), data_of(after))
        || !same_value(&tunes_of(before), &tunes_of(after))
}

static NULL: Value = Value::Null;

/// A missing member reads as null, as Go's map miss gives nil.
pub(crate) fn data_of(block: &Object) -> &Value {
    block.get(&Str::from("data")).unwrap_or(&NULL)
}

/// Missing or null tunes read as {}.
pub(crate) fn tunes_of(block: &Object) -> Value {
    match block.get(&Str::from("tunes")) {
        Some(Value::Null) | None => Value::Object(Object::new()),
        Some(tunes) => tunes.clone(),
    }
}

pub(crate) fn type_of(block: &Object) -> Option<&Str> {
    string_of(block, "type")
}

pub(crate) fn parent_of(block: &Object) -> Option<&Str> {
    string_of(block, "parent")
}

pub(crate) fn string_of<'a>(block: &'a Object, key: &str) -> Option<&'a Str> {
    match block.get(&Str::from(key)) {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}

const VALUES_PREFIX: &str = "values.";

/// A comparable form of every page and values key: plain JSON by content,
/// anything else by the item that holds it.
pub fn page_fields(doc: &Doc) -> Result<HashMap<Str, String>, Error> {
    let mut fields = HashMap::new();
    read_page_fields(&doc.get_map("page")?, "", &mut fields);
    read_page_fields(&doc.get_map("values")?, VALUES_PREFIX, &mut fields);
    Ok(fields)
}

fn read_page_fields(map: &Map, prefix: &str, fields: &mut HashMap<Str, String>) {
    for key in map.keys() {
        let value = map.get(key.clone());
        let mut name = Str::from(prefix);
        name.extend_from_slice(&key);
        if let Some(fingerprint) = fingerprint_of(value.as_ref()) {
            fields.insert(name, fingerprint);
            continue;
        }
        let (client, clock) = map.head_id(key).map_or((0, 0), |id| (id.client, id.clock));
        fields.insert(name, format!("#{client}:{clock}"));
    }
}

fn fingerprint_of(value: Option<&Out>) -> Option<String> {
    let value = match value {
        None => &NULL,
        Some(Out::Any(Value::Undefined) | Out::Type(_) | Out::Subdoc(_)) => return None,
        Some(Out::Any(value)) => value,
    };
    // "=" keeps a JSON text apart from the "#" item ids.
    stringify(value).ok().map(|text| format!("={text}"))
}

/// Lists the keys whose fingerprint differs: page keys first, then values
/// keys, each in ordinal order.
pub fn diff_page(before: &HashMap<Str, String>, after: &HashMap<Str, String>) -> Vec<String> {
    let prefix = Str::from(VALUES_PREFIX);
    let is_values = |key: &Str| key.starts_with(&prefix);
    let mut keys: Vec<&Str> = before
        .keys()
        .chain(after.keys().filter(|key| !before.contains_key(*key)))
        .filter(|key| before.get(*key) != after.get(*key))
        .collect();
    keys.sort_by(|a, b| is_values(a).cmp(&is_values(b)).then_with(|| a.cmp(b)));
    keys.into_iter().map(Str::to_string).collect()
}
