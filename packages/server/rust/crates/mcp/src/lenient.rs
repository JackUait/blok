//! Client JSON that JSON.parse takes and serde_json refuses. rmcp parses
//! every message with serde_json, so these lines must be mended, or
//! answered here, before rmcp sees them; it drops them without a word.

use serde_json::json;

/// What to do with a client message.
#[derive(Debug, PartialEq, Eq)]
pub enum Mended {
    /// Pass this text on (the message itself when nothing needed mending).
    Forward(String),
    /// Answer with this instead; rmcp cannot read the message.
    Answer(String),
}

/// serde_json's nesting limit, which rmcp parses under.
const SERDE_DEPTH: usize = 128;

/// Mends `text` for rmcp. A lone surrogate escape becomes U+FFFD (USER
/// DECISION 2026-11-04). A number past f64 becomes a stand-in that
/// `restore_infinities` turns back. A request nested past serde_json's limit
/// gets Invalid Request with its id: Node runs it, but rmcp cannot read it.
pub fn mend(text: &str) -> Mended {
    if !may_need_mending(text) {
        return Mended::Forward(text.to_owned());
    }
    // A Value, not IgnoredAny: skipping checks neither escapes nor depth.
    let Err(error) = serde_json::from_str::<serde_json::Value>(text) else {
        return Mended::Forward(text.to_owned());
    };
    if error.classify() != serde_json::error::Category::Syntax {
        return Mended::Forward(text.to_owned());
    }
    let text = replace_lone_surrogates(text).unwrap_or_else(|| text.to_owned());
    let text = replace_infinities(&text).unwrap_or(text);
    match serde_json::from_str::<serde_json::Value>(&text) {
        Err(error) if error.to_string().starts_with("recursion limit exceeded") => {
            match too_deep_answer(&text) {
                Some(answer) => Mended::Answer(answer),
                None => Mended::Forward(text),
            }
        }
        _ => Mended::Forward(text),
    }
}

/// A quick scan, so most messages are not parsed twice: a `\uD...`
/// escape, nesting at serde_json's limit, or a number that may pass f64.
fn may_need_mending(text: &str) -> bool {
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut at, mut digits) = (0usize, false, 0, 0usize);
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
            b'[' | b'{' if !in_string => {
                depth += 1;
                if depth >= SERDE_DEPTH {
                    return true;
                }
            }
            b']' | b'}' if !in_string => depth = depth.saturating_sub(1),
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

/// Invalid Request for a request too deep for serde_json, read with
/// JSON.parse's rules. None for a notification, an id JSON-RPC refuses, or
/// text that is not JSON.
fn too_deep_answer(text: &str) -> Option<String> {
    let top = top_level(text)?;
    if !top.method {
        return None;
    }
    let id = match blok_jsjson::parse(top.id?.as_bytes()).ok()? {
        id @ (blok_jsjson::Value::String(_) | blok_jsjson::Value::Number(_)) => {
            serde_json::from_str::<serde_json::Value>(&blok_jsjson::stringify(&id).ok()?).ok()?
        }
        _ => return None,
    };
    Some(
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32600,
                "message": format!("Invalid request: the message nests {SERDE_DEPTH} levels or deeper"),
            },
        })
        .to_string(),
    )
}

/// The top-level `id` (its raw text, the last one) and whether a `method`
/// is there.
struct TopLevel<'a> {
    id: Option<&'a str>,
    method: bool,
}

