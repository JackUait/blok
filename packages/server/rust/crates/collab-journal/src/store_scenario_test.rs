//! The scenarios C# CollabJournalStoreCaptureTests ran against its store.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use blok_collab_operation::{
    AppendOutcome, Candidate, Checkpoint, Head, LookupOutcome, Record, Reset, Source,
};
use blok_collab_workingset::doc_key;
use blok_dotnet::{ticks, time_from_ticks};
use blok_jsjson::{
    Kind, Node, new_array, new_bool, new_member, new_null, new_number, new_object, new_string,
};

use crate::fixture::*;
use crate::*;

fn s(value: &str) -> Node {
    new_string(&value.encode_utf16().collect::<Vec<_>>())
}

fn opt_s(value: Option<&str>) -> Node {
    value.map_or_else(new_null, s)
}

fn n(value: impl ToString) -> Node {
    new_number(&value.to_string())
}

fn object(members: Vec<(&str, Node)>) -> Node {
    new_object(members.into_iter().map(|(k, v)| new_member(k, v)).collect())
}

pub(crate) fn canonical(node: &Node) -> String {
    let mut out = Vec::new();
    node.append_canonical(&mut out).unwrap();
    String::from_utf8(out).unwrap()
}

fn number_at(node: &Node, key: &str) -> i64 {
    number(node, key)
}

pub(crate) struct Fixture {
    pub doc_id: String,
    pub start_ticks: String,
    pub scenarios: Vec<Node>,
}

pub(crate) fn load_journal_scenarios() -> Fixture {
    let fixture = load("collab-journal/scenarios.json");
    let scenarios = items(&fixture, "scenarios").to_vec();
    assert!(scenarios.len() >= 40, "only {} scenarios", scenarios.len());
    Fixture {
        doc_id: text(&fixture, "docId"),
        start_ticks: text(&fixture, "startTicks"),
        scenarios,
    }
}

fn parse_int(value: &str) -> i64 {
    value
        .parse::<i64>()
        .unwrap_or_else(|_| value.parse::<u64>().unwrap() as i64)
}

fn scenario_files(scenario: &Node) -> BTreeMap<String, Option<String>> {
    at(scenario, "files")
        .members
        .iter()
        .map(|m| {
            let value = (m.value.kind == Kind::String).then(|| m.value.text().unwrap().to_string());
            (m.key().unwrap().to_string(), value)
        })
        .collect()
}

pub(crate) fn write_scenario_files(
    root: &Path,
    doc_id: &str,
    files: &BTreeMap<String, Option<String>>,
) {
    let key = doc_key(doc_id);
    for (path, content) in files {
        let full = root.join(path.replace("{doc}", &key));
        match content {
            None => std::fs::create_dir_all(&full).unwrap(),
            Some(content) => {
                std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                std::fs::write(&full, unhex(content)).unwrap();
            }
        }
    }
}

pub(crate) struct ScenarioRunner {
    root: PathBuf,
    doc_id: String,
    now: Arc<Mutex<SystemTime>>,
    pub store: Store,
    sessions: HashMap<String, Session>,
    snapshots: HashMap<String, Vec<u8>>,
    logs: Arc<Mutex<Vec<String>>>,
}

impl ScenarioRunner {
    pub(crate) fn new(
        root: &Path,
        doc_id: &str,
        start_ticks: &str,
        max_update: i64,
    ) -> ScenarioRunner {
        let now = Arc::new(Mutex::new(time_from_ticks(parse_int(start_ticks))));
        let logs = Arc::new(Mutex::new(Vec::new()));
        let root_text = root.display().to_string();
        let key = doc_key(doc_id);
        let sink = logs.clone();
        let clock = now.clone();
        let store = Store::new(
            root,
            StoreOptions {
                max_update_bytes: max_update,
                log: Some(Arc::new(move |line: &str| {
                    const HELD: &str = " is held elsewhere: ";
                    let mut line = line.to_owned();
                    if let Some(cut) = line.find(HELD) {
                        line = format!("{}…", &line[..cut + HELD.len()]);
                    }
                    let line = line.replace(&root_text, "{root}").replace(&key, "{doc}");
                    sink.lock().unwrap().push(line);
                })),
                now: Some(Arc::new(move || *clock.lock().unwrap())),
            },
        )
        .unwrap();
        ScenarioRunner {
            root: root.to_owned(),
            doc_id: doc_id.to_owned(),
            now,
            store,
            sessions: HashMap::new(),
            snapshots: HashMap::new(),
            logs,
        }
    }

    fn path(&self, step: &Node) -> PathBuf {
        self.root
            .join(text(step, "path").replace("{doc}", &doc_key(&self.doc_id)))
    }

