use std::collections::HashMap;

use blok_jsjson::Str;

use crate::graphemes::{is_high, is_low, text_element_starts};
use crate::textdiff_tables::{CONJUNCT_BREAKERS, CONJUNCT_CONSONANTS, CONJUNCT_LINKERS};

/// Turns the stored text into the saved text: at `index` (UTF-16 units into
/// the stored text) drop `remove` units and put `insert` there.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TextEdit {
    pub index: usize,
    pub remove: usize,
    pub insert: Str,
}

/// How far each bounded search looks (MAX_DIFF_DISTANCE in the client's
/// text-diff.ts; the two must stay equal).
pub const MAX_DIFF_DISTANCE: usize = 64;

const ANCHOR_ATOMS: usize = 3;
const MAX_ENTITY_LENGTH: usize = 32;
const FNV_OFFSET_BASIS: u32 = 0x811c9dc5;
const FNV_PRIME: u32 = 0x01000193;

/// The client's diffText (src/components/modules/yjs/text-diff.ts) as C#
/// TextDiff.Diff ports it: Myers over atoms, then anchored gaps past the cap,
/// then words, then one region. Edits come back ascending; apply them back
/// to front, each insert first.
pub fn diff(before: &[u16], after: &[u16], markup: bool) -> Vec<TextEdit> {
    let before_atoms = atoms(before, markup);
    let after_atoms = atoms(after, markup);
    if let Some(ops) = myers_ops(&before_atoms, &after_atoms) {
        return ops;
    }
    let before_units = unit_offsets(&before_atoms);
    let after_units = unit_offsets(&after_atoms);
    let mut found = anchors(before, after, &before_units, &after_units);
    if found.is_empty() {
        return coarse_ops(before, after);
    }
    // Anchors are split points: each gap's ops turn that gap into its pair on
    // their own, so the result is exactly after whatever the anchors were.
    let mut ops = Vec::new();
    let (mut before_from, mut after_from) = (0, 0);
    found.push(Anchor {
        before: before_atoms.len(),
        after: after_atoms.len(),
    });
    for pair in found {
        let before_text = &before[before_units[before_from]..before_units[pair.before]];
        let after_text = &after[after_units[after_from]..after_units[pair.after]];
        if before_text != after_text {
            let gap_ops = myers_ops(
                &before_atoms[before_from..pair.before],
                &after_atoms[after_from..pair.after],
            )
            .unwrap_or_else(|| coarse_ops(before_text, after_text));
            let shift = before_units[before_from];
            ops.extend(gap_ops.into_iter().map(|mut op| {
                op.index += shift;
                op
            }));
        }
        (before_from, after_from) = (pair.before, pair.after);
    }
    ops
}

/// Myers over the words of the single changed region, or that region.
fn coarse_ops(before: &[u16], after: &[u16]) -> Vec<TextEdit> {
    let (index, remove, insert) = single_region(before, after);
    if remove == 0 && insert.is_empty() {
        return Vec::new();
    }
    match myers_ops(
        &tokenize(&before[index..index + remove]),
        &tokenize(&insert),
    ) {
        Some(mut word_ops) => {
            for op in &mut word_ops {
                op.index += index;
            }
            word_ops
        }
        None => vec![TextEdit {
            index,
            remove,
            insert: Str::from(insert),
        }],
    }
}

/// Splits text into the units an edit boundary may fall between: a complete
/// tag, a complete entity, otherwise one user-visible character.
pub fn atomize(text: &[u16], markup: bool) -> Vec<Str> {
    atoms(text, markup).into_iter().map(Str::from).collect()
}

fn atoms(text: &[u16], markup: bool) -> Vec<&[u16]> {
    let interiors = cluster_interiors(text);
    if !interiors.any
        && (!markup
            || !text
                .iter()
                .any(|&u| u == u16::from(b'<') || u == u16::from(b'&')))
    {
        return code_points(text);
    }
    let mut atoms = Vec::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        let structured = if markup {
            structured_end(text, index)
        } else {
            index
        };
        if structured > index {
            atoms.push(&text[index..structured]);
            index = structured;
            continue;
        }
        let mut end = index + 1;
        if is_high(text[index]) && index + 1 < text.len() && is_low(text[index + 1]) {
            end += 1;
        }
        // A character never swallows a tag or entity that starts inside it
        // (the Prepend characters cluster with what follows).
        while interiors.inside[end] && (!markup || structured_end(text, end) == end) {
            end += 1;
        }
        atoms.push(&text[index..end]);
        index = end;
    }
    atoms
}

/// `inside[i]` is whether offset i falls inside a user-visible character.
struct Interiors {
    inside: Vec<bool>,
    any: bool,
}

