use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_auth::{Authorization, BoxFuture, Error, Extensions, User};
use blok_jsjson::{Object, Str, Value, parse};

use crate::test_support::{AppOptions, start_app};

// Twins of C# HistoryEndpointTests.Hooks: the history hooks are default
// methods on Authorization.

/// Allows reads and writes; the history hooks answer from its fields.
#[derive(Default)]
struct HistoryPolicy {
    deny_history: Mutex<bool>,
    /// Where the window should cut; the hook answers the span from now to it.
    cut: Mutex<Option<SystemTime>>,
    held: Mutex<HashSet<String>>,
    holds_asked: Mutex<Vec<String>>,
}

impl Authorization for HistoryPolicy {
    fn can_read_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
    fn can_read_history<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(!*self.deny_history.lock().unwrap()) })
    }
    fn history_window<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<Option<Duration>, Error>> {
        Box::pin(async {
            Ok(self
                .cut
                .lock()
                .unwrap()
                .map(|cut| SystemTime::now().duration_since(cut).unwrap()))
        })
    }
    fn is_history_held<'a>(
        &'a self,
        _: &'a str,
        lineage: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async move {
            self.holds_asked.lock().unwrap().push(lineage.to_owned());
            Ok(self.held.lock().unwrap().contains(lineage))
        })
    }
}

/// Only the two gates: every history hook keeps its default.
struct Plain;

impl Authorization for Plain {
    fn can_read_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
        _: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }
}

fn window_fixture() -> Object {
    let root = std::env::var("BLOK_REPO_ROOT")
        .ok()
        .filter(|root| !root.is_empty())
        .map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../.."),
            PathBuf::from,
        );
    let path = root.join("test/unit/server-conformance/fixtures/collab-history/window.json");
    match parse(&std::fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))) {
        Ok(Value::Object(object)) => object,
        other => panic!("window.json: {other:?}"),
    }
}

fn get<'a>(object: &'a Object, key: &str) -> &'a Value {
    object.get(&Str::from(key)).unwrap_or(&Value::Null)
}

fn as_object(value: &Value) -> &Object {
    match value {
        Value::Object(object) => object,
        other => panic!("not an object: {other:?}"),
    }
}

fn as_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.to_string(),
        other => panic!("not a string: {other:?}"),
    }
}

fn as_number(value: &Value) -> u16 {
    match value {
        Value::Number(n) => *n as u16,
        other => panic!("not a number: {other:?}"),
    }
}