    pub(crate) fn close_all(&mut self) {
        for session in self.sessions.values_mut() {
            session.close();
        }
        self.sessions.clear();
    }

    fn read_file(&self, step: &Node) -> Vec<u8> {
        std::fs::read(self.path(step)).unwrap()
    }

    fn write_file(&self, step: &Node, data: &[u8]) {
        std::fs::write(self.path(step), data).unwrap();
    }

    fn run(&mut self, step: &Node) -> Option<Node> {
        let op = text(step, "op");
        match op.as_str() {
            "clock" => {
                *self.now.lock().unwrap() = time_from_ticks(parse_int(&text(step, "ticks")));
            }
            "write" => self.write_file(step, &unhex(&text(step, "hex"))),
            "appendBytes" => {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .append(true)
                    .open(self.path(step))
                    .unwrap();
                file.write_all(&unhex(&text(step, "hex"))).unwrap();
            }
            "delete" => std::fs::remove_file(self.path(step)).unwrap(),
            "mkdir" => std::fs::create_dir_all(self.path(step)).unwrap(),
            "rmdir" => std::fs::remove_dir(self.path(step)).unwrap(),
            "zero" => {
                let mut data = self.read_file(step);
                let offset = number_at(step, "offset") as usize;
                let length = number_at(step, "length") as usize;
                data[offset..offset + length].fill(0);
                self.write_file(step, &data);
            }
            "flip" => {
                let mut data = self.read_file(step);
                data[number_at(step, "offset") as usize] ^= 0xff;
                self.write_file(step, &data);
            }
            "snapshot" => {
                let data = self.read_file(step);
                self.snapshots.insert(text(step, "name"), data);
            }
            "restore" => {
                let data = self.snapshots[&text(step, "name")].clone();
                self.write_file(step, &data);
            }
            "keepRecords" => {
                let data = self.read_file(step);
                let mut offset = 0;
                for _ in 0..number_at(step, "count") {
                    let decoded = decode_record(&data[offset..]);
                    assert_eq!(
                        decoded.status,
                        Status::Ok,
                        "keepRecords: record at {offset}"
                    );
                    offset += decoded.consumed;
                }
                self.write_file(step, &data[..offset]);
            }
            "sealed" => write_sealed(
                &self.path(step),
                &text(step, "magic"),
                parse_int(&text(step, "tag")) as u64,
                &unhex(&text(step, "content")),
            )
            .unwrap(),
            _ => return Some(self.call(&op, step)),
        }
        None
    }

    pub(crate) fn call(&mut self, op: &str, step: &Node) -> Node {
        match self.answer(op, step) {
            Ok(node) => node,
            Err(err) => error_json(&err),
        }
    }

    fn session(&mut self, step: &Node) -> &mut Session {
        let name = text(step, "session");
        self.sessions
            .get_mut(&name)
            .unwrap_or_else(|| panic!("no session {name}"))
    }

