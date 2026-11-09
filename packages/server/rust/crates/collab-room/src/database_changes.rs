use std::collections::HashMap;

use blok_jsjson::{Object, Str, Value};

use crate::changes::same_data;

/// CollabDatabaseChanges.Describe: the extra row fields for one changed
/// block. `properties` for a database row, `schema` and `views` for a
/// database; each is left out when empty. Keys and ids only, in document
/// order; values compare as the changes diff does.
pub fn describe_database_change(
    type_name: Option<&Str>,
    before: Option<&Object>,
    after: Option<&Object>,
) -> Object {
    let mut fields = Object::new();
    let (Some(type_name), Some(before), Some(after)) = (type_name, before, after) else {
        return fields;
    };
    if *type_name == Str::from("database-row") {
        let properties = property_changes(
            object_of(data_member(before, "properties")),
            object_of(data_member(after, "properties")),
        );
        if !properties.is_empty() {
            fields.set(Str::from("properties"), Value::Array(properties));
        }
    } else if *type_name == Str::from("database") {
        let schema = entry_changes(
            array_of(data_member(before, "schema")),
            array_of(data_member(after, "schema")),
            true,
        );
        let views = entry_changes(
            array_of(data_member(before, "views")),
            array_of(data_member(after, "views")),
            false,
        );
        if !schema.is_empty() {
            fields.set(Str::from("schema"), Value::Array(schema));
        }
        if !views.is_empty() {
            fields.set(Str::from("views"), Value::Array(views));
        }
    }
    fields
}

fn data_member<'a>(block: &'a Object, key: &str) -> Option<&'a Value> {
    match block.get(&Str::from("data")) {
        Some(Value::Object(data)) => data.get(&Str::from(key)),
        _ => None,
    }
}

fn object_of(value: Option<&Value>) -> Option<&Object> {
    match value {
        Some(Value::Object(object)) => Some(object),
        _ => None,
    }
}

fn array_of(value: Option<&Value>) -> &[Value] {
    match value {
        Some(Value::Array(items)) => items,
        _ => &[],
    }
}

/// After's keys in order, then the keys only before had.
fn property_changes(before: Option<&Object>, after: Option<&Object>) -> Vec<Value> {
    let mut keys: Vec<&Str> = Vec::new();
    if let Some(after) = after {
        keys.extend(after.members().iter().map(|m| &m.key));
    }
    if let Some(before) = before {
        keys.extend(
            before
                .members()
                .iter()
                .map(|m| &m.key)
                .filter(|key| after.is_none_or(|after| after.get(key).is_none())),
        );
    }
    let mut changes = Vec::new();
    for key in keys {
        let old = before.and_then(|b| b.get(key));
        let now = after.and_then(|a| a.get(key));
        if let (Some(old), Some(now)) = (old, now)
            && same_data(old, now)
        {
            continue;
        }
        let mut entry = Object::new();
        entry.set(Str::from("id"), Value::String(key.clone()));
        if let Some(old) = old {
            entry.set(Str::from("before"), old.clone());
        }
        if let Some(now) = now {
            entry.set(Str::from("after"), now.clone());
        }
        changes.push(Value::Object(entry));
    }
    changes
}

/// The most schema or view entries one side may hold for a breakdown. Past
/// it the list is left out, so one changes call stays cheap.
pub const MAX_DATABASE_ENTRIES: usize = 500;

/// Entries with a string id, the first of a repeated id kept, in order.
fn by_id(entries: &[Value]) -> (Vec<&Str>, HashMap<&Str, &Object>) {
    let mut order = Vec::new();
    let mut index = HashMap::new();
    for item in entries {
        if let Value::Object(entry) = item
            && let Some(Value::String(id)) = entry.get(&Str::from("id"))
            && !index.contains_key(id)
        {
            index.insert(id, entry);
            order.push(id);
        }
    }
    (order, index)
}

/// After's order, then the deleted ones. Empty when either side is past the
/// cap.
fn entry_changes(before: &[Value], after: &[Value], with_name: bool) -> Vec<Value> {
    let mut changes = Vec::new();
    if before.len() > MAX_DATABASE_ENTRIES || after.len() > MAX_DATABASE_ENTRIES {
        return changes;
    }
    let (old_order, old) = by_id(before);
    let (now_order, now) = by_id(after);
    let mut add = |id: &Str, named: &Object, action: &str| {
        let mut entry = Object::new();
        entry.set(Str::from("id"), Value::String(id.clone()));
        if with_name && let Some(Value::String(name)) = named.get(&Str::from("name")) {
            entry.set(Str::from("name"), Value::String(name.clone()));
        }
        entry.set(Str::from("action"), Value::String(Str::from(action)));
        changes.push(Value::Object(entry));
    };
    for id in &now_order {
        let entry = now[id];
        match old.get(id) {
            None => add(id, entry, "created"),
            Some(previous) => {
                if !same_data(
                    &Value::Object((*previous).clone()),
                    &Value::Object(entry.clone()),
                ) {
                    add(id, entry, "updated");
                }
            }
        }
    }
    for id in &old_order {
        if !now.contains_key(id) {
            add(id, old[id], "deleted");
        }
    }
    changes
}
