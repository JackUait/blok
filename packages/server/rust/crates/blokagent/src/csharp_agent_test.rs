use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_jsjson::{Kind, Node};

use crate::normalize_test::deep_equals;
use crate::scenario_test::load;
use crate::test_support::{SharedPool, lookup, must_parse, pointer, shared_executor, string_of};
use crate::wire::write;
use crate::{
    Actor, Cancel, Execution, Executor, HostFuture, InvokeFuture, Invoker, Options, PageLocation,
    PageTarget, StoredPage,
};

// Twins of the C# Agent/*Tests cases that no scenario file and no Go test
// holds: BlokAgentPageActionTests, BlokAgentExecutorTests,
// BlokAgentSessionTests, JintAttributionTests, JintCommentHostTests,
// BlokAgentPageCreateTests.

const SOURCE: &str = r#"{"id":"source","title":"Source title","blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}"#;
const TARGET: &str = r#"{"id":"target","title":"Target title","icon":{"type":"emoji","value":"old"},"blocks":[{"id":"body","type":"paragraph","data":{"text":[{"text":"Keep this content"}]}}]}"#;
const RENAME: &str =
    r#"{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}"#;
const DOCUMENT: &str =
    r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}"#;

fn actor() -> Actor {
    Actor {
        id: "agent-cs".to_owned(),
        name: "Server agent".to_owned(),
        on_behalf_of: None,
    }
}

#[derive(Default)]
struct Pages {
    events: Mutex<Vec<String>>,
    saved: Mutex<Vec<String>>,
}

impl Pages {
    fn events(&self) -> Vec<String> {
        self.events.lock().expect("lock").clone()
    }

    fn saved(&self) -> Vec<String> {
        self.saved.lock().expect("lock").clone()
    }
}

struct Stored(Arc<Pages>);

impl StoredPage for Stored {
    fn load<'a>(&'a self, _: &'a Cancel) -> HostFuture<'a, String> {
        self.0.events.lock().expect("lock").push("load".to_owned());
        Box::pin(async { Ok(TARGET.to_owned()) })
    }

    fn save<'a>(&'a self, _: &'a Cancel, document_json: &'a str) -> HostFuture<'a, ()> {
        self.0.events.lock().expect("lock").push("save".to_owned());
        self.0
            .saved
            .lock()
            .expect("lock")
            .push(document_json.to_owned());
        Box::pin(async { Ok(()) })
    }
}

struct Target(Arc<Pages>);

impl PageTarget for Target {
    fn resolve<'a>(
        &'a self,
        _: &'a Cancel,
        page_id: &'a str,
        _: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>> {
        self.0
            .events
            .lock()
            .expect("lock")
            .push(format!("resolve:{page_id}"));
        let location = PageLocation::Stored(Box::new(Stored(self.0.clone())));
        Box::pin(async move { Ok(Some(location)) })
    }
}

fn target_options(page_titles: bool, with_target: bool) -> (Options, Arc<Pages>) {
    let pages = Arc::new(Pages::default());
    let options = Options {
        page_titles,
        page_target: with_target.then(|| Arc::new(Target(pages.clone())) as Arc<dyn PageTarget>),
        ..Options::default()
    };
    (options, pages)
}

/// The shared pool, with every call and answer kept.
#[derive(Clone, Default)]
struct Observing(Arc<Mutex<Vec<(String, String, String)>>>);

impl Invoker for Observing {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        Box::pin(async move {
            let output = Invoker::invoke(&SharedPool, cancel, op, input, timeout).await?;
            self.0
                .lock()
                .expect("lock")
                .push((op.to_owned(), input.to_owned(), output.clone()));
            Ok(output)
        })
    }
}

impl Observing {
    fn calls(&self) -> Vec<(String, String, String)> {
        self.0.lock().expect("lock").clone()
    }
}

/// Records each input and answers one fixed text.
struct Fixed {
    answer: String,
    inputs: Arc<Mutex<Vec<(String, String)>>>,
}

