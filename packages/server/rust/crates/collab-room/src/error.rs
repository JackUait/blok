use std::fmt;

use blok_collab_convert::{EditError, ReplayError};
use blok_jsruntime::{InvokeError, Kind};

/// The start of the purge refusal for a store that cannot purge.
pub const PURGE_UNSUPPORTED: &str = "the operation journal cannot purge documents";

/// What the room's fallible calls return, where Go returns `error`. The
/// classifiers walk the same wrappers Go's errors.As unwraps.
#[derive(Debug)]
pub enum Error {
    /// context.Canceled: the caller or the room's lifetime ended.
    Canceled,
    /// context.DeadlineExceeded: a bounded call ran past its bound.
    DeadlineExceeded,
    Convert(blok_collab_convert::Error),
    Journal(blok_collab_journal::Error),
    WorkingSet(blok_collab_workingset::Error),
    Endpoint(blok_collab_docendpoint::Error),
    Yjs(blok_yjs::Error),
    Replay(ReplayError),
    /// A plain Go errors.New / fmt.Errorf.
    Message(String),
    /// A message that keeps its cause for the classifiers.
    Wrapped {
        message: String,
        err: Box<Error>,
    },
    /// A store or replay failure the history answers Corrupt for.
    Corrupt(Box<Error>),
    /// CollabChangesExportException.
    ChangesExport(Box<Error>),
    /// ArgumentException.ThrowIfNullOrEmpty(documentId).
    EmptyDocId,
    /// The same refusal at the doors whose C# parameter is docId.
    EmptyDocIdArgument,
    /// ArgumentException.ThrowIfNullOrEmpty(operationId).
    EmptyOperationId,
    /// A purged id that is not one path segment.
    NotSingleSegment,
    PurgeNotAuthorized,
    /// The registered operation store cannot purge; holds its type name.
    PurgeUnsupported(String),
    /// A restore whose point is gone; the restore answers NotFound.
    RestorePointMissing,
    /// A host's own store failure.
    Other(Box<dyn std::error::Error + Send + Sync>),
}

