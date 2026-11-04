use blok_jsjson::{
    ErrorKind, Node, Options, Str, new_array, new_bool, new_member, new_null, new_object,
    new_string, parse_node,
};

fn must_node(text: &[u8]) -> Node {
    parse_node(text, Options::default())
        .unwrap_or_else(|e| panic!("parse {}: {e}", String::from_utf8_lossy(text)))
}

fn written(node: &Node) -> String {
    let mut out = Vec::new();
    node.append_json(&mut out).expect("write");
    String::from_utf8(out).unwrap()
}

#[test]
fn built_nodes_write_like_system_text_json() {
    let object = new_object(vec![
        new_member("s", new_string(&Str::from("é<\"🚀"))),
        new_member("t", new_bool(true)),
        new_member("n", new_null()),
        new_member(
            "a",
            new_array(vec![new_bool(false), new_string(&Str::from("x"))]),
        ),
    ]);
    let want =
        "{\"s\":\"\\u00E9\\u003C\\u0022\\uD83D\\uDE80\",\"t\":true,\"n\":null,\"a\":[false,\"x\"]}";
    assert_eq!(written(&object), want);
    let text = object.members[0].value.text().unwrap();
    assert_eq!(text.to_string(), "é<\"🚀");
}

#[test]
fn set_replaces_in_place_or_appends() {
    let mut object = must_node(br#"{"a":1,"b":2}"#);
    object.set("a", new_bool(true)).unwrap();
    object.set("c", new_null()).unwrap();
    assert_eq!(written(&object), r#"{"a":true,"b":2,"c":null}"#);
    assert!(object.remove("b"));
    assert!(!object.remove("zz"));
    assert_eq!(written(&object), r#"{"a":true,"c":null}"#);
}

#[test]
fn lookup_fails_as_the_json_object_indexer_does() {
    let node = must_node(br#"{"a":1,"b":2}"#);
    let found = node.lookup("b").unwrap().unwrap();
    assert_eq!(found.raw(), b"2");
    assert!(must_node(br#"{"a":1}"#).lookup("b").unwrap().is_none());
    // Any repeat fails, even one under another name.
    let err = must_node(br#"{"a":1,"x":2,"x":3}"#)
        .lookup("a")
        .unwrap_err();
    assert_eq!(err.kind(), ErrorKind::Duplicate);
    let err = must_node(br#"{"a":1,"\ud800":2}"#).lookup("a").unwrap_err();
    assert_eq!(err.kind(), ErrorKind::LoneSurrogate);
    assert!(must_node(b"[1]").lookup("a").unwrap().is_none());
}

#[test]
fn clone_is_deep() {
    let original = must_node(br#"{"a":[{"b":1}]}"#);
    let mut copied = original.clone();
    let inner = copied.lookup_mut("a").unwrap().unwrap();
    inner.items[0].set("b", new_null()).unwrap();
    assert_eq!(written(&original), r#"{"a":[{"b":1}]}"#);
    assert_eq!(written(&copied), r#"{"a":[{"b":null}]}"#);
}

// Invalid UTF-8 in a key reads as U+FFFD, as it does in a .NET string.
#[test]
fn lookup_reads_invalid_utf8_keys_as_replacement() {
    let node = must_node(b"{\"a\xff\":1}");
    let found = node.lookup("a\u{fffd}").unwrap().unwrap();
    assert_eq!(found.raw(), b"1");
}
