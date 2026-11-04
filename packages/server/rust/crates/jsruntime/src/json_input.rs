//! Rewrites a call's input so QuickJS's JSON.parse reads it as goja (Go) and
//! C# (JsonInputNormalizer.cs) do:
//!
//! - a repeated key keeps its first position and takes the last value;
//! - a lone UTF-16 surrogate escape becomes U+FFFD; a high escape right
//!   before a low escape is a pair and stays as written.
//!
//! Text that needs neither comes back borrowed. Text that is not strict JSON,
//! or nests deeper than 64 levels (Jint's JSON.parse limit), comes back
//! unchanged, so the engine still reports its own SyntaxError. Numbers and
//! literals are copied verbatim. Both passes use explicit stacks: a deep
//! document must not overflow the native stack.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use crate::runtime::Stop;

// Past this many keys, an object's keys go into a set instead of a scan.
const LINEAR_KEY_LIMIT: usize = 16;
// Jint's default JSON.parse depth; deeper text is left for the engine.
const MAX_DEPTH: usize = 64;
const CHECK_EVERY: u64 = 4096;
// C#'s rough upper bound per value, not a measurement.
const BYTES_PER_VALUE: i64 = 128;

/// `check` runs every few thousand steps and stops the rewrite with its
/// error. A rewrite estimated past `budget` is refused as over budget.
pub(crate) fn normalize<'a>(
    text: &'a str,
    budget: i64,
    check: &mut dyn FnMut() -> Result<(), Stop>,
) -> Result<Cow<'a, str>, Stop> {
    let bytes = text.as_bytes();
    let Some(values) = needs_rewrite(bytes, check)? else {
        return Ok(Cow::Borrowed(text));
    };
    // C# counts UTF-16 units: the output and its builder, plus the tree.
    let units = text.encode_utf16().count() as i64;
    let estimate = units
        .saturating_mul(3 * 2)
        .saturating_add((values as i64).saturating_mul(BYTES_PER_VALUE));
    if estimate > budget {
        return Err(Stop::Budget);
    }
    Ok(Cow::Owned(rewrite(bytes, check)?))
}

#[derive(Clone, Copy)]
struct KeyRef {
    start: usize,
    end: usize,
    plain: bool,
}

#[derive(Default)]
struct ObjectFrame {
    keys: Vec<KeyRef>,
    set: Option<HashSet<Vec<u16>>>,
}

/// Some(values) when strict JSON that repeats a key or holds a lone
/// surrogate; None otherwise, invalid JSON included.
fn needs_rewrite(
    text: &[u8],
    check: &mut dyn FnMut() -> Result<(), Stop>,
) -> Result<Option<u64>, Stop> {
    let mut frames: Vec<Option<ObjectFrame>> = Vec::new();
    let mut needed = false;
    let mut values: u64 = 0;
    let mut i = skip_space(text, 0);
    loop {
        if values.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        values += 1;
        let Some(&c) = text.get(i) else {
            return Ok(None);
        };
        if c == b'{' || c == b'[' {
            let is_object = c == b'{';
            if frames.len() == MAX_DEPTH {
                return Ok(None);
            }
            frames.push(is_object.then(ObjectFrame::default));
            i = skip_space(text, i + 1);
            if text.get(i) == Some(if is_object { &b'}' } else { &b']' }) {
                frames.pop();
                i += 1;
            } else if is_object {
                let frame = frames
                    .last_mut()
                    .and_then(Option::as_mut)
                    .expect("object frame");
                match read_key(text, i, frame, &mut needed) {
                    Some(next) => i = next,
                    None => return Ok(None),
                }
                continue;
            } else {
                continue;
            }
        } else if c == b'"' {
            match scan_string(text, i) {
                Some(scanned) => {
                    needed |= scanned.lone;
                    i = scanned.end;
                }
                None => return Ok(None),
            }
        } else {
            match scan_literal_or_number(text, i) {
                Some(next) => i = next,
                None => return Ok(None),
            }
        }
        // A value ended at i: close containers or move to the next member.
        loop {
            i = skip_space(text, i);
            let Some(frame) = frames.last_mut() else {
                return Ok((i == text.len() && needed).then_some(values));
            };
            let Some(&c) = text.get(i) else {
                return Ok(None);
            };
            if c == b',' {
                i = skip_space(text, i + 1);
                if let Some(frame) = frame {
                    match read_key(text, i, frame, &mut needed) {
                        Some(next) => i = next,
                        None => return Ok(None),
                    }
                }
                break;
            }
            if c != if frame.is_some() { b'}' } else { b']' } {
                return Ok(None);
            }
            frames.pop();
            i += 1;
        }
    }
}