impl Error {
    pub fn message(message: impl Into<String>) -> Error {
        Error::Message(message.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Canceled => f.write_str("context canceled"),
            Error::DeadlineExceeded => f.write_str("context deadline exceeded"),
            Error::Convert(err) => err.fmt(f),
            Error::Journal(err) => err.fmt(f),
            Error::WorkingSet(err) => err.fmt(f),
            Error::Endpoint(err) => err.fmt(f),
            Error::Yjs(err) => err.fmt(f),
            Error::Replay(err) => err.fmt(f),
            Error::Message(message) | Error::Wrapped { message, .. } => f.write_str(message),
            Error::Corrupt(err) => err.fmt(f),
            Error::ChangesExport(err) => {
                write!(
                    f,
                    "collab: a step of the history could not be exported: {err}"
                )
            }
            Error::EmptyDocId => {
                f.write_str("The value cannot be an empty string. (Parameter 'documentId')")
            }
            Error::EmptyDocIdArgument => {
                f.write_str("The value cannot be an empty string. (Parameter 'docId')")
            }
            Error::EmptyOperationId => {
                f.write_str("The value cannot be an empty string. (Parameter 'operationId')")
            }
            Error::NotSingleSegment => {
                f.write_str("collab: document ids must be a single path segment.")
            }
            Error::PurgeNotAuthorized => f.write_str("collab: document purge was not authorized."),
            Error::PurgeUnsupported(store) => write!(
                f,
                "{PURGE_UNSUPPORTED}: the registered collabstore.OperationStore ({store}) must also implement collabstore.PurgeStore"
            ),
            Error::RestorePointMissing => f.write_str("collab: the restore point is gone"),
            Error::Other(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

macro_rules! from {
    ($($variant:ident($ty:ty)),*) => {$(
        impl From<$ty> for Error {
            fn from(err: $ty) -> Error {
                Error::$variant(err)
            }
        }
    )*};
}

from!(
    Convert(blok_collab_convert::Error),
    Journal(blok_collab_journal::Error),
    WorkingSet(blok_collab_workingset::Error),
    Endpoint(blok_collab_docendpoint::Error),
    Yjs(blok_yjs::Error),
    Replay(ReplayError)
);

impl From<blok_yjs::EngineError> for Error {
    fn from(err: blok_yjs::EngineError) -> Error {
        Error::Convert(blok_collab_convert::Error::Engine(err))
    }
}

/// The room's errors one level down, as Unwrap gives them.
fn inner(err: &Error) -> Option<&Error> {
    match err {
        Error::Wrapped { err, .. } | Error::Corrupt(err) | Error::ChangesExport(err) => Some(err),
        _ => None,
    }
}

fn convert_chain(err: &Error) -> Option<&blok_collab_convert::Error> {
    let mut at = err;
    loop {
        if let Error::Convert(e) = at {
            return Some(e);
        }
        at = inner(at)?;
    }
}

fn convert_inner(err: &blok_collab_convert::Error) -> Option<&blok_collab_convert::Error> {
    use blok_collab_convert::Error as E;
    match err {
        E::Transient(t) => Some(&t.err),
        E::EditFailedMidWrite(cause) => Some(cause),
        E::Edit(EditError {
            err: Some(cause), ..
        }) => Some(cause),
        _ => None,
    }
}

fn any_convert(err: &Error, test: impl Fn(&blok_collab_convert::Error) -> bool) -> bool {
    let Some(mut at) = convert_chain(err) else {
        return false;
    };
    loop {
        if test(at) {
            return true;
        }
        match convert_inner(at) {
            Some(next) => at = next,
            None => return false,
        }
    }
}

/// CollabTransientException.
pub fn is_transient(err: &Error) -> bool {
    any_convert(err, |e| {
        matches!(e, blok_collab_convert::Error::Transient(_))
    })
}

/// OperationCanceledException, which a timeout is too.
pub fn is_cancellation(err: &Error) -> bool {
    let mut at = err;
    loop {
        match at {
            Error::Canceled
            | Error::DeadlineExceeded
            | Error::Journal(blok_collab_journal::Error::Canceled) => return true,
            _ => match inner(at) {
                Some(next) => at = next,
                None => return false,
            },
        }
    }
}

/// err as C# prints error.Message at a room log line. .NET words a cancel
/// by when it came: HttpClient, SemaphoreSlim and channels say "A task was
/// canceled." when the token was already cancelled as the call began, and
/// "The operation was canceled." when it was cancelled during the call
/// (DocEndpointClientTests.ACancelledSaveReadsAsDotNetsCancelText). A timeout
/// is a cancel during the call. With ctx given, only a cancel of ctx itself
/// counts; a store's own timeout keeps its own text. With no ctx, only a
/// bare cancel counts: a store that wraps one in its own error keeps its
/// own text, as C#'s error.Message does.
pub(crate) fn error_text(
    err: &Error,
    ctx: Option<&crate::Token>,
    cancelled_before: bool,
) -> String {
    let bare = matches!(
        err,
        Error::Canceled
            | Error::DeadlineExceeded
            | Error::Journal(blok_collab_journal::Error::Canceled)
            | Error::WorkingSet(blok_collab_workingset::Error::Canceled)
    );
    let cancelled = if ctx.is_some() {
        bare || is_cancellation(err)
    } else {
        bare
    };
    if !cancelled || ctx.is_some_and(|ctx| !ctx.is_cancelled()) {
        return err.to_string();
    }
    if cancelled_before {
        "A task was canceled.".to_owned()
    } else {
        "The operation was canceled.".to_owned()
    }
}

/// The runtime's own timeout or allocation budget.
pub(crate) fn is_runtime_limit(err: &Error) -> bool {
    any_convert(err, |e| {
        matches!(
            e,
            blok_collab_convert::Error::Runtime(InvokeError::Failure(f))
                if matches!(f.kind, Kind::TimedOut | Kind::DocumentTooLarge)
        )
    })
}

/// A history read failure the routes answer Corrupt for.
pub(crate) fn is_corrupt(err: &Error) -> bool {
    let mut at = err;
    loop {
        match at {
            Error::Corrupt(_)
            | Error::Replay(_)
            | Error::Journal(blok_collab_journal::Error::InvalidData { .. }) => return true,
            _ => match inner(at) {
                Some(next) => at = next,
                None => return false,
            },
        }
    }
}

#[cfg(test)]
mod error_text_test {
    use super::*;
    use crate::Token;

    #[test]
    fn a_cancel_reads_as_dot_nets_cancel_text() {
        let done = Token::new();
        done.cancel();
        let live = Token::new();
        assert_eq!(
            error_text(&Error::Canceled, Some(&done), true),
            "A task was canceled."
        );
        assert_eq!(
            error_text(&Error::Canceled, Some(&done), false),
            "The operation was canceled."
        );
        assert_eq!(
            error_text(&Error::DeadlineExceeded, None, false),
            "The operation was canceled."
        );
        // A store's own timeout while our token is live keeps its text.
        assert_eq!(
            error_text(&Error::DeadlineExceeded, Some(&live), false),
            "context deadline exceeded"
        );
        assert_eq!(
            error_text(&Error::message("s3 down"), Some(&done), true),
            "s3 down"
        );
    }
}
