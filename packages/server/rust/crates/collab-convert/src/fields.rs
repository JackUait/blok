use std::collections::{BTreeMap, HashMap};
use std::fmt;

use blok_jsjson::{Str, to_string_lossy};

/// Names the data keys stored as formatted text, per block type: the
/// client's built-ins plus a host's custom tools (C# RichTextFields.cs).
/// Types and keys are UTF-16, as C# compares them.
#[derive(Clone, Debug)]
pub struct RichTextFields {
    table: HashMap<Str, Vec<Str>>,
}

/// One custom block type and its rich fields; `None` is C#'s null list.
#[derive(Clone, Debug)]
pub struct RichTextFieldEntry {
    pub kind: Str,
    pub fields: Option<Vec<Str>>,
}

/// A custom field list C# refuses at startup with ArgumentException.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldsError {
    pub message: String,
}

impl fmt::Display for FieldsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FieldsError {}

fn built_in_fields() -> HashMap<Str, Vec<Str>> {
    ["paragraph", "header", "quote", "toggle", "list"]
        .into_iter()
        .map(|kind| (Str::from(kind), vec![Str::from("text")]))
        .collect()
}

impl RichTextFields {
    /// The client's table alone.
    pub fn built_in() -> RichTextFields {
        RichTextFields {
            table: built_in_fields(),
        }
    }

    /// Adds custom fields to the built-ins. An empty or NUL name, or a null
    /// list, is refused as C# refuses it. The entries are read in order, so
    /// the first bad one is the one reported, as in C#.
    pub fn new(custom: &[RichTextFieldEntry]) -> Result<RichTextFields, FieldsError> {
        let mut table = built_in_fields();
        for entry in custom {
            let kind = to_string_lossy(&entry.kind);
            check_field_name(&entry.kind, "block type")?;
            let Some(fields) = &entry.fields else {
                return Err(FieldsError {
                    message: format!(
                        "rich text fields: block type \"{kind}\" has a null field list."
                    ),
                });
            };
            for field in fields {
                check_field_name(field, &format!("field of \"{kind}\""))?;
            }
            let keys = table.entry(entry.kind.clone()).or_default();
            for field in fields {
                if !keys.contains(field) {
                    keys.push(field.clone());
                }
            }
        }
        Ok(RichTextFields { table })
    }

    /// Whether `key` of a block of type `kind` holds formatted text.
    pub fn is_rich(&self, kind: &[u16], key: &[u16]) -> bool {
        !kind.is_empty()
            && self
                .table
                .get(&Str::from(kind))
                .is_some_and(|keys| keys.iter().any(|k| k.units() == key))
    }

    /// Each type's fields in ordinal (UTF-16) order.
    pub fn table(&self) -> BTreeMap<Str, Vec<Str>> {
        self.table
            .iter()
            .map(|(kind, fields)| {
                let mut sorted = fields.clone();
                sorted.sort();
                (kind.clone(), sorted)
            })
            .collect()
    }
}

fn check_field_name(name: &[u16], what: &str) -> Result<(), FieldsError> {
    if name.is_empty() || name.contains(&0) {
        return Err(FieldsError {
            message: format!("rich text fields: a {what} name is empty or holds a NUL."),
        });
    }
    Ok(())
}
