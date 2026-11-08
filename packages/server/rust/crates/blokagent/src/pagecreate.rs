use blok_jsjson::{Kind, Node, new_array, new_object};

use crate::cancel::Cancel;
use crate::errors::{Error, invalid_operation, no_answer};
use crate::executor::{Executor, has_command};
use crate::types::{Actor, Execution, Options, PageCreateRequest, PageCreator};
use crate::wire::{
    failure, get, int_value, member, object, parse, revision_of, str_node, string_value, write,
};

/// What `create_pages` did before the bundle runs the batch.
pub(crate) enum Created {
    /// The ids made, in batch order; empty when the batch makes none.
    Pages(Vec<Node>),
    /// The answer to give instead of running the batch.
    Refused(Execution),
}

impl Executor {
    /// Makes the pages a batch inserts before the bundle runs it: the bundle
    /// counts them on a copy (a refused batch makes none), the host creates
    /// each one for the actor, and the ids go in as createdPages, which the
    /// bundle hands out in batch order.
    pub(crate) async fn create_pages(
        &self,
        cancel: &Cancel,
        input: &mut Node,
        options: Option<&Options>,
        actor: &Actor,
        parent: Option<&str>,
    ) -> Result<Created, Error> {
        let Some(creator) = options
            .filter(|options| options.page_titles)
            .and_then(|options| options.page_target.as_deref())
            .and_then(|target| target.as_creator())
        else {
            return Ok(Created::Pages(Vec::new()));
        };
        let inserts = match input.lookup("batch") {
            Ok(Some(batch)) => has_command(batch, &["block.insert"])?,
            _ => false,
        };
        if !inserts {
            return Ok(Created::Pages(Vec::new()));
        }

        let answer = self.invoke(cancel, "agentPagesNeeded", input).await?;
        let needed = parse(&answer)?;
        if needed.kind != Kind::Object {
            return Err(no_answer("page count"));
        }
        if let Some(refused) = object(&needed, "result")? {
            return Ok(Created::Refused(Execution {
                result_json: write(refused)?,
                document_json: None,
                revision: revision_of(refused)?,
            }));
        }
        let count = int_value(get(&needed, "count")?)?;

        let mut created = Vec::new();
        for _ in 0..count {
            let request = PageCreateRequest {
                parent_document_id: parent.map(str::to_owned),
                principal: None,
                actor: actor.clone(),
                suggested_page_id: suggested_page_id()?,
            };
            let page_id = match create_one(cancel, creator, &request).await {
                Ok(page_id) => page_id,
                Err(err) if !created.is_empty() => {
                    return Ok(Created::Refused(stopped_after_creating(&err, &created)?));
                }
                Err(err) => return Err(err),
            };
            let Some(page_id) = page_id.filter(|id| !id.is_empty()) else {
                let forbidden = failure(
                    "FORBIDDEN",
                    "The host does not let this agent create a page here. Nothing was written.",
                    false,
                    None,
                    "",
                )?;
                if created.is_empty() {
                    return Ok(Created::Refused(forbidden));
                }
                return Ok(Created::Refused(stranded(forbidden, &created)?));
            };
            created.push(str_node(&page_id));
        }

        input
            .members
            .push(member("createdPages", new_array(created.clone())));
        Ok(Created::Pages(created))
    }
}

async fn create_one(
    cancel: &Cancel,
    creator: &dyn PageCreator,
    request: &PageCreateRequest,
) -> Result<Option<String>, Error> {
    cancel.check()?;
    creator.create(cancel, request).await
}

// src/shared/mint-id.ts's alphabet, so ids look the same everywhere.
const PAGE_ID_ALPHABET: &[u8; 64] =
    b"57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9";

/// Ten characters, as blok-mcp mints a page id.
fn suggested_page_id() -> Result<String, Error> {
    let mut bytes = [0u8; 10];
    getrandom::fill(&mut bytes).map_err(|err| Error::Host(err.to_string().into()))?;
    Ok(bytes
        .iter()
        .map(|b| PAGE_ID_ALPHABET[usize::from(b & 63)] as char)
        .collect())
}

/// Answers a batch that stopped on a cancel or an error after the host made
/// pages: nothing was written, and the host is told which pages to clean
/// up. The error itself is not passed on.
pub(crate) fn stopped_after_creating(err: &Error, created: &[Node]) -> Result<Execution, Error> {
    let cause = if err.is_cancel() {
        failure(
            "CANCELLED",
            "The batch was cancelled. Nothing was written.",
            false,
            None,
            "",
        )?
    } else {
        failure(
            "APPLY_FAILED",
            "The batch stopped on a server error. Nothing was written.",
            true,
            None,
            "",
        )?
    };
    stranded(cause, created)
}

/// Wraps a failure after the host created pages in ORPHANED_SIDE_EFFECT,
/// unless it already is one or has no error.
pub(crate) fn stranded(failed: Execution, created: &[Node]) -> Result<Execution, Error> {
    let result = parse(&failed.result_json)?;
    if result.kind != Kind::Object {
        return Err(invalid_operation("The agent result is not an object."));
    }
    let Some(cause) = object(&result, "error")? else {
        return Ok(failed);
    };
    if string_value(get(cause, "code")?)? == "ORPHANED_SIDE_EFFECT" {
        return Ok(failed);
    }
    let message = string_value(get(cause, "message")?)?;
    let orphaned = new_array(
        created
            .iter()
            .map(|page_id| {
                new_object(vec![
                    member("command", str_node("block.insert")),
                    member("type", str_node("page")),
                    member(
                        "prepared",
                        new_object(vec![member("pageId", page_id.clone())]),
                    ),
                ])
            })
            .collect(),
    );
    let details = new_object(vec![
        member("orphaned", orphaned),
        member("cause", cause.clone()),
    ]);
    failure(
        "ORPHANED_SIDE_EFFECT",
        &format!(
            "The batch failed after the host did work for it ({message}). Clean up the listed items."
        ),
        false,
        Some(details),
        &failed.revision,
    )
}
