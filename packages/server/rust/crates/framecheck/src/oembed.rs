use blok_jsjson::{Kind, Node, Options, Str, append_quoted, parse_node};

// In UTF-16 units, like every other cap in the server.
const MAX_TEXT_LENGTH: usize = 256;
const MAX_SIZE: u32 = 4096;

/// C#'s OEmbedAnswer: the few oEmbed fields Blok passes on. The html field
/// never leaves the server (oEmbed §3 calls it an XSS vector). Empty and
/// zero fields are absent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OEmbed {
    pub title: Str,
    pub provider_name: Str,
    pub thumbnail_url: String,
    pub width: u32,
    pub height: u32,
}

impl OEmbed {
    /// Whether no field survived.
    pub fn is_empty(&self) -> bool {
        self.title.is_empty()
            && self.provider_name.is_empty()
            && self.thumbnail_url.is_empty()
            && self.width == 0
            && self.height == 0
    }

    /// Writes the fields that survived, as System.Text.Json would.
    pub fn append_json(&self, mut dst: Vec<u8>) -> Vec<u8> {
        dst.push(b'{');
        let mut comma = false;
        let mut field = |dst: &mut Vec<u8>, name: &str| {
            if comma {
                dst.push(b',');
            }
            comma = true;
            dst.extend_from_slice(format!("\"{name}\":").as_bytes());
        };
        if !self.title.is_empty() {
            field(&mut dst, "title");
            append_quoted(&mut dst, &self.title);
        }
        if !self.provider_name.is_empty() {
            field(&mut dst, "provider_name");
            append_quoted(&mut dst, &self.provider_name);
        }
        if !self.thumbnail_url.is_empty() {
            field(&mut dst, "thumbnail_url");
            append_quoted(&mut dst, &Str::from(self.thumbnail_url.as_str()));
        }
        if self.width != 0 {
            field(&mut dst, "width");
            dst.extend_from_slice(self.width.to_string().as_bytes());
        }
        if self.height != 0 {
            field(&mut dst, "height");
            dst.extend_from_slice(self.height.to_string().as_bytes());
        }
        dst.push(b'}');
        dst
    }
}

/// Reads an oEmbed JSON body the way C# does: JsonDocument rules, a
/// repeated name's last value winning even when it is not usable.
pub fn parse_oembed(body: &[u8]) -> OEmbed {
    let mut o = OEmbed::default();
    let Ok(root) = parse_node(body, Options::default()) else {
        return o;
    };
    if root.kind != Kind::Object {
        return o;
    }
    for member in &root.members {
        let Ok(key) = member.key() else {
            continue;
        };
        let value = &member.value;
        match key.to_string().as_str() {
            "title" => o.title = text(value),
            "provider_name" => o.provider_name = text(value),
            "thumbnail_url" => o.thumbnail_url = secure_url(value),
            "width" => o.width = size(value),
            "height" => o.height = size(value),
            _ => {}
        }
    }
    o
}

fn string(value: &Node) -> Option<Str> {
    if value.kind != Kind::String {
        return None;
    }
    value.text().ok()
}

fn text(value: &Node) -> Str {
    let Some(mut s) = string(value) else {
        return Str::new();
    };
    if s.len() > MAX_TEXT_LENGTH {
        let mut end = MAX_TEXT_LENGTH;
        if (0xd800..0xdc00).contains(&s[end - 1]) {
            end -= 1;
        }
        s.0.truncate(end);
    }
    s
}

fn secure_url(value: &Node) -> String {
    match string(value) {
        Some(s) => blok_outbound::browser_url(None, &s.to_string()),
        None => String::new(),
    }
}

/// ^[1-9][0-9]{0,8}$, then capped.
fn size(value: &Node) -> u32 {
    let raw = value.raw();
    if value.kind != Kind::Number
        || raw.is_empty()
        || raw.len() > 9
        || !(b'1'..=b'9').contains(&raw[0])
        || !raw.iter().all(u8::is_ascii_digit)
    {
        return 0;
    }
    let n: u32 = std::str::from_utf8(raw).unwrap().parse().unwrap();
    n.min(MAX_SIZE)
}
