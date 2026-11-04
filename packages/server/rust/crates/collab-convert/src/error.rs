use std::fmt;

use blok_jsruntime::InvokeError;
use blok_yjs::EngineError;

use crate::export::DataError;

/// What the converter's fallible calls return, where Go returns `error`.
#[derive(Debug)]
pub enum Error {
    /// Data a reader refuses (C# InvalidDataException).
    Data(DataError),
    /// The embedded runtime refused or failed a call.
    Runtime(InvokeError),
    /// A value JS JSON has no form for.
    Json(blok_jsjson::Error),
    /// The engine refused an operation, where Go panics with *yjs.EngineError.
    Engine(EngineError),
    /// A string .NET cannot read (a lone-surrogate escape or invalid UTF-8):
    /// C#'s InvalidOperationException, not an InvalidDataException.
    NotUnicode(blok_jsjson::Error),
}

/// Go's ErrNotUnicode text.
pub const NOT_UNICODE: &str = "collab: the document holds text that is not valid Unicode";

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Data(err) => err.fmt(f),
            Error::Runtime(err) => err.fmt(f),
            Error::Json(err) => err.fmt(f),
            Error::Engine(err) => err.fmt(f),
            Error::NotUnicode(err) => write!(f, "{NOT_UNICODE}\n{err}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Data(err) => Some(err),
            Error::Runtime(err) => Some(err),
            Error::Json(err) => Some(err),
            Error::Engine(err) => Some(err),
            Error::NotUnicode(err) => Some(err),
        }
    }
}

impl From<DataError> for Error {
    fn from(err: DataError) -> Error {
        Error::Data(err)
    }
}

impl From<InvokeError> for Error {
    fn from(err: InvokeError) -> Error {
        Error::Runtime(err)
    }
}

impl From<blok_jsjson::Error> for Error {
    fn from(err: blok_jsjson::Error) -> Error {
        Error::Json(err)
    }
}

impl From<EngineError> for Error {
    fn from(err: EngineError) -> Error {
        Error::Engine(err)
    }
}
