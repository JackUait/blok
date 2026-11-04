//! The /edit write path, in place (C# YDocConverter.DeepAssign, LOCKSTEP
//! with the client's deepAssignYMap/deepAssignYArray/deepAssignYGrid): plain
//! JSON assigned onto the containers a block's data already holds, at every
//! depth. A container one side replaces wholesale is one the other side's
//! concurrent edit was inside. Only containers matter; a changed leaf is
//! simply written. Every write was screened while planning, so an error
//! here means the edit failed mid-write (Go panics).

use std::collections::{HashMap, HashSet};

use blok_jsjson::{Object, Str, Value};
use blok_yjs::{Array, In, Map, Out, Transaction};

use crate::error::Error;
use crate::export::{
    GRID_ORDER_KEY, GRID_ROWS_KEY, MAX_VALUE_DEPTH, grid_row_keys, is_grid_map, number_node,
    to_json_node,
};
use crate::keys::ORDERED_ID_ARRAY_KEYS;
use crate::richtext::{from_delta, is};
use crate::seed::{
    SourceValue, element_id, is_convertible_array, is_grid_array, is_identity_array,
    new_grid_row_key, plain_data_value, plain_to_identity_map, plain_to_y_array, plain_to_y_value,
};

const LIST_SLOT_MAP_KEY: &str = "properties";
const MAX_SAFE_INTEGER: f64 = 9007199254740992.0;

fn live_map(v: Option<&Out>) -> Option<Map> {
    v.and_then(Out::as_map)
}

fn live_array(v: Option<&Out>) -> Option<Array> {
    v.and_then(Out::as_array)
}

/// The grid's rows map and order array; is_grid_map vouched for both.
fn grid_parts(grid: &Map) -> (Map, Array) {
    let rows = grid.get(GRID_ROWS_KEY).and_then(|v| v.as_map());
    let order = grid.get(GRID_ORDER_KEY).and_then(|v| v.as_array());
    match (rows, order) {
        (Some(rows), Some(order)) => (rows, order),
        _ => unreachable!("a grid map holds its rows and order"),
    }
}

/// One key of a live map. depth is the depth of the value, counted as
/// plain_to_y_value counts it. nested is false only for a block's
/// top-level data keys, where the ordered-id rule does not apply.
pub(crate) fn assign_entry(
    t: &Transaction<'_>,
    target: &Map,
    key: &Str,
    v: &SourceValue,
    depth: usize,
    nested: bool,
    list_slot: bool,
) -> Result<(), Error> {
    let existing = target.get(&key[..]);
    let existing = existing.as_ref();
    // An emptied list slot is cleared in place, so a peer's concurrent add
    // survives. A leaf [] (an older client's write) is left alone.
    if let SourceValue::Array(empty) = v
        && list_slot
        && empty.is_empty()
    {
        match live_map(existing) {
            Some(slot) if is_grid_map(&slot) => assign_identity(t, &slot, empty, depth)?,
            _ if !same_as_live(existing, v, depth) => {
                target.set(t, key.clone(), plain_to_identity_map(empty, depth)?)?;
            }
            _ => {}
        }
        return Ok(());
    }
    // The keyed grid first: a grid wrapper is a map too.
    if let SourceValue::Array(rows) = v
        && let Some(grid) = live_map(existing)
        && is_grid_map(&grid)
    {
        if is_grid_array(rows) {
            assign_grid(t, &grid, rows, depth)?;
        } else if is_identity_array(rows) {
            assign_identity(t, &grid, rows, depth)?;
        } else if !same_as_live(existing, v, depth) {
            // Neither shape any more: rebuild, as the read path would.
            target.set(t, key.clone(), plain_to_y_value(v, depth)?)?;
        }
        return Ok(());
    }
    // An ordered id list is a Y.Array at any depth, so two peers each
    // dropping a block into one cell keep both ids.
    if let SourceValue::Array(ids) = v
        && nested
        && ORDERED_ID_ARRAY_KEYS.iter().any(|k| is(key, k))
        && !is_grid_array(ids)
        && !is_identity_array(ids)
    {
        match live_array(existing) {
            Some(live) => assign_array(t, &live, ids, depth)?,
            // A cell written before this rule holds a plain array: promote it.
            None => target.set(t, key.clone(), plain_to_y_array(ids, depth)?)?,
        }
        return Ok(());
    }
    if let SourceValue::Array(array) = v
        && let Some(live) = live_array(existing)
    {
        if is_convertible_array(array) {
            assign_array(t, &live, array, depth)?;
        } else if !same_as_live(existing, v, depth) {
            target.set(t, key.clone(), plain_to_y_value(v, depth)?)?;
        }
        return Ok(());
    }
    if let SourceValue::Object(object) = v {
        let slots = !nested && is(key, LIST_SLOT_MAP_KEY);
        if let Some(live) = live_map(existing) {
            return assign_map(t, &live, object, depth, slots);
        }
        // Unconditional: what is there is not a Y.Map, and leaving it would
        // keep the key unmergeable for good.
        let value = if slots {
            plain_data_value(key, v, depth)?
        } else {
            plain_to_y_value(v, depth)?
        };
        target.set(t, key.clone(), value)?;
        return Ok(());
    }
    if !same_as_live(existing, v, depth) {
        target.set(t, key.clone(), plain_to_y_value(v, depth)?)?;
    }
    Ok(())
}