    fn answer(&mut self, op: &str, step: &Node) -> Result<Node, Error> {
        let ctx = Context::background();
        let doc_id = self.doc_id.clone();
        Ok(match op {
            "open" => {
                let (outcome, session) = self.store.open(&ctx, &doc_id)?;
                let json = open_json(outcome, session.as_ref());
                if let Some(session) = session {
                    self.sessions.insert(text(step, "session"), session);
                }
                json
            }
            "close" => {
                self.session(step).close();
                object(vec![("ok", new_bool(true))])
            }
            "append" => {
                let candidate = Candidate {
                    operation_id: text(step, "operationId"),
                    actor_id: opt_text(step, "actorId"),
                    source: Source(number_at(step, "source") as u8),
                    update: unhex(&text(step, "update")),
                    digest: unhex(&text(step, "digest")),
                };
                let result = self.session(step).append(&ctx, &candidate)?;
                let outcome = match result.outcome {
                    AppendOutcome::Committed => "Committed",
                    AppendOutcome::Duplicate => "Duplicate",
                    AppendOutcome::Conflict => "Conflict",
                };
                object(vec![
                    ("outcome", s(outcome)),
                    ("sequence", s(&result.sequence.to_string())),
                ])
            }
            "find" => {
                let id = text(step, "operationId");
                let digest = unhex(&text(step, "digest"));
                let result = self.session(step).find_committed(&ctx, &id, &digest)?;
                let outcome = match result.outcome {
                    LookupOutcome::NotCommitted => "NotCommitted",
                    LookupOutcome::Duplicate => "Duplicate",
                    LookupOutcome::Conflict => "Conflict",
                };
                object(vec![
                    ("outcome", s(outcome)),
                    ("sequence", s(&result.sequence.to_string())),
                ])
            }
            "checkpoint" => {
                let checkpoint = Checkpoint {
                    through: parse_int(&text(step, "through")) as u64,
                    state: unhex(&text(step, "state")),
                };
                self.session(step).write_checkpoint(&ctx, &checkpoint)?;
                object(vec![("ok", new_bool(true))])
            }
            "reset" => {
                let reset = Reset {
                    format: number_at(step, "format") as i32,
                    epoch: number_at(step, "epoch"),
                    lineage: text(step, "lineage"),
                    baseline: items(step, "baseline")
                        .iter()
                        .map(|f| unhex(&f.text().unwrap().to_string()))
                        .collect(),
                };
                head_json(&self.session(step).reset(&ctx, &reset)?)
            }
            "purge" => {
                let outcome = self.store.purge(&ctx, &doc_id)?;
                object(vec![("outcome", s(&outcome.to_string()))])
            }
            "isPurged" => {
                let purged = self.store.is_purged(&ctx, &doc_id)?;
                object(vec![("purged", new_bool(purged))])
            }
            "lineages" => {
                let list = self
                    .store
                    .list_lineages(&ctx, &doc_id)?
                    .into_iter()
                    .map(|info| {
                        object(vec![
                            ("lineage", s(&info.lineage)),
                            ("epoch", n(info.epoch)),
                            ("format", n(info.format)),
                            (
                                "createdAt",
                                info.created_at
                                    .map_or_else(new_null, |t| s(&ticks(t).to_string())),
                            ),
                            ("current", new_bool(info.current)),
                        ])
                    })
                    .collect();
                object(vec![("lineages", new_array(list))])
            }
            "baseline" => {
                let frames = self
                    .store
                    .read_baseline(&ctx, &doc_id, &text(step, "lineage"))?;
                object(vec![(
                    "baseline",
                    frames.map_or_else(new_null, |f| hex_list(&f)),
                )])
            }
            "records" => {
                let through = parse_int(&text(step, "through")) as u64;
                let mut records = Vec::new();
                for record in
                    self.store
                        .read_records(&ctx, &doc_id, &text(step, "lineage"), through)
                {
                    records.push(record_json(&record?));
                }
                object(vec![("records", new_array(records))])
            }
            "headers" => {
                let mut headers = Vec::new();
                for header in self
                    .store
                    .read_headers(&ctx, &doc_id, &text(step, "lineage"))
                {
                    let header = header?;
                    headers.push(object(vec![
                        ("sequence", s(&header.sequence.to_string())),
                        ("committedAt", s(&ticks(header.committed_at).to_string())),
                        ("actorId", opt_s(header.actor_id.as_deref())),
                    ]));
                }
                object(vec![("headers", new_array(headers))])
            }
            "deleteLineage" => {
                let outcome = self
                    .store
                    .delete_lineage(&ctx, &doc_id, &text(step, "lineage"))?;
                object(vec![("outcome", s(&outcome.to_string()))])
            }
            other => panic!("unknown step {other:?}"),
        })
    }
}

fn open_json(outcome: OpenOutcome, session: Option<&Session>) -> Node {
    let mut members = vec![("outcome", s(&outcome.to_string()))];
    if let Some(session) = session {
        let result = session.open_result();
        members.push((
            "head",
            result.head.as_ref().map_or_else(new_null, head_json),
        ));
        members.push(("baseline", hex_list(&result.baseline)));
        members.push((
            "checkpoint",
            result.checkpoint.as_ref().map_or_else(new_null, |c| {
                object(vec![
                    ("through", s(&c.through.to_string())),
                    ("state", s(&hex(&c.state))),
                ])
            }),
        ));
        members.push((
            "tail",
            new_array(result.tail.iter().map(record_json).collect()),
        ));
    }
    object(members)
}

fn head_json(head: &Head) -> Node {
    object(vec![
        ("format", n(head.format)),
        ("epoch", n(head.epoch)),
        ("lineage", s(&head.lineage)),
        ("durableThrough", s(&head.durable_through.to_string())),
    ])
}

fn record_json(record: &Record) -> Node {
    object(vec![
        ("operationId", s(&record.operation_id)),
        ("sequence", s(&record.sequence.to_string())),
        ("committedAt", s(&ticks(record.committed_at).to_string())),
        ("actorId", opt_s(record.actor_id.as_deref())),
        ("source", n(record.source.0)),
        ("update", s(&hex(&record.update))),
        ("digest", s(&hex(&record.digest))),
    ])
}

fn hex_list(frames: &[Vec<u8>]) -> Node {
    new_array(frames.iter().map(|f| s(&hex(f))).collect())
}

