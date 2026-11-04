use std::collections::HashSet;

use blok_jsjson::{Kind, Node};

use crate::host_fixture_test::{REPO_ROOT, read_repo_file};
use crate::normalize_test::{id_of, normalize_document, records};
use crate::room::new_guid;
use crate::roomharness_test::new_test_room;
use crate::test_support::{lookup, must_parse, shared_executor, stable, string_of};
use crate::wire::{is_true, write};
use crate::{Actor, Cancel};

// The stored runner over test/fixtures/agent-commands, as C#
// JintAgentParityTests runs it: one session per case, and the "jint"
// expectation, because Rust sends the bundle the same input bytes C# does
// (host.json pins them) and so takes the same runtime path.

const CORPUS_ROOT: &str = "test/fixtures/agent-commands";

struct ParityCase {
    name: String,
    seed: Node,
    batches: Vec<Node>,
    expect: Option<Node>,
    expect_runners: Option<Node>,
}

fn json_files(dir: &str) -> Vec<String> {
    let path = format!("{REPO_ROOT}/{CORPUS_ROOT}/{dir}");
    let mut names: Vec<String> = std::fs::read_dir(&path)
        .unwrap_or_else(|err| panic!("{path}: {err}"))
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    names
}

fn load_corpus() -> Vec<ParityCase> {
    let mut list = Vec::new();
    for file in json_files("cases") {
        let item = must_parse(&read_repo_file(&format!("{CORPUS_ROOT}/cases/{file}")));
        // The C# and Rust runtimes get service names but no host bridge, so
        // a case with fixed services has a twin without them.
        if lookup(Some(&item), "services").is_some() {
            continue;
        }
        list.push(ParityCase {
            name: string_of(lookup(Some(&item), "name")).unwrap_or_default(),
            seed: lookup(Some(&item), "seed").expect("seed").clone(),
            batches: lookup(Some(&item), "batches")
                .expect("batches")
                .items
                .clone(),
            expect: lookup(Some(&item), "expect").cloned(),
            expect_runners: lookup(Some(&item), "expectByRunner").cloned(),
        });
    }
    for file in json_files("evals") {
        let item = must_parse(&read_repo_file(&format!("{CORPUS_ROOT}/evals/{file}")));
        if lookup(Some(&item), "parityExcluded").is_some() {
            continue;
        }
        list.push(ParityCase {
            name: format!(
                "eval:{}",
                string_of(lookup(Some(&item), "id")).unwrap_or_default()
            ),
            seed: lookup(Some(&item), "seed").expect("seed").clone(),
            batches: lookup(Some(&item), "reference")
                .expect("reference")
                .items
                .clone(),
            expect: None,
            expect_runners: lookup(Some(&item), "referenceExpectByRunner").cloned(),
        });
    }
    list
}

/// C# AgentParityCorpus.ExpectedError; "" means ok.
fn expected_error(case: &ParityCase, runner: &str) -> String {
    let expectation = lookup(case.expect_runners.as_ref(), runner)
        .filter(|e| e.kind == Kind::Object)
        .or(case.expect.as_ref());
    string_of(lookup(expectation, "errorCode")).unwrap_or_default()
}

fn caller_chosen_ids(case: &ParityCase) -> HashSet<String> {
    let mut ids: HashSet<String> = records(lookup(Some(&case.seed), "blocks"))
        .into_iter()
        .filter_map(id_of)
        .collect();
    fn collect(node: Option<&Node>, ids: &mut HashSet<String>) {
        let Some(node) = node else { return };
        match node.kind {
            Kind::Array => node.items.iter().for_each(|item| collect(Some(item), ids)),
            Kind::Object => {
                if let Some(id) = id_of(node) {
                    ids.insert(id);
                }
                collect(lookup(Some(node), "children"), ids);
            }
            _ => {}
        }
    }
    for batch in &case.batches {
        for command in records(lookup(Some(batch), "commands")) {
            if string_of(lookup(Some(command), "name")).as_deref() == Some("block.insert") {
                collect(lookup(Some(command), "args"), &mut ids);
            }
        }
    }
    ids
}