/// Removes the keys the object lacks (only those the doc holds now, so a
/// peer's concurrent key survives), then assigns each key.
pub(crate) fn assign_map(
    t: &Transaction<'_>,
    target: &Map,
    source: &Object<SourceValue>,
    depth: usize,
    list_slots: bool,
) -> Result<(), Error> {
    for key in target.keys() {
        if source.get(&key).is_none() {
            target.delete(t, key)?;
        }
    }
    for m in source.members() {
        assign_entry(t, target, &m.key, &m.value, depth + 1, true, list_slots)?;
    }
    Ok(())
}

/// A two-ended diff: equal ends are skipped, equal-length middles are
/// assigned element by element, unequal ones are paired by content (inserts
/// and deletes only), else replaced by one splice.
fn assign_array(
    t: &Transaction<'_>,
    target: &Array,
    source: &[SourceValue],
    depth: usize,
) -> Result<(), Error> {
    let items = target.values();
    let (prefix, suffix) = common_ends(items.len(), source.len(), |i, j| {
        same_as_live(Some(&items[i]), &source[j], depth + 1)
    });
    let target_middle = items.len() - prefix - suffix;
    let source_middle = source.len() - prefix - suffix;
    if target_middle == 0 && source_middle == 0 {
        return Ok(());
    }
    if target_middle == source_middle {
        for offset in 0..source_middle {
            assign_element(
                t,
                target,
                prefix + offset,
                &source[prefix + offset],
                depth + 1,
            )?;
        }
        return Ok(());
    }
    let assignment = pair_rows(
        target_middle,
        source_middle,
        |i, j| same_as_live(Some(&items[prefix + i]), &source[prefix + j], depth + 1),
        |i, j| row_similarity(Some(&items[prefix + i]), &source[prefix + j], depth + 1),
        true,
    );
    let paired: Vec<usize> = assignment.iter().flatten().copied().collect();
    let reordered = paired.windows(2).any(|pair| pair[1] <= pair[0]);
    if !paired.is_empty() && !reordered {
        // Backwards, so an earlier delete cannot shift a later offset.
        for offset in (0..target_middle).rev() {
            if !paired.contains(&offset) {
                target.delete(t, (prefix + offset) as i64, 1)?;
            }
        }
        for (offset, paired) in assignment.iter().enumerate() {
            let at = prefix + offset;
            if paired.is_none() {
                target.insert(
                    t,
                    at as i64,
                    vec![plain_to_y_value(&source[at], depth + 1)?],
                )?;
                continue;
            }
            assign_element(t, target, at, &source[at], depth + 1)?;
        }
        return Ok(());
    }
    // Nothing pairs, or the pairing is a reorder: one splice.
    if target_middle > 0 {
        target.delete(t, prefix as i64, target_middle as i64)?;
    }
    if source_middle > 0 {
        let values = source[prefix..prefix + source_middle]
            .iter()
            .map(|v| plain_to_y_value(v, depth + 1))
            .collect::<Result<Vec<In>, _>>()?;
        target.insert(t, prefix as i64, values)?;
    }
    Ok(())
}

