use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_blokdocs::{ConversionError, Reason};
use sha2::{Digest, Sha256};

use crate::test_json::{self, Json};
use crate::{
    Actor, Cancel, CancelReason, Error, Execution, Executor, HostFuture, InvokeFuture, Invoker,
    Options, PageCreator, PageLocation, PageTarget, StoredPage,
};

pub(crate) const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../..");

// Longer strings are pinned by length and hash, as AgentHostFixtureTests does.
const MAX_INLINE: usize = 65536;

pub(crate) fn read_repo_file(path: &str) -> String {
    let path = format!("{REPO_ROOT}/{path}");
    std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{path}: {err}"))
}

fn object(members: Vec<(&str, Json)>) -> Json {
    Json::Object(
        members
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<BTreeMap<_, _>>(),
    )
}

fn string(text: &str) -> Json {
    Json::String(text.to_owned())
}

fn member<'a>(json: &'a Json, key: &str) -> Option<&'a Json> {
    match json {
        Json::Object(map) => map.get(key).filter(|value| **value != Json::Null),
        _ => None,
    }
}

/// A fixture string: text, or {template, fill:[{marker, unit, count}]}.
fn scripted(raw: Option<&Json>) -> String {
    match raw {
        None => String::new(),
        Some(Json::String(text)) => text.clone(),
        Some(spec) => {
            let mut text = spec.get("template").str().to_owned();
            for fill in spec.get("fill").array() {
                let unit = fill
                    .get("unit")
                    .str()
                    .repeat(fill.get("count").number() as usize);
                text = text.replace(fill.get("marker").str(), &unit);
            }
            text
        }
    }
}

fn pinned(text: Option<&str>) -> Json {
    let Some(text) = text else { return Json::Null };
    let length = text.encode_utf16().count();
    if length <= MAX_INLINE {
        return string(text);
    }
    let hex: String = Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    object(vec![
        ("length", Json::Number(length as f64)),
        ("sha256", string(&hex)),
    ])
}

#[derive(Debug)]
struct HostFailure;

impl fmt::Display for HostFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The host's page store is down.")
    }
}

impl std::error::Error for HostFailure {}

struct Recorder {
    events: Mutex<Vec<Json>>,
    cancel: Cancel,
    deadline: bool,
    host: Json,
    creates: Mutex<usize>,
}

impl Recorder {
    fn push(&self, event: Json) {
        self.events.lock().expect("lock").push(event);
    }

    fn reason(&self) -> CancelReason {
        if self.deadline {
            CancelReason::DeadlineExceeded
        } else {
            CancelReason::Cancelled
        }
    }

    fn stop(&self) {
        if self.deadline {
            self.cancel.expire();
        } else {
            self.cancel.cancel();
        }
    }

    fn hook(&self, name: &str) -> Result<(), Error> {
        if member(&self.host, "cancelOn").map(Json::str) == Some(name) {
            self.stop();
        }
        match member(&self.host, "throwOn")
            .and_then(|on| member(on, name))
            .map(Json::str)
        {
            Some("cancel") => Err(Error::Cancelled(self.reason())),
            Some("error") => Err(Error::Host(Box::new(HostFailure))),
            _ => Ok(()),
        }
    }
}

fn actor_event(actor: &Actor) -> Json {
    object(vec![
        ("id", string(&actor.id)),
        ("name", string(&actor.name)),
        (
            "onBehalfOf",
            actor.on_behalf_of.as_deref().map_or(Json::Null, string),
        ),
    ])
}

struct Stored {
    recorder: Arc<Recorder>,
    document: String,
}

impl StoredPage for Stored {
    fn load<'a>(&'a self, _: &'a Cancel) -> HostFuture<'a, String> {
        self.recorder.push(object(vec![("host", string("load"))]));
        let result = self.recorder.hook("load").map(|()| self.document.clone());
        Box::pin(async move { result })
    }

