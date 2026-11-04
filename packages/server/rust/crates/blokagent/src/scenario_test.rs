use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use blok_jsjson::{Kind, Node, new_member, new_object, to_string_lossy};

use crate::host_fixture_test::{REPO_ROOT, read_repo_file};
use crate::normalize_test::{deep_equals, records};
use crate::scenario_room_test::{fill_scenario, headed, open_scenario_room, step_actor};
use crate::test_support::{lookup, must_parse, pointer, shared_executor, stable, string_of};
use crate::wire::{is_true, present, str_node, write};
use crate::{
    Actor, Cancel, Error, Execution, Executor, HostFuture, Options, PageCreator, PageLocation,
    PageTarget, Session, StoredPage,
};

// The Rust reader of test/fixtures/agent-server-scenarios. The runner
// contract is written on the C# reader, AgentServerScenarioTests.cs.

const SCENARIO_ROOT: &str = "test/fixtures/agent-server-scenarios";

fn scenario_actor() -> Actor {
    Actor {
        id: "agent-cs".to_owned(),
        name: "Server agent".to_owned(),
        on_behalf_of: Some("human-1".to_owned()),
    }
}

#[derive(Default)]
struct HostState {
    stored: HashMap<String, String>,
    resolved: Vec<String>,
    saved: Vec<String>,
    created: Vec<String>,
    problems: Vec<String>,
}

struct ScenarioHost {
    scenario: Node,
    state: Mutex<HostState>,
    creates: bool,
}

impl ScenarioHost {
    fn new(scenario: &Node, creates: bool) -> ScenarioHost {
        let mut state = HostState::default();
        if let Some(pages) = lookup(Some(scenario), "pages") {
            for m in &pages.members {
                if let Some(stored) = lookup(Some(&m.value), "stored") {
                    let key = to_string_lossy(m.key().expect("key").units());
                    state.stored.insert(key, write(stored).expect("write"));
                }
            }
        }
        ScenarioHost {
            scenario: scenario.clone(),
            state: Mutex::new(state),
            creates,
        }
    }

    fn same_actor(&self, actor: &Actor) {
        if *actor != scenario_actor() {
            self.state
                .lock()
                .expect("lock")
                .problems
                .push(format!("host got actor {actor:?}"));
        }
    }
}

struct ScenarioPage {
    host: Arc<ScenarioHost>,
    page_id: String,
}

impl StoredPage for ScenarioPage {
    fn load<'a>(&'a self, _: &'a Cancel) -> HostFuture<'a, String> {
        let document = self.host.state.lock().expect("lock").stored[&self.page_id].clone();
        Box::pin(async move { Ok(document) })
    }

    fn save<'a>(&'a self, _: &'a Cancel, document_json: &'a str) -> HostFuture<'a, ()> {
        let mut state = self.host.state.lock().expect("lock");
        state
            .stored
            .insert(self.page_id.clone(), document_json.to_owned());
        state.saved.push(document_json.to_owned());
        Box::pin(async { Ok(()) })
    }
}

struct Target(Arc<ScenarioHost>);

impl PageTarget for Target {
    fn resolve<'a>(
        &'a self,
        _: &'a Cancel,
        page_id: &'a str,
        actor: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>> {
        let host = &self.0;
        host.same_actor(actor);
        host.state
            .lock()
            .expect("lock")
            .resolved
            .push(page_id.to_owned());
        let page = lookup(lookup(Some(&host.scenario), "pages"), page_id);
        let location = if let Some(room) = string_of(lookup(page, "room")) {
            Some(PageLocation::Room { doc_id: room })
        } else if host
            .state
            .lock()
            .expect("lock")
            .stored
            .contains_key(page_id)
        {
            Some(PageLocation::Stored(Box::new(ScenarioPage {
                host: host.clone(),
                page_id: page_id.to_owned(),
            })))
        } else {
            None
        };
        Box::pin(async move { Ok(location) })
    }

    fn as_creator(&self) -> Option<&dyn PageCreator> {
        if self.0.creates { Some(self) } else { None }
    }
}

