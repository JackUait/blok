use crate::changes_test::{array, member, string};
use crate::history_fixture_test::{history_fixture, stringified};
use crate::restore_guards::restore_guards;

// The twin of C# CollabHistoryCaptureTests.TheRestoreGuardsMatchTheRules.
#[test]
fn restore_guards_match_the_fixture() {
    let mut failures = Vec::new();
    for c in history_fixture("restore-guards.json") {
        let name = string(member(&c, "name"));
        let wanted: Vec<String> = array(member(&c, "guards"))
            .iter()
            .map(stringified)
            .collect();
        let got: Vec<String> =
            restore_guards(array(member(&c, "current")), array(member(&c, "target")))
                .iter()
                .map(|guard| stringified(&guard.json()))
                .collect();
        if got != wanted {
            failures.push(format!("{name}: guards are {got:?}, want {wanted:?}"));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