    fn save<'a>(&'a self, _: &'a Cancel, document_json: &'a str) -> HostFuture<'a, ()> {
        self.recorder.push(object(vec![
            ("host", string("save")),
            ("document", pinned(Some(document_json))),
        ]));
        let result = self.recorder.hook("save");
        Box::pin(async move { result })
    }
}

struct Target {
    recorder: Arc<Recorder>,
    creates: bool,
}

impl PageTarget for Target {
    fn resolve<'a>(
        &'a self,
        _: &'a Cancel,
        page_id: &'a str,
        actor: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>> {
        let r = &self.recorder;
        r.push(object(vec![
            ("host", string("resolve")),
            ("pageId", string(page_id)),
            ("actor", actor_event(actor)),
        ]));
        let result = r.hook("resolve").map(|()| {
            let page = member(&r.host, "pages").and_then(|pages| match pages {
                Json::Object(map) => map.get(page_id),
                _ => None,
            });
            let page = page?;
            if let Some(stored) = member(page, "stored") {
                return Some(PageLocation::Stored(Box::new(Stored {
                    recorder: r.clone(),
                    document: scripted(Some(stored)),
                })));
            }
            member(page, "room").map(|room| PageLocation::Room {
                doc_id: scripted(Some(room)),
            })
        });
        Box::pin(async move { result })
    }

    fn as_creator(&self) -> Option<&dyn PageCreator> {
        if self.creates { Some(self) } else { None }
    }
}

impl PageCreator for Target {
    fn create<'a>(&'a self, _: &'a Cancel, actor: &'a Actor) -> HostFuture<'a, Option<String>> {
        let r = &self.recorder;
        let at = {
            let mut creates = r.creates.lock().expect("lock");
            *creates += 1;
            *creates - 1
        };
        r.push(object(vec![
            ("host", string("create")),
            ("actor", actor_event(actor)),
        ]));
        let result = r.hook(&format!("create:{at}")).map(|()| {
            match member(&r.host, "create").map(Json::array) {
                Some(list) if at < list.len() => list[at].opt_str().map(str::to_owned),
                _ => Some(format!("host-{}", at + 1)),
            }
        });
        Box::pin(async move { result })
    }
}

/// Answers each call with the next scripted step.
struct Scripted {
    recorder: Arc<Recorder>,
    script: Vec<Json>,
    next: Mutex<usize>,
    problems: Mutex<Vec<String>>,
}

impl Invoker for Arc<Scripted> {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        self.recorder.push(object(vec![
            ("op", string(op)),
            ("input", pinned(Some(input))),
        ]));
        if !timeout.is_zero() {
            self.problems
                .lock()
                .expect("lock")
                .push(format!("{op}: timeout {timeout:?}, want the pool's"));
        }
        let outcome = (|| {
            cancel.check()?;
            let step = {
                let mut next = self.next.lock().expect("lock");
                let step = self
                    .script
                    .get(*next)
                    .unwrap_or_else(|| panic!("no scripted answer for call {} ({op})", *next + 1))
                    .clone();
                *next += 1;
                step
            };
            match member(&step, "throw").map(Json::str) {
                None => {}
                Some("cancel") => return Err(Error::Cancelled(self.recorder.reason())),
                Some(kind) => {
                    let reason = match kind {
                        "Unknown" => Reason::Unknown,
                        "InvalidDocument" => Reason::InvalidDocument,
                        "TimedOut" => Reason::TimedOut,
                        "DocumentTooLarge" => Reason::DocumentTooLarge,
                        other => panic!("unknown throw {other}"),
                    };
                    return Err(Error::Conversion(ConversionError {
                        reason,
                        source: None,
                    }));
                }
            }
            if member(&step, "cancelAfter").is_some_and(Json::bool) {
                self.recorder.stop();
            }
            Ok(scripted(member(&step, "answer")))
        })();
        Box::pin(async move { outcome })
    }
}

