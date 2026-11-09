use std::collections::{HashMap, HashSet};

use blok_jsjson::{Object, Str, Value, to_string_lossy};

use crate::changes::same_data;

/// One reason a restore needs a person's yes (C# CollabRestoreGuard).
/// `view_id` is set for a share guard only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestoreGuard {
    pub kind: &'static str,
    pub block_id: String,
    pub view_id: Option<String>,
}

pub const GUARD_SHARE: &str = "share";
pub const GUARD_UNLOCK: &str = "unlock";
pub const GUARD_LOCKED_RESHAPE: &str = "lockedReshape";

/// The kinds a request may confirm.
pub const CONFIRMABLE_GUARDS: [&str; 3] = [GUARD_SHARE, GUARD_UNLOCK, GUARD_LOCKED_RESHAPE];

impl RestoreGuard {
    /// `{kind, blockId, viewId?}`.
    pub fn json(&self) -> Value {
        let mut object = Object::new();
        object.set(key("kind"), Value::String(key(self.kind)));
        object.set(key("blockId"), Value::String(key(&self.block_id)));
        if let Some(view) = &self.view_id {
            object.set(key("viewId"), Value::String(key(view)));
        }
        Value::Object(object)
    }
}

/// LOCK_PROTECTED_FIELDS in src/shared/tool-actions/database.ts.
const LOCK_PROTECTED_FIELDS: [&str; 6] = [
    "schema",
    "views",
    "automations",
    "source",
    "hideDataSourceTitles",
    "starter",
];

const SUBMISSION_ACCESS: [&str; 5] = ["none", "view", "comment", "edit", "full"];

// The agent's question names the calendar in full: a longer id is not one it can show.
const MAX_CALENDAR_ID: usize = 64;

/// Cc, Cf, Zl, Zp and Zs but U+0020, as Unicode 17 (Go's tables) has them.
const NOT_PLAIN: [(u32, u32); 25] = [
    (0x0000, 0x001F),
    (0x007F, 0x00A0),
    (0x00AD, 0x00AD),
    (0x0600, 0x0605),
    (0x061C, 0x061C),
    (0x06DD, 0x06DD),
    (0x070F, 0x070F),
    (0x0890, 0x0891),
    (0x08E2, 0x08E2),
    (0x1680, 0x1680),
    (0x180E, 0x180E),
    (0x2000, 0x200F),
    (0x2028, 0x202F),
    (0x205F, 0x2064),
    (0x2066, 0x206F),
    (0x3000, 0x3000),
    (0xFEFF, 0xFEFF),
    (0xFFF9, 0xFFFB),
    (0x110BD, 0x110BD),
    (0x110CD, 0x110CD),
    (0x13430, 0x1343F),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0001, 0xE0001),
    (0xE0020, 0xE007F),
];

fn key(text: &str) -> Str {
    Str::from_utf8(text.as_bytes())
}

struct Indexed<'a> {
    order: Vec<String>,
    by_id: HashMap<String, &'a Object>,
}

/// C# CollabRestoreGuards.Of: the guards a restore of `target` over
/// `current` raises, both as exported blocks. Lock guards come first in
/// current's order, then share guards in target's. The oracle is
/// fixtures/collab-history/restore-guards.json.
pub fn restore_guards(current_blocks: &[Value], target_blocks: &[Value]) -> Vec<RestoreGuard> {
    let now = index(current_blocks);
    let target = index(target_blocks);
    let locked_now = locked_in(&now);
    let locked_target = locked_in(&target);
    let mut guards = Vec::new();
    for id in &now.order {
        let block = now.by_id[id];
        if text(block, "type").as_deref() != Some("database")
            || !locked_or_held(&now, id, &locked_now, &HashSet::new())
        {
            continue;
        }
        let after = target.by_id.get(id).copied();
        if let Some(after) = after
            && text(after, "type").as_deref() == Some("database")
            && LOCK_PROTECTED_FIELDS
                .iter()
                .all(|field| same_member(object_at(block, "data"), object_at(after, "data"), field))
        {
            continue;
        }
        let unlocks = locked_now.contains(id) && after.is_some() && !locked_target.contains(id);
        guards.push(RestoreGuard {
            kind: if unlocks {
                GUARD_UNLOCK
            } else {
                GUARD_LOCKED_RESHAPE
            },
            block_id: id.clone(),
            view_id: None,
        });
    }
    for id in &target.order {
        let after = target.by_id[id];
        if text(after, "type").as_deref() != Some("database") {
            continue;
        }
        let mut was: HashMap<String, &Object> = HashMap::new();
        if let Some(before) = now.by_id.get(id)
            && text(before, "type").as_deref() == Some("database")
        {
            // Last wins, as a Map built from entries does.
            for view in views_in(before) {
                if let Some(view_id) = text(view, "id") {
                    was.insert(view_id, view);
                }
            }
        }
        for view in views_in(after) {
            let view_id = text(view, "id").unwrap_or_default();
            let previous = if view_id.is_empty() {
                None
            } else {
                was.get(&view_id).copied()
            };
            if share_changes(previous, view) {
                guards.push(RestoreGuard {
                    kind: GUARD_SHARE,
                    block_id: id.clone(),
                    view_id: Some(view_id),
                });
            }
        }
    }
    guards
}