impl PageCreator for Target {
    fn create<'a>(&'a self, _: &'a Cancel, actor: &'a Actor) -> HostFuture<'a, Option<String>> {
        let host = &self.0;
        host.same_actor(actor);
        let mut state = host.state.lock().expect("lock");
        let at = state.created.len();
        let mut page_id = format!("host-{}", at + 1);
        if let Some(script) = lookup(Some(&host.scenario), "create")
            && at < script.items.len()
        {
            page_id = string_of(Some(&script.items[at])).unwrap_or_default();
        }
        if !page_id.is_empty() {
            state.created.push(page_id.clone());
        }
        Box::pin(async move { Ok(Some(page_id)) })
    }
}

fn scenario_options(
    node: Option<&Node>,
    scenario: &Node,
) -> (Option<Options>, Option<Arc<ScenarioHost>>) {
    let Some(node) = node.filter(|node| node.kind == Kind::Object) else {
        return (None, None);
    };
    let mut options = Options {
        page_titles: lookup(Some(node), "pageTitles").is_some_and(|v| v.kind == Kind::True),
        custom_tools_json: string_of(lookup(Some(node), "customTools")),
        overrides_json: string_of(lookup(Some(node), "overrides")),
        disable_built_in_comments: lookup(Some(node), "builtInComments")
            .is_some_and(|v| v.kind == Kind::False),
        page_target: None,
    };
    let mut host = None;
    match string_of(lookup(Some(node), "target")).as_deref() {
        None | Some("") => {}
        Some(target @ ("plain" | "creator")) => {
            let made = Arc::new(ScenarioHost::new(scenario, target == "creator"));
            options.page_target = Some(Arc::new(Target(made.clone())));
            host = Some(made);
        }
        Some(other) => panic!("unknown target {other}"),
    }
    (Some(options), host)
}

pub(crate) fn check_pointers(
    failures: &mut Vec<String>,
    place: &str,
    root: &Node,
    pointers: Option<&Node>,
) {
    let Some(pointers) = pointers else { return };
    for m in &pointers.members {
        let path = to_string_lossy(m.key().expect("key").units());
        let want = &m.value;
        let got = pointer(root, &path);
        if lookup(Some(want), "absent").is_some() {
            if got.is_some() {
                failures.push(format!(
                    "{place}: {path} should be absent, got {}",
                    stable(got)
                ));
            }
        } else if lookup(Some(want), "present").is_some() {
            if !present(got) {
                failures.push(format!("{place}: {path} should be present"));
            }
        } else if let Some(length) = lookup(Some(want), "length") {
            let count: usize = std::str::from_utf8(length.raw())
                .ok()
                .and_then(|raw| raw.parse().ok())
                .unwrap_or(usize::MAX);
            if !got.is_some_and(|got| got.kind == Kind::Array && got.items.len() == count) {
                failures.push(format!("{place}: {path} length, got {}", stable(got)));
            }
        } else if got.is_none() || !deep_equals(Some(want), got) {
            failures.push(format!(
                "{place}: {path} = {}, want {}",
                stable(got),
                stable(Some(want))
            ));
        }
    }
}

fn check_contract(failures: &mut Vec<String>, place: &str, contract: &Node, expect: &Node) {
    for list in ["commands", "blocks"] {
        let Some(wanted) = lookup(Some(expect), list) else {
            continue;
        };
        let entries = if list == "blocks" {
            lookup(lookup(Some(contract), "manifest"), "blocks")
        } else {
            lookup(Some(contract), "commands")
        };
        for m in &wanted.members {
            let name = to_string_lossy(m.key().expect("key").units());
            let entry = records(entries).into_iter().rfind(|candidate| {
                string_of(lookup(Some(candidate), "name")).as_deref() == Some(name.as_str())
            });
            if lookup(Some(&m.value), "absent").is_some() {
                if entry.is_some() {
                    failures.push(format!("{place}: {list} {name} should be absent"));
                }
                continue;
            }
            let Some(entry) = entry else {
                failures.push(format!("{place}: {list} has no {name}"));
                continue;
            };
            let fields = new_object(
                m.value
                    .members
                    .iter()
                    .map(|field| {
                        let key = to_string_lossy(field.key().expect("key").units());
                        new_member(&format!("/{key}"), field.value.clone())
                    })
                    .collect(),
            );
            check_pointers(failures, &format!("{place} {name}"), entry, Some(&fields));
        }
    }
}

