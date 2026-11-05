/// string.Equals(a, b, OrdinalIgnoreCase): the simple upper case of each
/// char, as OrdinalCasing.ToUpper. Unlike a full case fold it never folds
/// U+212A to "k", U+017F to "s", U+0131 to "i" or "ß" to "ẞ". Takes bytes
/// because the Go callers pass strings that may hold invalid UTF-8: an
/// invalid byte only equals itself.
pub fn equals_ordinal_ignore_case(a: &[u8], b: &[u8]) -> bool {
    let (mut a, mut b) = (a, b);
    while !a.is_empty() && !b.is_empty() {
        let (x, xn) = decode_rune(a);
        let (y, yn) = decode_rune(b);
        match (x, y) {
            (Some(x), Some(y)) => {
                if ordinal_upper(x) != ordinal_upper(y) {
                    return false;
                }
            }
            (None, None) if a[0] == b[0] => {}
            _ => return false,
        }
        a = &a[xn..];
        b = &b[yn..];
    }
    a.is_empty() && b.is_empty()
}

/// utf8.DecodeRune: one char, or None over one invalid byte.
pub(crate) fn decode_rune(b: &[u8]) -> (Option<char>, usize) {
    let valid = b.utf8_chunks().next().map_or("", |chunk| chunk.valid());
    match valid.chars().next() {
        Some(c) => (Some(c), c.len_utf8()),
        None => (None, 1),
    }
}

fn ordinal_upper(c: char) -> char {
    // Measured on .NET 10: ſ keeps its case here (ı does in both).
    if c == 'ſ' {
        return c;
    }
    to_upper_invariant(c)
}

/// char.ToUpperInvariant: Go's unicode.ToUpper, the simple mapping
/// (Unicode 17, checked against Go over every char), except that ı keeps
/// its case (measured on .NET 10). Rust's to_uppercase is the full mapping:
/// where that gives several chars, the simple one is the char itself except
/// for the Greek iota-subscript letters below.
pub fn to_upper_invariant(c: char) -> char {
    if c == 'ı' {
        return c;
    }
    let simple = match u32::from(c) {
        u @ (0x1f80..=0x1f87 | 0x1f90..=0x1f97 | 0x1fa0..=0x1fa7) => Some(u + 8),
        0x1fb3 => Some(0x1fbc),
        0x1fc3 => Some(0x1fcc),
        0x1ff3 => Some(0x1ffc),
        _ => None,
    };
    if let Some(upper) = simple.and_then(char::from_u32) {
        return upper;
    }
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(single), None) => single,
        _ => c,
    }
}
