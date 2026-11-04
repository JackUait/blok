//! Reads Content-Type values with the grammar of ASP.NET's
//! MediaTypeHeaderValue, which is not a strict RFC parser: it allows space
//! around "/", a parameter with no value, and repeated parameters.

use std::collections::HashMap;

/// One parameter; `value` keeps its quotes and escapes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Param {
    pub name: String,
    pub value: String,
}

/// MediaTypeHeaderValue.TryParse: the media type with spaces removed, and
/// its parameters.
pub fn parse(s: &str) -> Option<(String, Vec<Param>)> {
    let mut p = Parser {
        s: s.as_bytes(),
        i: 0,
    };
    p.space();
    let type_start = p.i;
    if !p.token() {
        return None;
    }
    p.space();
    if !p.eat(b'/') {
        return None;
    }
    p.space();
    if !p.token() {
        return None;
    }
    let media_type = s[type_start..p.i].replace([' ', '\t'], "");
    let mut params = Vec::new();
    loop {
        p.space();
        if p.i == s.len() {
            return Some((media_type, params));
        }
        if !p.eat(b';') {
            return None;
        }
        p.space();
        if p.i == s.len() {
            return Some((media_type, params));
        }
        let name_start = p.i;
        if !p.token() {
            return None;
        }
        let mut param = Param {
            name: s[name_start..p.i].to_owned(),
            value: String::new(),
        };
        p.space();
        if p.eat(b'=') {
            p.space();
            let value_start = p.i;
            if p.i < s.len() && p.s[p.i] == b'"' {
                if !p.quoted() {
                    return None;
                }
            } else {
                p.token();
            }
            // Every stop is after an ASCII byte or at the end, so the slice
            // is on char boundaries.
            param.value = s[value_start..p.i].to_owned();
        }
        params.push(param);
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn space(&mut self) {
        while self.i < self.s.len() && (self.s[self.i] == b' ' || self.s[self.i] == b'\t') {
            self.i += 1;
        }
    }

    fn eat(&mut self, c: u8) -> bool {
        if self.i < self.s.len() && self.s[self.i] == c {
            self.i += 1;
            return true;
        }
        false
    }

    fn token(&mut self) -> bool {
        let start = self.i;
        while self.i < self.s.len() && is_token_char(self.s[self.i]) {
            self.i += 1;
        }
        self.i > start
    }

    fn quoted(&mut self) -> bool {
        self.i += 1;
        while self.i < self.s.len() {
            match self.s[self.i] {
                b'\\' => self.i += 2,
                b'"' => {
                    self.i += 1;
                    return true;
                }
                _ => self.i += 1,
            }
        }
        false
    }
}

fn is_token_char(c: u8) -> bool {
    if c <= b' ' || c >= 0x7f {
        return false;
    }
    !b"()<>@,;:\\\"/[]?={}".contains(&c)
}

/// HeaderUtilities.RemoveQuotes.
fn remove_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"' {
        return &value[1..value.len() - 1];
    }
    value
}

/// UploadWire.UnquoteMediaParameter: quotes off, and a backslash dropped
/// only before a MIME special.
fn unquote_parameter(value: &str) -> String {
    let bytes = value.as_bytes();
    let quoted = bytes.len() >= 2 && bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"';
    let unquoted = remove_quotes(value);
    if !quoted || !unquoted.contains('\\') {
        return unquoted.to_owned();
    }
    let unquoted = unquoted.as_bytes();
    let mut out = Vec::with_capacity(unquoted.len());
    let mut i = 0;
    while i < unquoted.len() {
        if unquoted[i] == b'\\'
            && i + 1 < unquoted.len()
            && b"()<>@,;:\\\"/[]?=".contains(&unquoted[i + 1])
        {
            i += 1;
        }
        out.push(unquoted[i]);
        i += 1;
    }
    // Only an ASCII backslash before an ASCII byte is dropped.
    String::from_utf8_lossy(&out).into_owned()
}

/// A parameter named twice (any case) with two different unquoted values.
pub fn has_conflicting_parameters(params: &[Param]) -> bool {
    let mut seen: HashMap<String, String> = HashMap::new();
    for param in params {
        let name = param.name.to_ascii_lowercase();
        let value = unquote_parameter(&param.value);
        if seen.get(&name).is_some_and(|existing| *existing != value) {
            return true;
        }
        seen.insert(name, value);
    }
    false
}

/// UploadWire.SanitizeMediaType: the trimmed text when it parses and has no
/// conflicting parameters, else "". The length counts UTF-16 units, as C#
/// does.
pub fn sanitize_wire(value: &str) -> String {
    let candidate = value.trim();
    let length = candidate.encode_utf16().count();
    if length == 0 || length > 255 {
        return String::new();
    }
    match parse(candidate) {
        Some((_, params)) if !has_conflicting_parameters(&params) => candidate.to_owned(),
        _ => String::new(),
    }
}

/// The upload route's TryGetBoundary: a multipart/form-data type with no
/// conflicting parameters and a non-empty boundary, quotes removed.
pub fn boundary(content_type: &str) -> Option<String> {
    let (media_type, params) = parse(content_type)?;
    if !media_type.eq_ignore_ascii_case("multipart/form-data")
        || has_conflicting_parameters(&params)
    {
        return None;
    }
    let param = params
        .iter()
        .find(|param| param.name.eq_ignore_ascii_case("boundary"))?;
    let boundary = remove_quotes(&param.value);
    (!boundary.is_empty()).then(|| boundary.to_owned())
}

/// The JSON routes' check: application/json in any case with no conflicting
/// parameters.
pub fn is_json(content_type: &str) -> bool {
    parse(content_type).is_some_and(|(media_type, params)| {
        media_type.eq_ignore_ascii_case("application/json") && !has_conflicting_parameters(&params)
    })
}
