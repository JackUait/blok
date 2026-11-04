use std::fmt;

use blok_jsruntime::InvokeError;
use blok_yjs::EngineError;

use crate::docconverter::TransientError;
use crate::editops::EditError;
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
    /// A refused edit request (C# CollabEditException).
    Edit(EditError),
    /// C#'s InvalidOperationException from ApplyOps: a step failed inside
    /// the transaction. Nothing was emitted, but what the step wrote stays
    /// in the doc, so it is a server error, not a refusal. Holds the cause.
    EditFailedMidWrite(Box<Error>),
    /// A plain Go `errors.New`.
    Message(String),
    /// A failure a retry may heal (C# CollabTransientException).
    Transient(TransientError),
}

/// Go's ErrEditFailedMidWrite text.
pub const EDIT_FAILED_MID_WRITE: &str = "collab: an edit failed while it was being written, and the document may hold part of it. Reload the document from the record.";

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
            Error::Edit(err) => err.fmt(f),
            Error::EditFailedMidWrite(err) => write!(f, "{EDIT_FAILED_MID_WRITE} ({err})"),
            Error::Message(message) => f.write_str(message),
            Error::Transient(err) => err.fmt(f),
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
            Error::Edit(err) => Some(err),
            Error::EditFailedMidWrite(err) => Some(err.as_ref()),
            Error::Message(_) => None,
            Error::Transient(err) => Some(err),
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

impl From<EditError> for Error {
    fn from(err: EditError) -> Error {
        Error::Edit(err)
    }
}