impl Invoker for Fixed {
    fn invoke<'a>(
        &'a self,
        _: &'a Cancel,
        op: &'a str,
        input: &'a str,
        _: Duration,
    ) -> InvokeFuture<'a> {
        self.inputs
            .lock()
            .expect("lock")
            .push((op.to_owned(), input.to_owned()));
        let answer = self.answer.clone();
        Box::pin(async move { Ok(answer) })
    }
}

async fn execute(
    executor: &Executor,
    document: &str,
    batch: &str,
    options: Option<&Options>,
) -> Execution {
    executor
        .execute(&Cancel::new(), document, batch, &actor(), options)
        .await
        .unwrap_or_else(|err| panic!("{batch}: {err}"))
}

async fn read_revision(executor: &Executor, document: &str) -> String {
    let read = execute(
        executor,
        document,
        r#"{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}"#,
        None,
    )
    .await;
    let result = must_parse(&read.result_json);
    assert_eq!(
        lookup(Some(&result), "ok").map(|n| n.kind),
        Some(Kind::True)
    );
    let revision = &read.revision;
    assert!(
        revision.len() > 1
            && revision.starts_with('h')
            && revision[1..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "{revision}"
    );
    revision.clone()
}

fn text_at(root: &Node, path: &str) -> String {
    string_of(pointer(root, path)).unwrap_or_default()
}

fn equal(json: &str, node: Option<&Node>) -> bool {
    deep_equals(Some(&must_parse(json)), node)
}

/// C#'s AssertSourceFailure: the source's revision, no save, and an error
/// with a message. Returns the error.
fn source_failure(execution: &Execution, revision: &str, code: &str, retryable: bool) -> Node {
    let result = must_parse(&execution.result_json);
    let place = &execution.result_json;
    assert!(execution.document_json.is_none(), "{place}");
    assert_eq!(execution.revision, revision, "{place}");
    assert_eq!(
        lookup(Some(&result), "ok").map(|n| n.kind),
        Some(Kind::False),
        "{place}"
    );
    assert_eq!(text_at(&result, "/revision"), revision, "{place}");
    assert!(equal("[]", lookup(Some(&result), "warnings")), "{place}");
    for absent in ["results", "refs", "changed"] {
        assert!(lookup(Some(&result), absent).is_none(), "{absent}: {place}");
    }
    assert_eq!(text_at(&result, "/error/code"), code, "{place}");
    let want = if retryable { Kind::True } else { Kind::False };
    assert_eq!(
        pointer(&result, "/error/retryable").map(|n| n.kind),
        Some(want),
        "{place}"
    );
    assert!(
        !text_at(&result, "/error/message").trim().is_empty(),
        "{place}"
    );
    lookup(Some(&result), "error").expect("error").clone()
}

/// C#'s ExecutesPageAction: an agentExecute whose batch holds a page action.
fn executes_page_action((op, input, _): &(String, String, String)) -> bool {
    op == "agentExecute"
        && pointer(&must_parse(input), "/batch/commands").is_some_and(|commands| {
            commands
                .items
                .iter()
                .any(|c| matches!(text_at(c, "/name").as_str(), "page.rename" | "page.setIcon"))
        })
}

/// C#'s IsTargetCommand: an agentExecute on the target document whose batch
/// holds `name`.
fn is_target_command((op, input, _): &(String, String, String), name: &str) -> bool {
    let input = must_parse(input);
    op == "agentExecute"
        && text_at(&input, "/document/id") == "target"
        && pointer(&input, "/batch/commands")
            .is_some_and(|commands| commands.items.iter().any(|c| text_at(c, "/name") == name))
}

fn number_at(root: &Node, path: &str) -> Option<String> {
    pointer(root, path)
        .filter(|n| n.kind == Kind::Number)
        .map(|n| String::from_utf8_lossy(n.raw()).into_owned())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sets_or_clears_the_stored_target_icon_without_changing_the_source() {
    for icon in [
        r#"{"type":"emoji","value":"🚀"}"#,
        r#"{"type":"image","url":"https://example.com/icon.png"}"#,
        "null",
    ] {
        let observing = Observing::default();
        let executor = Executor::on_runtime(observing.clone());
        let (options, pages) = target_options(true, true);
        let revision = read_revision(&executor, SOURCE).await;
        let batch = format!(
            r#"{{"commands":[{{"name":"page.setIcon","args":{{"id":"pg","icon":{icon}}}}}],"expectRevision":"{revision}"}}"#
        );
        let calls_before = observing.calls().len();
        let execution = execute(&executor, SOURCE, &batch, Some(&options)).await;
        let saved = pages.saved();
        assert_eq!(saved.len(), 1, "{icon}");
        let saved = must_parse(&saved[0]);
        if icon == "null" {
            assert!(lookup(Some(&saved), "icon").is_none(), "{icon}");
        } else {
            assert!(equal(icon, lookup(Some(&saved), "icon")), "{icon}");
        }
        assert_eq!(text_at(&saved, "/title"), "Target title");
        assert!(deep_equals(
            lookup(Some(&must_parse(TARGET)), "blocks"),
            lookup(Some(&saved), "blocks")
        ));
        assert_eq!(pages.events(), ["resolve:page-2", "load", "save"]);
        assert!(execution.document_json.is_none());
        assert_eq!(execution.revision, revision);
        let mut want = must_parse(
            r#"{"ok":true,"results":[{"pageId":"page-2","applied":true}],"refs":{},"changed":{"created":[],"updated":[],"moved":[],"removed":[]},"warnings":[]}"#,
        );
        want.set("revision", must_parse(&format!("\"{revision}\"")))
            .expect("set");
        assert!(
            deep_equals(Some(&want), Some(&must_parse(&execution.result_json))),
            "{}",
            execution.result_json
        );
        let calls = &observing.calls()[calls_before..];
        let writes: Vec<&(String, String, String)> = calls
            .iter()
            .filter(|call| is_target_command(call, "doc.setIcon"))
            .collect();
        assert_eq!(writes.len(), 1, "{icon}");
        assert!(
            !calls.iter().any(executes_page_action),
            "the page action ran in the engine"
        );
        let input = must_parse(&writes[0].1);
        let commands = pointer(&input, "/batch/commands").expect("commands");
        assert_eq!(commands.items.len(), 1);
        assert!(equal(
            &format!(r#"{{"icon":{icon}}}"#),
            lookup(Some(&commands.items[0]), "args")
        ));
        let target_revision = read_revision(&executor, &write(&saved).expect("write")).await;
        assert_ne!(target_revision, execution.revision);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn requires_both_page_opt_ins_before_any_backend_call() {
    let executor = shared_executor();
    let revision = read_revision(executor, SOURCE).await;
    for (name, args) in [
        ("page.rename", r#"{"id":"pg","title":"Roadmap"}"#),
        ("page.setIcon", r#"{"id":"pg","icon":null}"#),
    ] {
        for (page_titles, with_target) in [(false, false), (true, false), (false, true)] {
            let place = format!("{name} {page_titles} {with_target}");
            let (options, pages) = target_options(page_titles, with_target);
            let batch = format!(r#"{{"commands":[{{"name":"{name}","args":{args}}}]}}"#);
            let execution = execute(executor, SOURCE, &batch, Some(&options)).await;
            assert!(
                pages.events().is_empty() && pages.saved().is_empty(),
                "{place}"
            );
            let error = source_failure(&execution, &revision, "COMMAND_UNAVAILABLE", false);
            assert_eq!(
                number_at(&error, "/commandIndex").as_deref(),
                Some("0"),
                "{place}"
            );
            assert_eq!(text_at(&error, "/path"), "/commands/0/name", "{place}");
            assert_eq!(text_at(&error, "/details/reason"), "service", "{place}");
            assert!(
                equal(r#"["pageBackend"]"#, pointer(&error, "/details/requires")),
                "{place}"
            );
            let contract = must_parse(
                &executor
                    .contract(&Cancel::new(), Some(&options))
                    .await
                    .expect("contract"),
            );
            let entries: Vec<&Node> = lookup(Some(&contract), "commands")
                .expect("commands")
                .items
                .iter()
                .filter(|c| text_at(c, "/name") == name)
                .collect();
            assert_eq!(entries.len(), 1, "{place}");
            assert_eq!(
                pointer(entries[0], "/available").map(|n| n.kind),
                Some(Kind::False),
                "{place}"
            );
            assert_eq!(
                text_at(entries[0], "/unavailableReason"),
                "service",
                "{place}"
            );
            assert!(pages.events().is_empty(), "{place}");
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_a_stale_source_before_resolving_or_loading_the_target() {
    let executor = shared_executor();
    let revision = read_revision(executor, SOURCE).await;
    let (options, pages) = target_options(true, true);
    let batch = r#"{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}],"expectRevision":"not-the-source-revision"}"#;
    let execution = execute(executor, SOURCE, batch, Some(&options)).await;
    assert!(pages.events().is_empty() && pages.saved().is_empty());
    let error = source_failure(&execution, &revision, "STALE", true);
    assert_eq!(text_at(&error, "/details/revision"), revision);
    assert!(equal(
        r#"[{"id":"pg","type":"page"}]"#,
        pointer(&error, "/details/current")
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn validates_the_original_envelope_before_backend_work() {
    let executor = shared_executor();
    let revision = read_revision(executor, SOURCE).await;
    for (batch, path) in [
        (
            r#"{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":1}]}"#,
            "/commands/0",
        ),
        (
            r#"{"expectRevision":1,"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}"#,
            "/expectRevision",
        ),
        (
            r#"{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":"created"}]}"#,
            "/commands/0/ref",
        ),
    ] {
        let (options, pages) = target_options(true, true);
        let execution = execute(executor, SOURCE, batch, Some(&options)).await;
        assert!(
            pages.events().is_empty() && pages.saved().is_empty(),
            "{batch}"
        );
        let error = source_failure(&execution, &revision, "INVALID_ARGS", false);
        assert_eq!(text_at(&error, "/path"), path, "{batch}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_malformed_action_args_before_backend_work() {
    let executor = shared_executor();
    let revision = read_revision(executor, SOURCE).await;
    for command in [
        r#"{"name":"page.rename","args":{"title":"Roadmap"}}"#,
        r#"{"name":"page.rename","args":{"id":"pg"}}"#,
        r#"{"name":"page.rename","args":{"id":"pg","title":7}}"#,
        r#"{"name":"page.rename","args":{"id":"pg","title":"Roadmap","extra":true}}"#,
        r#"{"name":"page.setIcon","args":{"id":"pg"}}"#,
        r#"{"name":"page.setIcon","args":{"id":"pg","icon":"🚀"}}"#,
    ] {
        let (options, pages) = target_options(true, true);
        let batch = format!(r#"{{"commands":[{command}]}}"#);
        let execution = execute(executor, SOURCE, &batch, Some(&options)).await;
        assert!(
            pages.events().is_empty() && pages.saved().is_empty(),
            "{command}"
        );
        let error = source_failure(&execution, &revision, "INVALID_ARGS", false);
        assert_eq!(
            number_at(&error, "/commandIndex").as_deref(),
            Some("0"),
            "{command}"
        );
        let path = text_at(&error, "/path");
        assert!(path.starts_with("/commands/0/args"), "{command}: {path}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn honors_the_source_contract_overrides_before_backend_work() {
    let executor = shared_executor();
    let revision = read_revision(executor, SOURCE).await;
    for overrides in [
        r#"{"page":{"hidden":true}}"#,
        r#"{"page":{"hiddenActions":["rename"]}}"#,
    ] {
        let (mut options, pages) = target_options(true, true);
        options.overrides_json = Some(overrides.to_owned());
        let execution = execute(executor, SOURCE, RENAME, Some(&options)).await;
        assert!(
            pages.events().is_empty() && pages.saved().is_empty(),
            "{overrides}"
        );
        let error = source_failure(&execution, &revision, "UNKNOWN_COMMAND", false);
        assert_eq!(
            number_at(&error, "/commandIndex").as_deref(),
            Some("0"),
            "{overrides}"
        );
        assert_eq!(text_at(&error, "/path"), "/commands/0/name", "{overrides}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_a_page_id_on_the_wrong_source_tool_or_a_missing_block_before_backend_work() {
    let executor = shared_executor();
    for (source, code) in [
        (
            r#"{"blocks":[{"id":"pg","type":"paragraph","data":{"text":[{"text":"Not a page"}],"pageId":"page-2"}}]}"#,
            "INVALID_ARGS",
        ),
        (r#"{"blocks":[]}"#, "BLOCK_NOT_FOUND"),
    ] {
        let revision = read_revision(executor, source).await;
        let (options, pages) = target_options(true, true);
        let execution = execute(executor, source, RENAME, Some(&options)).await;
        assert!(
            pages.events().is_empty() && pages.saved().is_empty(),
            "{code}"
        );
        let error = source_failure(&execution, &revision, code, false);
        assert_eq!(
            number_at(&error, "/commandIndex").as_deref(),
            Some("0"),
            "{code}"
        );
        assert_eq!(text_at(&error, "/path"), "/commands/0/args/id", "{code}");
    }
}

// Page icons allow extra keys; doc.setIcon's schema does not. The target's
// own refusal comes back whole, with the pageId added.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn does_not_save_a_stored_target_failure_and_preserves_its_error() {
    let observing = Observing::default();
    let executor = Executor::on_runtime(observing.clone());
    let revision = read_revision(&executor, SOURCE).await;
    let icon = r#"{"type":"emoji","value":"🚀","hostMetadata":{"keep":"icon"}}"#;
    let target_args = format!(r#"{{"icon":{icon}}}"#);
    let direct = execute(
        &executor,
        TARGET,
        &format!(r#"{{"commands":[{{"name":"doc.setIcon","args":{target_args}}}]}}"#),
        None,
    )
    .await;
    let original = must_parse(&direct.result_json);
    assert!(direct.document_json.is_none(), "{}", direct.result_json);
    assert_eq!(text_at(&original, "/error/code"), "INVALID_ARGS");
    assert_eq!(
        pointer(&original, "/error/retryable").map(|n| n.kind),
        Some(Kind::False)
    );
    assert!(!text_at(&original, "/error/message").trim().is_empty());
    assert!(pointer(&original, "/error/details/problems").is_some_and(|p| !p.items.is_empty()));
    assert!(pointer(&original, "/error/details/pageId").is_none());
    assert!(equal("[]", lookup(Some(&original), "warnings")));
    assert_ne!(direct.revision, revision);

    let (options, pages) = target_options(true, true);
    let calls_before = observing.calls().len();
    let batch = format!(
        r#"{{"commands":[{{"name":"page.setIcon","args":{{"id":"pg","icon":{icon}}}}}],"expectRevision":"{revision}"}}"#
    );
    let execution = execute(&executor, SOURCE, &batch, Some(&options)).await;
    assert!(pages.saved().is_empty());
    assert_eq!(pages.events(), ["resolve:page-2", "load"]);
    assert!(execution.document_json.is_none());
    assert_eq!(execution.revision, revision);
    let mut want = original.clone();
    want.set("revision", must_parse(&format!("\"{revision}\"")))
        .expect("set");
    want.lookup_mut("error")
        .expect("lookup")
        .expect("error")
        .lookup_mut("details")
        .expect("lookup")
        .expect("details")
        .set("pageId", must_parse("\"page-2\""))
        .expect("set");
    assert!(
        deep_equals(Some(&want), Some(&must_parse(&execution.result_json))),
        "{}",
        execution.result_json
    );
    let calls = &observing.calls()[calls_before..];
    assert!(!calls.iter().any(executes_page_action));
    let writes: Vec<&(String, String, String)> = calls
        .iter()
        .filter(|call| is_target_command(call, "doc.setIcon"))
        .collect();
    assert_eq!(writes.len(), 1);
    let input = must_parse(&writes[0].1);
    assert!(deep_equals(
        Some(&must_parse(TARGET)),
        lookup(Some(&input), "document")
    ));
    let commands = pointer(&input, "/batch/commands").expect("commands");
    assert_eq!(commands.items.len(), 1);
    assert!(equal(
        &target_args,
        lookup(Some(&commands.items[0]), "args")
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn factory_runs_a_stored_write_through_the_embedded_runtime() {
    let execution = execute(
        shared_executor(),
        DOCUMENT,
        r#"{"commands":[{"name":"text.format","args":{"id":"p","range":{"find":"world"},"set":{"bold":true}}}]}"#,
        None,
    )
    .await;
    let saved = must_parse(execution.document_json.as_deref().expect("saved"));
    assert_eq!(
        lookup(Some(&saved), "blocks").map(|b| b.items.len()),
        Some(1)
    );
    assert!(equal(
        r#"[{"text":"Hello "},{"text":"world","marks":{"bold":true}}]"#,
        pointer(&saved, "/blocks/0/data/text")
    ));
    assert_eq!(text_at(&saved, "/blocks/0/lastEditedBy"), "agent-cs");
    let at: f64 = number_at(&saved, "/blocks/0/lastEditedAt")
        .and_then(|n| n.parse().ok())
        .expect("lastEditedAt");
    assert!(at > 0.0);
    let result = must_parse(&execution.result_json);
    assert_eq!(
        lookup(Some(&result), "ok").map(|n| n.kind),
        Some(Kind::True)
    );
    assert_eq!(text_at(&result, "/revision"), execution.revision);
    assert!(execution.revision.starts_with('h'));
    assert!(equal(r#"["p"]"#, pointer(&result, "/changed/updated")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_stored_batch_returns_nothing_to_save_and_leaves_no_partial_wire_writes() {
    let observing = Observing::default();
    let executor = Executor::on_runtime(observing.clone());
    let normalized =
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello world"}]}}]}"#;
    let execution = execute(
        &executor,
        normalized,
        r#"{"commands":[{"name":"doc.setTitle","args":{"title":"Never written"}},{"name":"block.delete","args":{"id":"missing"}}]}"#,
        None,
    )
    .await;
    assert!(execution.document_json.is_none());
    let calls = observing.calls();
    let wire = must_parse(&calls.last().expect("a call").2);
    assert!(deep_equals(
        Some(&must_parse(normalized)),
        lookup(Some(&wire), "document")
    ));
    assert!(equal("[]", lookup(Some(&wire), "edits")));
    let result = must_parse(&execution.result_json);
    assert_eq!(text_at(&result, "/error/code"), "BLOCK_NOT_FOUND");
    assert_eq!(
        number_at(&result, "/error/commandIndex").as_deref(),
        Some("1")
    );
    assert_eq!(
        lookup(Some(&result), "ok").map(|n| n.kind),
        Some(Kind::False)
    );
    assert_eq!(text_at(&result, "/revision"), execution.revision);
    assert!(deep_equals(Some(&result), lookup(Some(&wire), "result")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_plain_call_refuses_history_and_has_nothing_to_save() {
    for name in ["history.undo", "history.redo"] {
        let execution = execute(
            shared_executor(),
            DOCUMENT,
            &format!(r#"{{"commands":[{{"name":"{name}","args":{{}}}}]}}"#),
            None,
        )
        .await;
        assert!(execution.document_json.is_none(), "{name}");
        let result = must_parse(&execution.result_json);
        assert_eq!(
            text_at(&result, "/error/code"),
            "COMMAND_UNAVAILABLE",
            "{name}"
        );
        assert_eq!(
            text_at(&result, "/error/details/reason"),
            "runtime",
            "{name}"
        );
        assert_eq!(
            lookup(Some(&result), "ok").map(|n| n.kind),
            Some(Kind::False)
        );
        assert_eq!(
            pointer(&result, "/error/retryable").map(|n| n.kind),
            Some(Kind::False)
        );
        assert!(!text_at(&result, "/error/message").trim().is_empty());
        assert!(equal("[]", lookup(Some(&result), "warnings")), "{name}");
        assert_eq!(text_at(&result, "/revision"), execution.revision, "{name}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn declares_page_backend_only_with_both_opt_ins_for_the_manifest() {
    for (page_titles, with_target) in [(false, false), (true, false), (false, true), (true, true)] {
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let executor = Executor::on_runtime(Fixed {
            answer: r#"{"contract":{}}"#.to_owned(),
            inputs: inputs.clone(),
        });
        let (options, pages) = target_options(page_titles, with_target);
        let _ = executor.contract(&Cancel::new(), Some(&options)).await;
        let calls = inputs.lock().expect("lock").clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "manifest");
        let want = if page_titles && with_target {
            r#"["pageBackend"]"#
        } else {
            "[]"
        };
        let input = must_parse(&calls[0].1);
        assert!(
            equal(want, lookup(Some(&input), "services")),
            "{page_titles} {with_target}: {}",
            calls[0].1
        );
        assert!(pages.events().is_empty());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn overrides_hide_what_the_baseline_contract_offers() {
    let executor = shared_executor();
    let baseline = must_parse(
        &executor
            .contract(&Cancel::new(), None)
            .await
            .expect("contract"),
    );
    let create = lookup(Some(&baseline), "commands")
        .expect("commands")
        .items
        .iter()
        .find(|c| text_at(c, "/name") == "column_list.create")
        .expect("column_list.create");
    assert_eq!(
        pointer(create, "/available").map(|n| n.kind),
        Some(Kind::True)
    );
    assert!(
        pointer(&baseline, "/manifest/blocks")
            .expect("blocks")
            .items
            .iter()
            .any(|b| text_at(b, "/name") == "spacer")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_embedded_contract_revision_reflects_only_the_two_part_page_opt_in() {
    let executor = shared_executor();
    let revision_of = |contract: String| text_at(&must_parse(&contract), "/revision");
    let original = revision_of(
        executor
            .contract(&Cancel::new(), None)
            .await
            .expect("contract"),
    );
    for (page_titles, with_target) in [(false, false), (true, false), (false, true), (true, true)] {
        let (options, pages) = target_options(page_titles, with_target);
        let revision = revision_of(
            executor
                .contract(&Cancel::new(), Some(&options))
                .await
                .expect("contract"),
        );
        if page_titles && with_target {
            assert_ne!(revision, original);
        } else {
            assert_eq!(revision, original, "{page_titles} {with_target}");
        }
        assert!(pages.events().is_empty());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_to_delete_a_locked_database() {
    let document = r#"{"blocks":[{"id":"D","type":"database","data":{"schema":[{"id":"dt","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"v","name":"Table","type":"table","position":"a0"}],"activeViewId":"v"}}]}"#;
    let (options, pages) = target_options(true, true);
    let execution = execute(
        shared_executor(),
        document,
        r#"{"commands":[{"name":"block.delete","args":{"id":"D"}}]}"#,
        Some(&options),
    )
    .await;
    let result = must_parse(&execution.result_json);
    assert_eq!(
        text_at(&result, "/error/code"),
        "PRECONDITION_FAILED",
        "{}",
        execution.result_json
    );
    assert!(execution.document_json.is_none());
    assert!(pages.events().is_empty());
}

/// The scenario's first step, run on its seed with the scenario actor.
async fn first_step_of(name: &str, actor: Actor) -> Execution {
    let scenario = load(name);
    let seed = write(lookup(Some(&scenario), "seed").expect("seed")).expect("write");
    let step = &lookup(Some(&scenario), "steps").expect("steps").items[0];
    let batch = write(lookup(Some(step), "batch").expect("batch")).expect("write");
    shared_executor()
        .execute(&Cancel::new(), &seed, &batch, &actor, None)
        .await
        .unwrap_or_else(|err| panic!("{name}: {err}"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn what_the_agent_creates_is_created_now_by_the_person_with_the_agent() {
    let execution = first_step_of(
        "bundle-attribution-created",
        Actor {
            on_behalf_of: Some("human-1".to_owned()),
            ..actor()
        },
    )
    .await;
    let saved = must_parse(execution.document_json.as_deref().expect("saved"));
    let created: Vec<&Node> = lookup(Some(&saved), "blocks")
        .expect("blocks")
        .items
        .iter()
        .filter(|b| text_at(b, "/id") == "n1" || text_at(b, "/type") == "database-row")
        .collect();
    assert_eq!(created.len(), 2);
    for block in created {
        assert!(
            number_at(block, "/createdAt").is_some(),
            "{}",
            write(block).expect("write")
        );
        assert_eq!(text_at(block, "/createdBy"), "human-1");
        assert_eq!(text_at(block, "/createdWith"), "agent-cs");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_comment_write_runs_by_default() {
    let execution = first_step_of("options-comments-on", actor()).await;
    let saved = must_parse(execution.document_json.as_deref().expect("saved"));
    let replies: Vec<&Node> = lookup(Some(&saved), "blocks")
        .expect("blocks")
        .items
        .iter()
        .filter(|b| {
            text_at(b, "/type") == "database-comment" && text_at(b, "/data/text") == "Hidden"
        })
        .collect();
    assert_eq!(
        replies.len(),
        1,
        "{}",
        execution.document_json.unwrap_or_default()
    );
}

/// What the second of two session calls hands the engine as its steps,
/// when the engine hands back `past`.
async fn sent_history(past: &[String]) -> Vec<Node> {
    let document =
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello"}]}}]}"#;
    let answer = format!(
        r#"{{"result":{{"ok":true,"revision":"h1","results":[{{}}],"refs":{{}},"changed":{{"created":[],"updated":[],"moved":[],"removed":[]}},"warnings":[]}},"document":{document},"edits":[],"history":{{"past":[{}],"future":[],"revision":"h1"}}}}"#,
        past.join(",")
    );
    let inputs = Arc::new(Mutex::new(Vec::new()));
    let executor = Executor::on_runtime(Fixed {
        answer,
        inputs: inputs.clone(),
    });
    let mut session = executor.open_session(actor(), None);
    for title in ["One", "Two"] {
        session
            .execute(
                &Cancel::new(),
                document,
                &format!(
                    r#"{{"commands":[{{"name":"doc.setTitle","args":{{"title":"{title}"}}}}]}}"#
                ),
            )
            .await
            .expect("execute");
    }
    let last = must_parse(&inputs.lock().expect("lock").last().expect("an input").1);
    let mut sent = pointer(&last, "/history/past").expect("past").items.clone();
    sent.extend(
        pointer(&last, "/history/future")
            .expect("future")
            .items
            .clone(),
    );
    sent
}

#[tokio::test]
async fn trims_too_many_steps_before_they_reach_the_engine() {
    let past: Vec<String> = (0..150)
        .map(|i| if i == 149 { "\"newest\"" } else { "\"other\"" }.to_owned())
        .collect();
    let sent = sent_history(&past).await;
    assert_eq!(sent.len(), 100);
    assert_eq!(string_of(sent.last()).as_deref(), Some("newest"));
}

#[tokio::test]
async fn trims_too_many_bytes_before_they_reach_the_engine() {
    let big = "x".repeat(1024 * 1024);
    let past: Vec<String> = (0..8)
        .map(|i| {
            format!(
                r#"{{"title":"T{i}","blocks":[{{"id":"p","type":"paragraph","data":{{"text":[{{"text":"{big}"}}]}}}}]}}"#
            )
        })
        .collect();
    let sent = sent_history(&past).await;
    assert!(!sent.is_empty());
    let chars: usize = sent.iter().map(|n| write(n).expect("write").len()).sum();
    assert!(chars <= 4 * 1024 * 1024, "{chars}");
    assert_eq!(text_at(sent.last().expect("a step"), "/title"), "T7");
}
