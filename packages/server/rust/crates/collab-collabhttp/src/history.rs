use std::collections::HashSet;
use std::future::Future;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_auth::User;
use blok_collab_journal::LineageDeleteOutcome;
use blok_collab_room::{
    BlockChangeKind, CONFIRMABLE_GUARDS, Error, HistoryStatus, MAX_CHANGE_BYTES,
    MAX_CHANGE_RECORDS, Manager, RecordChanges, RestoreGuard, describe_database_change,
};
use blok_collab_synchttp::{derive_actor, refuse};
use blok_collab_workingset::is_lineage;
use blok_dotnet::{parse_uint64_none, query_all};
use blok_http::{Request, ResponseWriter};
use blok_jsjson::{Object, Str, Value, append_quoted, parse, stringify, to_string_lossy};

use crate::edit::{
    BAD_IF_MATCH, KEY_REQUIRED, operation_id, precondition, read_body, while_connected,
    write_edit_result,
};
use crate::{Handlers, expose, failed, refuse_retry_later};

#[path = "history_time.rs"]
mod time;

const HISTORY_LINEAGE_HEADER: &str = "Blok-History-Lineage";
const HISTORY_SEQUENCE_HEADER: &str = "Blok-History-Sequence";
const NO_SUCH_VERSION: &str = "no such version\n";
/// {"changes":[ and ],"truncated":true}.
const CHANGES_ENVELOPE_BYTES: i64 = 32;

struct Admitted {
    doc: String,
    user: User,
    has_user: bool,
    ticket_user: String,
    rooms: Manager,
}

/// Runs a history call off the request's task: the journal reads under it
/// block.
async fn blocking<T: Send + 'static>(
    request: &Request,
    work: impl Future<Output = Result<T, Error>> + Send + 'static,
) -> Option<Result<T, Error>> {
    let handle = tokio::runtime::Handle::current();
    let task = tokio::task::spawn_blocking(move || handle.block_on(work));
    let joined = async move {
        task.await
            .unwrap_or_else(|err| Err(Error::message(err.to_string())))
    };
    while_connected(request, joined).await
}

fn quoted(body: &mut Vec<u8>, s: &str) {
    let units: Vec<u16> = s.encode_utf16().collect();
    append_quoted(body, &units);
}

/// Go's Time.UnixMilli: whole milliseconds, rounded down.
fn unix_milli(at: SystemTime) -> i64 {
    match at.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => {
            let before = before.duration();
            let millis = before.as_millis() as i64;
            if before.as_nanos() % 1_000_000 == 0 {
                -millis
            } else {
                -millis - 1
            }
        }
    }
}

fn append_millis(body: &mut Vec<u8>, at: Option<SystemTime>) {
    match at {
        None => body.extend_from_slice(b"null"),
        Some(at) => body.extend_from_slice(unix_milli(at).to_string().as_bytes()),
    }
}

/// Lists the guard kinds a restore confirms; a body {"confirm":[...]} adds to it.
pub const RESTORE_CONFIRM_HEADER: &str = "X-Blok-Restore-Confirm";

/// Marks a guard's 409, which the key-reuse 409 lacks.
pub const RESTORE_REFUSAL_HEADER: &str = "X-Blok-Restore-Refusal";

/// The kinds from every header line and comma item, then a body
/// {"confirm":[...]}. Unknown kinds and a body that does not parse or is
/// over the cap confirm nothing.
async fn restore_confirms(request: &mut Request, max_bytes: usize) -> HashSet<String> {
    let mut confirmed = HashSet::new();
    let mut add = |kind: &str| {
        if CONFIRMABLE_GUARDS.contains(&kind) {
            confirmed.insert(kind.to_owned());
        }
    };
    for line in request.headers().get_all(RESTORE_CONFIRM_HEADER) {
        for item in line.split(',') {
            add(item.trim_matches([' ', '\t']));
        }
    }
    let Ok(body) = read_body(request, max_bytes).await else {
        return confirmed;
    };
    if let Ok(Value::Object(object)) = parse(&body)
        && let Some(Value::Array(items)) = object.get(&Str::from_utf8(b"confirm"))
    {
        for item in items {
            if let Value::String(kind) = item {
                add(&to_string_lossy(kind.units()));
            }
        }
    }
    confirmed
}