/// The blocks by id in first-seen order; a later repeat wins.
fn index(blocks: &[Value]) -> Indexed<'_> {
    let mut indexed = Indexed {
        order: Vec::new(),
        by_id: HashMap::new(),
    };
    for item in blocks {
        let Value::Object(block) = item else { continue };
        let Some(id) = text(block, "id").filter(|id| !id.is_empty()) else {
            continue;
        };
        if !indexed.by_id.contains_key(&id) {
            indexed.order.push(id.clone());
        }
        indexed.by_id.insert(id, block);
    }
    indexed
}

/// A member; undefined counts as missing.
fn member<'a>(object: Option<&'a Object>, name: &str) -> Option<&'a Value> {
    object?
        .get(&key(name))
        .filter(|value| !matches!(value, Value::Undefined))
}

fn text(object: &Object, name: &str) -> Option<String> {
    match member(Some(object), name) {
        Some(Value::String(s)) => Some(to_string_lossy(s.units())),
        _ => None,
    }
}

fn text_in(object: Option<&Object>, name: &str) -> Option<String> {
    object.and_then(|object| text(object, name))
}

fn is_true(object: Option<&Object>, name: &str) -> bool {
    matches!(member(object, name), Some(Value::Bool(true)))
}

fn object_at<'a>(object: &'a Object, name: &str) -> Option<&'a Object> {
    match member(Some(object), name) {
        Some(Value::Object(inner)) => Some(inner),
        _ => None,
    }
}

fn object_in<'a>(object: Option<&'a Object>, name: &str) -> Option<&'a Object> {
    object.and_then(|object| object_at(object, name))
}

/// Blocks of any type whose schema has a title property with databaseLocked true.
fn locked_in(blocks: &Indexed<'_>) -> HashSet<String> {
    blocks
        .order
        .iter()
        .filter(
            |id| match member(object_at(blocks.by_id[*id], "data"), "schema") {
                Some(Value::Array(schema)) => schema.iter().any(|property| match property {
                    Value::Object(title) => {
                        text(title, "type").as_deref() == Some("title")
                            && is_true(Some(title), "databaseLocked")
                    }
                    _ => false,
                }),
                _ => false,
            },
        )
        .cloned()
        .collect()
}

/// Its own lock, or a locked database up its chain of database parents.
fn locked_or_held(
    blocks: &Indexed<'_>,
    id: &str,
    locked: &HashSet<String>,
    seen: &HashSet<String>,
) -> bool {
    if locked.contains(id) {
        return true;
    }
    let Some(parent) = text(blocks.by_id[id], "parent") else {
        return false;
    };
    if parent == id || seen.contains(&parent) {
        return false;
    }
    let Some(holder) = blocks.by_id.get(&parent) else {
        return false;
    };
    if text(holder, "type").as_deref() != Some("database") {
        return false;
    }
    let mut next = seen.clone();
    next.insert(id.to_owned());
    locked_or_held(blocks, &parent, locked, &next)
}

/// Missing and null differ, as undefined and null do.
fn same_member(left: Option<&Object>, right: Option<&Object>, name: &str) -> bool {
    match (member(left, name), member(right, name)) {
        (None, None) => true,
        (Some(a), Some(b)) => same_data(a, b),
        _ => false,
    }
}

