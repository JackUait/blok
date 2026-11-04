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
