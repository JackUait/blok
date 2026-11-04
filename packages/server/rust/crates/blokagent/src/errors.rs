use std::fmt;

use blok_blokdocs::{ConversionError, Reason};
use blok_jsjson::ErrorKind;
use blok_jsruntime::{ConstraintError, InvokeError, Kind};

use crate::cancel::CancelReason;

/// What C# throws. A batch the bundle refuses is never an error: it is an
/// Execution whose result has ok false.
#[derive(Debug)]
pub enum Error {
    /// Input or a runtime answer that is not JSON, where C# throws
    /// JsonException.
    Json(blok_jsjson::Error),
    /// Input the caller got wrong, as C# ArgumentException. The message has
    /// no " (Parameter '…')" suffix.
    Argument { param: String, message: String },
    /// An answer the host could not use, as C# InvalidOperationException.
    /// The shipped bundle never gives one.
    InvalidOperation(String),
    /// A runtime answer the room path cannot translate, as C#
    /// InvalidDataException.
    InvalidData(String),
    /// A runtime failure.
    Conversion(ConversionError),
    /// A per-call limit below its floor.
    Constraint(ConstraintError),
    /// The caller's own cancellation.
    Cancelled(CancelReason),
    /// A host callback's own failure, passed on unchanged.
    Host(Box<dyn std::error::Error + Send + Sync>),
    /// A live room's own failure, passed on unchanged.
    Room(blok_collab_room::Error),
}

impl Error {
    /// C#'s `error is OperationCanceledException`.
    pub fn is_cancel(&self) -> bool {
        match self {
            Error::Cancelled(_) => true,
            Error::Room(err) => blok_collab_room::is_cancellation(err),
            _ => false,
        }
    }
}

impl From<blok_collab_room::Error> for Error {
    /// The agent's own errors travel through the room boxed; they come back
    /// out as themselves.
    fn from(err: blok_collab_room::Error) -> Error {
        match err {
            blok_collab_room::Error::Other(inner) => match inner.downcast::<Error>() {
                Ok(own) => *own,
                Err(other) => Error::Room(blok_collab_room::Error::Other(other)),
            },
            // C# InvalidDataException, which nothing on the room path
            // catches: a value with no JSON form, such as a nested bigint.
            blok_collab_room::Error::Convert(blok_collab_convert::Error::Data(err)) => {
                Error::InvalidData(err.message)
            }
            other => Error::Room(other),
        }
    }
}

impl From<blok_collab_convert::Error> for Error {
    fn from(err: blok_collab_convert::Error) -> Error {
        Error::from(blok_collab_room::Error::Convert(err))
    }
}

impl From<blok_collab_docendpoint::Error> for Error {
    fn from(err: blok_collab_docendpoint::Error) -> Error {
        Error::Room(blok_collab_room::Error::Endpoint(err))
    }
}

impl From<blok_yjs::EngineError> for Error {
    fn from(err: blok_yjs::EngineError) -> Error {
        Error::Room(err.into())
    }
}

/// An agent error carried through a room plan, which returns room errors.
pub(crate) fn into_room(err: Error) -> blok_collab_room::Error {
    match err {
        Error::Room(err) => err,
        other => blok_collab_room::Error::Other(Box::new(other)),
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Json(err) => write!(f, "blokagent: not JSON: {err}"),
            Error::Argument { message, .. } => f.write_str(message),
            Error::InvalidOperation(message) | Error::InvalidData(message) => f.write_str(message),
            Error::Conversion(err) => err.fmt(f),
            Error::Constraint(err) => err.fmt(f),
            Error::Cancelled(CancelReason::Cancelled) => f.write_str("context canceled"),
            Error::Cancelled(CancelReason::DeadlineExceeded) => {
                f.write_str("context deadline exceeded")
            }
            Error::Host(err) => err.fmt(f),
            Error::Room(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

pub(crate) fn no_answer(what: &str) -> Error {
    Error::InvalidOperation(format!("The Blok runtime returned no {what}."))
}

pub(crate) fn invalid_operation(message: &str) -> Error {
    Error::InvalidOperation(message.to_owned())
}

/// A jsjson read or write failure as what C# throws there.
pub(crate) fn from_json(err: blok_jsjson::Error) -> Error {
    match err.kind() {
        // jsjson carries .NET's own message after its prefix.
        ErrorKind::Duplicate => {
            let text = err.to_string();
            let message = text
                .split_once("jsjson: duplicate property: ")
                .map_or(text.as_str(), |(_, message)| message)
                .to_owned();
            Error::Argument {
                param: "key".to_owned(),
                message,
            }
        }
        ErrorKind::LoneSurrogate => Error::InvalidOperation(
            "Cannot read incomplete UTF-16 JSON text as string with missing low surrogate."
                .to_owned(),
        ),
        _ => Error::Json(err),
    }
}

pub(crate) fn from_runtime(err: InvokeError) -> Error {
    match err {
        InvokeError::Failure(failure) => Error::Conversion(ConversionError {
            reason: match failure.kind {
                Kind::Unknown => Reason::Unknown,
                Kind::InvalidDocument => Reason::InvalidDocument,
                Kind::TimedOut => Reason::TimedOut,
                Kind::DocumentTooLarge => Reason::DocumentTooLarge,
            },
            source: Some(Box::new(failure)),
        }),
        InvokeError::Constraint(err) => Error::Constraint(err),
    }
}
