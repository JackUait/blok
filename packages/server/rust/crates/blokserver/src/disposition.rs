//! ContentDispositionHeaderValue.TryDecode5987 and the charsets it knows.

use blok_jsjson::to_string_lossy;

/// "charset'language'value", split on every quote. Each run of %XX bytes is
/// decoded on its own with the charset; other chars are kept as they are.
pub(crate) fn decode_extended_value(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split('\'').collect();
    if parts.len() != 3 {
        return None;
    }
    let decode = charset_decoder(&parts[0].to_lowercase())?;
    let mut out = String::new();
    let mut run: Vec<u8> = Vec::new();
    let text = parts[2];
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && bytes.len() - i >= 3
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            run.push(hex_value(bytes[i + 1]) << 4 | hex_value(bytes[i + 2]));
            i += 3;
            continue;
        }
        if !run.is_empty() {
            out.push_str(&decode(&run));
            run.clear();
        }
        // Copy one whole char: text is UTF-8.
        let width = text[i..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&text[i..i + width]);
        i += width;
    }
    if !run.is_empty() {
        out.push_str(&decode(&run));
    }
    Some(out)
}

fn hex_value(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'A'..=b'F' => c - b'A' + 10,
        _ => c - b'a' + 10,
    }
}

/// EncodingTable's name list (System.Private.CoreLib 10.0.11). No
/// EncodingProvider is registered, so nothing else resolves. The UTF-7
/// names (65000) are left out: UploadEndpoint treats them as unknown, since
/// Encoding.GetEncoding refuses UTF-7.
fn charset_code_page(name: &str) -> Option<u32> {
    Some(match name {
        "ansi_x3.4-1968" | "ansi_x3.4-1986" | "ascii" | "cp367" | "csascii" | "ibm367"
        | "iso-ir-6" | "iso646-us" | "iso_646.irv:1991" | "us" | "us-ascii" => 20127,
        "cp819" | "csisolatin1" | "ibm819" | "iso-8859-1" | "iso-ir-100" | "iso8859-1"
        | "iso_8859-1" | "iso_8859-1:1987" | "l1" | "latin1" => 28591,
        "iso-10646-ucs-2" | "ucs-2" | "unicode" | "utf-16" | "utf-16le" => 1200,
        "unicodefffe" | "utf-16be" => 1201,
        "unicode-1-1-utf-8"
        | "unicode-2-0-utf-8"
        | "utf-8"
        | "x-unicode-1-1-utf-8"
        | "x-unicode-2-0-utf-8" => 65001,
        "utf-32" | "utf-32le" => 12000,
        "utf-32be" => 12001,
        _ => return None,
    })
}

/// Decoders with .NET's default replacement fallback: "?" for ASCII,
/// U+FFFD for the Unicode encodings.
fn charset_decoder(name: &str) -> Option<fn(&[u8]) -> String> {
    Some(match charset_code_page(name)? {
        20127 => decode_ascii,
        28591 => decode_latin1,
        65001 => decode_utf8,
        1200 => |b| decode_utf16(b, false),
        1201 => |b| decode_utf16(b, true),
        12000 => |b| decode_utf32(b, false),
        _ => |b| decode_utf32(b, true),
    })
}

fn decode_ascii(b: &[u8]) -> String {
    b.iter()
        .map(|&c| if c >= 0x80 { '?' } else { char::from(c) })
        .collect()
}

fn decode_latin1(b: &[u8]) -> String {
    b.iter().map(|&c| char::from(c)).collect()
}

/// Replaces each maximal ill-formed subpart with one U+FFFD, as .NET does;
/// std's lossy decoding does the same (the WHATWG rule).
fn decode_utf8(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

fn decode_utf16(b: &[u8], big_endian: bool) -> String {
    let unit = |i: usize| {
        if big_endian {
            u16::from(b[i]) << 8 | u16::from(b[i + 1])
        } else {
            u16::from(b[i + 1]) << 8 | u16::from(b[i])
        }
    };
    let units: Vec<u16> = (0..b.len() / 2).map(|k| unit(2 * k)).collect();
    let mut out = to_string_lossy(&units);
    if b.len() % 2 == 1 {
        out.push('\u{FFFD}');
    }
    out
}

fn decode_utf32(b: &[u8], big_endian: bool) -> String {
    let mut out = String::new();
    let (chunks, remainder) = b.as_chunks::<4>();
    for &bytes in chunks {
        let v = if big_endian {
            u32::from_be_bytes(bytes)
        } else {
            u32::from_le_bytes(bytes)
        };
        out.push(char::from_u32(v).unwrap_or('\u{FFFD}'));
    }
    if !remainder.is_empty() {
        out.push('\u{FFFD}');
    }
    out
}
