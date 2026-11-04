use std::fmt;

/// The error kinds C# tells apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// Text that is not JSON (JsonReaderException).
    Invalid,
    /// Nesting past `Options::max_depth` (JsonReaderException).
    Depth,
    /// A repeated key: at parse with `refuse_duplicates` (JsonException), or
    /// when the canonical writer or an index reads the object
    /// (ArgumentException).
    Duplicate,
    /// A `\ud800`-style escape with no partner, met when .NET reads the
    /// string (InvalidOperationException). `parse` accepts it.
    LoneSurrogate,
    /// A key with invalid UTF-8, met when .NET reads it as a string
    /// (InvalidOperationException). Writing replaces it.
    InvalidUtf8,
    /// Undefined at the top, or a value with no JS form (BigInt, bytes).
    NoJsonForm,
}

/// A jsjson error: its kind and a message with the position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    kind: ErrorKind,
    message: String,
}

impl Error {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Error {
        Error {
            kind,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> ErrorKind {
        self.kind
    }

    /// `errors.Is(err, kind)` in Go.
    pub fn is(&self, kind: ErrorKind) -> bool {
        self.kind == kind
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let prefix = match self.kind {
            ErrorKind::Invalid => "jsjson: invalid JSON",
            ErrorKind::Depth => "jsjson: maximum depth exceeded",
            ErrorKind::Duplicate => "jsjson: duplicate property",
            ErrorKind::LoneSurrogate => "jsjson: lone surrogate escape",
            ErrorKind::InvalidUtf8 => "jsjson: invalid UTF-8",
            ErrorKind::NoJsonForm => "jsjson: value has no JSON form",
        };
        if self.message.is_empty() {
            f.write_str(prefix)
        } else {
            write!(f, "{prefix}: {}", self.message)
        }
    }
}

impl std::error::Error for Error {}
