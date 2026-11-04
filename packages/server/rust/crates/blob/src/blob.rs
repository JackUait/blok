use std::fmt;
use std::future::Future;
use std::io;

use tokio::io::{AsyncRead, AsyncSeek};

/// A seekable upload body: C#'s PreparedPayload hashes one in place.
pub trait Seekable: AsyncRead + AsyncSeek + Send + Unpin {}

impl<T: AsyncRead + AsyncSeek + Send + Unpin> Seekable for T {}

/// What an upload carries.
pub enum Body {
    Seekable(Box<dyn Seekable>),
    /// Its length is unknown until read, so S3 spools it.
    Stream(Box<dyn AsyncRead + Send + Unpin>),
}

impl Body {
    pub fn bytes(content: Vec<u8>) -> Body {
        Body::Seekable(Box::new(io::Cursor::new(content)))
    }
}

#[derive(Debug)]
pub enum Error {
    /// A delete for a URL this store did not issue (ForeignBlobUrlException).
    Foreign,
    Io(io::Error),
    /// A store failure; the text is C#'s.
    Message(String),
    /// The S3 request timeout passed.
    DeadlineExceeded,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Foreign => f.write_str("blob: the URL was not issued by this store"),
            Error::Io(err) => err.fmt(f),
            Error::Message(message) => f.write_str(message),
            Error::DeadlineExceeded => f.write_str("context deadline exceeded"),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Self {
        Error::Io(err)
    }
}

/// IBlobStore.
pub trait Store: Send + Sync {
    /// Stores `content` and returns its public URL.
    fn put(
        &self,
        extension: &str,
        mime_type: &str,
        content: Body,
    ) -> impl Future<Output = Result<String, Error>> + Send;
    /// Removes the file behind `url`; `Error::Foreign` for a URL it never issued.
    fn delete(&self, url: &str) -> impl Future<Output = Result<(), Error>> + Send;
}

const HEX_LENGTH: usize = 32;
const MAX_EXTENSION_LENGTH: usize = 15;

pub(crate) fn random_hex() -> String {
    let mut random = [0u8; HEX_LENGTH / 2];
    getrandom::fill(&mut random).expect("the system random source");
    random.iter().map(|b| format!("{b:02x}")).collect()
}

/// BlobKey.Create: 32 random lowercase hex digits plus a normalized extension.
pub fn new_key(extension: &str) -> String {
    random_hex() + &normalize_extension(extension)
}

/// Keeps "." plus 1 to 15 ASCII letters and digits, lowercased, and drops
/// anything else.
pub fn normalize_extension(extension: &str) -> String {
    let b = extension.as_bytes();
    if b.len() < 2
        || b.len() > MAX_EXTENSION_LENGTH + 1
        || b[0] != b'.'
        || !b[1..].iter().all(u8::is_ascii_alphanumeric)
    {
        return String::new();
    }
    extension.to_ascii_lowercase()
}

/// Whether `key` has the shape `new_key` makes.
pub fn is_generated(key: &str) -> bool {
    let b = key.as_bytes();
    if b.len() < HEX_LENGTH
        || !b[..HEX_LENGTH]
            .iter()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c))
    {
        return false;
    }
    let extension = &key[HEX_LENGTH..];
    extension.is_empty() || extension == normalize_extension(extension)
}

/// BlobKey.TryParsePublicUrl: an ordinal prefix match after the query and
/// fragment are cut off.
pub fn key_from_public_url(public_url: &str, raw_url: &str) -> Option<String> {
    let raw_url = match raw_url.find(['?', '#']) {
        Some(cut) => &raw_url[..cut],
        None => raw_url,
    };
    let prefix = format!("{}/", public_url.trim_end_matches('/'));
    let key = raw_url.strip_prefix(&prefix)?;
    is_generated(key).then(|| key.to_owned())
}

/// Path.GetExtension: the text from the last "." of the last path segment,
/// or "" when that "." ends the name.
pub fn extension(name: &str) -> &str {
    for (i, c) in name.bytes().enumerate().rev() {
        match c {
            b'.' if i == name.len() - 1 => return "",
            b'.' => return &name[i..],
            b'/' | b'\\' => return "",
            _ => {}
        }
    }
    ""
}
