use std::fmt;
use std::io;

#[derive(Debug)]
pub enum Error {
    /// The caller cancelled; Go's context.Canceled.
    Canceled,
    /// A deadline passed; Go's context.DeadlineExceeded.
    DeadlineExceeded,
    /// C#'s ArgumentException or InvalidOperationException; the text is C#'s.
    Refused(String),
    Io(io::Error),
    Store(StoreError),
    /// An object store's own failure.
    Other(Box<dyn std::error::Error + Send + Sync>),
}

impl Error {
    fn is_cancellation(&self) -> bool {
        matches!(self, Error::Canceled | Error::DeadlineExceeded)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Canceled => f.write_str("context canceled"),
            Error::DeadlineExceeded => f.write_str("context deadline exceeded"),
            Error::Refused(message) => f.write_str(message),
            Error::Io(err) => err.fmt(f),
            Error::Store(err) => err.fmt(f),
            Error::Other(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(err) => Some(err),
            Error::Store(err) => Some(&*err.source),
            Error::Other(err) => Some(&**err),
            _ => None,
        }
    }
}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Self {
        Error::Io(err)
    }
}

/// CollabWorkingSetStoreException.
#[derive(Debug)]
pub struct StoreError {
    pub doc_id: String,
    pub what: String,
    pub source: Box<Error>,
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "collab: the working-set {} for \"{}\" failed: {}",
            self.what, self.doc_id, self.source
        )
    }
}

/// GuardAsync: a store timeout looks like a cancellation, and the room would
/// take it for its own shutdown and skip its failure handling. So a
/// cancellation the caller did not ask for becomes a StoreError.
pub fn guard<T>(
    caller_cancelled: bool,
    doc_id: &str,
    what: &str,
    result: Result<T, Error>,
) -> Result<T, Error> {
    match result {
        Err(err) if !caller_cancelled && err.is_cancellation() => Err(Error::Store(StoreError {
            doc_id: doc_id.to_owned(),
            what: what.to_owned(),
            source: Box::new(err),
        })),
        other => other,
    }
}