fn error_shape(err: &Error) -> Json {
    let shape = match err {
        Error::Cancelled(_) => object(vec![("kind", string("cancelled"))]),
        Error::Conversion(conversion) => object(vec![
            ("kind", string("conversion")),
            ("reason", string(&conversion.reason.to_string())),
        ]),
        Error::Host(_) => object(vec![("kind", string("host"))]),
        Error::Argument { param, message } => object(vec![
            ("kind", string("argument")),
            ("param", string(param)),
            ("message", string(message)),
        ]),
        Error::Json(_) => object(vec![("kind", string("json"))]),
        Error::InvalidOperation(message) => object(vec![
            ("kind", string("invalidOperation")),
            ("message", string(message)),
        ]),
        other => object(vec![
            ("kind", string("unexpected")),
            ("message", string(&other.to_string())),
        ]),
    };
    object(vec![("error", shape)])
}

fn execution_shape(execution: &Execution) -> Json {
    object(vec![
        ("result", pinned(Some(&execution.result_json))),
        ("document", pinned(execution.document_json.as_deref())),
        ("revision", string(&execution.revision)),
    ])
}

async fn run_host_case(case: &Json, deadline: bool) -> (Vec<Json>, Vec<Json>, Vec<String>) {
    let cancel = Cancel::new();
    let recorder = Arc::new(Recorder {
        events: Mutex::new(Vec::new()),
        cancel: cancel.clone(),
        deadline,
        host: member(case, "host")
            .cloned()
            .unwrap_or(Json::Object(BTreeMap::new())),
        creates: Mutex::new(0),
    });
    let script = member(case, "runtime")
        .map(|list| list.array().to_vec())
        .unwrap_or_default();
    let runtime = Arc::new(Scripted {
        recorder: recorder.clone(),
        script: script.clone(),
        next: Mutex::new(0),
        problems: Mutex::new(Vec::new()),
    });
    let executor = Executor::on_runtime(runtime.clone());
    let actor_json = case.get("actor");
    let actor = Actor {
        id: actor_json.get("id").str().to_owned(),
        name: actor_json.get("name").str().to_owned(),
        on_behalf_of: member(actor_json, "onBehalfOf").map(|v| v.str().to_owned()),
    };
    let options = member(case, "options").map(|o| Options {
        page_titles: member(o, "pageTitles").is_some_and(Json::bool),
        custom_tools_json: member(o, "customTools").map(|v| v.str().to_owned()),
        overrides_json: member(o, "overrides").map(|v| v.str().to_owned()),
        disable_built_in_comments: member(o, "builtInComments").is_some_and(|v| !v.bool()),
        page_target: match member(o, "target").map(Json::str) {
            None | Some("") => None,
            Some("plain") => Some(Arc::new(Target {
                recorder: recorder.clone(),
                creates: false,
            }) as Arc<dyn PageTarget>),
            Some("creator") => Some(Arc::new(Target {
                recorder: recorder.clone(),
                creates: true,
            }) as Arc<dyn PageTarget>),
            Some(other) => panic!("unknown target {other}"),
        },
    });
    if member(case, "cancelled").is_some_and(Json::bool) {
        recorder.stop();
    }
    let calls = member(case, "calls")
        .map(|list| list.array().to_vec())
        .unwrap_or_else(|| vec![Json::Object(BTreeMap::new())]);
    let call = case.get("call").str();
    let mut session =
        (call == "Session").then(|| executor.open_session(actor.clone(), options.clone()));
    let mut results = Vec::new();
    for step in &calls {
        let document = scripted(member(step, "document"));
        let batch = scripted(member(step, "batch"));
        let doc_id = member(step, "docId").map_or(String::new(), |v| v.str().to_owned());
        let options = options.as_ref();
        let outcome: Result<Json, Error> = match call {
            "Execute" => executor
                .execute(&cancel, &document, &batch, &actor, options)
                .await
                .map(|e| execution_shape(&e)),
            "Session" => session
                .as_mut()
                .expect("a session")
                .execute(&cancel, &document, &batch)
                .await
                .map(|e| execution_shape(&e)),
            "ExecuteInRoom" => executor
                .execute_in_room(&cancel, &doc_id, &batch, &actor, options)
                .await
                .map(|e| execution_shape(&e)),
            "Contract" => executor
                .contract(&cancel, options)
                .await
                .map(|c| object(vec![("contract", string(&c))])),
            "SessionContract" => executor
                .open_session(actor.clone(), options.cloned())
                .contract(&cancel)
                .await
                .map(|c| object(vec![("contract", string(&c))])),
            "RoomContract" => executor
                .room_contract(&cancel, options)
                .await
                .map(|c| object(vec![("contract", string(&c))])),
            other => panic!("unknown call {other}"),
        };
        results.push(outcome.unwrap_or_else(|err| error_shape(&err)));
    }
    let mut problems = runtime.problems.lock().expect("lock").clone();
    let used = *runtime.next.lock().expect("lock");
    if used != script.len() {
        problems.push(format!(
            "the case scripts {} runtime answers, {used} were asked for",
            script.len()
        ));
    }
    let events = recorder.events.lock().expect("lock").clone();
    (events, results, problems)
}