/// One array element in place, recursing into containers.
fn assign_element(
    t: &Transaction<'_>,
    target: &Array,
    index: usize,
    v: &SourceValue,
    depth: usize,
) -> Result<(), Error> {
    let existing = target.get(index as i64);
    let existing = existing.as_ref();
    if let SourceValue::Array(rows) = v
        && let Some(grid) = live_map(existing)
        && is_grid_map(&grid)
    {
        if is_grid_array(rows) {
            return assign_grid(t, &grid, rows, depth);
        }
        if is_identity_array(rows) {
            return assign_identity(t, &grid, rows, depth);
        }
    }
    if let SourceValue::Object(object) = v
        && let Some(live) = live_map(existing)
    {
        return assign_map(t, &live, object, depth, false);
    }
    if let SourceValue::Array(array) = v
        && let Some(live) = live_array(existing)
        && is_convertible_array(array)
    {
        return assign_array(t, &live, array, depth);
    }
    if same_as_live(existing, v, depth) {
        return Ok(());
    }
    target.delete(t, index as i64, 1)?;
    target.insert(t, index as i64, vec![plain_to_y_value(v, depth)?])?;
    Ok(())
}

/// Re-associates keyless plain rows with the keys in the doc, so a paired
/// row is diffed in place and only the order array records a move. The row
/// wrapper costs two levels.
fn assign_grid(
    t: &Transaction<'_>,
    grid: &Map,
    source: &[SourceValue],
    depth: usize,
) -> Result<(), Error> {
    let (rows, order) = grid_parts(grid);
    let current_keys = grid_row_keys(&order, &rows);
    let current_rows: Vec<Option<Out>> =
        current_keys.iter().map(|key| rows.get(&key[..])).collect();
    let row_depth = depth + 2;
    let assignment = pair_rows_by_id(&current_keys, &current_rows, source, row_depth);
    let paired: HashSet<usize> = assignment.iter().flatten().copied().collect();
    for (i, key) in current_keys.iter().enumerate() {
        if !paired.contains(&i) {
            rows.delete(t, key.clone())?;
        }
    }
    // After the removals, as on the client: a freed key may be reused.
    let mut taken: HashSet<Str> = rows.keys().into_iter().collect();
    let mut next_keys = Vec::with_capacity(source.len());
    for (i, row) in source.iter().enumerate() {
        let Some(at) = assignment[i] else {
            let minted = new_grid_row_key(row, &taken);
            taken.insert(minted.clone());
            rows.set(t, minted.clone(), plain_to_y_value(row, row_depth)?)?;
            next_keys.push(minted);
            continue;
        };
        let key = &current_keys[at];
        // Through assign_entry: the row's live value may be anything.
        assign_entry(t, &rows, key, row, row_depth, true, false)?;
        next_keys.push(key.clone());
    }
    key_sequence(t, &order, &next_keys)
}

/// Each element carries its own key, so a reorder is just a new order array
/// and every element's map survives it.
fn assign_identity(
    t: &Transaction<'_>,
    target: &Map,
    source: &[SourceValue],
    depth: usize,
) -> Result<(), Error> {
    let (rows, order) = grid_parts(target);
    let next_keys: Vec<Str> = source.iter().map(element_id).collect();
    let kept: HashSet<&Str> = next_keys.iter().collect();
    for key in rows.keys() {
        if !kept.contains(&key) {
            rows.delete(t, key)?;
        }
    }
    for (key, element) in next_keys.iter().zip(source) {
        assign_entry(t, &rows, key, element, depth + 2, true, false)?;
    }
    key_sequence(t, &order, &next_keys)
}

/// Pairs a saved row with the doc row whose key is the row id it carries,
/// then the rest by content. Mirrors pairGridRowsById.
fn pair_rows_by_id(
    current_keys: &[Str],
    current_rows: &[Option<Out>],
    source: &[SourceValue],
    row_depth: usize,
) -> Vec<Option<usize>> {
    let mut index_by_key: HashMap<&Str, usize> = HashMap::new();
    for (i, key) in current_keys.iter().enumerate() {
        index_by_key.entry(key).or_insert(i);
    }
    let mut claimed = HashSet::new();
    let mut assignment = vec![None; source.len()];
    for (i, row) in source.iter().enumerate() {
        if let Some(id) = crate::seed::grid_row_id(row)
            && let Some(&target) = index_by_key.get(&id)
            && claimed.insert(target)
        {
            assignment[i] = Some(target);
        }
    }
    let rest_sources: Vec<usize> = (0..source.len())
        .filter(|&i| assignment[i].is_none())
        .collect();
    let rest_targets: Vec<usize> = (0..current_keys.len())
        .filter(|i| !claimed.contains(i))
        .collect();
    let rest = pair_rows(
        rest_targets.len(),
        rest_sources.len(),
        |c, s| {
            same_as_live(
                current_rows[rest_targets[c]].as_ref(),
                &source[rest_sources[s]],
                row_depth,
            )
        },
        |c, s| {
            row_similarity(
                current_rows[rest_targets[c]].as_ref(),
                &source[rest_sources[s]],
                row_depth,
            )
        },
        false,
    );
    for (rank, paired) in rest.into_iter().enumerate() {
        assignment[rest_sources[rank]] = paired.map(|paired| rest_targets[paired]);
    }
    assignment
}