/// Reads the top-level members of a JSON object of any depth, with a
/// counter instead of recursion; None when the text is not one JSON object.
fn top_level(text: &str) -> Option<TopLevel<'_>> {
    let bytes = text.as_bytes();
    let space = |at: &mut usize| {
        while matches!(bytes.get(*at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            *at += 1;
        }
    };
    // One scalar or string from `at`; returns its end.
    let scalar = |at: usize| -> Option<usize> {
        if bytes.get(at) == Some(&b'"') {
            let mut end = at + 1;
            loop {
                match bytes.get(end)? {
                    b'"' => return Some(end + 1),
                    b'\\' => end += 2,
                    _ => end += 1,
                }
            }
        }
        let mut end = at;
        while end < bytes.len()
            && !matches!(
                bytes[end],
                b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r' | b':'
            )
        {
            end += 1;
        }
        (end > at).then_some(end)
    };
    let mut at = 0;
    space(&mut at);
    if bytes.get(at) != Some(&b'{') {
        return None;
    }
    at += 1;
    let mut top = TopLevel {
        id: None,
        method: false,
    };
    let mut depth = 0usize;
    let mut key: Option<&str> = None;
    let mut expect_key = true;
    loop {
        space(&mut at);
        let byte = *bytes.get(at)?;
        match byte {
            b'}' | b']' if depth > 0 => {
                depth -= 1;
                at += 1;
            }
            b'}' if depth == 0 => {
                at += 1;
                space(&mut at);
                // Anything after the object makes it no JSON.
                return (at == bytes.len()).then_some(top);
            }
            b'{' | b'[' => {
                depth += 1;
                at += 1;
            }
            b',' => {
                expect_key = depth == 0;
                at += 1;
            }
            b':' => at += 1,
            _ => {
                let end = scalar(at)?;
                let token = &text[at..end];
                if depth == 0 && expect_key {
                    key = Some(token);
                    expect_key = false;
                } else if depth == 0 {
                    match key {
                        Some(r#""id""#) => top.id = Some(token),
                        Some(r#""method""#) => top.method = true,
                        _ => {}
                    }
                }
                at = end;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lone_surrogate_becomes_u_fffd() {
        let mended = mend(r#"{"id":1,"method":"m","params":{"a":"x\ud800y","b":"\udc00"}}"#);
        assert_eq!(
            mended,
            Mended::Forward(
                r#"{"id":1,"method":"m","params":{"a":"x\ufffdy","b":"\ufffd"}}"#.to_owned()
            )
        );
        let Mended::Forward(text) = mended else {
            unreachable!()
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["params"]["a"], "x\u{fffd}y");
    }

    #[test]
    fn a_pair_and_an_escaped_backslash_stay() {
        let text = r#"{"a":"\ud83d\ude00","b":"\\ud800"}"#;
        assert_eq!(mend(text), Mended::Forward(text.to_owned()));
        assert_eq!(replace_lone_surrogates(text), None);
    }

    #[test]
    fn a_request_past_128_levels_gets_invalid_request_with_its_id() {
        let deep = format!("{}{}", "[".repeat(200), "]".repeat(200));
        let text = format!(
            r#"{{"jsonrpc":"2.0","id":7.0,"method":"tools/call","params":{{"x":{deep}}}}}"#
        );
        assert_eq!(
            mend(&text),
            Mended::Answer(
                r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32600,"message":"Invalid request: the message nests 128 levels or deeper"}}"#
                    .to_owned()
            )
        );
        // A notification gets no answer.
        let note = format!(r#"{{"jsonrpc":"2.0","method":"n","params":{{"x":{deep}}}}}"#);
        assert_eq!(mend(&note), Mended::Forward(note.clone()));
    }

    // serde_json stops at exactly 128 levels; jsjson's own parse at 512.
    // Every such request still gets its answer.
    #[test]
    fn a_request_of_128_levels_or_past_512_is_answered() {
        // The message itself adds two levels: 126 makes 128.
        for levels in [126, 600, 5000] {
            let deep = format!("{}{}", "[".repeat(levels), "]".repeat(levels));
            let text = format!(
                r#"{{"jsonrpc":"2.0","id":"q","method":"tools/call","params":{{"x":{deep}}}}}"#
            );
            let Mended::Answer(answer) = mend(&text) else {
                panic!("{levels} levels were not answered");
            };
            let answer: serde_json::Value = serde_json::from_str(&answer).unwrap();
            assert_eq!(answer["id"], "q", "{levels}");
            assert_eq!(answer["error"]["code"], -32600, "{levels}");
        }
        // Broken JSON this deep is still left alone.
        let broken = format!(r#"{{"id":1,"method":"m","params":{}"#, "[".repeat(600));
        assert_eq!(mend(&broken), Mended::Forward(broken.clone()));
    }

    // JSON.parse reads 1e400 as Infinity, which serde_json refuses: it goes
    // through rmcp as a stand-in, and back to 1e400 for the engine.
    #[test]
    fn a_number_past_f64_reaches_the_engine_as_written() {
        let text =
            r#"{"id":1,"method":"m","params":{"a":1e400,"b":-1E+999,"s":"1e400","c":1e308}}"#;
        let Mended::Forward(mended) = mend(text) else {
            panic!("not forwarded")
        };
        let value: serde_json::Value = serde_json::from_str(&mended).unwrap();
        let args = serde_json::to_string(&value["params"]).unwrap();
        assert_eq!(
            restore_infinities(&args),
            r#"{"a":1e400,"b":-1e400,"s":"1e400","c":1e+308}"#
        );
    }

    #[test]
    fn broken_json_is_left_for_rmcp() {
        assert_eq!(mend("{nope"), Mended::Forward("{nope".to_owned()));
    }
}
