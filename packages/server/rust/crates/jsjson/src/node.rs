use std::collections::HashSet;

use crate::error::{Error, ErrorKind};
use crate::str::{Str, append_utf8, compare, has_lone, is_high, is_low};
use crate::value::{UPPER_HEX, hex_escape, short_escape};

/// The JsonDocumentOptions C# passes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Options {
    /// Limits nested arrays and objects. 0 means 64, .NET's default.
    pub max_depth: usize,
    /// AllowDuplicateProperties = false.
    pub refuse_duplicates: bool,
}

/// A JSON token kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Null,
    False,
    True,
    Number,
    String,
    Array,
    Object,
}

/// JSON read the System.Text.Json way: keys keep their order and repeats,
/// numbers keep their text, and strings stay undecoded until read or
/// written, so a lone-surrogate escape fails late, as in C#.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub kind: Kind,
    pub(crate) raw: Vec<u8>,
    pub items: Vec<Node>,
    pub members: Vec<NodeMember>,
}

/// One object member.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeMember {
    pub(crate) raw: Vec<u8>,
    pub value: Node,
}

impl Node {
    pub(crate) fn leaf(kind: Kind, raw: Vec<u8>) -> Node {
        Node {
            kind,
            raw,
            items: Vec::new(),
            members: Vec::new(),
        }
    }

    /// A number's literal text, or a string's text between its quotes with
    /// escapes intact.
    pub fn raw(&self) -> &[u8] {
        &self.raw
    }

    /// Reads a string like JsonNode.GetValue<string>().
    pub fn text(&self) -> Result<Str, Error> {
        decode_strict(&self.raw)
    }
}

impl NodeMember {
    /// The member name with escapes intact.
    pub fn raw(&self) -> &[u8] {
        &self.raw
    }

    /// Reads a member name like JsonObject enumeration does.
    pub fn key(&self) -> Result<Str, Error> {
        decode_strict(&self.raw)
    }
}

/// Reads one JSON value like JsonNode.Parse(bytes, documentOptions).
pub fn parse_node(data: &[u8], options: Options) -> Result<Node, Error> {
    let mut p = Parser {
        data,
        pos: 0,
        max_depth: if options.max_depth == 0 {
            64
        } else {
            options.max_depth
        },
    };
    p.skip_space();
    let node = p.value(0)?;
    p.skip_space();
    if p.pos != data.len() {
        return Err(p.fail(ErrorKind::Invalid, "data after the value"));
    }
    // .NET checks repeats only once the whole text is valid JSON.
    if options.refuse_duplicates {
        node.check_duplicates()?;
    }
    Ok(node)
}

impl Node {
    /// Walks in document order. .NET compares unescaped UTF-8 bytes, so
    /// invalid bytes compare raw and a lone escape fails.
    fn check_duplicates(&self) -> Result<(), Error> {
        for item in &self.items {
            item.check_duplicates()?;
        }
        let mut seen = HashSet::new();
        for member in &self.members {
            let name = unescape_bytes(&member.raw)?;
            if seen.contains(&name) {
                return Err(Error::new(
                    ErrorKind::Duplicate,
                    format!("property {:?}", String::from_utf8_lossy(&name)),
                ));
            }
            seen.insert(name);
            member.value.check_duplicates()?;
        }
        Ok(())
    }
}

struct Parser<'a> {
    data: &'a [u8],
    pos: usize,
    max_depth: usize,
}

