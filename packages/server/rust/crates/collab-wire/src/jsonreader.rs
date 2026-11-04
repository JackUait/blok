//! Utf8JsonReader with default options over one final block, as far as
//! SyncWire looks: no comments, no trailing commas, depth 64, one top-level
//! value. Read validates the grammar but not UTF-8 inside strings.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Token {
    None,
    StartObject,
    EndObject,
    StartArray,
    EndArray,
    PropertyName,
    String,
    Number,
    True,
    False,
    Null,
}

/// A JsonException: text Utf8JsonReader refuses.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct JsonError;

/// GetString's InvalidOperationException: invalid UTF-8 or a lone-surrogate
/// escape. Read accepts both.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TextError;

/// JsonReaderOptions.MaxDepth's default.
pub(crate) const MAX_DEPTH: usize = 64;

pub(crate) struct JsonReader<'a> {
    data: &'a [u8],
    pos: usize,
    // b'{' or b'[' per open container.
    stack: Vec<u8>,
    // A property name was read and its value is next.
    need_value: bool,
    // A value ended, so ',' or a closer comes next.
    after_value: bool,
    root_done: bool,
    pub(crate) token: Token,
    raw: &'a [u8],
    has_escape: bool,
}

type ReadResult = Result<bool, JsonError>;

