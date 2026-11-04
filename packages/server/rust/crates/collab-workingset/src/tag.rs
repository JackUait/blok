use std::fmt;

/// Rich text as HTML in a plain Y.Text; a room in it is migrated on open.
pub const HTML_RICH_TEXT_FORMAT: i32 = 1;
/// Rich text as formatted Y.XmlText, the only format the server writes.
pub const CURRENT_FORMAT: i32 = 2;
/// The lineage length in hex characters.
pub const LINEAGE_LENGTH: usize = 32;
/// What a room holds before it loads.
pub const NO_LINEAGE: &str = "";

/// CollabWorkingSetTag: the schema format, the reset count and the history id.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct Tag {
    pub format: i32,
    pub epoch: i64,
    pub lineage: String,
}

/// Matches the C# record's ToString, which refusal messages carry.
impl fmt::Display for Tag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "CollabWorkingSetTag {{ Format = {}, Epoch = {}, Lineage = {} }}",
            self.format, self.epoch, self.lineage
        )
    }
}

impl Tag {
    /// A tag that may be persisted or sent to a client.
    pub fn is_announceable(&self) -> bool {
        self.format >= 1 && self.epoch >= 0 && is_lineage(&self.lineage)
    }
}

/// Mints 16 random bytes as lower hex.
pub fn new_lineage() -> String {
    let mut raw = [0u8; LINEAGE_LENGTH / 2];
    getrandom::fill(&mut raw).expect("the OS random source failed");
    crate::codec::lower_hex(&raw)
}

/// 32 lower-hex characters: the client compares lineages as strings.
pub fn is_lineage(value: &str) -> bool {
    value.len() == LINEAGE_LENGTH
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
