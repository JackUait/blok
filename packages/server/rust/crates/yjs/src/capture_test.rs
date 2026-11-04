//! The C#-captured golden (Blok.Server.Tests/Yjs/CSharpCaptureTests.cs):
//! after every scenario and fuzz step, the engine must answer what the C#
//! engine answered, byte for byte where bytes are involved.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use blok_jsjson::Value;
use blok_yjs_yjstest as yjstest;
use sha2::{Digest, Sha256};

use crate::scenario_test::{ScenarioRunner, fuzz_seeds, scenarios, selected};
use crate::test_support::*;
use crate::{ApplyResult, Doc, UpdateEvent};

fn capture_hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()[..12]
        .to_string()
}

/// One step rendered the way the C# test writes it.
fn capture_step(
    doc: &Doc,
    previous: &[u8],
    first: &[u8],
    minted: bool,
    emitted: &[UpdateEvent],
    result: Option<&ApplyResult>,
) -> String {
    let mut line = format!(
        r#"{{"sv": "{}", "full": "{}", "prev": "{}", "first": "{}""#,
        b64_encode(&doc.encode_state_vector()),
        capture_hash(&encode_state(doc, &[])),
        capture_hash(&encode_state(doc, previous)),
        capture_hash(&encode_state(doc, first)),
    );
    if doc.has_pending() {
        line += r#", "pending": true"#;
    }
    if minted {
        line += r#", "minted": true"#;
    }
    if !emitted.is_empty() {
        let events: Vec<String> = emitted
            .iter()
            .map(|e| {
                format!(
                    r#"{{"update": "{}", "local": {}}}"#,
                    capture_hash(&e.update),
                    e.local
                )
            })
            .collect();
        line += &format!(r#", "emitted": [{}]"#, events.join(", "));
    }
    if let Some(result) = result {
        line += &format!(
            r#", "apply": {{"pendingRemains": {}, "changed": {}}}"#,
            result.pending_remains, result.changed
        );
    }
    line + "}"
}

fn expected_step(step: &Value) -> String {
    let mut line = format!(
        r#"{{"sv": "{}", "full": "{}", "prev": "{}", "first": "{}""#,
        yjstest::string(step, "sv"),
        yjstest::string(step, "full"),
        yjstest::string(step, "prev"),
        yjstest::string(step, "first"),
    );
    if yjstest::bool(step, "pending") {
        line += r#", "pending": true"#;
    }
    if yjstest::bool(step, "minted") {
        line += r#", "minted": true"#;
    }
    let events = yjstest::items(step, "emitted");
    if !events.is_empty() {
        let events: Vec<String> = events
            .iter()
            .map(|e| {
                format!(
                    r#"{{"update": "{}", "local": {}}}"#,
                    yjstest::string(e, "update"),
                    yjstest::bool(e, "local")
                )
            })
            .collect();
        line += &format!(r#", "emitted": [{}]"#, events.join(", "));
    }
    if let Some(apply) = yjstest::field(step, "apply") {
        line += &format!(
            r#", "apply": {{"pendingRemains": {}, "changed": {}}}"#,
            yjstest::bool(apply, "pendingRemains"),
            yjstest::bool(apply, "changed")
        );
    }
    line + "}"
}

#[test]
fn every_step_matches_the_csharp_capture() {
    let captured = fixture_cases("csharp-capture.json");
    let cases: Vec<_> = scenarios().into_iter().chain(fuzz_seeds()).collect();
    assert_eq!(
        captured.len(),
        cases.len(),
        "the capture holds {} cases, the fixtures {}; rerun CSharpCaptureTests with BLOK_WRITE_CSHARP_CAPTURE=1",
        captured.len(),
        cases.len()
    );
    let mut checked = 0;
    let mut failures = Vec::new();
    for (index, c) in cases.into_iter().enumerate() {
        assert_eq!(
            yjstest::string(&captured[index], "name"),
            c.name,
            "case {index}"
        );
        let steps = yjstest::items(&captured[index], "steps");
        assert_eq!(steps.len(), c.steps.len(), "{}: captured steps", c.name);
        if !selected(&c.name) {
            continue;
        }
        let mut runner = ScenarioRunner::new(c.clone());
        let emitted: Arc<Mutex<Vec<UpdateEvent>>> = Arc::default();
        let sink = emitted.clone();
        let _subscription = runner
            .doc
            .on_update(move |event| sink.lock().unwrap().push(event.clone()));
        let result: Rc<RefCell<Option<ApplyResult>>> = Rc::default();
        let slot = result.clone();
        runner.observe = Some(Box::new(move |_, _, applied| {
            *slot.borrow_mut() = applied.cloned()
        }));
        let mut previous = runner.doc.encode_state_vector();
        let mut first: Option<Vec<u8>> = None;
        for (at, step) in c.steps.iter().enumerate() {
            let client_before = runner.doc.client_id();
            emitted.lock().unwrap().clear();
            *result.borrow_mut() = None;
            runner.run(step);
            let sv = runner.doc.encode_state_vector();
            if first.is_none() && sv.len() > 1 {
                first = Some(sv.clone());
            }
            let got = capture_step(
                &runner.doc,
                &previous,
                first.as_deref().unwrap_or(&[]),
                runner.doc.client_id() != client_before,
                &emitted.lock().unwrap(),
                result.borrow().as_ref(),
            );
            let want = expected_step(&steps[at]);
            checked += 1;
            if got != want {
                failures.push(format!(
                    "{} step {at} ({} {:?}):\n got {got}\nwant {want}",
                    c.name, step.kind, step.id
                ));
                break;
            }
            previous = sv;
        }
        failures.extend(runner.failures);
    }
    assert!(checked > 0, "nothing was checked");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