/// Reads `"key" :` and returns the index of the value.
fn read_key(text: &[u8], i: usize, frame: &mut ObjectFrame, needed: &mut bool) -> Option<usize> {
    if text.get(i) != Some(&b'"') {
        return None;
    }
    let scanned = scan_string(text, i)?;
    *needed |= scanned.lone;
    let key = KeyRef {
        start: i + 1,
        end: scanned.end - 1,
        plain: scanned.plain,
    };
    if !*needed {
        *needed = is_repeat(text, frame, key);
    }
    let i = skip_space(text, scanned.end);
    if text.get(i) != Some(&b':') {
        return None;
    }
    Some(skip_space(text, i + 1))
}

fn is_repeat(text: &[u8], frame: &mut ObjectFrame, key: KeyRef) -> bool {
    if let Some(set) = &mut frame.set {
        return !set.insert(decode(text, key.start, key.end));
    }
    for seen in &frame.keys {
        let same = if seen.plain && key.plain {
            text[seen.start..seen.end] == text[key.start..key.end]
        } else {
            decode(text, seen.start, seen.end) == decode(text, key.start, key.end)
        };
        if same {
            return true;
        }
    }
    frame.keys.push(key);
    if frame.keys.len() > LINEAR_KEY_LIMIT {
        frame.set = Some(
            frame
                .keys
                .iter()
                .map(|seen| decode(text, seen.start, seen.end))
                .collect(),
        );
    }
    false
}

struct Scanned {
    end: usize,
    lone: bool,
    plain: bool,
}

/// Scans a string token from its opening quote. `plain` is false when the
/// token holds an escape or a surrogate unit.
fn scan_string(text: &[u8], start: usize) -> Option<Scanned> {
    let mut lone = false;
    let mut plain = true;
    let mut high_pending = false;
    let mut i = start + 1;
    loop {
        let c = *text.get(i)?;
        if c == b'"' {
            return Some(Scanned {
                end: i + 1,
                lone: lone || high_pending,
                plain,
            });
        }
        if c < 0x20 {
            return None;
        }
        let (unit, width) = if c == b'\\' {
            plain = false;
            match *text.get(i + 1)? {
                b'u' => (hex4(text, i + 2)?, 6),
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => (0, 2),
                _ => return None,
            }
        } else if c >= 0xf0 {
            // A raw astral character is a complete UTF-16 pair.
            plain = false;
            lone |= high_pending;
            high_pending = false;
            i += 4;
            continue;
        } else {
            (0, utf8_width(c))
        };
        if (0xd800..0xdc00).contains(&unit) {
            lone |= high_pending;
            high_pending = true;
        } else if (0xdc00..0xe000).contains(&unit) {
            lone |= !high_pending;
            high_pending = false;
        } else {
            lone |= high_pending;
            high_pending = false;
        }
        i += width;
    }
}

fn utf8_width(lead: u8) -> usize {
    match lead {
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xff => 4,
        _ => 1,
    }
}