fn cases() -> Vec<Json> {
    let cases = test_json::parse(&read_repo_file(
        "test/unit/server-conformance/fixtures/agent/host.json",
    ));
    assert!(!cases.array().is_empty(), "no cases");
    cases.array().to_vec()
}

async fn check(case: &Json, deadline: bool, failures: &mut Vec<String>) {
    let name = case.get("name").str();
    let (events, results, problems) = run_host_case(case, deadline).await;
    for problem in problems {
        failures.push(format!("{name}: {problem}"));
    }
    if events.as_slice() != case.get("events").array() {
        failures.push(format!(
            "{name}: events\n got {events:?}\nwant {:?}",
            case.get("events")
        ));
    }
    if results.as_slice() != case.get("results").array() {
        failures.push(format!(
            "{name}: results\n got {results:?}\nwant {:?}",
            case.get("results")
        ));
    }
}

#[tokio::test]
async fn matches_the_shared_host_fixture() {
    let mut failures = Vec::new();
    for case in cases() {
        check(&case, false, &mut failures).await;
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

fn cancels(case: &Json) -> bool {
    if member(case, "cancelled").is_some_and(Json::bool) {
        return true;
    }
    let host = member(case, "host");
    if host.and_then(|h| member(h, "cancelOn")).is_some() {
        return true;
    }
    if let Some(Json::Object(throw_on)) = host.and_then(|h| member(h, "throwOn"))
        && throw_on.values().any(|how| how.str() == "cancel")
    {
        return true;
    }
    member(case, "runtime").is_some_and(|steps| {
        steps.array().iter().any(|step| {
            member(step, "throw").map(Json::str) == Some("cancel")
                || member(step, "cancelAfter").is_some_and(Json::bool)
        })
    })
}

// C# has one cancel exception, a timeout included, so the fixture cannot
// tell a deadline from a cancel. Each cancel case is replayed with the
// caller's deadline passing instead, and must answer the same.
#[tokio::test]
async fn a_caller_deadline_answers_as_a_cancel() {
    let mut failures = Vec::new();
    let mut stranded = 0;
    for case in cases().iter().filter(|case| cancels(case)) {
        check(case, true, &mut failures).await;
        if format!("{:?}", case.get("results")).contains("ORPHANED_SIDE_EFFECT") {
            stranded += 1;
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    // A cancel after pages were made is where a deadline could turn into a
    // retryable APPLY_FAILED.
    assert!(
        stranded > 0,
        "no replayed case cancels after pages were made"
    );
}