impl Parser<'_> {
    fn fail(&self, kind: ErrorKind, what: &str) -> Error {
        Error::new(kind, format!("{what} at byte {}", self.pos))
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn skip_space(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.peek() {
            self.pos += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Result<Node, Error> {
        let Some(c) = self.peek() else {
            return Err(self.fail(ErrorKind::Invalid, "missing value"));
        };
        match c {
            b'{' | b'[' => {
                if depth + 1 > self.max_depth {
                    let what = format!("depth over {}", self.max_depth);
                    return Err(self.fail(ErrorKind::Depth, &what));
                }
                if c == b'[' {
                    self.array(depth + 1)
                } else {
                    self.object(depth + 1)
                }
            }
            b'"' => Ok(Node::leaf(Kind::String, self.string()?.to_vec())),
            b't' => self.literal(b"true", Kind::True),
            b'f' => self.literal(b"false", Kind::False),
            b'n' => self.literal(b"null", Kind::Null),
            _ => self.number(),
        }
    }

    fn literal(&mut self, word: &[u8], kind: Kind) -> Result<Node, Error> {
        if !self.data[self.pos..].starts_with(word) {
            return Err(self.fail(ErrorKind::Invalid, "bad literal"));
        }
        self.pos += word.len();
        Ok(Node::leaf(kind, Vec::new()))
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.pos += 1;
        }
        self.pos - start
    }

    fn number(&mut self) -> Result<Node, Error> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        if self.peek() == Some(b'0') {
            self.pos += 1;
            if self.peek().is_some_and(|c| c.is_ascii_digit()) {
                return Err(self.fail(ErrorKind::Invalid, "leading zero"));
            }
        } else if self.digits() == 0 {
            return Err(self.fail(ErrorKind::Invalid, "not a value"));
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if self.digits() == 0 {
                return Err(self.fail(ErrorKind::Invalid, "no digits after the point"));
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.pos += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.pos += 1;
            }
            if self.digits() == 0 {
                return Err(self.fail(ErrorKind::Invalid, "no exponent digits"));
            }
        }
        Ok(Node::leaf(
            Kind::Number,
            self.data[start..self.pos].to_vec(),
        ))
    }

    /// The text between the quotes. Bytes of 0x80 and up are not checked
    /// here: .NET accepts invalid UTF-8 inside a string.
    fn string(&mut self) -> Result<&[u8], Error> {
        self.pos += 1;
        let start = self.pos;
        while let Some(c) = self.peek() {
            match c {
                b'"' => {
                    let raw = &self.data[start..self.pos];
                    self.pos += 1;
                    return Ok(raw);
                }
                0..0x20 => {
                    return Err(self.fail(ErrorKind::Invalid, "control character in a string"));
                }
                b'\\' => {
                    self.pos += 1;
                    match self.peek() {
                        None => return Err(self.fail(ErrorKind::Invalid, "unfinished escape")),
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {
                            self.pos += 1;
                        }
                        Some(b'u') => {
                            let hex = self.data.get(self.pos + 1..self.pos + 5);
                            if !hex.is_some_and(|h| h.iter().all(u8::is_ascii_hexdigit)) {
                                return Err(self.fail(ErrorKind::Invalid, "bad \\u escape"));
                            }
                            self.pos += 5;
                        }
                        Some(_) => return Err(self.fail(ErrorKind::Invalid, "bad escape")),
                    }
                }
                _ => self.pos += 1,
            }
        }
        Err(self.fail(ErrorKind::Invalid, "unfinished string"))
    }

    fn array(&mut self, depth: usize) -> Result<Node, Error> {
        let mut node = Node::leaf(Kind::Array, Vec::new());
        self.pos += 1;
        self.skip_space();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(node);
        }
        loop {
            self.skip_space();
            node.items.push(self.value(depth)?);
            self.skip_space();
            match self.peek() {
                None => return Err(self.fail(ErrorKind::Invalid, "unfinished array")),
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(node);
                }
                Some(_) => return Err(self.fail(ErrorKind::Invalid, "expected , or ]")),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Node, Error> {
        let mut node = Node::leaf(Kind::Object, Vec::new());
        self.pos += 1;
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(node);
        }
        loop {
            self.skip_space();
            if self.peek() != Some(b'"') {
                return Err(self.fail(ErrorKind::Invalid, "expected a property name"));
            }
            let raw = self.string()?.to_vec();
            self.skip_space();
            if self.peek() != Some(b':') {
                return Err(self.fail(ErrorKind::Invalid, "expected :"));
            }
            self.pos += 1;
            self.skip_space();
            let value = self.value(depth)?;
            node.members.push(NodeMember { raw, value });
            self.skip_space();
            match self.peek() {
                None => return Err(self.fail(ErrorKind::Invalid, "unfinished object")),
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(node);
                }
                Some(_) => return Err(self.fail(ErrorKind::Invalid, "expected , or }")),
            }
        }
    }
}

