use std::cmp::Ordering;
use std::fmt;
use std::ops::{Deref, DerefMut};

/// A JS string: UTF-16 code units, lone surrogates allowed. Its `Ord` is the
/// UTF-16 unit order, like JS sort() and C# StringComparer.Ordinal; Rust's
/// `str` order differs (it puts U+FF61 before U+1F600).
#[derive(Clone, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Str(pub Vec<u16>);

impl Str {
    pub fn new() -> Str {
        Str(Vec::new())
    }

    /// FromString for bytes: each invalid byte run becomes one U+FFFD per
    /// maximal subpart, as .NET's UTF-8 decoder does.
    pub fn from_utf8(bytes: &[u8]) -> Str {
        let mut units = Vec::with_capacity(bytes.len());
        append_utf8(&mut units, bytes);
        Str(units)
    }

    pub fn units(&self) -> &[u16] {
        &self.0
    }

    pub fn into_units(self) -> Vec<u16> {
        self.0
    }
}

/// Lone surrogates become U+FFFD, as TextEncoder and C#'s Encoding.UTF8 do.
pub fn to_string_lossy(units: &[u16]) -> String {
    char::decode_utf16(units.iter().copied())
        .map(|r| r.unwrap_or('\u{fffd}'))
        .collect()
}

impl fmt::Display for Str {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&to_string_lossy(&self.0))
    }
}

impl fmt::Debug for Str {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if has_lone(&self.0) {
            write!(f, "Str({:04x?})", self.0)
        } else {
            write!(f, "{:?}", self.to_string())
        }
    }
}

impl Deref for Str {
    type Target = Vec<u16>;
    fn deref(&self) -> &Vec<u16> {
        &self.0
    }
}

impl DerefMut for Str {
    fn deref_mut(&mut self) -> &mut Vec<u16> {
        &mut self.0
    }
}

impl From<&str> for Str {
    fn from(s: &str) -> Str {
        Str(s.encode_utf16().collect())
    }
}

impl From<String> for Str {
    fn from(s: String) -> Str {
        Str::from(s.as_str())
    }
}

impl From<Vec<u16>> for Str {
    fn from(units: Vec<u16>) -> Str {
        Str(units)
    }
}

impl From<&[u16]> for Str {
    fn from(units: &[u16]) -> Str {
        Str(units.to_vec())
    }
}

/// Orders by UTF-16 code units, like JS sort() and C# StringComparer.Ordinal.
pub fn compare(a: &[u16], b: &[u16]) -> Ordering {
    a.cmp(b)
}

pub(crate) fn is_high(unit: u16) -> bool {
    (0xd800..=0xdbff).contains(&unit)
}

pub(crate) fn is_low(unit: u16) -> bool {
    (0xdc00..=0xdfff).contains(&unit)
}

/// A surrogate that is not half of a pair.
pub(crate) fn has_lone(s: &[u16]) -> bool {
    let mut i = 0;
    while i < s.len() {
        if is_high(s[i]) && i + 1 < s.len() && is_low(s[i + 1]) {
            i += 2;
            continue;
        }
        if is_high(s[i]) || is_low(s[i]) {
            return true;
        }
        i += 1;
    }
    false
}

pub(crate) fn push_char(dst: &mut Vec<u16>, c: char) {
    let mut buf = [0u16; 2];
    dst.extend_from_slice(c.encode_utf16(&mut buf));
}

/// Decodes `bytes` onto `dst` and reports whether any byte was invalid.
pub(crate) fn append_utf8(dst: &mut Vec<u16>, bytes: &[u8]) -> bool {
    let mut replaced = false;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] < 0x80 {
            dst.push(u16::from(bytes[i]));
            i += 1;
            continue;
        }
        let (c, size, ok) = decode_maximal(&bytes[i..]);
        replaced |= !ok;
        push_char(dst, c);
        i += size;
    }
    replaced
}

/// Reads one well-formed sequence (Unicode Table 3-7), or U+FFFD over the
/// longest prefix of one (its maximal subpart).
fn decode_maximal(b: &[u8]) -> (char, usize, bool) {
    let lead = b[0];
    let (need, mut lo, mut hi) = match lead {
        0xc2..=0xdf => (1, 0x80, 0xbf),
        0xe0 => (2, 0xa0, 0xbf),
        0xed => (2, 0x80, 0x9f),
        0xe1..=0xef => (2, 0x80, 0xbf),
        0xf0 => (3, 0x90, 0xbf),
        0xf4 => (3, 0x80, 0x8f),
        0xf1..=0xf3 => (3, 0x80, 0xbf),
        _ => return ('\u{fffd}', 1, false),
    };
    for i in 1..=need {
        if i >= b.len() || b[i] < lo || b[i] > hi {
            return ('\u{fffd}', i, false);
        }
        (lo, hi) = (0x80, 0xbf);
    }
    let text = std::str::from_utf8(&b[..=need]).expect("validated sequence");
    (text.chars().next().expect("one char"), need + 1, true)
}