fn golden(name: &str) -> Option<Node> {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c.to_string()
            } else {
                "__".to_owned()
            }
        })
        .collect();
    let path = format!("{REPO_ROOT}/{CORPUS_ROOT}/goldens/{safe}.json");
    let raw = std::fs::read_to_string(path).ok()?;
    lookup(Some(&must_parse(&raw)), "document").cloned()
}

#[tokio::test]
async fn matches_the_agent_command_corpus() {
    let executor = shared_executor();
    let corpus = load_corpus();
    // 39 cases and 13 evals, as the C# reader counts them.
    assert_eq!(corpus.len(), 52, "runnable cases");
    let cancel = Cancel::new();
    let mut failures = Vec::new();
    for case in &corpus {
        let actor = Actor {
            id: "agent-test".to_owned(),
            name: "Parity".to_owned(),
            on_behalf_of: Some("human-1".to_owned()),
        };
        let mut session = executor.open_session(actor, None);
        let mut document = write(&case.seed).expect("write");
        let mut code = String::new();
        for batch in &case.batches {
            let batch = write(batch).expect("write");
            let execution = session
                .execute(&cancel, &document, &batch)
                .await
                .unwrap_or_else(|err| panic!("{}: execute: {err}", case.name));
            let result = must_parse(&execution.result_json);
            if !is_true(Some(&result), "ok").unwrap_or(false) {
                code =
                    string_of(lookup(lookup(Some(&result), "error"), "code")).unwrap_or_default();
                break;
            }
            document = execution.document_json.expect("a document");
        }
        let want = expected_error(case, "jint");
        if code != want {
            failures.push(format!("{}: error {code:?}, want {want:?}", case.name));
            continue;
        }
        if !code.is_empty() || !expected_error(case, "json").is_empty() {
            continue;
        }
        let Some(want) = golden(&case.name) else {
            failures.push(format!("{}: no golden", case.name));
            continue;
        };
        let got = normalize_document(&must_parse(&document), &caller_chosen_ids(case));
        if stable(Some(&got)) != stable(Some(&want)) {
            failures.push(format!(
                "{}: document\n got {}\nwant {}",
                case.name,
                stable(Some(&got)),
                stable(Some(&want))
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// The live-room runner over the same corpus, as C# RoomAgentParityTests: a
// real room on the real converter and journal, the "room" expectation, and
// the stored golden when the case succeeds everywhere.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matches_the_agent_command_corpus_in_a_room() {
    let corpus = load_corpus();
    assert_eq!(corpus.len(), 52, "runnable cases");
    let actor = Actor {
        id: "agent-test".to_owned(),
        name: "Parity".to_owned(),
        on_behalf_of: Some("human-1".to_owned()),
    };
    let cancel = Cancel::new();
    let mut failures = Vec::new();
    for case in &corpus {
        let rooms = new_test_room(false, None);
        let doc = format!("parity-{}", new_guid());
        rooms.docs.hold(&doc, &write(&case.seed).expect("write"));
        let mut code = String::new();
        for batch in &case.batches {
            let batch = write(batch).expect("write");
            let execution = rooms
                .executor
                .execute_in_room(&cancel, &doc, &batch, &actor, None)
                .await
                .unwrap_or_else(|err| panic!("{}: execute: {err}", case.name));
            let result = must_parse(&execution.result_json);
            if !is_true(Some(&result), "ok").unwrap_or(false) {
                code =
                    string_of(lookup(lookup(Some(&result), "error"), "code")).unwrap_or_default();
                break;
            }
        }
        let want = expected_error(case, "room");
        if code != want {
            failures.push(format!("{}: error {code:?}, want {want:?}", case.name));
            continue;
        }
        // Same gate as the stored runner: content only.
        if !code.is_empty() || !expected_error(case, "json").is_empty() {
            continue;
        }
        let Some(want) = golden(&case.name) else {
            failures.push(format!("{}: no golden", case.name));
            continue;
        };
        let got = normalize_document(&rooms.export(&doc).await, &caller_chosen_ids(case));
        if stable(Some(&got)) != stable(Some(&want)) {
            failures.push(format!(
                "{}: document\n got {}\nwant {}",
                case.name,
                stable(Some(&got)),
                stable(Some(&want))
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
