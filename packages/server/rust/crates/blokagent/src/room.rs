//! The room side of the executor. Live rooms need the collaboration crates,
//! which are not ported yet, so this executor is C#'s built without rooms:
//! `execute_in_room` answers COMMAND_UNAVAILABLE and never runs the bundle.
//! Go's room.go, roomhistory.go, roomreplay.go, translate.go and
//! versions.go land here.

use blok_jsjson::Node;

use crate::cancel::Cancel;
use crate::errors::Error;
use crate::executor::Executor;
use crate::types::{Actor, Execution, Options};
use crate::wire::{common, member, str_node, unavailable};

impl Executor {
    /// C#'s RoomCommon: a room keeps the agent's steps on the server, so its
    /// contract says so. Rooms whose journal keeps history also add
    /// versionHistory and restores.
    pub(crate) fn room_common(&self, options: Option<&Options>) -> Result<Node, Error> {
        let mut input = common(options)?;
        input
            .members
            .push(member("runtime", str_node("csharp-live")));
        Ok(input)
    }

    /// Runs a batch on a live room. Without rooms it answers
    /// COMMAND_UNAVAILABLE and never runs the bundle.
    pub async fn execute_in_room(
        &self,
        _cancel: &Cancel,
        doc_id: &str,
        _batch_json: &str,
        _actor: &Actor,
        _options: Option<&Options>,
    ) -> Result<Execution, Error> {
        if doc_id.is_empty() {
            return Err(Error::Argument {
                param: "docId".to_owned(),
                message: "The value cannot be an empty string.".to_owned(),
            });
        }
        unavailable("Live rooms need collaboration on this server.")
    }
}
