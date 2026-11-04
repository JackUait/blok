//! JS strings and the two JSON dialects the C# server speaks: JavaScript's
//! JSON.stringify/JSON.parse (C# Yjs/JsJson.cs, what a yjs peer reads), and
//! System.Text.Json's reader and default writer (what C# writes for digests,
//! caps and envelopes). Port of Go `internal/jsjson`.
//!
//! A JS string is a [`Str`]: UTF-16 code units, not WTF-8. C#, JS and yjs all
//! count, index, split and sort strings by UTF-16 units. A lone surrogate is a
//! legal unit that must survive a parse/stringify round trip.
//!
//! The fixtures under test/unit/server-conformance/fixtures/jsjson pin both
//! dialects; Blok.Server.Tests and the Go tests read the same files.

mod build;
mod error;
mod node;
mod number;
mod parse;
mod str;
mod value;

pub use build::{new_array, new_bool, new_member, new_null, new_number, new_object, new_string};
pub use error::{Error, ErrorKind};
pub use node::{Kind, Node, NodeMember, Options, append_quoted, parse_node};
pub use number::{NAN_BITS, format_number, nan};
pub use parse::{PARSE_MAX_DEPTH, parse};
pub use str::{Str, compare, to_string_lossy};
pub use value::{Member, Object, Value, key_order, stringify};
