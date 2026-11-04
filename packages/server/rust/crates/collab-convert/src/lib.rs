//! Turns Blok documents into Yjs docs and back, and plans and applies edits.
//! Port of Go `internal/collab/convert` (C# YDocConverter.cs,
//! CollabEditOps.cs, RichText*.cs, TextDiff.cs). One module per Go file.

mod graphemes;
mod graphemes_table;
mod keys;
mod textdiff;
mod textdiff_tables;

pub use keys::{DIFFABLE_TEXT_KEYS, ORDERED_ID_ARRAY_KEYS};
pub use textdiff::{MAX_DIFF_DISTANCE, TextEdit, atomize, diff};

#[cfg(test)]
mod csharp_graphemes_test;
#[cfg(test)]
mod csharp_textdiff_test;
#[cfg(test)]
mod keys_test;
#[cfg(test)]
mod textdiff_test;
