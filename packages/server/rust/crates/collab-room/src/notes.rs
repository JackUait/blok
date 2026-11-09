//! CollabRecordNote, ICollabRecordNotes and CollabStampAuthority.

use std::collections::HashMap;
use std::sync::Mutex;

use blok_collab::BoxFuture;
use blok_collab_convert::EditOp;
use blok_jsjson::{Str, format_number, new_number, new_string};

use crate::Error;

pub const KIND_PERSON: &str = "person";
pub const KIND_AGENT: &str = "agent";

/// CollabRecordNote: what kind of actor wrote one journal record. Kept
/// beside the journal, never in it. `kind` is "agent" for a write by the
/// in-process agent executor and "person" for any other verified actor: a
/// ticket's user is whatever the host minted, so its text never makes it an
/// agent. A host that mints tickets for agents can rewrite the kind in its
/// own `write`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordNote {
    pub kind: String,
    pub on_behalf_of: Option<String>,
}

/// ICollabRecordNotes: an optional store of one note per journal record,
/// keyed by document, lineage and sequence. Without one, history answers
/// carry no actor kinds.
///
/// A note is written right after its record, inside the room's lane, within
/// the commit timeout. It is not atomic with the journal: a crash, a timeout
/// or an error in between loses that one note, and never fails the edit.
/// Blok never deletes notes; delete a document's notes when you purge it.
pub trait RecordNotesStore: Send + Sync {
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        lineage: &'a str,
        sequence: u64,
        note: RecordNote,
    ) -> BoxFuture<'a, Result<(), Error>>;

    /// Every note of one lineage, by sequence.
    fn read<'a>(
        &'a self,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<u64, RecordNote>, Error>>;
}

/// InMemoryCollabRecordNotes: notes kept in memory, lost on restart.
#[derive(Default)]
pub struct MemoryRecordNotes {
    notes: Mutex<HashMap<(String, String), HashMap<u64, RecordNote>>>,
}

impl RecordNotesStore for MemoryRecordNotes {
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        lineage: &'a str,
        sequence: u64,
        note: RecordNote,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let mut notes = self
            .notes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        notes
            .entry((doc_id.to_owned(), lineage.to_owned()))
            .or_default()
            .insert(sequence, note);
        Box::pin(async { Ok(()) })
    }

    fn read<'a>(
        &'a self,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<u64, RecordNote>, Error>> {
        let notes = self
            .notes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let found = notes
            .get(&(doc_id.to_owned(), lineage.to_owned()))
            .cloned()
            .unwrap_or_default();
        Box::pin(async move { Ok(found) })
    }
}

/// CollabActorKinds.Classify: None when no actor is known. Only the
/// in-process agent path passes `agent`: the id's text is never read,
/// because a host may mint a person's ticket with any id, agent: ones too.
pub fn classify_actor(actor_id: &str, agent: bool, on_behalf_of: &str) -> Option<RecordNote> {
    if actor_id.is_empty() {
        return None;
    }
    Some(if agent {
        RecordNote {
            kind: KIND_AGENT.to_owned(),
            on_behalf_of: (!on_behalf_of.is_empty()).then(|| on_behalf_of.to_owned()),
        }
    } else {
        RecordNote {
            kind: KIND_PERSON.to_owned(),
            on_behalf_of: None,
        }
    })
}

/// CollabActorKinds.Attribution: the By and With a block stamp gets. The
/// person is the author and the agent co-authors; with no person the agent
/// is the author. Both None when no actor is known.
pub fn attribution(actor_id: &str, note: Option<&RecordNote>) -> (Option<String>, Option<String>) {
    match note {
        None => (None, None),
        Some(_) if actor_id.is_empty() => (None, None),
        Some(RecordNote {
            kind,
            on_behalf_of: Some(person),
        }) if kind == KIND_AGENT => (Some(person.clone()), Some(actor_id.to_owned())),
        Some(_) => (Some(actor_id.to_owned()), None),
    }
}

const STAMP_KEYS: [&str; 6] = [
    "createdAt",
    "createdBy",
    "createdWith",
    "lastEditedAt",
    "lastEditedBy",
    "lastEditedWith",
];

/// CollabStampAuthority.Apply, for an /edit when the host turns stamp
/// authority on. It runs after the request digest, so a retry still
/// matches. An insert's six stamps are replaced: both times are `now_ms`,
/// By and With follow `attribution`, and an unknown one is removed. An
/// update is followed by a stamp of its block, unless no actor is known.
pub fn stamp_authority(ops: Vec<EditOp>, actor_id: &str, now_ms: f64) -> Vec<EditOp> {
    let (by, with) = attribution(actor_id, classify_actor(actor_id, false, "").as_ref());
    let mut stamped = Vec::with_capacity(ops.len());
    for op in ops {
        match op {
            EditOp::Insert {
                id,
                mut block,
                after,
                parent,
            } => {
                for key in STAMP_KEYS {
                    block.remove(key);
                }
                let now = format_number(now_ms);
                let _ = block.set("createdAt", new_number(&now));
                let _ = block.set("lastEditedAt", new_number(&now));
                if let Some(by) = &by {
                    let by = Str::from(by.as_str());
                    let _ = block.set("createdBy", new_string(by.units()));
                    let _ = block.set("lastEditedBy", new_string(by.units()));
                }
                if let Some(with) = &with {
                    let with = Str::from(with.as_str());
                    let _ = block.set("createdWith", new_string(with.units()));
                    let _ = block.set("lastEditedWith", new_string(with.units()));
                }
                stamped.push(EditOp::Insert {
                    id,
                    block,
                    after,
                    parent,
                });
            }
            EditOp::Update { id, data } => {
                let stamp = by.as_ref().map(|by| EditOp::SetMetadata {
                    id: id.clone(),
                    last_edited_at: now_ms,
                    last_edited_by: Str::from(by.as_str()),
                    last_edited_with: with.as_deref().map(Str::from),
                });
                stamped.push(EditOp::Update { id, data });
                stamped.extend(stamp);
            }
            other => stamped.push(other),
        }
    }
    stamped
}
