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
/// DECISION 2026-11-04). A request nested past serde_json's limit gets
/// Invalid Request with its id: Node runs it, but rmcp cannot read it.
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
/// escape, or nesting past serde_json's limit.
fn may_need_mending(text: &str) -> bool {
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut at) = (0usize, false, 0);
    while at < bytes.len() {
        match bytes[at] {
            b'"' => in_string = !in_string,
            b'\\' if in_string => {
                if bytes.get(at + 1) == Some(&b'u')
                    && matches!(bytes.get(at + 2), Some(b'd' | b'D'))
                {
                    return true;
                }
                at += 1;
            }
            b'[' | b'{' if !in_string => {
                depth += 1;
                if depth > SERDE_DEPTH {
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
/// JSON.parse's rules. None for a notification or an id JSON-RPC refuses.
fn too_deep_answer(text: &str) -> Option<String> {
    let blok_jsjson::Value::Object(message) = blok_jsjson::parse(text.as_bytes()).ok()? else {
        return None;
    };
    let field = |name: &str| message.get(&blok_jsjson::Str::from(name));
    field("method")?;
    let id = match field("id")? {
        id @ (blok_jsjson::Value::String(_) | blok_jsjson::Value::Number(_)) => {
            serde_json::from_str::<serde_json::Value>(&blok_jsjson::stringify(id).ok()?).ok()?
        }
        _ => return None,
    };
    Some(
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32600,
                "message": format!("Invalid request: the message nests deeper than {SERDE_DEPTH} levels"),
            },
        })
        .to_string(),
    )
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
                r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32600,"message":"Invalid request: the message nests deeper than 128 levels"}}"#
                    .to_owned()
            )
        );
        // A notification gets no answer.
        let note = format!(r#"{{"jsonrpc":"2.0","method":"n","params":{{"x":{deep}}}}}"#);
        assert_eq!(mend(&note), Mended::Forward(note.clone()));
    }

    #[test]
    fn broken_json_is_left_for_rmcp() {
        assert_eq!(mend("{nope"), Mended::Forward("{nope".to_owned()));
    }
}