/// Re-associates keyless rows with the doc's rows: equal ends, then exact
/// matches, then (only when the counts differ) cell similarity within a
/// rank window, then by rank. Under enforce_order a rank pair must keep the
/// pairing monotonic. Returns, per source row, the doc row or None.
pub(crate) fn pair_rows(
    current_count: usize,
    source_count: usize,
    rows_equal: impl Fn(usize, usize) -> bool,
    similarity: impl Fn(usize, usize) -> usize,
    enforce_order: bool,
) -> Vec<Option<usize>> {
    let mut assignment: Vec<Option<usize>> = vec![None; source_count];
    let mut taken = HashSet::new();
    let pair = |assignment: &mut [Option<usize>],
                taken: &mut HashSet<usize>,
                source: usize,
                current: usize| {
        assignment[source] = Some(current);
        taken.insert(current);
    };
    let (prefix, suffix) = common_ends(current_count, source_count, &rows_equal);
    for i in 0..prefix {
        pair(&mut assignment, &mut taken, i, i);
    }
    for i in 0..suffix {
        pair(
            &mut assignment,
            &mut taken,
            source_count - 1 - i,
            current_count - 1 - i,
        );
    }
    let middle_sources: Vec<usize> = (0..source_count)
        .filter(|&i| assignment[i].is_none())
        .collect();
    let middle_targets: Vec<usize> = (0..current_count).filter(|i| !taken.contains(i)).collect();
    for &source_index in &middle_sources {
        for &index in &middle_targets {
            if !taken.contains(&index) && rows_equal(index, source_index) {
                pair(&mut assignment, &mut taken, source_index, index);
                break;
            }
        }
    }
    let rest_sources: Vec<usize> = middle_sources
        .iter()
        .copied()
        .filter(|&i| assignment[i].is_none())
        .collect();
    let rest_targets: Vec<usize> = middle_targets
        .iter()
        .copied()
        .filter(|i| !taken.contains(i))
        .collect();
    // An unmatched row can only have shifted by the unmatched count around it.
    let window = rest_sources.len().abs_diff(rest_targets.len()) + 1;
    if rest_sources.len() != rest_targets.len() {
        for (rank, &source_index) in rest_sources.iter().enumerate() {
            let free: Vec<usize> = rest_targets
                .iter()
                .enumerate()
                .filter(|&(target_rank, index)| {
                    !taken.contains(index) && target_rank.abs_diff(rank) <= window
                })
                .map(|(_, &index)| index)
                .collect();
            if let Some(found) = most_similar(&free, source_index, &similarity) {
                pair(&mut assignment, &mut taken, source_index, found);
            }
        }
    }
    // Taken once, so rank keeps its 1:1 meaning.
    let final_targets: Vec<usize> = rest_targets
        .iter()
        .copied()
        .filter(|i| !taken.contains(i))
        .collect();
    let rest: Vec<usize> = rest_sources
        .iter()
        .copied()
        .filter(|&i| assignment[i].is_none())
        .collect();
    for (&source_index, &current_index) in rest.iter().zip(&final_targets) {
        // Reads assignment live, so a pair taken here constrains the next.
        if !enforce_order || keeps_order(&assignment, source_index, current_index) {
            pair(&mut assignment, &mut taken, source_index, current_index);
        }
    }
    assignment
}

fn keeps_order(assignment: &[Option<usize>], source_index: usize, current_index: usize) -> bool {
    assignment
        .iter()
        .enumerate()
        .all(|(index, paired)| match paired {
            None => true,
            Some(paired) if index < source_index => *paired < current_index,
            Some(paired) => *paired > current_index,
        })
}

/// The candidate sharing the most cells, or None when none shares any.
fn most_similar(
    candidates: &[usize],
    source_index: usize,
    similarity: impl Fn(usize, usize) -> usize,
) -> Option<usize> {
    let mut best = None;
    let mut best_score = 0;
    for &candidate in candidates {
        let score = similarity(candidate, source_index);
        if score > best_score {
            best = Some(candidate);
            best_score = score;
        }
    }
    best
}

