//! The .NET parsers and formatters the C# server decides with:
//! IPAddress.TryParse, System.Uri, Uri.UnescapeDataString, double.ToString,
//! OrdinalIgnoreCase, the ASP.NET query and HTTP date readers, and ticks.
//! Rust's std reads the same text differently, and a security check that
//! reads a host differently from C# is a different check. Port of Go
//! `internal/dotnet`.

mod double;
mod httpdate;
mod idna;
mod ip;
mod native;
mod number;
mod ordinal;
mod query;
mod ticks;
mod uri;

pub use double::format_double;
pub use httpdate::parse_http_date;
pub use ip::{is_any, is_loopback, parse_ip, parse_ipv4, scope_id};
pub use native::native_text;
pub use number::parse_uint64_none;
pub use ordinal::{equals_ordinal_ignore_case, to_upper_invariant};
pub use query::{query_all, query_first};
pub use ticks::{MAX_TICKS, ticks, time_from_ticks};
pub use uri::{
    Uri, parse_absolute_uri, parses_as_uri, resolve_uri, resolve_uri_original, unescape_data_string,
};