fn scan_literal_or_number(text: &[u8], start: usize) -> Option<usize> {
    for literal in [&b"true"[..], b"false", b"null"] {
        if text[start..].starts_with(literal) {
            return Some(start + literal.len());
        }
    }
    let mut i = start;
    if text.get(i) == Some(&b'-') {
        i += 1;
    }
    match text.get(i)? {
        b'0' => i += 1,
        b'1'..=b'9' => i = skip_digits(text, i),
        _ => return None,
    }
    if text.get(i) == Some(&b'.') {
        let digits = i + 1;
        i = skip_digits(text, digits);
        if i == digits {
            return None;
        }
    }
    if matches!(text.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(text.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let digits = i;
        i = skip_digits(text, digits);
        if i == digits {
            return None;
        }
    }
    (i > start).then_some(i)
}

fn skip_digits(text: &[u8], mut i: usize) -> usize {
    while text.get(i).is_some_and(u8::is_ascii_digit) {
        i += 1;
    }
    i
}

fn skip_space(text: &[u8], mut i: usize) -> usize {
    while matches!(text.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        i += 1;
    }
    i
}

fn hex4(text: &[u8], at: usize) -> Option<u16> {
    let digits = std::str::from_utf8(text.get(at..at + 4)?).ok()?;
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u16::from_str_radix(digits, 16).ok()
}

/// One piece of a validated string body at i: a UTF-16 escape, or source
/// text to copy. Returns the piece and how many bytes it spans.
enum Piece {
    Unit(u16),
    Text,
}

fn piece_at(text: &[u8], i: usize) -> (Piece, usize) {
    if text[i] != b'\\' {
        return (Piece::Text, utf8_width(text[i]));
    }
    if text[i + 1] == b'u' {
        return (Piece::Unit(hex4(text, i + 2).unwrap_or(0)), 6);
    }
    (Piece::Text, 2)
}

fn is_high(unit: u16) -> bool {
    (0xd800..0xdc00).contains(&unit)
}

fn is_low(unit: u16) -> bool {
    (0xdc00..0xe000).contains(&unit)
}

/// A string body's value as UTF-16, lone surrogates read as U+FFFD.
fn decode(text: &[u8], start: usize, end: usize) -> Vec<u16> {
    let mut out = Vec::with_capacity(end - start);
    let mut i = start;
    while i < end {
        let (piece, width) = piece_at(text, i);
        match piece {
            Piece::Unit(unit) if is_high(unit) && i + width < end => {
                if let (Piece::Unit(low), next) = piece_at(text, i + width)
                    && is_low(low)
                {
                    out.extend([unit, low]);
                    i += width + next;
                    continue;
                }
                out.push(0xfffd);
            }
            Piece::Unit(unit) if is_high(unit) || is_low(unit) => out.push(0xfffd),
            Piece::Unit(unit) => out.push(unit),
            Piece::Text if width == 2 && text[i] == b'\\' => out.push(match text[i + 1] {
                b'b' => 0x08,
                b'f' => 0x0c,
                b'n' => 0x0a,
                b'r' => 0x0d,
                b't' => 0x09,
                other => u16::from(other),
            }),
            Piece::Text => {
                let source = std::str::from_utf8(&text[i..i + width]).unwrap_or("\u{fffd}");
                out.extend(source.encode_utf16());
            }
        }
        i += width;
    }
    out
}

/// A string body as written, each lone surrogate replaced with U+FFFD.
fn append_string(out: &mut Vec<u8>, text: &[u8], start: usize, end: usize) {
    out.push(b'"');
    let mut i = start;
    while i < end {
        let (piece, width) = piece_at(text, i);
        if let Piece::Unit(unit) = piece {
            if is_high(unit)
                && i + width < end
                && let (Piece::Unit(low), next) = piece_at(text, i + width)
                && is_low(low)
            {
                out.extend_from_slice(&text[i..i + width + next]);
                i += width + next;
                continue;
            }
            if is_high(unit) || is_low(unit) {
                out.extend_from_slice("\u{fffd}".as_bytes());
                i += width;
                continue;
            }
        }
        out.extend_from_slice(&text[i..i + width]);
        i += width;
    }
    out.push(b'"');
}

enum Node {
    // [start, end) of the source token.
    Scalar {
        start: usize,
        end: usize,
        string: bool,
    },
    Array(Vec<Node>),
    Object(ObjectNode),
}

#[derive(Default)]
struct ObjectNode {
    members: Vec<(usize, usize, Node)>,
    index: HashMap<Vec<u16>, usize>,
    pending: (usize, usize),
}

impl ObjectNode {
    // A repeated key keeps its first slot and takes the new value.
    fn add(&mut self, text: &[u8], value: Node) {
        let (start, end) = self.pending;
        let name = decode(text, start, end);
        if let Some(&slot) = self.index.get(&name) {
            self.members[slot].2 = value;
            return;
        }
        self.index.insert(name, self.members.len());
        self.members.push((start, end, value));
    }
}

fn read_pending_key(text: &[u8], i: usize, node: &mut ObjectNode) -> usize {
    let end = scan_string(text, i).map_or(i + 1, |scanned| scanned.end);
    node.pending = (i + 1, end - 1);
    let i = skip_space(text, end);
    skip_space(text, i + 1)
}

// Only called on text needs_rewrite validated.
fn rewrite(text: &[u8], check: &mut dyn FnMut() -> Result<(), Stop>) -> Result<String, Stop> {
    let mut containers: Vec<Node> = Vec::new();
    let mut i = skip_space(text, 0);
    let mut steps: u64 = 0;
    let root = 'outer: loop {
        if steps.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        steps += 1;
        let c = text[i];
        let mut value = if c == b'{' || c == b'[' {
            let close = if c == b'{' { b'}' } else { b']' };
            let mut container = if c == b'{' {
                Node::Object(ObjectNode::default())
            } else {
                Node::Array(Vec::new())
            };
            i = skip_space(text, i + 1);
            if text[i] == close {
                i += 1;
                container
            } else {
                if let Node::Object(object) = &mut container {
                    i = read_pending_key(text, i, object);
                }
                containers.push(container);
                continue;
            }
        } else {
            let start = i;
            i = if c == b'"' {
                scan_string(text, i).map_or(text.len(), |scanned| scanned.end)
            } else {
                scan_literal_or_number(text, i).unwrap_or(text.len())
            };
            Node::Scalar {
                start,
                end: i,
                string: c == b'"',
            }
        };
        // Attach the value, closing every container that ends here.
        loop {
            let Some(parent) = containers.last_mut() else {
                break 'outer value;
            };
            match parent {
                Node::Object(object) => object.add(text, value),
                Node::Array(items) => items.push(value),
                Node::Scalar { .. } => unreachable!("a scalar is never a container"),
            }
            i = skip_space(text, i);
            if text[i] == b',' {
                i = skip_space(text, i + 1);
                if let Some(Node::Object(object)) = containers.last_mut() {
                    i = read_pending_key(text, i, object);
                }
                break;
            }
            i += 1;
            value = containers.pop().expect("a parent");
        }
    };
    emit(text, &root, check)
}

