//! The writes that turn a live formatted text into new canonical segments
//! with the fewest changes, so characters outside the change keep their
//! CRDT identity (C# RichTextEdit.cs, client planRichTextEdit). Both sides
//! must issue the SAME ops; the rich-text-edits fixtures pin them.

use blok_jsjson::{Object, Str, Value, compare, stringify};
use blok_yjs::{Delta, EngineError, Out, Text, Transaction, XmlText};

use crate::richtext::{
    canonical_marks, from_delta, lookup, normalize, normalize_value, same_value,
};
use crate::textdiff::{TextEdit, diff};

/// One write against a live formatted text.
#[derive(Clone, Debug, PartialEq)]
pub enum RichTextOp {
    Insert {
        index: usize,
        text: Str,
        attributes: Object,
    },
    InsertEmbed {
        index: usize,
        embed: Object,
        attributes: Object,
    },
    Delete {
        index: usize,
        length: usize,
    },
    /// A null mark value removes that mark.
    Format {
        index: usize,
        length: usize,
        attributes: Object,
    },
}

/// Stands for an embed (or a foreign item) in the projection the diff runs over.
const EMBED_UNIT: u16 = 0xFFFC;

/// A Y.XmlText or a Y.Text. Attributes are always passed, even empty: an
/// absent object would make an insert inherit the marks before it.
pub trait RichTextTarget {
    fn insert_run(
        &self,
        txn: &Transaction<'_>,
        index: usize,
        chunk: &Str,
        attributes: &Object,
    ) -> Result<(), EngineError>;
    fn insert_embed_run(
        &self,
        txn: &Transaction<'_>,
        index: usize,
        embed: &Object,
        attributes: &Object,
    ) -> Result<(), EngineError>;
    fn delete_run(
        &self,
        txn: &Transaction<'_>,
        index: usize,
        length: usize,
    ) -> Result<(), EngineError>;
    fn format_run(
        &self,
        txn: &Transaction<'_>,
        index: usize,
        length: usize,
        attributes: &Object,
    ) -> Result<(), EngineError>;
}

macro_rules! rich_text_target {
    ($($name:ident),*) => {$(
        impl RichTextTarget for $name {
            fn insert_run(
                &self,
                txn: &Transaction<'_>,
                index: usize,
                chunk: &Str,
                attributes: &Object,
            ) -> Result<(), EngineError> {
                $name::insert(
                    self,
                    Some(txn),
                    index as i64,
                    chunk.clone(),
                    Some(&blok_yjs::marks(attributes)),
                )
            }

            fn insert_embed_run(
                &self,
                txn: &Transaction<'_>,
                index: usize,
                embed: &Object,
                attributes: &Object,
            ) -> Result<(), EngineError> {
                $name::insert_embed(
                    self,
                    Some(txn),
                    index as i64,
                    Value::Object(embed.clone()),
                    Some(&blok_yjs::marks(attributes)),
                )
            }

            fn delete_run(
                &self,
                txn: &Transaction<'_>,
                index: usize,
                length: usize,
            ) -> Result<(), EngineError> {
                $name::delete(self, Some(txn), index as i64, length as i64)
            }

            fn format_run(
                &self,
                txn: &Transaction<'_>,
                index: usize,
                length: usize,
                attributes: &Object,
            ) -> Result<(), EngineError> {
                $name::format(
                    self,
                    Some(txn),
                    index as i64,
                    length as i64,
                    &blok_yjs::marks(attributes),
                )
            }
        }
    )*};
}

rich_text_target!(Text, XmlText);

