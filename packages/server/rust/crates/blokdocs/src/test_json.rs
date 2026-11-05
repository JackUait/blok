//! A small JSON reader for the shared fixtures: serde_json is banned and
//! blok-jsjson is another lane's crate. Lone surrogates become U+FFFD, as Go's
//! encoding/json reads them.

#![allow(dead_code)]

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Map),
}

/// An object's members in file order, as C# reads them. Equality ignores
/// the order; a repeated key keeps its first place and its last value.
#[derive(Clone, Debug, Default)]
pub struct Map(Vec<(String, Json)>);

impl Map {
    pub fn get(&self, key: &str) -> Option<&Json> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &Json)> {
        self.0.iter().map(|(k, v)| (k, v))
    }

    pub fn insert(&mut self, key: String, value: Json) {
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(entry) => entry.1 = value,
            None => self.0.push((key, value)),
        }
    }
}

impl PartialEq for Map {
    fn eq(&self, other: &Map) -> bool {
        self.0.len() == other.0.len() && self.iter().all(|(k, v)| other.get(k) == Some(v))
    }
}

impl FromIterator<(String, Json)> for Map {
    fn from_iter<I: IntoIterator<Item = (String, Json)>>(items: I) -> Map {
        let mut map = Map::default();
        for (key, value) in items {
            map.insert(key, value);
        }
        map
    }
}

impl Json {
    pub fn get(&self, key: &str) -> &Json {
        match self {
            Json::Object(map) => map.get(key).unwrap_or_else(|| panic!("no key {key}")),
            other => panic!("{other:?} is not an object"),
        }
    }

    pub fn str(&self) -> &str {
        match self {
            Json::String(text) => text,
            other => panic!("{other:?} is not a string"),
        }
    }

    pub fn opt_str(&self) -> Option<&str> {
        match self {
            Json::Null => None,
            other => Some(other.str()),
        }
    }

    pub fn bool(&self) -> bool {
        match self {
            Json::Bool(value) => *value,
            other => panic!("{other:?} is not a bool"),
        }
    }

    pub fn number(&self) -> f64 {
        match self {
            Json::Number(value) => *value,
            other => panic!("{other:?} is not a number"),
        }
    }

    pub fn array(&self) -> &[Json] {
        match self {
            Json::Array(items) => items,
            other => panic!("{other:?} is not an array"),
        }
    }
}

pub fn parse(text: &str) -> Json {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        at: 0,
    };
    let value = parser.value();
    parser.space();
    assert_eq!(parser.at, parser.bytes.len(), "trailing bytes");
    value
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn space(&mut self) {
        while self.at < self.bytes.len() && b" \t\r\n".contains(&self.bytes[self.at]) {
            self.at += 1;
        }
    }

    fn expect(&mut self, literal: &str) {
        assert!(
            self.bytes[self.at..].starts_with(literal.as_bytes()),
            "expected {literal} at {}",
            self.at
        );
        self.at += literal.len();
    }

    fn value(&mut self) -> Json {
        self.space();
        match self.bytes[self.at] {
            b'n' => {
                self.expect("null");
                Json::Null
            }
            b't' => {
                self.expect("true");
                Json::Bool(true)
            }
            b'f' => {
                self.expect("false");
                Json::Bool(false)
            }
            b'"' => Json::String(self.string()),
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                self.space();
                if self.bytes[self.at] == b']' {
                    self.at += 1;
                    return Json::Array(items);
                }
                loop {
                    items.push(self.value());
                    self.space();
                    let next = self.bytes[self.at];
                    self.at += 1;
                    match next {
                        b',' => continue,
                        b']' => return Json::Array(items),
                        other => panic!("bad array byte {other}"),
                    }
                }
            }
            b'{' => {
                self.at += 1;
                let mut map = Map::default();
                self.space();
                if self.bytes[self.at] == b'}' {
                    self.at += 1;
                    return Json::Object(map);
                }
                loop {
                    self.space();
                    let key = self.string();
                    self.space();
                    self.expect(":");
                    let value = self.value();
                    map.insert(key, value);
                    self.space();
                    let next = self.bytes[self.at];
                    self.at += 1;
                    match next {
                        b',' => continue,
                        b'}' => return Json::Object(map),
                        other => panic!("bad object byte {other}"),
                    }
                }
            }
            _ => {
                let start = self.at;
                while self.at < self.bytes.len()
                    && b"+-.0123456789eE".contains(&self.bytes[self.at])
                {
                    self.at += 1;
                }
                let text = std::str::from_utf8(&self.bytes[start..self.at]).unwrap();
                Json::Number(text.parse().unwrap_or_else(|_| panic!("bad number {text}")))
            }
        }
    }

    fn hex4(&mut self) -> u32 {
        let text = std::str::from_utf8(&self.bytes[self.at..self.at + 4]).unwrap();
        self.at += 4;
        u32::from_str_radix(text, 16).unwrap()
    }

    fn string(&mut self) -> String {
        self.expect("\"");
        let mut out = Vec::new();
        loop {
            let byte = self.bytes[self.at];
            self.at += 1;
            match byte {
                b'"' => return String::from_utf8(out).unwrap(),
                b'\\' => {
                    let escape = self.bytes[self.at];
                    self.at += 1;
                    let decoded = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let unit = self.hex4();
                            if (0xd800..0xdc00).contains(&unit)
                                && self.bytes[self.at..].starts_with(b"\\u")
                            {
                                let save = self.at;
                                self.at += 2;
                                let low = self.hex4();
                                if (0xdc00..0xe000).contains(&low) {
                                    char::from_u32(
                                        0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00),
                                    )
                                    .unwrap()
                                } else {
                                    self.at = save;
                                    '\u{fffd}'
                                }
                            } else {
                                char::from_u32(unit).unwrap_or('\u{fffd}')
                            }
                        }
                        other => panic!("bad escape {other}"),
                    };
                    let mut buffer = [0; 4];
                    out.extend_from_slice(decoded.encode_utf8(&mut buffer).as_bytes());
                }
                other => out.push(other),
            }
        }
    }
}