fn emit(
    text: &[u8],
    root: &Node,
    check: &mut dyn FnMut() -> Result<(), Stop>,
) -> Result<String, Stop> {
    let mut out = Vec::with_capacity(text.len());
    let mut stack: Vec<(&Node, Option<usize>)> = vec![(root, None)];
    let mut steps: u64 = 0;
    while let Some((node, next)) = stack.pop() {
        steps += 1;
        if steps.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        match node {
            Node::Scalar {
                start,
                end,
                string: true,
            } => append_string(&mut out, text, start + 1, end - 1),
            Node::Scalar { start, end, .. } => out.extend_from_slice(&text[*start..*end]),
            Node::Array(items) => {
                let next = next.unwrap_or_else(|| {
                    out.push(b'[');
                    0
                });
                if next == items.len() {
                    out.push(b']');
                    continue;
                }
                if next > 0 {
                    out.push(b',');
                }
                stack.push((node, Some(next + 1)));
                stack.push((&items[next], None));
            }
            Node::Object(object) => {
                let next = next.unwrap_or_else(|| {
                    out.push(b'{');
                    0
                });
                if next == object.members.len() {
                    out.push(b'}');
                    continue;
                }
                if next > 0 {
                    out.push(b',');
                }
                let (start, end, value) = &object.members[next];
                append_string(&mut out, text, *start, *end);
                out.push(b':');
                stack.push((node, Some(next + 1)));
                stack.push((value, None));
            }
        }
    }
    // Only whole UTF-8 sequences and ASCII were copied.
    Ok(String::from_utf8(out).unwrap_or_default())
}