/// The guard's 409: JSON {error, guards} and the refusal header, so a client
/// never mistakes it for a reused key.
async fn refuse_restore(response: &mut ResponseWriter, reason: &str, guards: &[RestoreGuard]) {
    let mut body = Object::new();
    body.set(
        Str::from_utf8(b"error"),
        Value::String(Str::from_utf8(reason.as_bytes())),
    );
    body.set(
        Str::from_utf8(b"guards"),
        Value::Array(guards.iter().map(RestoreGuard::json).collect()),
    );
    let text = stringify(&Value::Object(body)).unwrap_or_default();
    let headers = response.headers_mut();
    headers.set("Content-Type", "application/json");
    headers.set(RESTORE_REFUSAL_HEADER, reason);
    blok_route::start_stream(response, 409).await;
    let _ = response.write(text.as_bytes()).await;
}

async fn write_json(response: &mut ResponseWriter, body: &[u8]) {
    response
        .headers_mut()
        .set("Content-Type", "application/json");
    blok_route::start_stream(response, 200).await;
    let _ = response.write(body).await;
}

impl Handlers {
    /// Sends no-store first: versions are document content behind an access
    /// check, whatever the answer.
    async fn admit_history(
        &self,
        request: &Request,
        response: &mut ResponseWriter,
        write: bool,
    ) -> Option<Admitted> {
        response.headers_mut().set("Cache-Control", "no-store");
        let admitted = self.admit(request, response, write).await?;
        let rooms = self.manager(response).await?;
        Some(Admitted {
            ticket_user: self.ticket_user(&admitted.user),
            doc: admitted.doc,
            user: admitted.user,
            has_user: admitted.has_user,
            rooms,
        })
    }

