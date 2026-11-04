use std::fmt;

use blok_collab_operation::Record;
use blok_yjs::{DEFAULT_INSPECT_DEPTH, Doc, EngineError, Options, Verdict, inspect};

/// A baseline frame or record that the history replay could not read or
/// apply (C# CollabHistoryReplayException). `sequence` is None for a
/// baseline frame.
#[derive(Debug)]
pub struct ReplayError {
    pub sequence: Option<u64>,
    pub message: String,
    pub err: Option<EngineError>,
}

impl fmt::Display for ReplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ReplayError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.err
            .as_ref()
            .map(|err| err as &(dyn std::error::Error + 'static))
    }
}

/// Rebuilds the doc as it stood at one point of a lineage: the baseline
/// frames, then the records in journal order, each screened and applied as
/// the live room applies a remote update. A record that arrives before its
/// dependency is parked and lands with it, as it did live. `ctx_err` is Go's
/// `ctx.Err()`, checked before each frame and record.
pub fn build_replay<E: From<ReplayError>>(
    ctx_err: impl Fn() -> Result<(), E>,
    baseline: &[Vec<u8>],
    records: impl IntoIterator<Item = Result<Record, E>>,
) -> Result<Doc, E> {
    replay(ctx_err, baseline, records, |_, _| Ok(()))
}

/// The same replay one step at a time: visit sees the baseline (record
/// None), then each record. Every step hands over the same doc, changed in
/// place, so read it before returning.
pub fn step_replay<E: From<ReplayError>>(
    ctx_err: impl Fn() -> Result<(), E>,
    baseline: &[Vec<u8>],
    records: impl IntoIterator<Item = Result<Record, E>>,
    visit: impl FnMut(Option<&Record>, &Doc) -> Result<(), E>,
) -> Result<(), E> {
    replay(ctx_err, baseline, records, visit).map(|_| ())
}

fn replay<E: From<ReplayError>>(
    ctx_err: impl Fn() -> Result<(), E>,
    baseline: &[Vec<u8>],
    records: impl IntoIterator<Item = Result<Record, E>>,
    mut visit: impl FnMut(Option<&Record>, &Doc) -> Result<(), E>,
) -> Result<Doc, E> {
    let doc = Doc::new(Options::default());
    for (i, frame) in baseline.iter().enumerate() {
        ctx_err()?;
        replay_apply(&doc, frame, None, &format!("baseline frame {i}"))?;
    }
    visit(None, &doc)?;
    for record in records {
        let record = record?;
        ctx_err()?;
        let sequence = record.sequence;
        replay_apply(
            &doc,
            &record.update,
            Some(sequence),
            &format!("record {sequence}"),
        )?;
        visit(Some(&record), &doc)?;
    }
    Ok(doc)
}

/// Fails where the live room would drop the update: a point rebuilt without
/// it is not the point the journal names. The default depth equals
/// MAX_VALUE_DEPTH, because the edit path journals uninspected.
fn replay_apply(
    doc: &Doc,
    update: &[u8],
    sequence: Option<u64>,
    name: &str,
) -> Result<(), ReplayError> {
    let inspection = inspect(update, DEFAULT_INSPECT_DEPTH);
    let decoded = match inspection.decoded {
        Some(decoded) if inspection.verdict == Verdict::Ok => decoded,
        _ => {
            return Err(ReplayError {
                sequence,
                message: format!(
                    "collab: history replay could not read {name}: {}",
                    inspection.reason
                ),
                err: None,
            });
        }
    };
    doc.apply_decoded(&decoded).map_err(|err| ReplayError {
        sequence,
        message: format!("collab: history replay could not apply {name}: {err}"),
        err: Some(err),
    })?;
    Ok(())
}
