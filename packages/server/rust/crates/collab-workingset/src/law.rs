use crate::{Error, Tag, decode_document};

/// CollabWorkingSet: the frame section and its tag.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Set {
    pub updates: Vec<u8>,
    pub tag: Tag,
}

/// Reads a stored blob; an unreadable one is logged and treated as absent.
pub fn decode_or_absent(doc_id: &str, document: &[u8], log: Option<&dyn Fn(&str)>) -> Option<Set> {
    match decode_document(document) {
        Ok((tag, updates)) => Some(Set { updates, tag }),
        Err(message) => {
            if let Some(log) = log {
                log(&format!(
                    "collab: the working set for \"{doc_id}\" is unreadable ({message}); treating it as absent"
                ));
            }
            None
        }
    }
}

/// Refuses a write below the stored epoch.
pub fn ensure_write_does_not_lower_epoch(
    doc_id: &str,
    stored: Option<&Set>,
    next: &Tag,
) -> Result<(), Error> {
    match stored {
        Some(stored) if next.epoch < stored.tag.epoch => Err(Error::Refused(format!(
            "collab: refusing to lower the working-set epoch for \"{doc_id}\" from {} to {}.",
            stored.tag.epoch, next.epoch
        ))),
        _ => Ok(()),
    }
}

/// Refuses a reset that does not raise the epoch strictly.
pub fn ensure_reset_raises_epoch(
    doc_id: &str,
    stored: Option<&Set>,
    next: &Tag,
) -> Result<(), Error> {
    match stored {
        Some(stored) if next.epoch <= stored.tag.epoch => Err(Error::Refused(format!(
            "collab: a reset must raise the working-set epoch for \"{doc_id}\" above {} (got {}).",
            stored.tag.epoch, next.epoch
        ))),
        _ => Ok(()),
    }
}