/// The common cell prefix plus suffix of two rows, measured from both ends
/// so a column added at the front still matches. Two objects score what
/// they both carry. The live side is read as the export reads it.
fn row_similarity(current: Option<&Out>, source: &SourceValue, depth: usize) -> usize {
    match try_plain(current, depth) {
        Some(plain) => similarity_score(&plain, source),
        None => 0,
    }
}

fn similarity_score(live: &Value, v: &SourceValue) -> usize {
    match (live, v) {
        (Value::Array(items), SourceValue::Array(cells)) => {
            let (prefix, suffix) = common_ends(items.len(), cells.len(), |i, j| {
                json_equal(&items[i], &cells[j])
            });
            prefix + suffix
        }
        (Value::Object(fields), SourceValue::Object(values)) => fields
            .members()
            .iter()
            .filter_map(|m| {
                values
                    .get(&m.key)
                    .map(|other| similarity_score(&m.value, other))
            })
            .sum(),
        _ => usize::from(json_equal(live, v)),
    }
}

/// Rewrites a grid's key order with one two-ended splice. Keys the read
/// path normalised away are absent from keys and get spliced out.
fn key_sequence(t: &Transaction<'_>, order: &Array, keys: &[Str]) -> Result<(), Error> {
    let current = order.values();
    let (prefix, suffix) = common_ends(
        current.len(),
        keys.len(),
        |i, j| matches!(&current[i], Out::Any(Value::String(key)) if *key == keys[j]),
    );
    let current_middle = current.len() - prefix - suffix;
    let next_middle = keys.len() - prefix - suffix;
    if current_middle > 0 {
        order.delete(t, prefix as i64, current_middle as i64)?;
    }
    if next_middle > 0 {
        let values = keys[prefix..prefix + next_middle]
            .iter()
            .map(|key| In::Any(Value::String(key.clone())))
            .collect();
        order.insert(t, prefix as i64, values)?;
    }
    Ok(())
}

/// The equal prefix, then the equal suffix past it, so the two never overlap.
pub(crate) fn common_ends(
    left: usize,
    right: usize,
    equal_at: impl Fn(usize, usize) -> bool,
) -> (usize, usize) {
    let max_prefix = left.min(right);
    let mut prefix = 0;
    while prefix < max_prefix && equal_at(prefix, prefix) {
        prefix += 1;
    }
    let max_suffix = max_prefix - prefix;
    let mut suffix = 0;
    while suffix < max_suffix && equal_at(left - 1 - suffix, right - 1 - suffix) {
        suffix += 1;
    }
    (prefix, suffix)
}

/// Whether the live value already is the plain value. A shape this writer
/// cannot produce answers no, which costs a redundant write and never drops
/// an edit.
pub(crate) fn same_as_live(live: Option<&Out>, v: &SourceValue, depth: usize) -> bool {
    try_plain(live, depth).is_some_and(|plain| json_equal(&plain, v))
}

/// The live value as the export would write it, or None. An absent value is
/// null, as Go's nil.
pub(crate) fn try_plain(live: Option<&Out>, depth: usize) -> Option<Value> {
    // Past the cap the export writes null, so nothing compares honestly.
    if depth > MAX_VALUE_DEPTH {
        return None;
    }
    let Some(live) = live else {
        return Some(Value::Null);
    };
    if let Some(m) = live.as_map() {
        if is_grid_map(&m) {
            let (rows, order) = grid_parts(&m);
            let values: Vec<Option<Out>> = grid_row_keys(&order, &rows)
                .iter()
                .map(|key| rows.get(&key[..]))
                .collect();
            // The keyed wrapper costs the two levels the write side spends.
            return try_plain_items(values.iter().map(Option::as_ref), depth + 2);
        }
        let mut result = Object::new();
        for key in m.keys() {
            let plain = try_plain(m.get(&key[..]).as_ref(), depth + 1)?;
            result.set(key, plain);
        }
        return Some(Value::Object(result));
    }
    if let Some(array) = live.as_array() {
        let values = array.values();
        return try_plain_items(values.iter().map(Some), depth + 1);
    }
    if let Some(rich) = live.as_xml_text() {
        return to_json_node(&Value::Array(from_delta(&rich.to_delta()))).ok();
    }
    if let Some(text) = live.as_text() {
        return Some(Value::String(text.units()));
    }
    match live {
        Out::Any(value) => try_plain_value(value, depth),
        _ => None,
    }
}

