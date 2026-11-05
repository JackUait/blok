use std::time::Duration;

use crate::pool_test::invoke;
use crate::runtime_test::fixture;
use crate::test_json::Json;
use crate::{InvokeError, Kind, Pool};

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Unknown => "Unknown",
        Kind::InvalidDocument => "InvalidDocument",
        Kind::TimedOut => "TimedOut",
        Kind::DocumentTooLarge => "DocumentTooLarge",
    }
}

// C# reads the same file (RuntimeScriptFixtureTests). A step's "goja" entry
// is a recorded Jint quirk that goja and QuickJS both do not share; its
// "why" says where it comes from.
#[tokio::test]
async fn matches_the_shared_runtime_script_fixture() {
    let cases = fixture("test/unit/server-conformance/fixtures/documents/runtime-scripts.json");
    for case in cases.array() {
        let name = case.get("name").str();
        let timeout = match case {
            Json::Object(map) if map.contains_key("timeoutMs") => {
                Duration::from_millis(case.get("timeoutMs").number() as u64)
            }
            _ => Duration::from_secs(10),
        };
        let pool = Pool::from_source(case.get("script").str(), 1, timeout, 0)
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        for step in case.get("steps").array() {
            let op = step.get("op").str();
            let want = match step {
                Json::Object(map) if map.contains_key("goja") => step.get("goja"),
                _ => step.get("expect"),
            };
            let got = match invoke(&pool, op, "{}").await {
                Ok(result) => ("result", result),
                Err(InvokeError::Failure(failure)) => ("error", kind_name(failure.kind).to_owned()),
                Err(err) => panic!("{name} {op}: unexpected error {err}"),
            };
            let Json::Object(want) = want else {
                panic!("{name} {op}: expect is not an object")
            };
            assert_eq!(want.len(), 1, "{name} {op}: {want:?}");
            let (key, value) = want.iter().next().expect("one entry");
            assert_eq!(
                (key.as_str(), value.str()),
                (got.0, got.1.as_str()),
                "{name} {op}"
            );
        }
    }
}