impl<'a> JsonReader<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        JsonReader {
            data,
            pos: 0,
            stack: Vec::new(),
            need_value: false,
            after_value: false,
            root_done: false,
            token: Token::None,
            raw: &[],
            has_escape: false,
        }
    }

    fn skip_space(&mut self) {
        while self.pos < self.data.len()
            && matches!(self.data[self.pos], b' ' | b'\t' | b'\n' | b'\r')
        {
            self.pos += 1;
        }
    }

    /// Moves to the next token. Ok(false) only at the end of input after a
    /// complete value; Err where Read would throw.
    pub(crate) fn read(&mut self) -> ReadResult {
        self.skip_space();
        if self.root_done {
            return if self.pos == self.data.len() {
                Ok(false)
            } else {
                Err(JsonError)
            };
        }
        if self.pos == self.data.len() {
            return Err(JsonError);
        }
        let c = self.data[self.pos];
        let in_object = self.stack.last() == Some(&b'{');
        if self.need_value {
            self.need_value = false;
            return self.value();
        }
        if self.after_value {
            let closer = if in_object { b'}' } else { b']' };
            if c == closer {
                return Ok(self.close());
            }
            if c != b',' {
                return Err(JsonError);
            }
            self.pos += 1;
            self.skip_space();
            if self.pos == self.data.len() {
                return Err(JsonError);
            }
            self.after_value = false;
            return if in_object {
                self.property_name()
            } else {
                self.value()
            };
        }
        if self.stack.is_empty() {
            return self.value();
        }
        if in_object {
            if c == b'}' {
                return Ok(self.close());
            }
            return self.property_name();
        }
        if c == b']' {
            return Ok(self.close());
        }
        self.value()
    }

    fn close(&mut self) -> bool {
        let open = self.stack.pop().expect("a closer only follows an opener");
        self.pos += 1;
        self.token = if open == b'{' {
            Token::EndObject
        } else {
            Token::EndArray
        };
        self.end_value();
        true
    }

    fn end_value(&mut self) {
        if self.stack.is_empty() {
            self.root_done = true;
        } else {
            self.after_value = true;
        }
    }

    fn property_name(&mut self) -> ReadResult {
        if self.data[self.pos] != b'"' {
            return Err(JsonError);
        }
        self.string()?;
        self.skip_space();
        if self.pos == self.data.len() || self.data[self.pos] != b':' {
            return Err(JsonError);
        }
        self.pos += 1;
        self.token = Token::PropertyName;
        self.need_value = true;
        Ok(true)
    }

    fn value(&mut self) -> ReadResult {
        self.skip_space();
        if self.pos == self.data.len() {
            return Err(JsonError);
        }
        let c = self.data[self.pos];
        match c {
            b'{' | b'[' => {
                if self.stack.len() >= MAX_DEPTH {
                    return Err(JsonError);
                }
                self.stack.push(c);
                self.pos += 1;
                self.token = if c == b'{' {
                    Token::StartObject
                } else {
                    Token::StartArray
                };
                return Ok(true);
            }
            b'"' => {
                self.string()?;
                self.token = Token::String;
            }
            b'-' | b'0'..=b'9' => {
                self.number()?;
                self.token = Token::Number;
            }
            b't' => {
                self.literal(b"true")?;
                self.token = Token::True;
            }
            b'f' => {
                self.literal(b"false")?;
                self.token = Token::False;
            }
            b'n' => {
                self.literal(b"null")?;
                self.token = Token::Null;
            }
            _ => return Err(JsonError),
        }
        self.end_value();
        Ok(true)
    }

    fn literal(&mut self, word: &[u8]) -> Result<(), JsonError> {
        if !self.data[self.pos..].starts_with(word) {
            return Err(JsonError);
        }
        self.pos += word.len();
        self.delimiter()
    }

    // A number or literal must be followed by space, a structural character
    // or the end: "1x" and "truex" are refused at the token.
    fn delimiter(&self) -> Result<(), JsonError> {
        match self.data.get(self.pos) {
            None | Some(b' ' | b'\t' | b'\n' | b'\r' | b',' | b'}' | b']') => Ok(()),
            Some(_) => Err(JsonError),
        }
    }

    fn digit_at(&self, at: usize) -> bool {
        self.data.get(at).is_some_and(u8::is_ascii_digit)
    }

    fn number(&mut self) -> Result<(), JsonError> {
        let start = self.pos;
        if self.data[self.pos] == b'-' {
            self.pos += 1;
        }
        if !self.digit_at(self.pos) {
            return Err(JsonError);
        }
        if self.data[self.pos] == b'0' {
            self.pos += 1;
        } else {
            while self.digit_at(self.pos) {
                self.pos += 1;
            }
        }
        if self.data.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            if !self.digit_at(self.pos) {
                return Err(JsonError);
            }
            while self.digit_at(self.pos) {
                self.pos += 1;
            }
        }
        if matches!(self.data.get(self.pos), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.data.get(self.pos), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !self.digit_at(self.pos) {
                return Err(JsonError);
            }
            while self.digit_at(self.pos) {
                self.pos += 1;
            }
        }
        self.raw = &self.data[start..self.pos];
        self.has_escape = false;
        self.delimiter()
    }

    // Control characters and bad escapes throw; bytes above 0x7F pass
    // unchecked, as in Utf8JsonReader.
    fn string(&mut self) -> Result<(), JsonError> {
        let d = self.data;
        self.pos += 1;
        let start = self.pos;
        self.has_escape = false;
        while self.pos < d.len() {
            let c = d[self.pos];
            match c {
                b'"' => {
                    self.raw = &d[start..self.pos];
                    self.pos += 1;
                    return Ok(());
                }
                0..0x20 => return Err(JsonError),
                b'\\' => {
                    self.has_escape = true;
                    self.pos += 1;
                    match d.get(self.pos) {
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {
                            self.pos += 1
                        }
                        Some(b'u') => {
                            if d.len() - self.pos < 5
                                || !d[self.pos + 1..self.pos + 5]
                                    .iter()
                                    .all(u8::is_ascii_hexdigit)
                            {
                                return Err(JsonError);
                            }
                            self.pos += 5;
                        }
                        _ => return Err(JsonError),
                    }
                }
                _ => self.pos += 1,
            }
        }
        Err(JsonError)
    }

    /// Utf8JsonReader.Skip: on a property name or container start it reads
    /// past the matching value; on anything else it does nothing.
    pub(crate) fn skip(&mut self) -> Result<(), JsonError> {
        if self.token == Token::PropertyName {
            self.read()?;
        }
        if self.token != Token::StartObject && self.token != Token::StartArray {
            return Ok(());
        }
        let depth = self.stack.len();
        loop {
            self.read()?;
            if matches!(self.token, Token::EndObject | Token::EndArray) && self.stack.len() < depth
            {
                return Ok(());
            }
        }
    }

    // The token's bytes with escapes resolved. A \u escape that is a lone
    // surrogate is a TextError, like GetString.
    fn unescaped(&self) -> Result<Vec<u8>, TextError> {
        let raw = self.raw;
        if !self.has_escape {
            return Ok(raw.to_vec());
        }
        let mut out = Vec::with_capacity(raw.len());
        let mut i = 0;
        while i < raw.len() {
            let c = raw[i];
            if c != b'\\' {
                out.push(c);
                i += 1;
                continue;
            }
            i += 1;
            match raw[i] {
                b'b' => out.push(0x08),
                b'f' => out.push(0x0c),
                b'n' => out.push(b'\n'),
                b'r' => out.push(b'\r'),
                b't' => out.push(b'\t'),
                b'u' => {
                    let unit = hex_unit(&raw[i + 1..i + 5]);
                    i += 4;
                    let ch = if (0xd800..=0xdfff).contains(&unit) {
                        // A high half needs a \u low half right after it.
                        if unit >= 0xdc00
                            || i + 6 >= raw.len()
                            || raw[i + 1] != b'\\'
                            || raw[i + 2] != b'u'
                        {
                            return Err(TextError);
                        }
                        let low = hex_unit(&raw[i + 3..i + 7]);
                        if !(0xdc00..=0xdfff).contains(&low) {
                            return Err(TextError);
                        }
                        i += 6;
                        let code = 0x10000
                            + ((u32::from(unit) - 0xd800) << 10)
                            + (u32::from(low) - 0xdc00);
                        char::from_u32(code).expect("a surrogate pair is a scalar value")
                    } else {
                        char::from_u32(u32::from(unit))
                            .expect("a non-surrogate unit is a scalar value")
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                other => out.push(other),
            }
            i += 1;
        }
        Ok(out)
    }

    /// Utf8JsonReader.GetString for a string or property name.
    pub(crate) fn get_string(&self) -> Result<String, TextError> {
        String::from_utf8(self.unescaped()?).map_err(|_| TextError)
    }

    /// Compares the unescaped token with `text`; a token that cannot be
    /// unescaped equals nothing.
    pub(crate) fn value_text_equals(&self, text: &str) -> bool {
        if self.token != Token::PropertyName && self.token != Token::String {
            return false;
        }
        self.unescaped().is_ok_and(|b| b == text.as_bytes())
    }

    // The integer reads accept only an optional '-' and digits that fit:
    // "1.0", "1e2" and "-1" for unsigned all fail.
    pub(crate) fn try_get_i64(&self) -> Option<i64> {
        self.integer_text()?.parse().ok()
    }

    pub(crate) fn try_get_i32(&self) -> Option<i32> {
        self.integer_text()?.parse().ok()
    }

    pub(crate) fn try_get_u64(&self) -> Option<u64> {
        let text = self.integer_text()?;
        if text.starts_with('-') {
            return None;
        }
        text.parse().ok()
    }

    fn integer_text(&self) -> Option<&str> {
        if self.token != Token::Number {
            return None;
        }
        let ok = self
            .raw
            .iter()
            .enumerate()
            .all(|(i, &c)| c.is_ascii_digit() || (i == 0 && c == b'-'));
        if !ok {
            return None;
        }
        std::str::from_utf8(self.raw).ok()
    }
}

fn hex_unit(b: &[u8]) -> u16 {
    b.iter().fold(0u16, |acc, &c| {
        let digit = (c as char)
            .to_digit(16)
            .expect("str checked the hex digits");
        (acc << 4) | digit as u16
    })
}
