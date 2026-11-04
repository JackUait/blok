//! Reads link-preview metadata out of an HTML page the way C#'s
//! UnfurlMetadataParser does: HTML5 tree building, a depth cut at 512,
//! Open Graph first, then Twitter, then the plain tags.

mod dom;
mod parse;

pub use parse::{Metadata, parse};

#[cfg(test)]
mod csharp_parser_test;
#[cfg(test)]
mod parse_test;
#[cfg(test)]
mod test_json;
