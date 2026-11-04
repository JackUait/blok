//! Stores uploaded files: in a local directory (and, once ported, in S3).
//! Keys are 32 random lowercase hex digits plus a normalized extension, as
//! in C#'s BlobKey.

use std::fmt;
use std::future::Future;
use std::io;
use std::pin::Pin;

use tokio::io::AsyncRead;

mod local;

pub use local::Local;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Why a store call failed.
#[derive(Debug)]
pub enum Error {
    /// A delete for a URL this store did not issue.
    Foreign,
    /// The caller went away mid-call.
    Cancelled,
    Io(io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Foreign => f.write_str("blob: the URL was not issued by this store"),
            Self::Cancelled => f.write_str("blob: cancelled"),
            Self::Io(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Polled before each step; true stops the call with [`Error::Cancelled`].
pub type Cancelled<'a> = &'a (dyn Fn() -> bool + Send + Sync);

/// IBlobStore.
pub trait Store: Send + Sync {
    /// Stores content and returns its public URL.
    fn put<'a>(
        &'a self,
        extension: &'a str,
        mime_type: &'a str,
        content: &'a mut (dyn AsyncRead + Unpin + Send),
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, Error>>;

    /// Removes the file behind url; [`Error::Foreign`] for a URL it never
    /// issued.
    fn delete<'a>(
        &'a self,
        url: &'a str,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), Error>>;
}

const HEX_LENGTH: usize = 32;
const MAX_EXTENSION_LENGTH: usize = 15;

/// BlobKey.Create.
pub fn new_key(extension: &str) -> String {
    let mut random = [0u8; HEX_LENGTH / 2];
    getrandom::fill(&mut random).expect("the OS random source failed");
    let mut key: String = random.iter().map(|b| format!("{b:02x}")).collect();
    key.push_str(&normalize_extension(extension));
    key
}

/// Keeps "." plus 1 to 15 ASCII letters and digits, lowercased, and drops
/// anything else.
pub fn normalize_extension(extension: &str) -> String {
    let bytes = extension.as_bytes();
    if bytes.len() < 2
        || bytes.len() > MAX_EXTENSION_LENGTH + 1
        || bytes[0] != b'.'
        || !bytes[1..].iter().all(u8::is_ascii_alphanumeric)
    {
        return String::new();
    }
    extension.to_ascii_lowercase()
}

/// Whether key has the shape [`new_key`] makes.
pub fn is_generated(key: &str) -> bool {
    let bytes = key.as_bytes();
    if bytes.len() < HEX_LENGTH
        || !bytes[..HEX_LENGTH]
            .iter()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c))
    {
        return false;
    }
    // A multi-byte char could straddle byte 32; such a key is not generated.
    let Some(extension) = key.get(HEX_LENGTH..) else {
        return false;
    };
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
