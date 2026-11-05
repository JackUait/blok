//! How the .NET host decodes argv and environment bytes on Unix (measured;
//! native-text.json).

/// Valid UTF-8 is kept. Each bad sequence becomes U+FFFD, but unlike
/// `from_utf8_lossy`, a lead byte and a continuation byte outside its range
/// (e0 80, ed a0, f4 90) are one U+FFFD together.
pub fn native_text(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let lead = bytes[i];
        let need = match lead {
            0x00..=0x7f => {
                out.push(char::from(lead));
                i += 1;
                continue;
            }
            0xc2..=0xdf => 1,
            0xe0..=0xef => 2,
            0xf0..=0xf4 => 3,
            _ => {
                out.push(char::REPLACEMENT_CHARACTER);
                i += 1;
                continue;
            }
        };
        let Some(&second) = bytes.get(i + 1).filter(|b| continuation(**b)) else {
            out.push(char::REPLACEMENT_CHARACTER);
            i += 1;
            continue;
        };
        if !second_in_range(lead, second) {
            out.push(char::REPLACEMENT_CHARACTER);
            i += 2;
            continue;
        }
        let mut end = i + 2;
        while end < bytes.len() && end < i + 1 + need && continuation(bytes[end]) {
            end += 1;
        }
        match std::str::from_utf8(&bytes[i..end]) {
            Ok(text) if end == i + 1 + need => out.push_str(text),
            _ => out.push(char::REPLACEMENT_CHARACTER),
        }
        i = end;
    }
    out
}

fn continuation(byte: u8) -> bool {
    byte & 0xc0 == 0x80
}

/// Rules out overlong forms, surrogates and code points past U+10FFFF from
/// the second byte.
fn second_in_range(lead: u8, second: u8) -> bool {
    match lead {
        0xe0 => second >= 0xa0,
        0xed => second <= 0x9f,
        0xf0 => second >= 0x90,
        0xf4 => second <= 0x8f,
        _ => true,
    }
}