fn sequences(body: &[u8], key: &str) -> Vec<u64> {
    let parsed = parse(body).unwrap();
    match get(as_object(&parsed), key) {
        Value::Array(items) => items
            .iter()
            .map(|item| match get(as_object(item), "sequence") {
                Value::Number(n) => *n as u64,
                other => panic!("no sequence: {other:?}"),
            })
            .collect(),
        other => panic!("no {key}: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_default_hooks_read_everything_with_no_window_and_hold_nothing() {
    let (user, extensions) = (User::default(), Extensions::default());
    assert!(
        Plain
            .can_read_history(&user, "doc", &extensions)
            .await
            .unwrap()
    );
    assert_eq!(
        Plain
            .history_window(&user, "doc", &extensions)
            .await
            .unwrap(),
        None
    );
    assert!(
        !Plain
            .is_history_held("doc", "lineage", &extensions)
            .await
            .unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_read_hook_guards_every_route_that_shows_history() {
    let policy = Arc::new(HistoryPolicy::default());
    *policy.deny_history.lock().unwrap() = true;
    let history = start_app(AppOptions {
        journal: true,
        policy: Some(policy.clone()),
        ..AppOptions::default()
    })
    .await;
    let lineage = history.open().await;
    history.edit_text("two").await;

    for (method, path) in [
        ("GET", "/history".to_owned()),
        ("GET", format!("/history/{lineage}/1")),
        ("GET", format!("/history/{lineage}/1/changes")),
        ("GET", "/history/at?time=2099-01-01T00:00:00Z".to_owned()),
        ("GET", "/history/changes".to_owned()),
        ("POST", format!("/history/{lineage}/0/restore/preview")),
    ] {
        let a = history.send(method, &path, "", "", "").await;
        assert!(
            a.status == 403 && a.text() == "forbidden\n",
            "{method} {path} = {} {:?}",
            a.status,
            a.text()
        );
    }
    // A restore changes the document: the write gate decides it.
    let restore = history.restore(&lineage, "0", "allowed", "").await;
    assert_eq!(restore.status, 204, "restore = {}", restore.text());
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_window_hides_points_before_its_cut_on_every_route() {
    let policy = Arc::new(HistoryPolicy::default());
    let history = start_app(AppOptions {
        journal: true,
        policy: Some(policy.clone()),
        ..AppOptions::default()
    })
    .await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    history.edit_text("three").await;
    history.edit_text("four").await;
    *history
        .journal
        .as_ref()
        .unwrap()
        .header_spacing
        .lock()
        .unwrap() = Some(Duration::from_secs(24 * 3600));
    // Records 1 and 2 are before the cut, 3 after it. The baseline is newer,
    // but below a hidden record.
    *policy.cut.lock().unwrap() = Some(UNIX_EPOCH + Duration::from_secs(60 * 3600));
    let fixture = window_fixture();
    let retention = as_object(get(as_object(get(&fixture, "answers")), "retention"));

    for (method, path) in [
        ("GET", format!("/history/{lineage}/2")),
        ("GET", format!("/history/{lineage}/0")),
        ("GET", format!("/history/{lineage}/2/changes")),
        ("POST", format!("/history/{lineage}/2/restore/preview")),
        ("GET", "/history/at?time=1970-01-03T00:00:00Z".to_owned()),
        (
            "GET",
            format!("/history/changes?from=1970-01-01T00:00:00Z&before={lineage}:2"),
        ),
    ] {
        let a = history.send(method, &path, "", "", "").await;
        assert!(
            a.status == as_number(get(retention, "status"))
                && a.header("Content-Type") == as_text(get(retention, "contentType"))
                && a.text() == as_text(get(retention, "body")),
            "{method} {path} = {} {} {:?}",
            a.status,
            a.header("Content-Type"),
            a.text()
        );
    }
    let restore = history.restore(&lineage, "2", "too-old", "").await;
    assert!(
        restore.status == 404 && restore.text() == as_text(get(retention, "body")),
        "restore = {} {:?}",
        restore.status,
        restore.text()
    );
    let read = history
        .send("GET", &format!("/history/{lineage}/3"), "", "", "")
        .await;
    assert_eq!(read.status, 200, "read 3 = {}", read.text());
    let changes = history
        .send("GET", &format!("/history/{lineage}/3/changes"), "", "", "")
        .await;
    assert_eq!(sequences(&changes.body, "changes"), vec![3]);
    let list = history.send("GET", "/history?group=1", "", "", "").await;
    assert_eq!(sequences(&list.body, "versions"), vec![3]);
    let range = history
        .send(
            "GET",
            "/history/changes?from=1970-01-01T00:00:00Z",
            "",
            "",
            "",
        )
        .await;
    assert_eq!(sequences(&range.body, "changes"), vec![3]);
    let at = history
        .request(
            "GET",
            "/history/at?time=1970-01-05T00:00:00Z",
            &[("Accept", "application/json")],
            "",
        )
        .await;
    assert!(
        at.status == 200 && at.header("Blok-History-Sequence") == "3",
        "at = {} {:?}",
        at.status,
        at.header("Blok-History-Sequence")
    );

    // A window shrunk at runtime takes effect on the next call.
    *policy.cut.lock().unwrap() = Some(UNIX_EPOCH + Duration::from_secs(84 * 3600));
    let shrunk = history
        .send("GET", &format!("/history/{lineage}/3"), "", "", "")
        .await;
    assert_eq!(
        shrunk.status,
        404,
        "read 3 after the window shrank = {}",
        shrunk.text()
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_held_lineage_is_not_deleted() {
    let fixture = window_fixture();
    let Value::Array(cases) = get(&fixture, "delete") else {
        panic!("no delete cases");
    };
    for entry in cases {
        let entry = as_object(entry);
        let name = as_text(get(entry, "name"));
        let policy = Arc::new(HistoryPolicy::default());
        let history = start_app(AppOptions {
            journal: true,
            policy: Some(policy.clone()),
            ..AppOptions::default()
        })
        .await;
        let old = history.open().await;
        let reset = history.send("POST", "/reset", "", "", "").await;
        assert_eq!(reset.status, 204, "reset = {}", reset.text());
        let current = history.open().await;
        let lineage = match as_text(get(entry, "lineage")).as_str() {
            "old" => old,
            "current" => current,
            _ => "f".repeat(32),
        };
        let held = matches!(get(entry, "held"), Value::Bool(true));
        if held {
            policy.held.lock().unwrap().insert(lineage.clone());
        }

        let a = history
            .send("DELETE", &format!("/history/{lineage}"), "", "", "")
            .await;
        let body = match get(entry, "body") {
            Value::String(s) => s.to_string(),
            _ => String::new(),
        };
        assert!(
            a.status == as_number(get(entry, "status")) && a.text() == body,
            "{name}: {} {:?}",
            a.status,
            a.text()
        );
        assert_eq!(
            *policy.holds_asked.lock().unwrap(),
            vec![lineage.clone()],
            "{name}"
        );
        if held {
            assert_eq!(a.header("Content-Type"), "application/json", "{name}");
        }
        history.drain().await;
    }
}