fn views_in(block: &Object) -> Vec<&Object> {
    match member(object_at(block, "data"), "views") {
        Some(Value::Array(views)) => views
            .iter()
            .filter_map(|view| match view {
                Value::Object(view) => Some(view),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The view's sharing differs from `previous` (None is the defaults), or a
/// raw value changed that Blok cannot read as the Share panel does, which
/// fails closed.
fn share_changes(previous: Option<&Object>, view: &Object) -> bool {
    if same_raw_share(previous, Some(view)) {
        return false;
    }
    !readable_share(view) || share_of(previous) != share_of(Some(view))
}

/// rawShare: whether form is missing or an object, the four form values and
/// calendarSync as stored.
fn same_raw_share(left: Option<&Object>, right: Option<&Object>) -> bool {
    let form_state = |view: Option<&Object>| !matches!(member(view, "form"), Some(value) if !matches!(value, Value::Object(_)));
    if form_state(left) != form_state(right) {
        return false;
    }
    let (left_form, right_form) = (object_in(left, "form"), object_in(right, "form"));
    ["closed", "public", "anonymous", "submissionAccess"]
        .iter()
        .all(|name| same_member(left_form, right_form, name))
        && same_member(left, right, "calendarSync")
}

/// shareOf: the settings with defaults filled in. Closed wins over public.
fn share_of(view: Option<&Object>) -> (&'static str, bool, String, bool, Option<String>) {
    let form = object_in(view, "form");
    let sync = object_in(view, "calendarSync");
    let access = text_in(form, "submissionAccess")
        .filter(|named| SUBMISSION_ACCESS.contains(&named.as_str()))
        .unwrap_or_else(|| "none".to_owned());
    let reach = if is_true(form, "closed") {
        "closed"
    } else if is_true(form, "public") {
        "public"
    } else {
        "workspace"
    };
    let calendar = text_in(sync, "calendarId").filter(|id| !id.is_empty());
    (
        reach,
        is_true(form, "anonymous"),
        access,
        is_true(sync, "enabled"),
        calendar,
    )
}

/// readableShare: every sharing value is one Blok reads the one way the
/// Share panel does.
fn readable_share(view: &Object) -> bool {
    let form = member(Some(view), "form");
    let sync = member(Some(view), "calendarSync");
    if matches!(form, Some(value) if !matches!(value, Value::Object(_)))
        || matches!(sync, Some(value) if !matches!(value, Value::Object(_)))
    {
        return false;
    }
    let (form, sync) = (
        object_in(Some(view), "form"),
        object_in(Some(view), "calendarSync"),
    );
    let is_bool = |value: &Value| matches!(value, Value::Bool(_));
    optional(form, "closed", is_bool)
        && optional(form, "public", is_bool)
        && optional(form, "anonymous", is_bool)
        && optional(form, "submissionAccess", |value| match value {
            Value::String(s) => SUBMISSION_ACCESS.contains(&to_string_lossy(s.units()).as_str()),
            _ => false,
        })
        && optional(sync, "enabled", is_bool)
        && optional(sync, "calendarId", |value| match value {
            Value::String(s) => is_plain_line(&to_string_lossy(s.units())),
            _ => false,
        })
}

fn optional(owner: Option<&Object>, name: &str, valid: impl Fn(&Value) -> bool) -> bool {
    member(owner, name).is_none_or(valid)
}

/// plainLine(id, 64) === id: 1 to 64 code points, no control, format, line
/// or paragraph separator, no space but U+0020, and no leading, trailing or
/// doubled space.
pub fn is_plain_line(id: &str) -> bool {
    let mut count = 0;
    let mut previous_space = true;
    for c in id.chars() {
        count += 1;
        if c == ' ' {
            if previous_space {
                return false;
            }
            previous_space = true;
            continue;
        }
        previous_space = false;
        let code = c as u32;
        if NOT_PLAIN
            .iter()
            .any(|&(low, high)| low <= code && code <= high)
        {
            return false;
        }
    }
    count > 0 && count <= MAX_CALENDAR_ID && !previous_space
}