fn try_plain_value(live: &Value, depth: usize) -> Option<Value> {
    if depth > MAX_VALUE_DEPTH {
        return None;
    }
    match live {
        Value::Null => Some(Value::Null),
        Value::Object(object) => {
            let mut result = Object::new();
            for m in object.members() {
                result.set(m.key.clone(), try_plain_value(&m.value, depth + 1)?);
            }
            Some(Value::Object(result))
        }
        Value::Array(items) => items
            .iter()
            .map(|item| try_plain_value(item, depth + 1))
            .collect::<Option<Vec<_>>>()
            .map(Value::Array),
        Value::String(_) | Value::Bool(_) => Some(live.clone()),
        Value::Number(number) => Some(number_node(*number)),
        Value::Undefined | Value::BigInt(_) | Value::Bytes(_) => None,
    }
}

fn try_plain_items<'a>(
    items: impl Iterator<Item = Option<&'a Out>>,
    depth: usize,
) -> Option<Value> {
    items
        .map(|item| try_plain(item, depth))
        .collect::<Option<Vec<_>>>()
        .map(Value::Array)
}

/// JsonNode.DeepEquals between a live plain value and a request value:
/// objects ignore key order, and numbers compare as .NET does (see
/// number_equal).
pub(crate) fn json_equal(plain: &Value, v: &SourceValue) -> bool {
    match (plain, v) {
        (Value::Null, SourceValue::Null) => true,
        (Value::Bool(p), SourceValue::Bool(other)) => p == other,
        (Value::String(p), SourceValue::String(other)) => p == other,
        (Value::Number(p), _) => number_equal(*p, v),
        (Value::Array(p), SourceValue::Array(other)) => {
            p.len() == other.len() && p.iter().zip(other).all(|(a, b)| json_equal(a, b))
        }
        (Value::Object(p), SourceValue::Object(other)) => {
            p.len() == other.len()
                && p.members().iter().all(|m| {
                    other
                        .get(&m.key)
                        .is_some_and(|value| json_equal(&m.value, value))
                })
        }
        _ => false,
    }
}

/// The live number is a long when it is an integer within 2^53
/// (NumberNode), and .NET compares a long to the request's number text by
/// exact decimal value (100 = 1.00e2, 5 != 5.0000000000000000001); any
/// other live number is compared to GetDouble of the text. Probed on .NET 10.
pub(crate) fn number_equal(live: f64, v: &SourceValue) -> bool {
    match v {
        SourceValue::Source(source) => {
            if live == live.trunc() && live.abs() <= MAX_SAFE_INTEGER {
                decimal_is_integer(&source.raw, live as i64)
            } else {
                source.value == live
            }
        }
        SourceValue::Number(number) => *number == live,
        _ => false,
    }
}

/// Whether a JSON number's text is exactly n.
pub(crate) fn decimal_is_integer(raw: &[u8], n: i64) -> bool {
    let negative = raw.first() == Some(&b'-');
    let raw = if negative { &raw[1..] } else { raw };
    let mut digits: Vec<u8> = Vec::new();
    let mut exponent: i64 = 0;
    let mut i = 0;
    while i < raw.len() && raw[i].is_ascii_digit() {
        digits.push(raw[i]);
        i += 1;
    }
    if i < raw.len() && raw[i] == b'.' {
        i += 1;
        while i < raw.len() && raw[i].is_ascii_digit() {
            digits.push(raw[i]);
            exponent -= 1;
            i += 1;
        }
    }
    if i < raw.len() && (raw[i] == b'e' || raw[i] == b'E') {
        let tail = &raw[i + 1..];
        let e = std::str::from_utf8(tail)
            .ok()
            .and_then(|text| text.parse::<i64>().ok())
            // Too large: no integer within 2^53 has such a scale, unless
            // the digits are all zero.
            .unwrap_or(if tail.first() == Some(&b'-') {
                i64::from(i32::MIN)
            } else {
                i64::from(i32::MAX)
            });
        // Go's int addition wraps.
        exponent = exponent.wrapping_add(e);
    }
    let leading = digits.iter().take_while(|&&d| d == b'0').count();
    let mut digits = &digits[leading..];
    if digits.is_empty() {
        return n == 0;
    }
    while let Some((b'0', rest)) = digits.split_last() {
        digits = rest;
        exponent = exponent.wrapping_add(1);
    }
    if n == 0 || negative != (n < 0) {
        return false;
    }
    let want = n.unsigned_abs().to_string();
    let trimmed = want.trim_end_matches('0');
    let zeros = (want.len() - trimmed.len()) as i64;
    digits == trimmed.as_bytes() && exponent == zeros
}