fn hex_value(b: &[u8]) -> u16 {
    b.iter().fold(0, |v, &c| {
        let digit = match c {
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => c - b'0',
        };
        v << 4 | u16::from(digit)
    })
}

fn unescape_short(c: u8) -> u16 {
    match c {
        b'b' => 0x08,
        b'f' => 0x0c,
        b'n' => 0x0a,
        b'r' => 0x0d,
        b't' => 0x09,
        _ => u16::from(c),
    }
}

/// Reads a validated string the JS way: escapes become units (a lone
/// surrogate stays one) and invalid UTF-8 becomes U+FFFD. Reports whether
/// any byte was invalid.
pub(crate) fn decode_js(raw: &[u8]) -> (Str, bool) {
    let mut units = Vec::with_capacity(raw.len());
    let mut invalid = false;
    let mut i = 0;
    while i < raw.len() {
        if raw[i] != b'\\' {
            let end = raw[i..]
                .iter()
                .position(|&c| c == b'\\')
                .map_or(raw.len(), |at| i + at);
            invalid |= append_utf8(&mut units, &raw[i..end]);
            i = end;
            continue;
        }
        if raw[i + 1] == b'u' {
            units.push(hex_value(&raw[i + 2..i + 6]));
            i += 6;
            continue;
        }
        units.push(unescape_short(raw[i + 1]));
        i += 2;
    }
    (Str(units), invalid)
}

/// Reads a string the way .NET materialises one.
fn decode_strict(raw: &[u8]) -> Result<Str, Error> {
    let (units, invalid) = decode_js(raw);
    if has_lone(&units) {
        return Err(Error::new(ErrorKind::LoneSurrogate, ""));
    }
    if invalid {
        return Err(Error::new(ErrorKind::InvalidUtf8, ""));
    }
    Ok(units)
}

/// Reads a string the way .NET writes one: a lone escape fails, invalid
/// UTF-8 is replaced.
pub(crate) fn decode_for_write(raw: &[u8]) -> Result<Str, Error> {
    let (units, _) = decode_js(raw);
    if has_lone(&units) {
        return Err(Error::new(ErrorKind::LoneSurrogate, ""));
    }
    Ok(units)
}

/// Turns escapes into UTF-8 and leaves other bytes as they are.
fn unescape_bytes(raw: &[u8]) -> Result<Vec<u8>, Error> {
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] != b'\\' {
            out.push(raw[i]);
            i += 1;
            continue;
        }
        if raw[i + 1] != b'u' {
            out.push(unescape_short(raw[i + 1]) as u8);
            i += 2;
            continue;
        }
        let unit = hex_value(&raw[i + 2..i + 6]);
        i += 6;
        let low = (is_high(unit) && i + 6 <= raw.len() && raw[i] == b'\\' && raw[i + 1] == b'u')
            .then(|| hex_value(&raw[i + 2..i + 6]))
            .filter(|&low| is_low(low));
        let mut units = Vec::with_capacity(2);
        if let Some(low) = low {
            units.extend([unit, low]);
            i += 6;
        } else if is_high(unit) || is_low(unit) {
            return Err(Error::new(ErrorKind::LoneSurrogate, ""));
        } else {
            units.push(unit);
        }
        let c = char::decode_utf16(units)
            .next()
            .and_then(Result::ok)
            .expect("scalar value");
        let mut buf = [0u8; 4];
        out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
    }
    Ok(out)
}

