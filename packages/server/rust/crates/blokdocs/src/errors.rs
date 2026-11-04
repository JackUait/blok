use std::fmt;

use blok_jsruntime::{ConstraintError, Failure, InvokeError, Kind};

/// Why a conversion could not finish. The values match C#
/// BlokConversionFailure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// Anything the runtime could not place, the stack limit included.
    Unknown,
    /// Input that is not a usable document: not JSON, JSON nested past 64
    /// levels on an envelope operation, a lone-surrogate escape on one, or no
    /// blocks array.
    InvalidDocument,
    TimedOut,
    /// A conversion that ran past its memory budget.
    DocumentTooLarge,
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Reason::Unknown => "Unknown",
            Reason::InvalidDocument => "InvalidDocument",
            Reason::TimedOut => "TimedOut",
            Reason::DocumentTooLarge => "DocumentTooLarge",
        })
    }
}

/// A conversion that failed. Branch on `reason`; the message is fixed per
/// reason.
#[derive(Debug)]
pub struct ConversionError {
    pub reason: Reason,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl fmt::Display for ConversionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.reason {
            Reason::InvalidDocument => "This is not a usable Blok document.",
            Reason::TimedOut => "Converting this document ran past the runtime's timeout.",
            Reason::DocumentTooLarge => {
                "Converting this document ran past the runtime's per-call allocation budget."
            }
            Reason::Unknown => "The Blok runtime could not convert this document.",
        })
    }
}

/// A runtime answer the host could not read: C#'s
/// InvalidOperationException, or its JsonException when `not_json` is set.
/// The shipped bundle never gives one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnswerError {
    pub message: String,
    pub not_json: bool,
}

impl fmt::Display for AnswerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.not_json {
            return f.write_str("The Blok runtime answered with JSON the host could not read.");
        }
        f.write_str(&self.message)
    }
}

/// Every way a Converter method fails. A caller's own cancellation is
/// dropping the future, never an error.
#[derive(Debug)]
pub enum Error {
    Conversion(ConversionError),
    /// A missing map or list where C# throws ArgumentNullException. The
    /// check runs before the document is read.
    NullArgument {
        name: &'static str,
    },
    /// A translation list whose length does not match the document's
    /// translatable strings. The numbers are the runtime's, as written.
    TextCount {
        expected: String,
        received: String,
    },
    /// Id maps that do not cover a page document.
    UnmappedIds {
        missing_block_ids: Vec<String>,
        duplicate_block_ids: Vec<String>,
        idless_blocks: i32,
    },
    Answer(AnswerError),
    Constraint(ConstraintError),
}

impl Error {
    /// The argument a C# ArgumentException names, for the argument errors.
    pub fn param(&self) -> Option<&'static str> {
        match self {
            Error::NullArgument { name } => Some(name),
            Error::TextCount { .. } => Some("texts"),
            Error::UnmappedIds { .. } => Some("blockIds"),
            _ => None,
        }
    }
}

fn quoted(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("\"{id}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Conversion(err) => err.fmt(f),
            Error::NullArgument { .. } => f.write_str("Value cannot be null."),
            Error::TextCount { expected, received } => write!(
                f,
                "This document yields {expected} translatable strings, but {received} were given."
            ),
            Error::UnmappedIds {
                missing_block_ids,
                duplicate_block_ids,
                idless_blocks,
            } => {
                let mut parts = Vec::new();
                if !missing_block_ids.is_empty() {
                    parts.push(format!("No new id for {}", quoted(missing_block_ids)));
                }
                if !duplicate_block_ids.is_empty() {
                    parts.push(format!(
                        "More than one block maps to {}",
                        quoted(duplicate_block_ids)
                    ));
                }
                if *idless_blocks > 0 {
                    parts.push(format!("{idless_blocks} block(s) without an id"));
                }
                write!(f, "{}.", parts.join("; "))
            }
            Error::Answer(err) => err.fmt(f),
            Error::Constraint(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Error {}

/// A bundle built without the VERSION define.
pub(crate) fn no_version() -> Error {
    Error::Answer(AnswerError {
        message:
            "The embedded Blok runtime reports no version; it was built without the VERSION define."
                .to_owned(),
        not_json: false,
    })
}

pub(crate) fn no_answer(what: &str) -> Error {
    Error::Answer(AnswerError {
        message: format!("The Blok runtime returned no {what}."),
        not_json: false,
    })
}

pub(crate) fn not_json() -> Error {
    Error::Answer(AnswerError {
        message: String::new(),
        not_json: true,
    })
}

pub(crate) fn invalid_operation(message: &str) -> Error {
    Error::Answer(AnswerError {
        message: message.to_owned(),
        not_json: false,
    })
}

pub(crate) fn invalid_document(source: blok_jsjson::Error) -> Error {
    Error::Conversion(ConversionError {
        reason: Reason::InvalidDocument,
        source: Some(Box::new(source)),
    })
}

/// A pool failure as a ConversionError; constraint errors pass through.
pub(crate) fn from_runtime(err: InvokeError) -> Error {
    match err {
        InvokeError::Failure(failure) => Error::Conversion(ConversionError {
            reason: reason_of(&failure),
            source: Some(Box::new(failure)),
        }),
        InvokeError::Constraint(err) => Error::Constraint(err),
    }
}

fn reason_of(failure: &Failure) -> Reason {
    match failure.kind {
        Kind::Unknown => Reason::Unknown,
        Kind::InvalidDocument => Reason::InvalidDocument,
        Kind::TimedOut => Reason::TimedOut,
        Kind::DocumentTooLarge => Reason::DocumentTooLarge,
    }
}
