//! Turns Blok documents into Yjs docs and back, and plans and applies edits.
//! Port of Go `internal/collab/convert` (C# YDocConverter.cs,
//! CollabEditOps.cs, RichText*.cs, TextDiff.cs). One module per Go file.

mod apply;
mod deepassign;
mod editops;
mod error;
mod export;
mod fields;
mod graphemes;
mod graphemes_table;
mod htmlreader;
mod keys;
mod longestkept;
mod richtext;
mod richtextedit;
mod richtextinput;
mod seed;
mod structure;
mod textdiff;
mod textdiff_tables;

pub use apply::{apply_ops, collect_ops_html};
pub use editops::{
    EditError, EditOp, JSON_MAX_DEPTH, MapPatch, canonical_body, canonical_body_digest,
    normalize_idempotency_key, parse_edit_ops, restore_digest,
};
pub use error::{EDIT_FAILED_MID_WRITE, Error, NOT_UNICODE};
pub use export::{
    DataError, MAX_VALUE_DEPTH, PAGE_MAPS, RichTextHtml, RichTextHtmlSlot, SlotStep, export,
    export_page, plain_json,
};
pub use fields::{FieldsError, RichTextFieldEntry, RichTextFields};
pub use htmlreader::{HtmlReader, Invoker, MAX_CALL_CHARS, MAX_EDIT_HTML_CHARS, RuntimeHtmlReader};
pub use keys::{DIFFABLE_TEXT_KEYS, ORDERED_ID_ARRAY_KEYS};
pub use longestkept::longest_kept_order;
pub use richtext::{
    WriteOp, canonical_marks, canonicalize, from_delta, is_rich_text, normalize, normalize_value,
    read_input, same_value, to_write_ops,
};
pub use richtextedit::{
    RichTextOp, RichTextTarget, apply_rich_text_ops, plan_rich_text_edit, same_json,
};
pub use richtextinput::RichTextInput;
pub use seed::{
    ROW_KEY_LENGTH, SourceNumber, SourceValue, collect_seed_html, generate_row_key, seed,
    source_object, strict_value,
};
pub use structure::{
    DocStructure, KeyShape, PageMap, PlainPageMap, describe_structure, is_plain_map_value,
    plain_map_values_equal, plain_page_maps, read_page_maps,
};
pub use textdiff::{MAX_DIFF_DISTANCE, TextEdit, atomize, diff};

#[cfg(test)]
mod agentops_test;
#[cfg(test)]
mod apply_test;
#[cfg(test)]
mod csharp_apply_test;
#[cfg(test)]
mod csharp_editops_test;
#[cfg(test)]
mod csharp_export_test;
#[cfg(test)]
mod csharp_graphemes_test;
#[cfg(test)]
mod csharp_richtext_test;
#[cfg(test)]
mod csharp_seed_richtext_test;
#[cfg(test)]
mod csharp_seed_test;
#[cfg(test)]
mod csharp_structure_test;
#[cfg(test)]
mod csharp_textdiff_test;
#[cfg(test)]
mod csharp_yrs_compat_test;
#[cfg(test)]
mod deepassign_test;
#[cfg(test)]
mod editops_test;
#[cfg(test)]
mod export_test;
#[cfg(test)]
mod fields_test;
#[cfg(test)]
mod hardening_test;
#[cfg(test)]
mod htmlreader_test;
#[cfg(test)]
mod keys_test;
#[cfg(test)]
mod longestkept_test;
#[cfg(test)]
mod richtext_test;
#[cfg(test)]
mod richtextinput_test;
#[cfg(test)]
mod seed_test;
#[cfg(test)]
mod shape_test;
#[cfg(test)]
mod structure_test;
#[cfg(test)]
mod textdiff_test;