/// The writes turning the live delta into next (canonical), in the order to
/// apply them: content edits back to front (each region's inserts, then its
/// delete), then format calls front to back. None when nothing changed.
pub fn plan_rich_text_edit(live: &[Delta], next: &[Value]) -> Vec<RichTextOp> {
    // A respelling must write nothing, or two peers re-saving it ping-pong.
    if same_json(
        &Value::Array(from_delta(live)),
        &Value::Array(next.to_vec()),
    ) {
        return Vec::new();
    }
    // From the raw delta: an item the canonical form drops still takes an index.
    let live_marks: Vec<Option<Object>> = live
        .iter()
        .map(|op| canonical_marks(op.attributes.as_ref()))
        .collect();
    let before = live_units(live, &live_marks);
    let after = next_units(next);
    let edits = diff(&project(&before), &project(&after), false);
    let (match_before, match_after) = align(&before, &after, &edits);
    let mut ops = Vec::new();
    for region in regions(&match_before, &match_after).iter().rev() {
        let mut position = region.before;
        let mut index = region.after;
        let end = region.after + region.inserted;
        while index < end {
            let unit = &after[index];
            if let Some(embed) = unit.embed {
                ops.push(RichTextOp::InsertEmbed {
                    index: position,
                    embed: embed.clone(),
                    attributes: normalize_marks(unit.marks),
                });
                position += 1;
                index += 1;
                continue;
            }
            let mut stop = index;
            while stop < end && after[stop].embed.is_none() && after[stop].segment == unit.segment {
                stop += 1;
            }
            let text: Vec<u16> = after[index..stop]
                .iter()
                .map(|part| part.character)
                .collect();
            ops.push(RichTextOp::Insert {
                index: position,
                text: Str::from(text),
                attributes: normalize_marks(unit.marks),
            });
            position += stop - index;
            index = stop;
        }
        if region.removed > 0 {
            ops.push(RichTextOp::Delete {
                index: region.before + region.inserted,
                length: region.removed,
            });
        }
    }
    ops.extend(format_ops(&before, &after, &match_after));
    ops
}

fn normalize_marks(marks: Option<&Object>) -> Object {
    normalize(marks.map(|marks| Value::Object(marks.clone())).as_ref())
}

/// Runs the planned writes inside the caller's transaction.
pub fn apply_rich_text_ops(
    txn: &Transaction<'_>,
    text: &impl RichTextTarget,
    ops: &[RichTextOp],
) -> Result<(), EngineError> {
    for op in ops {
        match op {
            RichTextOp::Insert {
                index,
                text: chunk,
                attributes,
            } => text.insert_run(txn, *index, chunk, attributes)?,
            RichTextOp::InsertEmbed {
                index,
                embed,
                attributes,
            } => text.insert_embed_run(txn, *index, embed, attributes)?,
            RichTextOp::Delete { index, length } => text.delete_run(txn, *index, *length)?,
            RichTextOp::Format {
                index,
                length,
                attributes,
            } => text.format_run(txn, *index, *length, attributes)?,
        }
    }
    Ok(())
}

/// Equal as JSON.stringify text. A value with no JSON form is never equal.
pub fn same_json(left: &Value, right: &Value) -> bool {
    matches!((stringify(left), stringify(right)), (Ok(a), Ok(b)) if a == b)
}

/// One UTF-16 unit, or one embed. `foreign` marks a live item no segment can
/// name, which never matches anything.
struct TextUnit<'a> {
    character: u16,
    embed: Option<&'a Object>,
    foreign: bool,
    marks: Option<&'a Object>,
    segment: Option<usize>,
}

fn live_units<'a>(live: &'a [Delta], marks: &'a [Option<Object>]) -> Vec<TextUnit<'a>> {
    let mut units = Vec::new();
    for (op, marks) in live.iter().zip(marks) {
        let marks = marks.as_ref();
        match &op.insert {
            Out::Any(Value::String(text)) => units.extend(text.iter().map(|&character| TextUnit {
                character,
                embed: None,
                foreign: false,
                marks,
                segment: None,
            })),
            insert => {
                let embed = match insert {
                    Out::Any(Value::Object(embed)) => Some(embed),
                    _ => None,
                };
                units.push(TextUnit {
                    character: EMBED_UNIT,
                    embed,
                    foreign: embed.is_none(),
                    marks,
                    segment: None,
                });
            }
        }
    }
    units
}

fn next_units(next: &[Value]) -> Vec<TextUnit<'_>> {
    let mut units = Vec::new();
    for (index, item) in next.iter().enumerate() {
        let Value::Object(segment) = item else {
            continue;
        };
        let marks = match lookup(segment, "marks") {
            Some(Value::Object(marks)) => Some(marks),
            _ => None,
        };
        if let Some(Value::String(text)) = lookup(segment, "text") {
            units.extend(text.iter().map(|&character| TextUnit {
                character,
                embed: None,
                foreign: false,
                marks,
                segment: Some(index),
            }));
        } else if let Some(Value::Object(embed)) = lookup(segment, "embed") {
            units.push(TextUnit {
                character: EMBED_UNIT,
                embed: Some(embed),
                foreign: false,
                marks,
                segment: Some(index),
            });
        }
    }
    units
}