    /// GET /sync/{doc}/history.
    pub async fn history_list(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, false).await else {
            return;
        };
        let minutes = match query_number(&request, "group") {
            Ok(None) => None,
            Ok(Some(minutes)) if matches!(minutes, 1 | 15 | 60) => Some(minutes),
            _ => {
                refuse(&mut response, 400, "group must be 1, 15 or 60\n").await;
                return;
            }
        };
        let group = Duration::from_secs(minutes.unwrap_or(0) * 60);
        let (rooms, doc) = (a.rooms.clone(), a.doc.clone());
        let result = match blocking(&request, async move { rooms.history(&doc, group).await }).await
        {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if result.status != HistoryStatus::Ready {
            self.refuse_history(&mut response, &a, result.status).await;
            return;
        }
        let mut body = br#"{"lineages":["#.to_vec();
        for (i, lineage) in result.lineages.iter().enumerate() {
            if i > 0 {
                body.push(b',');
            }
            body.extend_from_slice(br#"{"lineage":"#);
            quoted(&mut body, &lineage.lineage);
            body.extend_from_slice(
                format!(
                    r#","epoch":{},"format":{},"createdAt":"#,
                    lineage.epoch, lineage.format
                )
                .as_bytes(),
            );
            append_millis(&mut body, lineage.created_at);
            body.extend_from_slice(format!(r#","current":{}}}"#, lineage.current).as_bytes());
        }
        body.extend_from_slice(br#"],"versions":["#);
        for (i, version) in result.versions.iter().enumerate() {
            if i > 0 {
                body.push(b',');
            }
            body.extend_from_slice(br#"{"lineage":"#);
            quoted(&mut body, &version.lineage);
            body.extend_from_slice(format!(r#","sequence":{}"#, version.sequence).as_bytes());
            body.extend_from_slice(br#","startedAt":"#);
            append_millis(&mut body, version.started_at);
            body.extend_from_slice(br#","savedAt":"#);
            append_millis(&mut body, version.saved_at);
            body.extend_from_slice(br#","actors":["#);
            for (j, actor) in version.actors.iter().enumerate() {
                if j > 0 {
                    body.push(b',');
                }
                quoted(&mut body, actor);
            }
            body.extend_from_slice(b"]}");
        }
        body.extend_from_slice(b"]}");
        write_json(&mut response, &body).await;
    }

    /// GET /sync/{doc}/history/{lineage}/{sequence}.
    pub async fn history_read(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, false).await else {
            return;
        };
        let Some((lineage, sequence)) = history_point(&request, &mut response).await else {
            return;
        };
        let (rooms, doc, at) = (a.rooms.clone(), a.doc.clone(), lineage.clone());
        let read = async move { rooms.read_version(&doc, &at, sequence).await };
        let result = match blocking(&request, read).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if result.status != HistoryStatus::Ready {
            self.refuse_history(&mut response, &a, result.status).await;
            return;
        }
        write_history_head(&mut response, &lineage, sequence);
        write_json(&mut response, &result.json).await;
    }

    /// GET .../changes: the edits of each record in (since, sequence]. The
    /// client names the previous version's sequence.
    pub async fn history_changes(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, false).await else {
            return;
        };
        let Some((lineage, sequence)) = history_point(&request, &mut response).await else {
            return;
        };
        let since = match query_number(&request, "since") {
            Ok(since) if since.is_none_or(|since| since <= sequence) => since.unwrap_or(0),
            _ => {
                refuse(
                    &mut response,
                    400,
                    "since must be a whole number no greater than the sequence\n",
                )
                .await;
                return;
            }
        };
        // v2.1.0 ignored unknown keys here, so a bad detail is ignored, not
        // refused.
        let detail = query_detail(&request) == Ok(true);
        let (rooms, doc, at) = (a.rooms.clone(), a.doc.clone(), lineage.clone());
        let changes = async move {
            rooms
                .changes(
                    &doc,
                    &at,
                    sequence,
                    since,
                    MAX_CHANGE_RECORDS,
                    MAX_CHANGE_BYTES,
                )
                .await
        };
        let result = match blocking(&request, changes).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if result.status != HistoryStatus::Ready {
            self.refuse_history(&mut response, &a, result.status).await;
            return;
        }
        // Rows are measured newest first; the newest always goes out.
        let mut rows: Vec<Vec<u8>> = Vec::new();
        for record in result.changes.iter().rev() {
            let Ok(row) = change_row(record, detail) else {
                failed(&request, &mut response).await;
                return;
            };
            rows.push(row);
        }
        let (kept, truncated) = time::fit_answer(&rows, result.truncated, |oldest| {
            let record = &result.changes[result.changes.len() - 1 - oldest];
            let mut older_end = Vec::new();
            time::append_older_end(
                &mut older_end,
                &lineage,
                record.sequence,
                record.committed_at,
            );
            older_end.len() as i64
        });
        rows.truncate(kept);
        write_history_head(&mut response, &lineage, sequence);
        let mut body = br#"{"changes":["#.to_vec();
        for (i, row) in rows.iter().rev().enumerate() {
            if i > 0 {
                body.push(b',');
            }
            body.extend_from_slice(row);
        }
        body.push(b']');
        if truncated {
            let oldest = &result.changes[result.changes.len() - rows.len()];
            time::append_older_end(&mut body, &lineage, oldest.sequence, oldest.committed_at);
        }
        body.push(b'}');
        write_json(&mut response, &body).await;
    }

    /// DELETE /sync/{doc}/history/{lineage}.
    pub async fn history_delete(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, true).await else {
            return;
        };
        let Some(lineage) = history_lineage(&request, &mut response).await else {
            return;
        };
        let (rooms, doc) = (a.rooms.clone(), a.doc.clone());
        let delete = async move { rooms.delete_lineage(&doc, &lineage).await };
        let (status, outcome) = match blocking(&request, delete).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if status != HistoryStatus::Ready {
            self.refuse_history(&mut response, &a, status).await;
            return;
        }
        match outcome {
            Some(LineageDeleteOutcome::Deleted) => response.set_status(204),
            Some(LineageDeleteOutcome::Current) => {
                refuse(
                    &mut response,
                    409,
                    "the document is on this lineage; it cannot be deleted\n",
                )
                .await;
            }
            Some(LineageDeleteOutcome::Purged) => {
                self.refuse_history(&mut response, &a, HistoryStatus::Purged)
                    .await;
            }
            _ => {
                self.refuse_history(&mut response, &a, HistoryStatus::NotFound)
                    .await;
            }
        }
    }

    /// POST .../restore: the key is required, If-Match is optional, and it
    /// answers like an edit.
    pub async fn history_restore(&self, mut request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, true).await else {
            return;
        };
        let Some((lineage, sequence)) = history_point(&request, &mut response).await else {
            return;
        };
        // Exactly dryRun=1; any other value is today's restore.
        if query_all(
            request.query().strip_prefix('?').unwrap_or(request.query()),
            "dryRun",
        ) == ["1"]
        {
            self.restore_preview(&request, &mut response, &a, &lineage, sequence)
                .await;
            return;
        }
        let Some(operation_id) = operation_id(&request) else {
            refuse(&mut response, 400, KEY_REQUIRED).await;
            return;
        };
        let Ok(expect) = precondition(&request) else {
            refuse(&mut response, 400, BAD_IF_MATCH).await;
            return;
        };
        let confirmed = if self.config.enforce_restore_guards {
            Some(restore_confirms(&mut request, self.config.max_message_bytes).await)
        } else {
            None
        };
        let actor = derive_actor(&a.ticket_user, &a.user, a.has_user);
        let (rooms, doc) = (a.rooms.clone(), a.doc.clone());
        let restore = async move {
            rooms
                .restore_guarded(
                    &doc,
                    &lineage,
                    sequence,
                    &operation_id,
                    &actor,
                    expect,
                    confirmed,
                )
                .await
        };
        let (status, edit, refused) = match blocking(&request, restore).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        match edit {
            Some(edit) if status == HistoryStatus::Ready => {
                write_edit_result(&mut response, &edit, a.rooms.retry_after()).await;
            }
            None if status == HistoryStatus::Ready => {
                refuse_restore(&mut response, "confirmation_required", &refused).await;
            }
            _ => self.refuse_history(&mut response, &a, status).await,
        }
    }

    /// POST .../restore?dryRun=1: the restore planned and measured, nothing
    /// written, no key needed. If-Match is checked as the restore would.
    async fn restore_preview(
        &self,
        request: &Request,
        response: &mut ResponseWriter,
        a: &Admitted,
        lineage: &str,
        sequence: u64,
    ) {
        let Ok(expect) = precondition(request) else {
            refuse(response, 400, BAD_IF_MATCH).await;
            return;
        };
        let (rooms, doc, lineage) = (a.rooms.clone(), a.doc.clone(), lineage.to_owned());
        let preview = async move {
            rooms
                .preview_restore(&doc, &lineage, sequence, expect)
                .await
        };
        let (status, preview, edit) = match blocking(request, preview).await {
            Some(Ok(result)) => result,
            _ => {
                failed(request, response).await;
                return;
            }
        };
        if status != HistoryStatus::Ready {
            self.refuse_history(response, a, status).await;
            return;
        }
        let Some(preview) = preview else {
            if let Some(edit) = edit {
                write_edit_result(response, &edit, a.rooms.retry_after()).await;
            }
            return;
        };
        let key = |name: &str| Str::from_utf8(name.as_bytes());
        let text = |value: &str| Value::String(key(value));
        let blocks = preview
            .blocks
            .iter()
            .map(|change| {
                let mut row = Object::new();
                row.set(key("id"), Value::String(change.id.clone()));
                row.set(
                    key("type"),
                    change.kind_type.clone().map_or(Value::Null, Value::String),
                );
                row.set(key("kind"), text(change_kind(change.kind)));
                Value::Object(row)
            })
            .collect();
        let mut undo = Object::new();
        undo.set(key("blocks"), Value::Array(blocks));
        undo.set(
            key("page"),
            Value::Array(preview.page.iter().map(|page| text(page)).collect()),
        );
        let head = preview.head.as_ref().map_or(String::new(), |head| {
            format!("{}:{}", head.tag.lineage, head.server_sequence)
        });
        let mut body = Object::new();
        body.set(key("wouldUndo"), Value::Object(undo));
        body.set(
            key("guards"),
            Value::Array(preview.guards.iter().map(RestoreGuard::json).collect()),
        );
        body.set(
            key("fits"),
            Value::Bool(preview.frame_bytes <= preview.limit_bytes),
        );
        body.set(key("frameBytes"), Value::Number(preview.frame_bytes as f64));
        body.set(key("limitBytes"), Value::Number(preview.limit_bytes as f64));
        body.set(key("expectRevision"), text(&head));
        match stringify(&Value::Object(body)) {
            Ok(json) => write_json(response, json.as_bytes()).await,
            Err(_) => failed(request, response).await,
        }
    }

    async fn refuse_history(
        &self,
        response: &mut ResponseWriter,
        a: &Admitted,
        status: HistoryStatus,
    ) {
        match status {
            HistoryStatus::None => {
                refuse(response, 501, "history needs a journal that keeps it\n").await;
            }
            HistoryStatus::NotFound => refuse(response, 404, NO_SUCH_VERSION).await,
            HistoryStatus::Purged => refuse(response, 403, "forbidden\n").await,
            HistoryStatus::Unavailable => {
                refuse_retry_later(
                    response,
                    a.rooms.retry_after(),
                    "the server ran past its limits exporting this version, retry\n",
                )
                .await;
            }
            HistoryStatus::ExportFailed => {
                refuse(response, 500, "the version could not be exported\n").await;
            }
            HistoryStatus::Ready | HistoryStatus::Corrupt => {
                if let Some(log) = &self.config.corrupt_log {
                    log(&a.doc);
                }
                refuse(response, 500, "a stored version could not be read\n").await;
            }
        }
    }
}

fn change_kind(kind: BlockChangeKind) -> &'static str {
    match kind {
        BlockChangeKind::Added => "added",
        BlockChangeKind::Removed => "removed",
        BlockChangeKind::Changed => "changed",
        BlockChangeKind::Moved => "moved",
    }
}

/// One changes row. With `detail`, a changed database or row also carries
/// what changed inside its data.
fn change_row(
    record: &RecordChanges,
    detail: bool,
) -> Result<Vec<u8>, blok_collab_docendpoint::Error> {
    let mut row = format!(
        r#"{{"sequence":{},"committedAt":{},"actor":"#,
        record.sequence,
        unix_milli(record.committed_at)
    )
    .into_bytes();
    match &record.actor_id {
        None => row.extend_from_slice(b"null"),
        Some(actor) => quoted(&mut row, actor),
    }
    row.extend_from_slice(br#","blocks":["#);
    for (i, change) in record.blocks.iter().enumerate() {
        if i > 0 {
            row.push(b',');
        }
        row.extend_from_slice(br#"{"id":"#);
        append_quoted(&mut row, change.id.units());
        row.extend_from_slice(br#","type":"#);
        match &change.kind_type {
            None => row.extend_from_slice(b"null"),
            Some(kind) => append_quoted(&mut row, kind.units()),
        }
        row.extend_from_slice(br#","kind":""#);
        row.extend_from_slice(change_kind(change.kind).as_bytes());
        row.push(b'"');
        for (name, block) in [("before", &change.before), ("after", &change.after)] {
            let Some(block) = block else {
                continue;
            };
            let encoded = blok_collab_docendpoint::serialize(&Value::Object(block.clone()))?;
            row.extend_from_slice(format!(r#","{name}":"#).as_bytes());
            row.extend_from_slice(&encoded);
        }
        if detail && change.kind == BlockChangeKind::Changed {
            let fields = describe_database_change(
                change.kind_type.as_ref(),
                change.before.as_ref(),
                change.after.as_ref(),
            );
            if !fields.is_empty() {
                let encoded = blok_collab_docendpoint::serialize(&Value::Object(fields))?;
                row.push(b',');
                row.extend_from_slice(&encoded[1..encoded.len() - 1]);
            }
        }
        row.push(b'}');
    }
    row.push(b']');
    if !record.page.is_empty() {
        row.extend_from_slice(br#","page":["#);
        for (i, key) in record.page.iter().enumerate() {
            if i > 0 {
                row.push(b',');
            }
            quoted(&mut row, key);
        }
        row.push(b']');
    }
    row.push(b'}');
    Ok(row)
}

/// The route's lineage and sequence; a sequence that is not a plain unsigned
/// number is refused.
async fn history_point(request: &Request, response: &mut ResponseWriter) -> Option<(String, u64)> {
    let lineage = history_lineage(request, response).await?;
    // ulong.TryParse with NumberStyles.None: digits only, but .NET also
    // skips any NULs after the last digit ("1\x00" is 1).
    let Some(sequence) = parse_uint64_none(blok_route::path_value(request, "sequence")) else {
        refuse(response, 400, "the sequence must be a whole number\n").await;
        return None;
    };
    Some((lineage, sequence))
}

/// Anything not shaped like a lineage is a 404 and never reaches the store.
async fn history_lineage(request: &Request, response: &mut ResponseWriter) -> Option<String> {
    let lineage = blok_route::path_value(request, "lineage");
    if !is_lineage(lineage) {
        refuse(response, 404, NO_SUCH_VERSION).await;
        return None;
    }
    Some(lineage.to_owned())
}

/// Absent is Ok(None); a repeated, empty or signed value is Err. The query
/// is read the ASP.NET way.
fn query_number(request: &Request, name: &str) -> Result<Option<u64>, ()> {
    let raw = request.query();
    let values = query_all(raw.strip_prefix('?').unwrap_or(raw), name);
    match values.as_slice() {
        [] => Ok(None),
        [value] => parse_uint64_none(value).map(Some).ok_or(()),
        _ => Err(()),
    }
}

/// Absent is Ok(false); only one detail=properties is Ok(true).
fn query_detail(request: &Request) -> Result<bool, ()> {
    let raw = request.query();
    match query_all(raw.strip_prefix('?').unwrap_or(raw), "detail").as_slice() {
        [] => Ok(false),
        [value] if value == "properties" => Ok(true),
        _ => Err(()),
    }
}

/// Not Blok-Doc-*: those name the live head.
fn write_history_head(response: &mut ResponseWriter, lineage: &str, sequence: u64) {
    let headers = response.headers_mut();
    headers.set(HISTORY_LINEAGE_HEADER, lineage);
    headers.set(HISTORY_SEQUENCE_HEADER, sequence.to_string());
    expose(response, &[HISTORY_LINEAGE_HEADER, HISTORY_SEQUENCE_HEADER]);
}
