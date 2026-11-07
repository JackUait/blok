//! Client JSON that JSON.parse takes and serde_json refuses. rmcp parses
//! every message with serde_json, so these lines must be mended before
//! rmcp sees them; it drops them without a word.

/// Mends `text` for rmcp. A lone surrogate escape becomes U+FFFD (USER
/// DECISION 2026-11-04). A number past f64 becomes a stand-in that
/// `restore_infinities` turns back. Depth is clamped before this (depth.rs).
pub fn mend(text: &str) -> String {
    if !may_need_mending(text) {
        return text.to_owned();
    }
    // A Value, not IgnoredAny: skipping checks neither escapes nor depth.
    let Err(error) = serde_json::from_str::<serde_json::Value>(text) else {
        return text.to_owned();
    };
    if error.classify() != serde_json::error::Category::Syntax {
        return text.to_owned();
    }
    let text = replace_lone_surrogates(text).unwrap_or_else(|| text.to_owned());
    replace_infinities(&text).unwrap_or(text)
}

/// `text` as serde_json can read what JSON.parse reads: lone surrogates as
/// U+FFFD, numbers past f64 as the stand-in the engine reads back.
pub fn as_json_parse_reads(text: &str) -> String {
    let text = replace_lone_surrogates(text).unwrap_or_else(|| text.to_owned());
    replace_infinities(&text).unwrap_or(text)
}

/// A quick scan, so most messages are not parsed twice: a `\uD...`
/// escape, or a number that may pass f64.
fn may_need_mending(text: &str) -> bool {
    let bytes = text.as_bytes();
    let (mut in_string, mut at, mut digits) = (false, 0, 0usize);
    while at < bytes.len() {
        let byte = bytes[at];
        if byte.is_ascii_digit() && !in_string {
            digits += 1;
            // 309 digits, or a 3-digit exponent, may pass f64's range.
            if digits > 308 {
                return true;
            }
        } else {
            digits = 0;
        }
        match byte {
            b'"' => in_string = !in_string,
            b'\\' if in_string => {
                if bytes.get(at + 1) == Some(&b'u')
                    && matches!(bytes.get(at + 2), Some(b'd' | b'D'))
                {
                    return true;
                }
                at += 1;
            }
            b'e' | b'E' if !in_string => {
                let mut end = at + 1;
                if matches!(bytes.get(end), Some(b'+' | b'-')) {
                    end += 1;
                }
                if bytes
                    .get(end..end + 3)
                    .is_some_and(|d| d.iter().all(u8::is_ascii_digit))
                {
                    return true;
                }
            }
            _ => {}
        }
        at += 1;
    }
    false
}

/// What a number past f64 crosses rmcp as. serde_json writes it back as
/// exactly this text, and no client sends it on purpose.
pub(crate) const INFINITY_STAND_IN: &str = "1.2345e+308";

/// Each number token outside a string, in order.
fn number_tokens(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let (mut at, mut in_string) = (0, false);
    while at < bytes.len() {
        match bytes[at] {
            b'"' => in_string = !in_string,
            b'\\' if in_string => at += 1,
            b'-' | b'0'..=b'9' if !in_string => {
                let start = at;
                while at < bytes.len()
                    && matches!(bytes[at], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    at += 1;
                }
                out.push((start, at));
                continue;
            }
            _ => {}
        }
        at += 1;
    }
    out
}

/// `text` with each number past f64 as the stand-in; None when it has none.
fn replace_infinities(text: &str) -> Option<String> {
    let mut out: Option<String> = None;
    let mut copied = 0;
    for (start, end) in number_tokens(text) {
        let token = &text[start..end];
        if !token.parse::<f64>().is_ok_and(f64::is_infinite) {
            continue;
        }
        let out = out.get_or_insert_with(String::new);
        out.push_str(&text[copied..start]);
        if token.starts_with('-') {
            out.push('-');
        }
        out.push_str(INFINITY_STAND_IN);
        copied = end;
    }
    let mut out = out?;
    out.push_str(&text[copied..]);
    Some(out)
}

/// Arguments for the engine: each stand-in back as 1e400, which its
/// JSON.parse reads as Infinity, as Node's did.
pub fn restore_infinities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, end) in number_tokens(text) {
        let token = text[start..end].trim_start_matches('-');
        if token == INFINITY_STAND_IN {
            out.push_str(&text[copied..end - token.len()]);
            out.push_str("1e400");
            copied = end;
        }
    }
    out.push_str(&text[copied..]);
    out
}

/// `text` with each lone `\uD800`-`\uDFFF` escape in a string written as
/// `\ufffd`; None when it has none.
fn replace_lone_surrogates(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let unit = |at: usize| -> Option<u16> {
        if bytes.get(at) != Some(&b'\\') || bytes.get(at + 1) != Some(&b'u') {
            return None;
        }
        let hex = std::str::from_utf8(bytes.get(at + 2..at + 6)?).ok()?;
        u16::from_str_radix(hex, 16).ok()
    };
    let mut out: Option<String> = None;
    let mut copied = 0;
    let mut in_string = false;
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'"' => {
                in_string = !in_string;
                at += 1;
            }
            b'\\' if in_string => match unit(at) {
                Some(0xD800..=0xDBFF)
                    if unit(at + 6).is_some_and(|low| (0xDC00..=0xDFFF).contains(&low)) =>
                {
                    at += 12;
                }
                Some(0xD800..=0xDFFF) => {
                    let out = out.get_or_insert_with(String::new);
                    out.push_str(&text[copied..at]);
                    out.push_str("\\ufffd");
                    at += 6;
                    copied = at;
                }
                // Any other escape is two bytes, or six for \u.
                Some(_) => at += 6,
                None => at += 2,
            },
            _ => at += 1,
        }
    }
    let mut out = out?;
    out.push_str(&text[copied..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lone_surrogate_becomes_u_fffd() {
        let mended = mend(r#"{"id":1,"method":"m","params":{"a":"x\ud800y","b":"\udc00"}}"#);
        assert_eq!(
            mended,
            r#"{"id":1,"method":"m","params":{"a":"x\ufffdy","b":"\ufffd"}}"#
        );
        let value: serde_json::Value = serde_json::from_str(&mended).unwrap();
        assert_eq!(value["params"]["a"], "x\u{fffd}y");
    }

    #[test]
    fn a_pair_and_an_escaped_backslash_stay() {
        let text = r#"{"a":"\ud83d\ude00","b":"\\ud800"}"#;
        assert_eq!(mend(text), text);
        assert_eq!(replace_lone_surrogates(text), None);
    }

    // JSON.parse reads 1e400 as Infinity, which serde_json refuses: it goes
    // through rmcp as a stand-in, and back to 1e400 for the engine.
    #[test]
    fn a_number_past_f64_reaches_the_engine_as_written() {
        let text =
            r#"{"id":1,"method":"m","params":{"a":1e400,"b":-1E+999,"s":"1e400","c":1e308}}"#;
        let mended = mend(text);
        let value: serde_json::Value = serde_json::from_str(&mended).unwrap();
        let args = serde_json::to_string(&value["params"]).unwrap();
        assert_eq!(
            restore_infinities(&args),
            r#"{"a":1e400,"b":-1e400,"s":"1e400","c":1e+308}"#
        );
    }

    #[test]
    fn broken_json_is_left_for_rmcp() {
        assert_eq!(mend("{nope"), "{nope");
    }
}
