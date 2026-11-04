use std::fmt;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncSeek};

/// A seekable upload body: C#'s PreparedPayload hashes one in place.
pub trait Seekable: AsyncRead + AsyncSeek + Send + Unpin {}

impl<T: AsyncRead + AsyncSeek + Send + Unpin> Seekable for T {}

/// What an upload carries.
pub enum Body<'a> {
    Seekable(Box<dyn Seekable + 'a>),
    /// Its length is unknown until read, so S3 spools it.
    Stream(Box<dyn AsyncRead + Send + Unpin + 'a>),
}

impl Body<'_> {
    pub fn bytes(content: Vec<u8>) -> Body<'static> {
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
    /// The caller went away mid-call.
    Cancelled,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Foreign => f.write_str("blob: the URL was not issued by this store"),
            Error::Io(err) => err.fmt(f),
            Error::Message(message) => f.write_str(message),
            Error::DeadlineExceeded => f.write_str("context deadline exceeded"),
            Error::Cancelled => f.write_str("blob: cancelled"),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Self {
        Error::Io(err)
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Polled during a call; true stops it with [`Error::Cancelled`].
pub type Cancelled<'a> = &'a (dyn Fn() -> bool + Send + Sync);

/// IBlobStore.
pub trait Store: Send + Sync {
    /// Stores `content` and returns its public URL.
    fn put<'a>(
        &'a self,
        extension: &'a str,
        mime_type: &'a str,
        content: Body<'a>,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, Error>>;
    /// Removes the file behind `url`; `Error::Foreign` for a URL it never issued.
    fn delete<'a>(
        &'a self,
        url: &'a str,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), Error>>;
}

/// How often a network call looks at its cancel signal.
const CANCEL_POLL: Duration = Duration::from_millis(20);

/// Runs `work` until it ends or `cancelled` turns true.
pub(crate) async fn until_cancelled<T>(
    cancelled: Cancelled<'_>,
    work: impl Future<Output = Result<T, Error>>,
) -> Result<T, Error> {
    if cancelled() {
        return Err(Error::Cancelled);
    }
    let watch = async {
        loop {
            tokio::time::sleep(CANCEL_POLL).await;
            if cancelled() {
                return;
            }
        }
    };
    tokio::select! {
        result = work => result,
        () = watch => Err(Error::Cancelled),
    }
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
