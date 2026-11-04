use std::fmt;
use std::io;

/// The failures C# throws, one variant per exception kind the store raises.
#[derive(Debug)]
pub enum Error {
    /// CollabOperationFenceLostException: another process took the
    /// document, so this session may no longer write or answer.
    FenceLost,
    /// ObjectDisposedException: the session was closed.
    Closed,
    /// The caller's cancel token fired before the call wrote anything.
    Canceled,
    /// ArgumentException (`out_of_range`: ArgumentOutOfRangeException), with
    /// C#'s message and without .NET's parameter suffix.
    Argument {
        message: String,
        out_of_range: bool,
    },
    /// InvalidOperationException: a caller error, such as appending to a
    /// document that was never seeded.
    InvalidOperation(String),
    /// InvalidDataException: the bytes on disk are not what this build
    /// writes. The message is C#'s, word for word; `source` is the cause
    /// when there is one, such as a missing file.
    InvalidData {
        message: String,
        source: Option<io::Error>,
    },
    /// The session could not undo a failed flush and no longer answers.
    Faulted(String),
    Io(io::Error),
}

impl Error {
    pub(crate) fn argument(message: impl Into<String>) -> Error {
        Error::Argument {
            message: message.into(),
            out_of_range: false,
        }
    }

    pub(crate) fn out_of_range(message: impl Into<String>) -> Error {
        Error::Argument {
            message: message.into(),
            out_of_range: true,
        }
    }

    pub(crate) fn invalid_data(message: impl Into<String>) -> Error {
        Error::InvalidData {
            message: message.into(),
            source: None,
        }
    }

    /// An InvalidData caused by a missing file.
    pub fn is_missing_file(&self) -> bool {
        matches!(self, Error::InvalidData { source: Some(err), .. } if err.kind() == io::ErrorKind::NotFound)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::FenceLost => f.write_str(
                "collab: the operation-store session no longer holds the document fence",
            ),
            Error::Closed => f.write_str("collab: the operation-store session is closed"),
            Error::Canceled => f.write_str("context canceled"),
            Error::Argument { message, .. }
            | Error::InvalidOperation(message)
            | Error::InvalidData { message, .. }
            | Error::Faulted(message) => f.write_str(message),
            Error::Io(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::InvalidData {
                source: Some(err), ..
            }
            | Error::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Error {
        Error::Io(err)
    }
}
