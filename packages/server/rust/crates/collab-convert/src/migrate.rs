use blok_jsjson::{Str, Value};
use blok_yjs::{Doc, Map, Out, XmlText};

use crate::error::Error;
use crate::export::{BLOCKS_ROOT, RichTextHtml};
use crate::fields::RichTextFields;
use crate::richtext::without_nul;
use crate::richtextinput::RichTextInput;
use crate::seed::{SourceValue, new_rich_text, rich_segments};

struct LegacyField {
    data: Map,
    kind: Str,
    key: Str,
    html: Str,
}

/// Every top-level rich field still holding HTML (a plain Y.Text or a
/// string), in every block map entry, not only the ones the export reaches:
/// an orphan left holding HTML would surface later in a format-2 room. A
/// database-row's nested documents stay plain JSON.
fn legacy_rich_text(doc: &Doc, fields: &RichTextFields) -> Result<Vec<LegacyField>, Error> {
    let mut found = Vec::new();
    let block_map = doc.get_map(BLOCKS_ROOT)?;
    for id in block_map.keys() {
        let Some(block) = block_map.get(id).and_then(|v| v.as_map()) else {
            continue;
        };
        let Some(Out::Any(Value::String(kind))) = block.get("type") else {
            continue;
        };
        let Some(data) = block.get("data").and_then(|v| v.as_map()) else {
            continue;
        };
        for key in data.keys() {
            if !fields.is_rich(&kind, &key) {
                continue;
            }
            // An XmlText is not a Text here, so a migrated field never matches.
            let html = match data.get(key.clone()) {
                Some(Out::Any(Value::String(html))) => html,
                Some(other) => match other.as_text() {
                    Some(text) => text.units(),
                    None => continue,
                },
                None => continue,
            };
            // Dropped as the client's stripNul drops it; kept, it would fail
            // the NUL guard after the whole read, on every open.
            found.push(LegacyField {
                data: data.clone(),
                kind: kind.clone(),
                key,
                html: without_nul(&html),
            });
        }
    }
    Ok(found)
}

/// The HTML a format-1 room still holds in its rich fields, each string
/// once: what `migrate_rich_text` needs read. It writes nothing.
pub fn collect_legacy_rich_text(
    doc: &Doc,
    fields: &RichTextFields,
) -> Result<Vec<RichTextHtml>, Error> {
    let mut input = RichTextInput::collecting(fields);
    for field in legacy_rich_text(doc, fields)? {
        let _ = input.segments(&field.kind, &field.key, &field.html);
    }
    Ok(input.found().to_vec())
}

/// Format 1 to 2: each legacy rich field becomes a formatted text built from
/// input's segments, all in one transaction. Every field is built first, so
/// a refused one writes nothing. It returns how many fields were replaced.
pub fn migrate_rich_text(doc: &Doc, input: &mut RichTextInput<'_>) -> Result<usize, Error> {
    let planned = legacy_rich_text(doc, input.fields)?;
    let mut built: Vec<(Map, Str, XmlText)> = Vec::with_capacity(planned.len());
    for field in planned {
        let segments = rich_segments(
            &field.kind,
            &field.key,
            &SourceValue::String(field.html),
            input,
        )?;
        built.push((field.data, field.key, new_rich_text(&segments)?));
    }
    if built.is_empty() {
        return Ok(0);
    }
    doc.transact(|txn| {
        for (data, key, text) in &built {
            data.set(txn, key.clone(), text.clone())?;
        }
        Ok(())
    })?;
    Ok(built.len())
}