/// Every offset inside a user-visible character: StringInfo's elements, with
/// GB9c conjuncts joined on top.
fn cluster_interiors(text: &[u16]) -> Interiors {
    let starts = text_element_starts(text);
    let mut interiors = Interiors {
        inside: vec![false; text.len() + 1],
        any: false,
    };
    let mut conjunct = ConjunctState::default();
    for (index, &start) in starts.iter().enumerate() {
        let end = starts.get(index + 1).copied().unwrap_or(text.len());
        // The joined character keeps its start, so a second conjunct chains on.
        if index > 0
            && in_ranges(CONJUNCT_CONSONANTS, code_point_at(text, start))
            && conjunct.joins()
        {
            interiors.inside[start] = true;
            interiors.any = true;
        } else {
            conjunct = ConjunctState {
                cluster_start: start,
                ..ConjunctState::default()
            };
        }
        conjunct.take(text, start, end);
        for at in start + 1..end {
            interiors.inside[at] = true;
            interiors.any = true;
        }
    }
    interiors
}

/// GB9c: Consonant (Extend | Linker)* Linker (Extend | Linker)* × Consonant.
/// Read backwards from a boundary, the first code point that is not a linker
/// and is the character's first or a breaker decides: it must be a consonant
/// with a linker after it. Anything else counts as an extender. The state
/// keeps that stop as the character grows; walking back at every boundary
/// was quadratic. C# ConjunctState is the same.
#[derive(Default)]
struct ConjunctState {
    cluster_start: usize,
    stop_is_consonant: bool,
    linked_after_stop: bool,
}

impl ConjunctState {
    fn joins(&self) -> bool {
        self.stop_is_consonant && self.linked_after_stop
    }

    /// Adds the element [start, end), cut into code points from the end as
    /// the backward read cuts them.
    fn take(&mut self, text: &[u16], start: usize, end: usize) {
        let mut points = Vec::new();
        let mut at = end;
        while at > start {
            if at - 1 > self.cluster_start && is_low(text[at - 1]) && is_high(text[at - 2]) {
                at -= 2;
            } else {
                at -= 1;
            }
            points.push(at);
        }
        for &point in points.iter().rev() {
            let code = code_point_at(text, point);
            if in_ranges(CONJUNCT_LINKERS, code) {
                self.linked_after_stop = true;
            } else if point == self.cluster_start || in_ranges(CONJUNCT_BREAKERS, code) {
                self.stop_is_consonant = in_ranges(CONJUNCT_CONSONANTS, code);
                self.linked_after_stop = false;
            }
        }
    }
}

fn in_ranges(ranges: &[u32], code: u32) -> bool {
    for pair in ranges.chunks(2) {
        if code <= pair[1] {
            return code >= pair[0];
        }
    }
    false
}

fn code_point_at(text: &[u16], index: usize) -> u32 {
    if is_high(text[index]) && index + 1 < text.len() && is_low(text[index + 1]) {
        return 0x10000 + ((u32::from(text[index]) - 0xD800) << 10) + u32::from(text[index + 1])
            - 0xDC00;
    }
    u32::from(text[index])
}

fn structured_end(text: &[u16], start: usize) -> usize {
    match text[start] {
        0x3C => tag_end(text, start),
        0x26 => entity_end(text, start),
        _ => start,
    }
}

/// Scans through quoted attribute values: serializing does not escape > inside one.
fn tag_end(text: &[u16], start: usize) -> usize {
    let mut index = start + 1;
    if char_at(text, index) == u16::from(b'/') {
        index += 1;
    }
    let name = char_at(text, index);
    if !(u16::from(b'A')..=u16::from(b'Z')).contains(&name)
        && !(u16::from(b'a')..=u16::from(b'z')).contains(&name)
    {
        return start;
    }
    let mut quote = 0;
    while index < text.len() {
        let code = text[index];
        let was_quoted = quote != 0;
        quote = next_quote(code, quote);
        if !was_quoted && quote == 0 && code == u16::from(b'>') {
            return index + 1;
        }
        if !was_quoted && quote == 0 && code == u16::from(b'<') {
            return start;
        }
        index += 1;
    }
    start
}

fn next_quote(code: u16, quote: u16) -> u16 {
    if quote != 0 {
        return if code == quote { 0 } else { quote };
    }
    if code == u16::from(b'"') || code == u16::from(b'\'') {
        return code;
    }
    0
}

fn entity_end(text: &[u16], start: usize) -> usize {
    let mut index = start + 1;
    if char_at(text, index) == u16::from(b'#') {
        index += 1;
    }
    let limit = text.len().min(start + MAX_ENTITY_LENGTH);
    while index < limit {
        let code = text[index];
        if code == u16::from(b';') {
            return if index > start + 1 { index + 1 } else { start };
        }
        let alphanumeric = u8::try_from(code).is_ok_and(|byte| byte.is_ascii_alphanumeric());
        if !alphanumeric {
            return start;
        }
        index += 1;
    }
    start
}

