use blok_jsjson::{Object, Str, Value, parse};
use blok_yjs::{Doc, Options, Outcome};

use crate::apply::apply_ops;
use crate::csharp_apply_test::{block_named, json, nodes, ops};
use crate::export_test::canonical;
use crate::fields::RichTextFields;
use crate::richtext_test::{field, items};
use crate::richtextinput::RichTextInput;
use crate::seed::seed;
use crate::seed_test::exported;

// C# YDocConverterDatabaseStructureTests: lists born empty that two peers
// grow (a button's buttonActions, saved automation definitions and their
// triggers and actions) are YArrays from birth, even on a server-seeded
// database, so two first adds both survive.

const DATABASE_WITH_BUTTON: &str = r#"{ "id": "db", "type": "database",
    "data": { "activeViewId": "v", "views": [],
      "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [] } }] } }"#;

fn seeded(block: &str) -> Doc {
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &nodes(&[block]),
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

fn apply(doc: &Doc, op: &str) {
    let fields = RichTextFields::built_in();
    apply_ops(doc, &ops(&[op]), &mut RichTextInput::refusing(&fields))
        .unwrap_or_else(|err| panic!("{err}"));
}

fn peer(server: &Doc) -> Doc {
    let peer = Doc::new(Options::default());
    let update = server
        .encode_state_as_update(&peer.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let result = peer
        .apply_update(&update)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(result.outcome, Outcome::Applied);
    peer
}

fn exchange(left: &Doc, right: &Doc) {
    let to_right = left
        .encode_state_as_update(&right.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    let to_left = right
        .encode_state_as_update(&left.encode_state_vector())
        .unwrap_or_else(|err| panic!("{err}"));
    for (doc, update) in [(right, to_right), (left, to_left)] {
        let result = doc
            .apply_update(&update)
            .unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(result.outcome, Outcome::Applied);
    }
}

fn sorted_ids(list: &Value) -> Vec<String> {
    let mut ids: Vec<String> = items(list)
        .iter()
        .map(|item| match field(item, "id") {
            Value::String(id) => id.to_string(),
            _ => String::new(),
        })
        .collect();
    ids.sort();
    ids
}

fn action_ids(doc: &Doc) -> Vec<String> {
    let exported = exported(doc);
    let schema = field(field(block_named(&exported, "db"), "data"), "schema");
    sorted_ids(field(field(&items(schema)[0], "button"), "buttonActions"))
}

#[test]
fn two_peers_adding_the_first_action_at_once_keep_both() {
    let server = seeded(DATABASE_WITH_BUTTON);
    let peer = peer(&server);
    apply(
        &server,
        r#"{ "op": "update", "id": "db", "data": { "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [{ "id": "x1", "type": "openPage" }] } }] } }"#,
    );
    apply(
        &peer,
        r#"{ "op": "update", "id": "db", "data": { "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [{ "id": "x2", "type": "callback" }] } }] } }"#,
    );
    exchange(&server, &peer);
    assert_eq!(action_ids(&server), ["x1", "x2"]);
    assert_eq!(action_ids(&peer), ["x1", "x2"]);
}

fn automation_definition(id: &str, name: &str) -> String {
    format!(
        r#"{{ "id": "{id}", "name": "{name}", "status": "paused",
    "scope": {{ "type": "database" }}, "triggerMode": "any", "triggers": [], "actions": [] }}"#
    )
}

fn automation_doc(definitions: &str) -> Doc {
    seeded(&format!(
        r#"{{ "id": "db1", "type": "database", "data": {{
    "title": "Intake",
    "schema": [
      {{ "id": "p-title", "name": "Name", "type": "title", "position": "a0" }},
      {{ "id": "p-where", "name": "Where", "type": "place", "position": "a1" }},
      {{ "id": "p-check", "name": "Verified", "type": "verification", "position": "a2" }},
      {{ "id": "p-sum", "name": "Summary", "type": "text", "position": "a3" }}
    ],
    "views": [{{
      "id": "v1", "name": "Form", "type": "form", "position": "a0",
      "sorts": [], "filters": [], "visibleProperties": [],
      "properties": [
        {{ "id": "p-title", "visible": true }}, {{ "id": "p-where", "visible": true }},
        {{ "id": "p-check", "visible": true }}, {{ "id": "p-sum", "visible": true }}
      ],
      "form": {{}}
    }}],
    "activeViewId": "v1",
    "automations": {{ "version": 1, "definitions": {definitions} }}
  }} }}"#
    ))
}

fn value(text: &str) -> Value {
    parse(text.as_bytes()).unwrap_or_else(|err| panic!("{err}"))
}

