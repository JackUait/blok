//! Turns every object or array that opens deeper than a limit into `[]`,
//! so no parser here recurses past it. Node parses any depth; what it reads
//! past the limit is only ever refused or ignored. A dropped part that is not
//! valid JSON cuts the text there and appends "!", so the message stays
//! invalid, as it is for Node. Text that fits comes back unchanged.
//! test/unit/server-conformance/fixtures/mcp-depth-clamp.json holds the
//! cases; the Go and C# MCP tests read it too.

use std::borrow::Cow;

/// Arguments start at depth 3 (4 in an HTTP batch), so clamped arguments
/// still nest past the shared 48-level rule and the bundle refuses them in
/// Node's words; and serde_json (128) and the engine (64) never see them deeper.
pub(crate) const MESSAGE_LIMIT: usize = 51;

/// The shared bundle's MAX_JSON_DEPTH (src/shared/mcp/wire-json.ts).
pub(crate) const MAX_JSON_DEPTH: i64 = 48;

/// wire-json.ts's textNestsDeeperThan: brackets inside strings do not
/// count, and the text need not be valid JSON.
pub(crate) fn text_nests_deeper_than(text: &str, limit: i64) -> bool {
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut at) = (0i64, false, 0usize);
    while at < bytes.len() {
        let byte = bytes[at];
        if in_string {
            if byte == b'\\' {
                at += 1;
            } else if byte == b'"' {
                in_string = false;
            }
        } else {
            match byte {
                b'"' => in_string = true,
                b'{' | b'[' => depth += 1,
                b'}' | b']' => depth -= 1,
                _ => {}
            }
        }
        if depth > limit {
            return true;
        }
        at += 1;
    }
    false
}

pub(crate) fn clamp(text: &str, limit: usize) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let (mut depth, mut in_string, mut from, mut at) = (0i64, false, 0usize, 0usize);
    let mut out: Option<String> = None;
    while at < bytes.len() {
        let byte = bytes[at];
        if in_string {
            if byte == b'\\' {
                at += 1;
            } else if byte == b'"' {
                in_string = false;
            }
            at += 1;
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'}' | b']' => depth -= 1,
            b'{' | b'[' if depth < limit => depth += 1,
            b'{' | b'[' => {
                let buffer = out.get_or_insert_with(|| String::with_capacity(text.len()));
                buffer.push_str(&text[from..at]);
                let Some(end) = skip_value(bytes, at) else {
                    buffer.push('!');
                    return Cow::Owned(out.unwrap_or_default());
                };
                buffer.push_str("[]");
                from = end;
                at = end;
                continue;
            }
            _ => {}
        }
        at += 1;
    }
    match out {
        None => Cow::Borrowed(text),
        Some(mut buffer) => {
            buffer.push_str(&text[from..]);
            Cow::Owned(buffer)
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Expect {
    Value,
    ValueOrClose,
    Key,
    KeyOrClose,
    Colon,
    CommaOrClose,
}

/// The index just past the object or array at `start`, checked as
/// JSON.parse would with a stack instead of recursion; None when invalid.
fn skip_value(bytes: &[u8], start: usize) -> Option<usize> {
    let mut stack: Vec<u8> = Vec::new();
    let mut state = Expect::Value;
    let mut at = start;
    loop {
        while matches!(bytes.get(at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            at += 1;
        }
        let byte = *bytes.get(at)?;
        let mut closed = false;
        match state {
            Expect::KeyOrClose | Expect::Key => {
                if byte == b'}' && state == Expect::KeyOrClose {
                    stack.pop();
                    at += 1;
                    closed = true;
                } else if byte == b'"' {
                    at = skip_string(bytes, at)?;
                    state = Expect::Colon;
                } else {
                    return None;
                }
            }
            Expect::Colon => {
                if byte != b':' {
                    return None;
                }
                at += 1;
                state = Expect::Value;
            }
            Expect::CommaOrClose => {
                let top = *stack.last()?;
                if byte == b',' {
                    at += 1;
                    state = if top == b'{' {
                        Expect::Key
                    } else {
                        Expect::Value
                    };
                } else if (byte == b'}' && top == b'{') || (byte == b']' && top == b'[') {
                    stack.pop();
                    at += 1;
                    closed = true;
                } else {
                    return None;
                }
            }
            Expect::Value | Expect::ValueOrClose => {
                if byte == b']' && state == Expect::ValueOrClose {
                    stack.pop();
                    at += 1;
                    closed = true;
                } else if byte == b'{' || byte == b'[' {
                    stack.push(byte);
                    at += 1;
                    state = if byte == b'{' {
                        Expect::KeyOrClose
                    } else {
                        Expect::ValueOrClose
                    };
                    continue;
                } else {
                    at = if byte == b'"' {
                        skip_string(bytes, at)?
                    } else {
                        skip_scalar(bytes, at)?
                    };
                    closed = true;
                }
            }
        }
        if closed {
            if stack.is_empty() {
                return Some(at);
            }
            state = Expect::CommaOrClose;
        }
    }
}

fn skip_string(bytes: &[u8], mut at: usize) -> Option<usize> {
    at += 1;
    loop {
        let byte = *bytes.get(at)?;
        match byte {
            b'"' => return Some(at + 1),
            0..=0x1f => return None,
            b'\\' => {
                at += 1;
                match *bytes.get(at)? {
                    b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => {}
                    b'u' => {
                        for _ in 0..4 {
                            at += 1;
                            if !bytes.get(at)?.is_ascii_hexdigit() {
                                return None;
                            }
                        }
                    }
                    _ => return None,
                }
            }
            _ => {}
        }
        at += 1;
    }
}

/// true, false, null or a JSON number.
fn skip_scalar(bytes: &[u8], mut at: usize) -> Option<usize> {
    for literal in [&b"true"[..], b"false", b"null"] {
        if bytes[at..].starts_with(literal) {
            return Some(at + literal.len());
        }
    }
    let digits = |at: &mut usize| {
        let begin = *at;
        while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
            *at += 1;
        }
        *at > begin
    };
    if bytes.get(at) == Some(&b'-') {
        at += 1;
    }
    if bytes.get(at) == Some(&b'0') {
        at += 1;
    } else if !digits(&mut at) {
        return None;
    }
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        if !digits(&mut at) {
            return None;
        }
    }
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        at += 1;
        if matches!(bytes.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        if !digits(&mut at) {
            return None;
        }
    }
    Some(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_as_the_shared_vectors_say() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../../test/unit/server-conformance/fixtures/mcp-depth-clamp.json"
        );
        let vectors: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(vectors["hostLimit"], MESSAGE_LIMIT);
        for case in vectors["cases"].as_array().unwrap() {
            let limit = usize::try_from(case["limit"].as_u64().unwrap()).unwrap();
            assert_eq!(
                clamp(case["input"].as_str().unwrap(), limit),
                case["output"].as_str().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn takes_a_hundred_thousand_levels() {
        let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
        assert_eq!(clamp(&format!(r#"{{"a":{deep}}}"#), 3), r#"{"a":[[[]]]}"#);
    }
}