/// JS charCodeAt with 0 past the end.
fn char_at(text: &[u16], index: usize) -> u16 {
    text.get(index).copied().unwrap_or(0)
}

/// Keeps a lone surrogate as its own entry, like JS's string iterator.
fn code_points(text: &[u16]) -> Vec<&[u16]> {
    let mut points = Vec::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        let size = if is_high(text[index]) && index + 1 < text.len() && is_low(text[index + 1]) {
            2
        } else {
            1
        };
        points.push(&text[index..index + size]);
        index += size;
    }
    points
}

/// Myers' V array: Go reads a missing diagonal as 0, so every slot starts at 0.
#[derive(Clone)]
struct Diagonals {
    offset: isize,
    x: Vec<isize>,
}

impl Diagonals {
    fn new(limit: usize) -> Diagonals {
        Diagonals {
            offset: limit as isize + 1,
            x: vec![0; 2 * limit + 3],
        }
    }

    fn get(&self, k: isize) -> isize {
        self.x[(k + self.offset) as usize]
    }

    fn set(&mut self, k: isize, x: isize) {
        self.x[(k + self.offset) as usize] = x;
    }
}

fn myers_ops(before: &[&[u16]], after: &[&[u16]]) -> Option<Vec<TextEdit>> {
    let limit = (before.len() + after.len()).min(MAX_DIFF_DISTANCE);
    let mut v = Diagonals::new(limit);
    let mut trace = Vec::new();
    for depth in 0..=limit as isize {
        trace.push(v.clone());
        if reaches_end(before, after, &mut v, depth) {
            return Some(to_unit_ops(
                backtrack_myers(&trace, before, after, depth),
                before,
            ));
        }
    }
    None
}

/// JavaScript's \s, which differs from .NET's at U+0085 and U+FEFF.
fn is_js_whitespace(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

/// Whitespace runs and non-whitespace runs.
fn tokenize(text: &[u16]) -> Vec<&[u16]> {
    let mut tokens = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let space = is_js_whitespace(text[start]);
        let mut end = start + 1;
        while end < text.len() && is_js_whitespace(text[end]) == space {
            end += 1;
        }
        tokens.push(&text[start..end]);
        start = end;
    }
    tokens
}

fn reaches_end(before: &[&[u16]], after: &[&[u16]], v: &mut Diagonals, depth: isize) -> bool {
    let mut k = -depth;
    while k <= depth {
        let down = k == -depth || (k != depth && v.get(k - 1) < v.get(k + 1));
        let start = if down { v.get(k + 1) } else { v.get(k - 1) + 1 };
        let x = slide_diagonal(before, after, start, start - k);
        v.set(k, x);
        if x >= before.len() as isize && x - k >= after.len() as isize {
            return true;
        }
        k += 2;
    }
    false
}

fn slide_diagonal(before: &[&[u16]], after: &[&[u16]], from_x: isize, from_y: isize) -> isize {
    let reach = (before.len() as isize - from_x).min(after.len() as isize - from_y);
    let mut matched = 0;
    while matched < reach
        && before[(from_x + matched) as usize] == after[(from_y + matched) as usize]
    {
        matched += 1;
    }
    from_x + matched
}

/// Walks the trace into edits, then fuses neighbours so a typed word is one
/// insert and a delete with an insert at its end is one replacement.
fn backtrack_myers(
    trace: &[Diagonals],
    before: &[&[u16]],
    after: &[&[u16]],
    depth: isize,
) -> Vec<TextEdit> {
    let mut ops = Vec::with_capacity(depth as usize);
    let (mut x, mut y) = (before.len() as isize, after.len() as isize);
    for step in (1..=depth).rev() {
        let previous = &trace[step as usize];
        let k = x - y;
        let down = k == -step || (k != step && previous.get(k - 1) < previous.get(k + 1));
        let previous_k = if down { k + 1 } else { k - 1 };
        let previous_x = previous.get(previous_k);
        let previous_y = previous_x - previous_k;
        if down {
            ops.push(TextEdit {
                index: previous_x as usize,
                remove: 0,
                insert: Str::from(after[previous_y as usize]),
            });
        } else {
            ops.push(TextEdit {
                index: previous_x as usize,
                remove: 1,
                insert: Str::new(),
            });
        }
        (x, y) = (previous_x, previous_y);
    }
    ops.reverse();
    let mut fused: Vec<TextEdit> = Vec::with_capacity(ops.len());
    for op in ops {
        let Some(last) = fused.last_mut() else {
            fused.push(op);
            continue;
        };
        let abuts = last.index + last.remove == op.index;
        if abuts && last.insert.is_empty() && op.remove == 0 {
            last.insert = op.insert;
        } else if abuts && last.remove == 0 && op.insert.is_empty() {
            last.remove = op.remove;
        } else if abuts && last.insert.is_empty() == op.insert.is_empty() {
            last.remove += op.remove;
            last.insert.extend_from_slice(&op.insert);
        } else {
            fused.push(op);
        }
    }
    fused
}