/// The exported db1 data with automations replaced, sent as an update.
fn apply_automations(doc: &Doc, automations: &str) {
    let exported = exported(doc);
    let Value::Object(mut data) = field(block_named(&exported, "db1"), "data").clone() else {
        panic!("db1 data is not an object")
    };
    data.set(Str::from("automations"), value(automations));
    let mut op = Object::new();
    op.set(Str::from("op"), Value::String(Str::from("update")));
    op.set(Str::from("id"), Value::String(Str::from("db1")));
    op.set(Str::from("data"), Value::Object(data));
    apply(doc, &json(&Value::Object(op)));
}

fn definitions(doc: &Doc) -> Value {
    let exported = exported(doc);
    field(
        field(field(block_named(&exported, "db1"), "data"), "automations"),
        "definitions",
    )
    .clone()
}

fn automation_ids(doc: &Doc, list: &str) -> Vec<String> {
    let definitions = definitions(doc);
    if list == "definitions" {
        return sorted_ids(&definitions);
    }
    sorted_ids(field(&items(&definitions)[0], list))
}

fn automation_entry(doc: &Doc, id: &str) -> Value {
    items(&definitions(doc))
        .iter()
        .find(|entry| field(entry, "id") == &Value::String(Str::from(id)))
        .cloned()
        .unwrap_or_else(|| panic!("no definition {id}"))
}

fn with_list(definition: &str, key: &str, list: &str) -> Value {
    let Value::Object(mut object) = value(definition) else {
        panic!("not an object")
    };
    object.set(Str::from(key), value(list));
    Value::Object(object)
}

fn by_id<'a>(list: &'a Value, id: &str) -> &'a Value {
    items(list)
        .iter()
        .find(|item| field(item, "id") == &Value::String(Str::from(id)))
        .unwrap_or_else(|| panic!("no {id}"))
}

#[test]
fn two_peers_adding_the_first_saved_automation_definition_at_once_keep_both() {
    let server = automation_doc("[]");
    let peer = peer(&server);
    apply_automations(
        &server,
        &format!(
            r#"{{ "version": 1, "definitions": [{}] }}"#,
            automation_definition("auto-a", "First")
        ),
    );
    apply_automations(
        &peer,
        &format!(
            r#"{{ "version": 1, "definitions": [{}] }}"#,
            automation_definition("auto-b", "Second")
        ),
    );
    exchange(&server, &peer);
    assert_eq!(automation_ids(&server, "definitions"), ["auto-a", "auto-b"]);
    assert_eq!(automation_ids(&peer, "definitions"), ["auto-a", "auto-b"]);
    for doc in [&server, &peer] {
        for (id, name) in [("auto-a", "First"), ("auto-b", "Second")] {
            assert_eq!(
                canonical(&value(&automation_definition(id, name))),
                canonical(&automation_entry(doc, id))
            );
        }
    }
}

/// Two peers each add the first entry of one saved definition's `list`.
fn first_entries_of_one_definition_keep_both(list: &str, first: &str, second: &str) {
    let definition = automation_definition("auto-1", "Draft");
    let server = automation_doc(&format!("[{definition}]"));
    let peer = peer(&server);
    let first = with_list(&definition, list, first);
    let second = with_list(&definition, list, second);
    for (doc, definition) in [(&server, &first), (&peer, &second)] {
        apply_automations(
            doc,
            &format!(
                r#"{{ "version": 1, "definitions": [{}] }}"#,
                json(definition)
            ),
        );
    }
    exchange(&server, &peer);
    let want = |v: &Value| sorted_ids(field(v, list));
    let mut ids = [want(&first), want(&second)].concat();
    ids.sort();
    assert_eq!(automation_ids(&server, list), ids);
    assert_eq!(automation_ids(&peer, list), ids);
    for doc in [&server, &peer] {
        assert_eq!(automation_ids(doc, "definitions"), ["auto-1"]);
        let entry = automation_entry(doc, "auto-1");
        let entries = field(&entry, list);
        for sent in [&first, &second] {
            let sent = &items(field(sent, list))[0];
            let Value::String(id) = field(sent, "id") else {
                panic!("no id")
            };
            assert_eq!(canonical(sent), canonical(by_id(entries, &id.to_string())));
        }
    }
}

#[test]
fn two_peers_adding_the_first_trigger_to_one_saved_definition_at_once_keep_both() {
    first_entries_of_one_definition_keep_both(
        "triggers",
        r#"[{ "id": "trigger-a", "type": "pageAdded" }]"#,
        r#"[{ "id": "trigger-b", "type": "propertyEdited", "propertyId": "p-sum" }]"#,
    );
}

#[test]
fn two_peers_adding_the_first_action_to_one_saved_definition_at_once_keep_both() {
    first_entries_of_one_definition_keep_both(
        "actions",
        r#"[{ "id": "action-a", "type": "editProperty", "target": "triggerRow", "propertyId": "p-sum", "value": "first" }]"#,
        r#"[{ "id": "action-b", "type": "editProperty", "target": "triggerRow", "propertyId": "p-title", "value": "second" }]"#,
    );
}
