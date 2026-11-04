use crate::test_json::{self, Json};
use crate::{Error, Runtime};

pub(crate) const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../..");

pub(crate) fn fixture(relative: &str) -> Json {
    let path = format!("{REPO_ROOT}/{relative}");
    test_json::parse(&std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{path}: {err}")))
}

fn new_runtime() -> Runtime {
    Runtime::new().expect("Runtime::new")
}

#[test]
fn version_matches_package_json() {
    let package = fixture("package.json");
    let version = package.get("version").str();
    assert!(!version.is_empty(), "package.json has no version");

    let got = new_runtime()
        .invoke("version", "{}")
        .expect("invoke(version)");
    assert_eq!(got, version);
}

#[test]
fn matches_node_on_the_smoke_fixture() {
    let cases = fixture("test/unit/server-conformance/fixtures/documents/bundle-smoke.json");
    assert!(!cases.array().is_empty(), "no smoke cases");

    let mut runtime = new_runtime();
    for case in cases.array() {
        let (name, op) = (case.get("name").str(), case.get("op").str());
        let got = runtime
            .invoke(op, case.get("input").str())
            .unwrap_or_else(|err| panic!("{name}: invoke({op}): {err}"));
        assert_eq!(got, case.get("output").str(), "{name}");
    }
}

#[test]
fn reports_the_java_script_error_name() {
    let mut runtime = new_runtime();

    match runtime.invoke("noSuchOperation", "{}") {
        Err(Error::Js(err)) if err.name == "TypeError" => {}
        other => panic!("unknown op: {other:?}, want a TypeError"),
    }

    match runtime.invoke("blocksToHtml", "not json") {
        Err(Error::Js(err)) if err.name == "SyntaxError" => {}
        other => panic!("bad json: {other:?}, want a SyntaxError"),
    }

    runtime
        .invoke("version", "{}")
        .expect("version after errors");
}

#[test]
fn fails_at_once_on_a_pending_promise() {
    let mut runtime = Runtime::from_source(
        "pending.js",
        "globalThis.blokServerInvoke = () => new Promise(() => {});",
    )
    .expect("from_source");
    match runtime.invoke("version", "{}") {
        Err(Error::Pending) => {}
        other => panic!("{other:?}, want Error::Pending"),
    }
}

#[test]
fn refuses_a_bundle_without_the_entry_point() {
    assert!(Runtime::from_source("empty.js", "var x = 1;").is_err());
}

#[test]
fn turns_a_lone_surrogate_in_a_returned_string_into_u_fffd() {
    let mut runtime = new_runtime();
    let got = runtime
        .invoke(
            "blocksToPlainText",
            r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}"#,
        )
        .expect("invoke");
    assert_eq!(got, "a\u{fffd}b");
}

#[test]
fn turns_a_lone_surrogate_in_an_error_message_into_u_fffd() {
    let mut runtime = Runtime::from_source(
        "lone.js",
        "globalThis.blokServerInvoke = () => { throw new TypeError('x\\ud800'); };",
    )
    .expect("from_source");
    match runtime.invoke("any", "{}") {
        Err(Error::Js(err)) => {
            assert_eq!(err.name, "TypeError");
            assert_eq!(err.message, "x\u{fffd}");
        }
        other => panic!("{other:?}, want a TypeError"),
    }
}

// The bundle sorts database property names with localeCompare. Jint (ICU),
// goja and node all give this order (measured); QuickJS alone compares
// code units, so the host replaces it.
#[test]
fn sorts_with_locale_compare_like_csharp() {
    let mut runtime = Runtime::from_source(
        "locale.js",
        "globalThis.blokServerInvoke = () => ['b','A','a','\u{e4}','Z','B','\u{e9}','e','f','_x','1','10','2',' x','\u{c4}','\u{df}','ss','Title','title','\u{540d}\u{524d}','\u{3a9}','\u{3c9}','a-b','ab','a b','Due date','Due Date','due'].sort((x, y) => x.localeCompare(y)).join('|');",
    )
    .expect("from_source");
    assert_eq!(
        runtime.invoke("any", "{}").expect("invoke"),
        " x|_x|1|10|2|a|A|\u{e4}|\u{c4}|a b|a-b|ab|b|B|due|Due date|Due Date|e|\u{e9}|f|ss|\u{df}|title|Title|Z|\u{3c9}|\u{3a9}|\u{540d}\u{524d}"
    );
}

#[test]
fn compares_a_lone_surrogate_as_u_fffd() {
    let mut runtime = Runtime::from_source(
        "lone-compare.js",
        "globalThis.blokServerInvoke = () => [String.fromCharCode(0xd800).localeCompare('\\ufffd'), 'a'.localeCompare(), 'a'.localeCompare('b')].join(',');",
    )
    .expect("from_source");
    assert_eq!(runtime.invoke("any", "{}").expect("invoke"), "0,-1,-1");
}

// A real path into the sort: an alphabetical view places its unlisted
// properties by name. Jint 4.17 (ICU, invariant culture), goja and node all
// give this order for this batch (measured).
#[test]
fn sorts_database_properties_like_csharp_through_agent_execute() {
    let names = [
        "b",
        "A",
        "a",
        "\u{e4}",
        "Z",
        "B",
        "\u{e9}",
        "e",
        "_x",
        "1",
        "10",
        "2",
        "\u{c4}",
        "\u{df}",
        "ss",
        "Title",
        "title",
        "Due date",
        "Due Date",
        "a b",
        "a-b",
        "ab",
        "\u{3c9}",
        "\u{3a9}",
        "\u{540d}\u{524d}",
    ];
    let schema: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            format!(
                r#"{{"id":"p{i}","name":"{name}","type":"text","position":"a{:02}"}}"#,
                i + 1
            )
        })
        .collect();
    let input = format!(
        r#"{{"services":[],"document":{{"blocks":[{{"id":"db","type":"database","data":{{"schema":[{{"id":"title","name":"Name","type":"title","position":"a00"}},{}],"views":[{{"id":"v1","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[],"propertyOrder":"alphabetical"}}],"activeViewId":"v1"}}}}]}},"batch":{{"commands":[{{"name":"database.updateView","args":{{"id":"db","viewId":"v1","changes":{{"properties":[]}}}}}}]}},"actor":{{"id":"agent-x","name":"Agent","kind":"agent"}}}}"#,
        schema.join(",")
    );
    let output = test_json::parse(
        &new_runtime()
            .invoke("agentExecute", &input)
            .expect("agentExecute"),
    );
    assert!(output.get("result").get("ok").bool(), "{output:?}");
    let data = output.get("document").get("blocks").array()[0]
        .get("data")
        .clone();
    let name_of = |id: &str| {
        data.get("schema")
            .array()
            .iter()
            .find(|p| p.get("id").str() == id)
            .map(|p| p.get("name").str().to_owned())
            .expect("a schema id")
    };
    let order: Vec<String> = data.get("views").array()[0]
        .get("visibleProperties")
        .array()
        .iter()
        .map(|id| name_of(id.str()))
        .collect();
    assert_eq!(
        order.join("|"),
        "_x|1|10|2|a|A|\u{e4}|\u{c4}|a b|a-b|ab|b|B|Due date|Due Date|e|\u{e9}|ss|\u{df}|title|Title|Z|\u{3c9}|\u{3a9}|\u{540d}\u{524d}"
    );
}