fn to_unit_ops(ops: Vec<TextEdit>, before_atoms: &[&[u16]]) -> Vec<TextEdit> {
    let unit_at = unit_offsets(before_atoms);
    ops.into_iter()
        .map(|op| TextEdit {
            index: unit_at[op.index],
            remove: unit_at[op.index + op.remove] - unit_at[op.index],
            insert: op.insert,
        })
        .collect()
}

fn unit_offsets(atoms: &[&[u16]]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(atoms.len() + 1);
    offsets.push(0);
    for atom in atoms {
        offsets.push(offsets[offsets.len() - 1] + atom.len());
    }
    offsets
}

/// Maps the FNV-1a hash of each run of ANCHOR_ATOMS atoms to where it starts,
/// or None when it repeats.
fn single_occurrences(text: &[u16], unit_at: &[usize]) -> HashMap<u32, Option<usize>> {
    let mut found = HashMap::new();
    for index in 0..unit_at.len().saturating_sub(ANCHOR_ATOMS) {
        let mut hash = FNV_OFFSET_BASIS;
        for &unit in &text[unit_at[index]..unit_at[index + ANCHOR_ATOMS]] {
            hash = (hash ^ u32::from(unit)).wrapping_mul(FNV_PRIME);
        }
        found
            .entry(hash)
            .and_modify(|seen| *seen = None)
            .or_insert(Some(index));
    }
    found
}

#[derive(Clone, Copy)]
struct Anchor {
    before: usize,
    after: usize,
}

/// Patience diff's anchor step over atoms: runs unique on both sides,
/// longest increasing run only.
fn anchors(
    before: &[u16],
    after: &[u16],
    before_units: &[usize],
    after_units: &[usize],
) -> Vec<Anchor> {
    let unique_in_before = single_occurrences(before, before_units);
    let unique_in_after = single_occurrences(after, after_units);
    let mut pairs = Vec::new();
    for (hash, index) in &unique_in_before {
        let (Some(index), Some(Some(in_after))) = (*index, unique_in_after.get(hash)) else {
            continue;
        };
        // The hash can collide; the runs decide.
        if before[before_units[index]..before_units[index + ANCHOR_ATOMS]]
            == after[after_units[*in_after]..after_units[in_after + ANCHOR_ATOMS]]
        {
            pairs.push(Anchor {
                before: index,
                after: *in_after,
            });
        }
    }
    pairs.sort_by_key(|pair| pair.before);
    let mut piles: Vec<usize> = Vec::new();
    let mut tails: Vec<usize> = Vec::new();
    let mut previous: Vec<Option<usize>> = vec![None; pairs.len()];
    for (pair_index, pair) in pairs.iter().enumerate() {
        let low = piles.partition_point(|&pile| pile < pair.after);
        if low == piles.len() {
            piles.push(pair.after);
            tails.push(pair_index);
        } else {
            piles[low] = pair.after;
            tails[low] = pair_index;
        }
        if low > 0 {
            previous[pair_index] = Some(tails[low - 1]);
        }
    }
    let mut chosen = Vec::new();
    let mut at = tails.last().copied();
    while let Some(index) = at {
        chosen.push(pairs[index]);
        at = previous[index];
    }
    chosen.reverse();
    chosen
}

/// lib0's simpleDiffString: the span between the common prefix and suffix,
/// both rolled back off a surrogate pair.
fn single_region(before: &[u16], after: &[u16]) -> (usize, usize, Vec<u16>) {
    let shortest = before.len().min(after.len());
    let mut prefix = 0;
    while prefix < shortest && before[prefix] == after[prefix] {
        prefix += 1;
    }
    if prefix > 0 && is_high(before[prefix - 1]) {
        prefix -= 1;
    }
    let mut suffix = 0;
    while suffix < shortest - prefix
        && before[before.len() - 1 - suffix] == after[after.len() - 1 - suffix]
    {
        suffix += 1;
    }
    if suffix > 0 && is_low(before[before.len() - suffix]) {
        suffix -= 1;
    }
    (
        prefix,
        before.len() - prefix - suffix,
        after[prefix..after.len() - suffix].to_vec(),
    )
}