fn project(units: &[TextUnit<'_>]) -> Vec<u16> {
    units.iter().map(|unit| unit.character).collect()
}

/// Which unit each kept unit pairs with, from the diff of the projections;
/// a pair whose units are not the same content is unpaired, so it becomes a
/// replacement instead of a silent keep.
fn align(
    before: &[TextUnit<'_>],
    after: &[TextUnit<'_>],
    edits: &[TextEdit],
) -> (Vec<Option<usize>>, Vec<Option<usize>>) {
    let mut match_before = vec![None; before.len()];
    let mut match_after = vec![None; after.len()];
    let (mut b, mut a) = (0, 0);
    let mut keep = |until: usize, b: &mut usize, a: &mut usize| {
        while *b < until {
            if same_content(&before[*b], &after[*a]) {
                match_before[*b] = Some(*a);
                match_after[*a] = Some(*b);
            }
            *b += 1;
            *a += 1;
        }
    };
    for edit in edits {
        keep(edit.index, &mut b, &mut a);
        b += edit.remove;
        a += edit.insert.len();
    }
    keep(before.len(), &mut b, &mut a);
    (match_before, match_after)
}

fn same_content(live: &TextUnit<'_>, next: &TextUnit<'_>) -> bool {
    match (live.embed, next.embed) {
        (None, None) => !live.foreign,
        (Some(a), Some(b)) => {
            !live.foreign && same_value(&Value::Object(a.clone()), &Value::Object(b.clone()))
        }
        _ => false,
    }
}

struct TextRegion {
    before: usize,
    removed: usize,
    after: usize,
    inserted: usize,
}

/// Each maximal run of unpaired units on either side, front to back.
fn regions(match_before: &[Option<usize>], match_after: &[Option<usize>]) -> Vec<TextRegion> {
    let mut found = Vec::new();
    let (mut b, mut a) = (0, 0);
    while b < match_before.len() || a < match_after.len() {
        if b < match_before.len() && a < match_after.len() && match_before[b] == Some(a) {
            b += 1;
            a += 1;
            continue;
        }
        let (start_before, start_after) = (b, a);
        while b < match_before.len() && match_before[b].is_none() {
            b += 1;
        }
        while a < match_after.len() && match_after[a].is_none() {
            a += 1;
        }
        found.push(TextRegion {
            before: start_before,
            removed: b - start_before,
            after: start_after,
            inserted: a - start_after,
        });
    }
    found
}

/// Over the kept units, in final positions: only the mark keys whose
/// canonical value changed. Adjacent units with the same change share a call.
fn format_ops(
    before: &[TextUnit<'_>],
    after: &[TextUnit<'_>],
    match_after: &[Option<usize>],
) -> Vec<RichTextOp> {
    let mut ops = Vec::new();
    let mut pending: Option<(Object, String, usize, usize)> = None;
    for (index, unit) in after.iter().enumerate() {
        let changes = match_after[index].and_then(|b| mark_changes(before[b].marks, unit.marks));
        let Some(changes) = changes else {
            flush(&mut ops, pending.take());
            continue;
        };
        let key = stringify(&Value::Object(changes.clone())).unwrap_or_default();
        if let Some((_, pending_key, start, length)) = &mut pending
            && *pending_key == key
            && *start + *length == index
        {
            *length += 1;
            continue;
        }
        flush(&mut ops, pending.take());
        pending = Some((changes, key, index, 1));
    }
    flush(&mut ops, pending);
    ops
}

fn flush(ops: &mut Vec<RichTextOp>, pending: Option<(Object, String, usize, usize)>) {
    if let Some((attributes, _, index, length)) = pending {
        ops.push(RichTextOp::Format {
            index,
            length,
            attributes,
        });
    }
}

/// The mark keys whose value changed, sorted, null for a removed one.
fn mark_changes(live: Option<&Object>, next: Option<&Object>) -> Option<Object> {
    let mut keys: Vec<&Str> = Vec::new();
    for record in [live, next].into_iter().flatten() {
        for member in record.members() {
            if !keys.contains(&&member.key) {
                keys.push(&member.key);
            }
        }
    }
    keys.sort_by(|a, b| compare(a, b));
    let mut changes = Object::new();
    for key in keys {
        let live_value = live.and_then(|record| record.get(key));
        let next_value = next.and_then(|record| record.get(key));
        if live_value.is_some() == next_value.is_some()
            && same_value(
                live_value.unwrap_or(&Value::Null),
                next_value.unwrap_or(&Value::Null),
            )
        {
            continue;
        }
        changes.set(key.clone(), next_value.map_or(Value::Null, normalize_value));
    }
    (!changes.is_empty()).then_some(changes)
}
