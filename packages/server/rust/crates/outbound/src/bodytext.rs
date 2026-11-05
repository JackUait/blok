//! HttpContent.ReadBufferAsString (System.Net.Http 10.0.11, decompiled):
//! the string Digest auth-int hashes. Pinned by the shared fixture
//! outbound-body-text.json.

/// Why .NET could not read the body as a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BodyTextError {
    /// InvalidOperationException: a charset Encoding.GetEncoding lacks.
    BadCharset,
    /// NotSupportedException: UTF-7, which .NET turns off.
    Utf7,
}

impl std::fmt::Display for BodyTextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            BodyTextError::BadCharset => {
                "The character set provided in ContentType is invalid. Cannot read content as string using an invalid character set."
            }
            BodyTextError::Utf7 => "dotnet: UTF-7 is turned off, as in .NET",
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CodePage {
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
    Ascii,
    Latin1,
    Utf7,
    Utf8,
}

/// EncodingTable's name list; names are matched lower case.
fn code_page(name: &str) -> Option<CodePage> {
    use CodePage::*;
    Some(match name {
        "ansi_x3.4-1968" | "ansi_x3.4-1986" | "ascii" | "cp367" | "csascii" | "ibm367"
        | "iso-ir-6" | "iso646-us" | "iso_646.irv:1991" | "us" | "us-ascii" => Ascii,
        "cp819" | "csisolatin1" | "ibm819" | "iso-8859-1" | "iso-ir-100" | "iso8859-1"
        | "iso_8859-1" | "iso_8859-1:1987" | "l1" | "latin1" => Latin1,
        "csunicode11utf7"
        | "unicode-1-1-utf-7"
        | "unicode-2-0-utf-7"
        | "utf-7"
        | "x-unicode-1-1-utf-7"
        | "x-unicode-2-0-utf-7" => Utf7,
        "iso-10646-ucs-2" | "ucs-2" | "unicode" | "utf-16" | "utf-16le" => Utf16Le,
        "unicodefffe" | "utf-16be" => Utf16Be,
        "utf-32" | "utf-32le" => Utf32Le,
        "utf-32be" => Utf32Be,
        "unicode-1-1-utf-8"
        | "unicode-2-0-utf-8"
        | "utf-8"
        | "x-unicode-1-1-utf-8"
        | "x-unicode-2-0-utf-8" => Utf8,
        _ => return None,
    })
}

fn preamble(page: CodePage) -> &'static [u8] {
    match page {
        CodePage::Utf8 => &[0xEF, 0xBB, 0xBF],
        CodePage::Utf32Le => &[0xFF, 0xFE, 0, 0],
        CodePage::Utf16Le => &[0xFF, 0xFE],
        CodePage::Utf16Be => &[0xFE, 0xFF],
        CodePage::Utf32Be => &[0, 0, 0xFE, 0xFF],
        _ => &[],
    }
}

/// ReadBufferAsString over `body` with the request's raw Content-Type, if
/// any. The answer is UTF-8, as ComputeHash encodes it.
pub(crate) fn body_text(body: &[u8], content_type: Option<&str>) -> Result<String, BodyTextError> {
    if body.is_empty() {
        return Ok(String::new());
    }
    let (page, skip) = match content_type.and_then(charset) {
        Some(mut name) => {
            if name.len() > 2 && name.starts_with('"') && name.ends_with('"') {
                name = &name[1..name.len() - 1];
            }
            // Names are ASCII here: ToLowerInvariant folds only those.
            let page = code_page(&name.to_ascii_lowercase()).ok_or(BodyTextError::BadCharset)?;
            if page == CodePage::Utf7 {
                return Err(BodyTextError::Utf7);
            }
            let skip = if body.starts_with(preamble(page)) {
                preamble(page).len()
            } else {
                0
            };
            (page, skip)
        }
        // TryDetectEncoding: UTF-32 LE is tried before UTF-16 LE.
        None => [
            CodePage::Utf8,
            CodePage::Utf32Le,
            CodePage::Utf16Le,
            CodePage::Utf16Be,
        ]
        .into_iter()
        .find(|&page| body.starts_with(preamble(page)))
        .map_or((CodePage::Utf8, 0), |page| (page, preamble(page).len())),
    };
    Ok(decode(&body[skip..], page))
}