impl Node {
    /// Writes the node like JsonNode.ToJsonString() with default options. On
    /// error `dst` may hold part of the output.
    pub fn append_json(&self, dst: &mut Vec<u8>) -> Result<(), Error> {
        self.append_net(dst, false)
    }

    /// Writes the node like CollabEditOps.WriteCanonicalNode: object keys
    /// sorted by UTF-16 units, everything else as `append_json`.
    pub fn append_canonical(&self, dst: &mut Vec<u8>) -> Result<(), Error> {
        self.append_net(dst, true)
    }

    fn append_net(&self, dst: &mut Vec<u8>, sorted: bool) -> Result<(), Error> {
        match self.kind {
            Kind::Null => dst.extend_from_slice(b"null"),
            Kind::True => dst.extend_from_slice(b"true"),
            Kind::False => dst.extend_from_slice(b"false"),
            Kind::Number => dst.extend_from_slice(&self.raw),
            Kind::String => append_quoted(dst, &decode_for_write(&self.raw)?),
            Kind::Array => {
                dst.push(b'[');
                for (i, item) in self.items.iter().enumerate() {
                    if i > 0 {
                        dst.push(b',');
                    }
                    item.append_net(dst, sorted)?;
                }
                dst.push(b']');
            }
            Kind::Object => {
                let mut entries = Vec::with_capacity(self.members.len());
                let mut seen = HashSet::new();
                for member in &self.members {
                    let key = if sorted {
                        // Enumerating a JsonObject reads every key and
                        // builds a dictionary, so a bad or repeated key
                        // fails here.
                        let key = decode_strict(&member.raw)?;
                        if !seen.insert(key.clone()) {
                            return Err(Error::new(ErrorKind::Duplicate, format!("{key:?}")));
                        }
                        key
                    } else {
                        decode_for_write(&member.raw)?
                    };
                    entries.push((key, &member.value));
                }
                if sorted {
                    entries.sort_by(|a, b| compare(&a.0, &b.0));
                }
                dst.push(b'{');
                for (i, (key, value)) in entries.iter().enumerate() {
                    if i > 0 {
                        dst.push(b',');
                    }
                    append_quoted(dst, key);
                    dst.push(b':');
                    value.append_net(dst, sorted)?;
                }
                dst.push(b'}');
            }
        }
        Ok(())
    }
}

/// Writes `s` like Utf8JsonWriter with the default encoder: only printable
/// ASCII outside "&'+<>`\ is raw; the rest is \uXXXX in uppercase, with \b
/// \t \n \f \r \\ short. A lone surrogate becomes �. The output is
/// pure ASCII, so its byte length is its UTF-16 length.
pub fn append_quoted(dst: &mut Vec<u8>, s: &[u16]) {
    dst.push(b'"');
    let mut i = 0;
    while i < s.len() {
        let unit = s[i];
        if unit == u16::from(b'\\') {
            dst.extend_from_slice(b"\\\\");
        } else if unit < 0x20 {
            match short_escape(unit) {
                Some(short) => dst.extend_from_slice(short.as_bytes()),
                None => dst.extend_from_slice(&hex_escape(unit, UPPER_HEX)),
            }
        } else if unit < 0x7f && !is_html_sensitive(unit) {
            dst.push(unit as u8);
        } else if is_high(unit) && i + 1 < s.len() && is_low(s[i + 1]) {
            dst.extend_from_slice(&hex_escape(unit, UPPER_HEX));
            dst.extend_from_slice(&hex_escape(s[i + 1], UPPER_HEX));
            i += 1;
        } else if is_high(unit) || is_low(unit) {
            dst.extend_from_slice(&hex_escape(0xfffd, UPPER_HEX));
        } else {
            dst.extend_from_slice(&hex_escape(unit, UPPER_HEX));
        }
        i += 1;
    }
    dst.push(b'"');
}

fn is_html_sensitive(unit: u16) -> bool {
    matches!(
        u8::try_from(unit),
        Ok(b'"' | b'&' | b'\'' | b'+' | b'<' | b'>' | b'`')
    )
}