// Names an error the way the capture does; anything else fails.
fn error_json(err: &Error) -> Node {
    let encoded = match err {
        Error::FenceLost => vec![("type", s("FenceLost")), ("message", s(&err.to_string()))],
        Error::InvalidData { message, .. } => {
            vec![("type", s("InvalidData")), ("message", s(message))]
        }
        Error::Closed => vec![("type", s("Disposed"))],
        Error::InvalidOperation(message) => {
            vec![("type", s("InvalidOperation")), ("message", s(message))]
        }
        Error::Argument {
            message,
            out_of_range: true,
        } => vec![("type", s("ArgumentOutOfRange")), ("message", s(message))],
        Error::Argument { message, .. } => vec![("type", s("Argument")), ("message", s(message))],
        Error::Io(_) => vec![("type", s("IO"))],
        other => panic!("an error C# has no kind for: {other}"),
    };
    object(vec![("error", object(encoded))])
}

fn list_files(root: &Path, doc_id: &str) -> BTreeMap<String, Option<String>> {
    let key = doc_key(doc_id);
    let mut files = BTreeMap::new();
    let mut stack = vec![root.to_owned()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace(&key, "{doc}");
            if std::fs::symlink_metadata(&path).unwrap().is_dir() {
                files.insert(format!("{relative}/"), None);
                stack.push(path);
            } else {
                files.insert(relative, Some(hex(&std::fs::read(&path).unwrap())));
            }
        }
    }
    files
}

// Replays each scenario and checks every answer, the log, and that the
// files left on disk are byte for byte the files C# left.
#[test]
fn the_store_answers_every_scenario_like_c_sharp() {
    let fixture = load_journal_scenarios();
    for scenario in &fixture.scenarios {
        let name = text(scenario, "name");
        let root = TempDir::new();
        let mut runner = ScenarioRunner::new(
            root.path(),
            &fixture.doc_id,
            &fixture.start_ticks,
            number(scenario, "maxUpdateBytes"),
        );
        for (i, step) in items(scenario, "steps").iter().enumerate() {
            let want = step
                .members
                .iter()
                .find(|m| m.key().unwrap().to_string() == "result")
                .map(|m| m.value.clone());
            let got = runner.run(step);
            if let Some(want) = want {
                let got = got.unwrap_or_else(new_null);
                assert_eq!(
                    canonical(&got),
                    canonical(&want),
                    "{name} step {i} {}",
                    text(step, "op")
                );
            }
        }
        runner.close_all();
        let want_log: Vec<String> = items(scenario, "log")
            .iter()
            .map(|l| l.text().unwrap().to_string())
            .collect();
        assert_eq!(*runner.logs.lock().unwrap(), want_log, "{name} log");
        let got = list_files(root.path(), &fixture.doc_id);
        let want = scenario_files(scenario);
        for (path, content) in &want {
            match got.get(path) {
                None => panic!("{name} {path}: missing"),
                Some(have) => assert_eq!(have, content, "{name} {path}"),
            }
        }
        for path in got.keys() {
            assert!(
                want.contains_key(path),
                "{name} {path}: written by Rust, not by C#"
            );
        }
    }
}

// Opens the files each C# scenario left with a fresh store, which must see
// what a fresh C# store saw.
#[test]
fn the_store_opens_every_directory_c_sharp_left() {
    let fixture = load_journal_scenarios();
    for scenario in &fixture.scenarios {
        let name = text(scenario, "name");
        let root = TempDir::new();
        write_scenario_files(root.path(), &fixture.doc_id, &scenario_files(scenario));
        let mut runner = ScenarioRunner::new(
            root.path(),
            &fixture.doc_id,
            &fixture.start_ticks,
            number(scenario, "maxUpdateBytes"),
        );
        let got = runner.call("open", &object(vec![("session", s("reopen"))]));
        runner.close_all();
        assert_eq!(canonical(&got), canonical(at(scenario, "reopen")), "{name}");
    }
}

// Lists, many times, two lineages that share a generation. C# keeps
// first-seen order; a hash map would shuffle them.
#[test]
fn lineages_that_share_a_generation_keep_their_ledger_order() {
    let fixture = load_journal_scenarios();
    let name = "an-abandoned-import-of-another-lineage-is-not-deletable";
    let scenario = fixture
        .scenarios
        .iter()
        .find(|s| text(s, "name") == name)
        .unwrap_or_else(|| panic!("no scenario {name}"));
    let root = TempDir::new();
    write_scenario_files(root.path(), &fixture.doc_id, &scenario_files(scenario));
    let runner = ScenarioRunner::new(root.path(), &fixture.doc_id, &fixture.start_ticks, 0);
    for _ in 0..200 {
        let epochs: Vec<i64> = runner
            .store
            .list_lineages(&Context::background(), &fixture.doc_id)
            .unwrap()
            .iter()
            .map(|l| l.epoch)
            .collect();
        assert_eq!(epochs, [7, 8]);
    }
}
