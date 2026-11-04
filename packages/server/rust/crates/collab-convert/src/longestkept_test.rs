use blok_jsjson::Value;
use blok_yjs_yjstest::{field, repo_root};

use crate::longestkept::longest_kept_order;

fn numbers(value: &Value, key: &str) -> Vec<i64> {
    match field(value, key) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Number(n) => *n as i64,
                other => panic!("{key}: {other:?}"),
            })
            .collect(),
        other => panic!("{key}: {other:?}"),
    }
}

// Twin of C# CollabLongestKeptOrderTests: the fixture the TS client diff and
// the C# restore planner also run, so all three keep the same blocks.
#[test]
fn longest_kept_order_keeps_the_fixture_indexes() {
    let root = repo_root().unwrap_or_else(|err| panic!("{err}"));
    let data = std::fs::read(root.join("test/fixtures/version-history/lis-cases.json")).unwrap();
    let fixture = blok_jsjson::parse(&data).unwrap();
    let Some(Value::Array(cases)) = field(&fixture, "cases") else {
        panic!("no cases");
    };
    assert!(cases.len() > 5, "only {} cases", cases.len());
    for c in cases {
        let positions = numbers(c, "positions");
        let kept: Vec<usize> = numbers(c, "kept").into_iter().map(|i| i as usize).collect();
        assert_eq!(longest_kept_order(&positions), kept, "{positions:?}");
    }
}