/// MediaTypeHeaderValue.CharSet over the raw value (System.Net.Http's
/// parser, one value): the first charset parameter as written; None when
/// there is none, it has no value, or the value does not parse.
fn charset(value: &str) -> Option<&str> {
    let s = value.as_bytes();
    let space = |at: usize| {
        s[at.min(s.len())..]
            .iter()
            .take_while(|&&c| c == b' ' || c == b'\t')
            .count()
    };
    let token = |at: usize| {
        s[at.min(s.len())..]
            .iter()
            .take_while(|&&c| crate::wire::is_token_char(c))
            .count()
    };
    // GetNextNonEmptyOrWhitespaceIndex without skipping empty values.
    let next = |at: usize| {
        let at = at + space(at);
        if at < s.len() && s[at] == b',' {
            (at + 1 + space(at + 1), true)
        } else {
            (at, false)
        }
    };
    let (mut i, separator) = next(0);
    if separator || i == s.len() {
        return None;
    }
    let n = token(i);
    if n == 0 {
        return None;
    }
    i += n;
    i += space(i);
    if s.get(i) != Some(&b'/') {
        return None;
    }
    i += 1;
    i += space(i);
    let n = token(i);
    if n == 0 {
        return None;
    }
    i += n;
    i += space(i);
    let mut found: Option<Option<&str>> = None;
    if s.get(i) == Some(&b';') {
        i += 1;
        i += space(i);
        loop {
            let n = token(i);
            if n == 0 {
                return None;
            }
            let name = &value[i..i + n];
            i += n;
            i += space(i);
            let mut item = None;
            if s.get(i) == Some(&b'=') {
                i += 1;
                i += space(i);
                let mut v = token(i);
                if v == 0 {
                    v = crate::wire::quoted_string_length(s, i);
                }
                if v == 0 {
                    return None;
                }
                item = Some(&value[i..i + v]);
                i += v;
                i += space(i);
            }
            if found.is_none() && name.eq_ignore_ascii_case("charset") {
                found = Some(item);
            }
            if s.get(i) != Some(&b';') {
                break;
            }
            i += 1;
            i += space(i);
        }
    }
    // One value only: anything left, a comma too, fails.
    let (end, separator) = next(i);
    if separator || end < s.len() {
        return None;
    }
    found.flatten()
}

/// Encoding.GetString with .NET's replacement fallback: U+FFFD for bad
/// UTF-8, UTF-16 and UTF-32, '?' for ASCII past 0x7F.
fn decode(b: &[u8], page: CodePage) -> String {
    match page {
        CodePage::Ascii => b
            .iter()
            .map(|&c| if c < 0x80 { char::from(c) } else { '?' })
            .collect(),
        CodePage::Latin1 => b.iter().map(|&c| char::from(c)).collect(),
        CodePage::Utf16Le | CodePage::Utf16Be => {
            let units = b.as_chunks::<2>().0.iter().map(|&pair| {
                if page == CodePage::Utf16Le {
                    u16::from_le_bytes(pair)
                } else {
                    u16::from_be_bytes(pair)
                }
            });
            let mut out: String = char::decode_utf16(units)
                .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
                .collect();
            if !b.len().is_multiple_of(2) {
                out.push(char::REPLACEMENT_CHARACTER);
            }
            out
        }
        CodePage::Utf32Le | CodePage::Utf32Be => {
            let mut out: String = b
                .as_chunks::<4>()
                .0
                .iter()
                .map(|&q| {
                    let v = if page == CodePage::Utf32Le {
                        u32::from_le_bytes(q)
                    } else {
                        u32::from_be_bytes(q)
                    };
                    char::from_u32(v).unwrap_or(char::REPLACEMENT_CHARACTER)
                })
                .collect();
            if !b.len().is_multiple_of(4) {
                out.push(char::REPLACEMENT_CHARACTER);
            }
            out
        }
        // One U+FFFD per maximal ill-formed subpart, as .NET does.
        CodePage::Utf8 | CodePage::Utf7 => String::from_utf8_lossy(b).into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use crate::test_json::{field, items, load, text};

    // The twin of C#'s BodyTextMatchesTheFixture.
    #[test]
    fn body_text_matches_the_fixture() {
        let fixture = load("outbound-body-text.json");
        let cases = items(field(&fixture, "cases"));
        let answers = items(field(&fixture, "answers"));
        assert!(!cases.is_empty() && cases.len() == answers.len());
        for (case, answer) in cases.iter().zip(answers) {
            let body = text(field(case, "body")).unwrap();
            let bytes: Vec<u8> = (0..body.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&body[i..i + 2], 16).unwrap())
                .collect();
            let content_type = text(field(case, "contentType"));
            let got = match super::body_text(&bytes, content_type.as_deref()) {
                Ok(text) => text.bytes().map(|b| format!("{b:02x}")).collect::<String>(),
                Err(super::BodyTextError::BadCharset) => "InvalidOperationException".to_owned(),
                Err(super::BodyTextError::Utf7) => "NotSupportedException".to_owned(),
            };
            let want = text(field(answer, "text"))
                .or_else(|| text(field(answer, "error")))
                .unwrap();
            assert_eq!(got, want, "{body} {content_type:?}");
        }
    }
}