fn indexed(node: &Node, repeat: usize) -> Node {
    let mut copied = node.clone();
    fn walk(node: &mut Node, repeat: usize) {
        for item in &mut node.items {
            walk(item, repeat);
        }
        for m in &mut node.members {
            match string_of(Some(&m.value)) {
                Some(value) => m.value = str_node(&value.replace("{i}", &repeat.to_string())),
                None => walk(&mut m.value, repeat),
            }
        }
    }
    walk(&mut copied, repeat);
    copied
}

fn scenario_names() -> Vec<String> {
    let path = format!("{REPO_ROOT}/{SCENARIO_ROOT}");
    let mut names: Vec<String> = std::fs::read_dir(&path)
        .unwrap_or_else(|err| panic!("{path}: {err}"))
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter_map(|name| name.strip_suffix(".json").map(str::to_owned))
        .collect();
    names.sort();
    names
}

pub(crate) fn load(name: &str) -> Node {
    must_parse(&read_repo_file(&format!("{SCENARIO_ROOT}/{name}.json")))
}

async fn run_scenario(name: &str, scenario: &Node, failures: &mut Vec<String>) {
    let live = lookup(Some(scenario), "room")
        .map(|spec| open_scenario_room(spec, lookup(Some(scenario), "seed").expect("seed")));
    let executor: &Executor = match &live {
        Some(live) => &live.room.executor,
        None => shared_executor(),
    };
    let mut revisions: HashMap<usize, String> = HashMap::new();
    let cancel = Cancel::new();
    let (options, host) = scenario_options(lookup(Some(scenario), "options"), scenario);
    let seed = write(lookup(Some(scenario), "seed").expect("seed")).expect("write");
    let mut last = seed.clone();
    let mut by_step: HashMap<usize, String> = HashMap::new();
    let mut sessions: HashMap<String, Session<'_>> = HashMap::new();
    let empty = new_object(Vec::new());
    for (index, step) in lookup(Some(scenario), "steps")
        .expect("steps")
        .items
        .iter()
        .enumerate()
    {
        let run = string_of(lookup(Some(step), "run")).unwrap_or_default();
        let given = lookup(Some(step), "expect").unwrap_or(&empty);
        let times: usize = lookup(Some(step), "times")
            .and_then(|n| std::str::from_utf8(n.raw()).ok()?.parse().ok())
            .unwrap_or(1);
        for repeat in 0..times {
            let place = format!("{name} step {index}#{repeat}");
            let expect = given;
            if run.starts_with("contract:") {
                let contract = match run.as_str() {
                    "contract:plain" => executor.contract(&cancel, options.as_ref()).await,
                    "contract:session" => {
                        executor
                            .open_session(scenario_actor(), options.clone())
                            .contract(&cancel)
                            .await
                    }
                    "contract:room" => executor.room_contract(&cancel, options.as_ref()).await,
                    other => panic!("{place}: unknown run {other}"),
                };
                let contract = contract.unwrap_or_else(|err| panic!("{place}: {err}"));
                check_contract(failures, &place, &must_parse(&contract), expect);
                continue;
            }
            let current = match &live {
                Some(live) => live.head(&live.doc).await,
                None => String::new(),
            };
            let fill = |text: &str, revisions: &HashMap<usize, String>| -> String {
                match &live {
                    Some(_) => fill_scenario(text, revisions, &current),
                    None => text.to_owned(),
                }
            };
            if matches!(
                run.as_str(),
                "peer" | "reset" | "purge" | "restore" | "drain" | "failListings"
            ) {
                let live = live.as_ref().expect("a room");
                live.host_step(&place, &run, step, &|text| fill(text, &revisions))
                    .await;
                continue;
            }
            let doc = live
                .as_ref()
                .map(|live| live.step_doc(step))
                .unwrap_or_default();
            let (before_head, before_blocks) = match &live {
                Some(live) => (live.head(&doc).await, live.blocks(&doc).await),
                None => (String::new(), String::new()),
            };
            let reference = |reference: &str| -> String {
                match reference {
                    "@seed" => seed.clone(),
                    "@last" => last.clone(),
                    other => {
                        let at: usize = other
                            .strip_prefix("@step:")
                            .and_then(|n| n.parse().ok())
                            .unwrap_or_else(|| panic!("unknown document {other}"));
                        by_step.get(&at).cloned().unwrap_or_default()
                    }
                }
            };
            let document = match lookup(Some(step), "document") {
                None => String::new(),
                Some(spec) => match string_of(Some(spec)) {
                    Some(reference_name) => reference(&reference_name),
                    None => {
                        let base = string_of(lookup(Some(spec), "from")).unwrap_or_default();
                        let mut from = must_parse(&reference(&base));
                        for m in &lookup(Some(spec), "set").expect("set").members {
                            let key = to_string_lossy(m.key().expect("key").units());
                            let parts: Vec<&str> = key.split('/').skip(1).collect();
                            let (leaf, path) = parts.split_last().expect("a path");
                            let mut parent = &mut from;
                            for part in path {
                                parent = match parent.kind {
                                    Kind::Array => {
                                        &mut parent.items[part.parse::<usize>().expect("an index")]
                                    }
                                    _ => parent.lookup_mut(part).expect("lookup").expect("a step"),
                                };
                            }
                            parent.set(leaf, m.value.clone()).expect("set");
                        }
                        write(&from).expect("write")
                    }
                },
            };
            let batch = write(&indexed(
                lookup(Some(step), "batch").expect("batch"),
                repeat,
            ))
            .expect("write");
            let batch = fill(&batch, &revisions);
            let outcome: Result<Execution, Error> = match run.as_str() {
                "room" => {
                    executor
                        .execute_in_room(
                            &cancel,
                            &doc,
                            &batch,
                            &step_actor(step, scenario_actor()),
                            options.as_ref(),
                        )
                        .await
                }
                "plain" => {
                    executor
                        .execute(
                            &cancel,
                            &document,
                            &batch,
                            &scenario_actor(),
                            options.as_ref(),
                        )
                        .await
                }
                session_name => {
                    let session = sessions.entry(session_name.to_owned()).or_insert_with(|| {
                        executor.open_session(scenario_actor(), options.clone())
                    });
                    session.execute(&cancel, &document, &batch).await
                }
            };
            if let Some(live) = &live {
                live.heal_listings();
            }
            // A step the executor throws on: only the error's kind and text are the answer.
            if let Some(throws) = lookup(Some(expect), "throws") {
                let kind = string_of(lookup(Some(throws), "type")).unwrap_or_default();
                let message = string_of(lookup(Some(throws), "message")).unwrap_or_default();
                match &outcome {
                    Err(Error::InvalidOperation(got))
                        if kind == "InvalidOperation" && *got == message => {}
                    other => {
                        failures.push(format!("{place}: threw {other:?}, want {kind}: {message}"))
                    }
                }
                continue;
            }
            let execution = match outcome {
                Ok(execution) => execution,
                Err(err) => {
                    failures.push(format!("{place}: {err}"));
                    return;
                }
            };
            let result = must_parse(&execution.result_json);
            revisions.insert(index, execution.revision.clone());
            let mut head = String::new();
            let rewritten;
            let expect = match &live {
                Some(live) => {
                    head = live.head(&doc).await;
                    let written = fill(&write(expect).expect("write"), &revisions);
                    rewritten = headed(must_parse(&written), &head);
                    &rewritten
                }
                None => expect,
            };
            if let Some(want) = lookup(Some(expect), "ok")
                && is_true(Some(&result), "ok").unwrap_or(false) != (want.kind == Kind::True)
            {
                failures.push(format!("{place}: ok\n{}", execution.result_json));
                return;
            }
            if let Some(want) = string_of(lookup(Some(expect), "code")) {
                let got =
                    string_of(lookup(lookup(Some(&result), "error"), "code")).unwrap_or_default();
                if got != want {
                    failures.push(format!(
                        "{place}: code {got}, want {want}\n{}",
                        execution.result_json
                    ));
                    return;
                }
            }
            if let Some(want) = lookup(Some(expect), "saved")
                && execution.document_json.is_some() != (want.kind == Kind::True)
            {
                failures.push(format!("{place}: saved\n{}", execution.result_json));
                return;
            }
            let revision = string_of(lookup(Some(&result), "revision")).unwrap_or_default();
            if revision != execution.revision {
                failures.push(format!(
                    "{place}: revision {:?}, result says {revision:?}",
                    execution.revision
                ));
            }
            check_pointers(
                failures,
                &format!("{place} result"),
                &result,
                lookup(Some(expect), "result"),
            );
            if let Some(pointers) = lookup(Some(expect), "document") {
                let saved = must_parse(execution.document_json.as_deref().unwrap_or("null"));
                check_pointers(
                    failures,
                    &format!("{place} document"),
                    &saved,
                    Some(pointers),
                );
            }
            if lookup(Some(expect), "revisionEqualsRead").is_some_and(|v| v.kind == Kind::True) {
                let read = executor
                    .execute(
                        &cancel,
                        &document,
                        r#"{"commands":[{"name":"doc.read","args":{"detail":"outline"}}]}"#,
                        &scenario_actor(),
                        None,
                    )
                    .await;
                if !read
                    .as_ref()
                    .is_ok_and(|r| r.revision == execution.revision)
                {
                    failures.push(format!(
                        "{place}: revision {:?}, a read gives {:?}",
                        execution.revision,
                        read.map(|r| r.revision)
                    ));
                }
            }
            if let Some(live) = &live {
                live.check(
                    failures,
                    &place,
                    &doc,
                    expect,
                    &execution,
                    &head,
                    &before_head,
                    &before_blocks,
                    |at| by_step.get(&at).cloned().unwrap_or_default(),
                    lookup(Some(scenario), "seed").expect("seed"),
                )
                .await;
            }
            if let Some(saved) = execution.document_json {
                last = saved;
                by_step.insert(index, last.clone());
            }
        }
    }

    if let Some(live) = &live {
        live.room
            .manager
            .drain()
            .await
            .unwrap_or_else(|err| panic!("{name}: drain: {err}"));
    }
    let expect_host = lookup(Some(scenario), "host");
    let state = host.as_ref().map(|host| {
        let state = host.state.lock().expect("lock");
        (
            state.resolved.clone(),
            state.created.clone(),
            state.saved.clone(),
            state.problems.clone(),
        )
    });
    let (resolved, created, saved, problems) = state.unwrap_or_default();
    failures.extend(problems.into_iter().map(|p| format!("{name}: {p}")));
    for (key, list) in [("resolved", &resolved), ("created", &created)] {
        if let Some(want) = lookup(expect_host, key) {
            let names: Vec<String> = want
                .items
                .iter()
                .filter_map(|item| string_of(Some(item)))
                .collect();
            if names != *list && names.len() + list.len() > 0 {
                failures.push(format!("{name}: {key} {list:?}, want {names:?}"));
            }
        }
    }
    if let Some(saves) = lookup(expect_host, "saved") {
        if saves.items.len() != saved.len() {
            failures.push(format!(
                "{name}: {} saves, want {}",
                saved.len(),
                saves.items.len()
            ));
            return;
        }
        for (i, want) in saves.items.iter().enumerate() {
            check_pointers(
                failures,
                &format!("{name} save {i}"),
                &must_parse(&saved[i]),
                Some(want),
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matches_the_agent_server_scenarios() {
    let names = scenario_names();
    assert!(!names.is_empty(), "no scenarios");
    let mut failures = Vec::new();
    let mut rooms = 0;
    for name in &names {
        let scenario = load(name);
        if lookup(Some(&scenario), "room").is_some() {
            rooms += 1;
        }
        run_scenario(name, &scenario, &mut failures).await;
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(rooms, 88, "room scenarios");
}
