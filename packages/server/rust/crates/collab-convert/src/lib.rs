//! Turns Blok documents into Yjs docs and back, and plans and applies edits.
//! Port of Go `internal/collab/convert` (C# YDocConverter.cs,
//! CollabEditOps.cs, RichText*.cs, TextDiff.cs). One module per Go file.

mod error;
mod export;
mod fields;
mod graphemes;
mod graphemes_table;
mod htmlreader;
mod keys;
mod longestkept;
mod richtextinput;
mod textdiff;
mod textdiff_tables;

pub use error::Error;
pub use export::{DataError, RichTextHtml};
pub use fields::{FieldsError, RichTextFieldEntry, RichTextFields};
pub use htmlreader::{HtmlReader, Invoker, MAX_CALL_CHARS, MAX_EDIT_HTML_CHARS, RuntimeHtmlReader};
pub use keys::{DIFFABLE_TEXT_KEYS, ORDERED_ID_ARRAY_KEYS};
pub use longestkept::longest_kept_order;
pub use richtextinput::RichTextInput;
pub use textdiff::{MAX_DIFF_DISTANCE, TextEdit, atomize, diff};

#[cfg(test)]
mod csharp_graphemes_test;
#[cfg(test)]
mod csharp_textdiff_test;
#[cfg(test)]
mod fields_test;
#[cfg(test)]
mod htmlreader_test;
#[cfg(test)]
mod keys_test;
#[cfg(test)]
mod longestkept_test;
#[cfg(test)]
mod richtextinput_test;
#[cfg(test)]
mod textdiff_test;
