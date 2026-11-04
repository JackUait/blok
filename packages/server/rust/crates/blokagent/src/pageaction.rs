use blok_jsjson::{Kind, Node, new_array, new_bool, new_null, new_object};

use crate::cancel::Cancel;
use crate::errors::{Error, invalid_operation, no_answer};
use crate::executor::Executor;
use crate::types::{Actor, Execution, PageLocation, PageTarget};
use crate::wire::{
    field, first, get, get_mut, is_true, member, object, parse, present, set, source_execution,
    str_node, string_value, text, write,
};

impl Executor {
    /// Renames a page or sets its icon on the target's own document. The
    /// bundle checks the batch against the source (agentPlanHost) and never
    /// runs the action itself.
    pub(crate) async fn run_page_action(
        &self,
        cancel: &Cancel,
        input: &Node,
        actor: &Actor,
        pages: &dyn PageTarget,
    ) -> Result<Execution, Error> {
        let answer = self.invoke(cancel, "agentPlanHost", input).await?;
        let output = parse(&answer)?;
        if !present(Some(&output)) {
            return Err(no_answer("host plan"));
        }
        let mut source = match field(Some(&output), "result")? {
            Some(source) if source.kind == Kind::Object => source.clone(),
            _ => return Err(no_answer("source result")),
        };
        if !is_true(Some(&source), "ok")? {
            return source_execution(&source);
        }

        let command = first_command(&output)?.ok_or_else(|| {
            invalid_operation("The Blok runtime returned no checked host command.")
        })?;
        let args = object(command, "args")?
            .ok_or_else(|| invalid_operation("The Blok runtime returned no checked host args."))?;
        let planned = planned_page_id(&output)?;

        cancel.check()?;
        let location = match &planned {
            Some(page_id) => pages.resolve(cancel, page_id, actor).await?,
            None => None,
        };
        let page_id = planned.clone().unwrap_or_default();
        let Some(location) = location else {
            return page_failure(&source, planned.as_deref());
        };

        let rename = string_value(get(command, "name")?)?;
        let (field_name, inner_name) = if rename == "page.rename" {
            ("title", "doc.setTitle")
        } else {
            ("icon", "doc.setIcon")
        };
        let value = get(args, field_name)?.cloned().unwrap_or_else(new_null);
        let inner = write(&new_object(vec![member(
            "commands",
            new_array(vec![new_object(vec![
                member("name", str_node(inner_name)),
                member("args", new_object(vec![member(field_name, value)])),
            ])]),
        )]))?;

        let done = match location {
            PageLocation::Stored(target) => {
                let document = target.load(cancel).await?;
                // The target batch runs with no options: no custom tools,
                // overrides or comments flag reach it.
                let done = Box::pin(self.execute(cancel, &document, &inner, actor, None)).await?;
                if let Some(saved) = &done.document_json {
                    cancel.check()?;
                    target.save(cancel, saved).await?;
                }
                done
            }
            PageLocation::Room { doc_id } => {
                self.execute_in_room(cancel, &doc_id, &inner, actor, None)
                    .await?
            }
        };

        let mut target_result = parse(&done.result_json)?;
        if target_result.kind != Kind::Object {
            return Err(invalid_operation("The target returned no agent result."));
        }
        let extra: Vec<Node> = match get(&target_result, "warnings")? {
            Some(list) if list.kind == Kind::Array => list.items.clone(),
            _ => Vec::new(),
        };
        // C# adds to the source's own list, so a success answers both too.
        match get_mut(&mut source, "warnings")? {
            Some(warnings) if warnings.kind == Kind::Array => warnings.items.extend(extra),
            _ => return Err(invalid_operation("The source result returned no warnings.")),
        }

        if !is_true(Some(&target_result), "ok")? {
            if object(&target_result, "error")?.is_none() {
                return Err(invalid_operation("The target failure returned no error."));
            }
            let error = get_mut(&mut target_result, "error")?.expect("checked above");
            if !matches!(get_mut(error, "details")?, Some(details) if details.kind == Kind::Object)
            {
                set(error, "details", new_object(Vec::new()))?;
            }
            let details = get_mut(error, "details")?.expect("set above");
            set(details, "pageId", str_node(&page_id))?;
            set(
                &mut target_result,
                "revision",
                clone_or_null(&source, "revision"),
            )?;
            let warnings = get(&source, "warnings")?.cloned().unwrap_or_else(new_null);
            set(&mut target_result, "warnings", warnings)?;
            return source_execution(&target_result);
        }

        let applied = new_array(vec![new_object(vec![
            member("pageId", str_node(&page_id)),
            member("applied", new_bool(true)),
        ])]);
        set(&mut source, "results", applied)?;
        source_execution(&source)
    }
}

/// `output["batch"]?["commands"]?[0] as JsonObject`.
fn first_command(output: &Node) -> Result<Option<&Node>, Error> {
    let batch = field(Some(output), "batch")?;
    let commands = field(batch, "commands")?;
    Ok(first(commands)?.filter(|command| command.kind == Kind::Object))
}

/// `output["view"]?["blocks"]?[0]?["data"]?["pageId"]` read as a string.
fn planned_page_id(output: &Node) -> Result<Option<String>, Error> {
    let view = field(Some(output), "view")?;
    let blocks = field(view, "blocks")?;
    let block = first(blocks)?;
    let data = field(block, "data")?;
    text(field(data, "pageId")?)
}

/// `source[key]?.DeepClone()` as a value to set: JSON null when absent.
fn clone_or_null(source: &Node, key: &str) -> Node {
    match source.lookup(key) {
        Ok(Some(value)) if value.kind != Kind::Null => value.clone(),
        _ => new_null(),
    }
}

/// C#'s PageFailure. Its key order differs from `failure`'s: ok, revision,
/// error, warnings, and revision and warnings are copied even when absent,
/// as null.
fn page_failure(source: &Node, page_id: Option<&str>) -> Result<Execution, Error> {
    let mut details = new_object(Vec::new());
    if let Some(page_id) = page_id {
        details.members.push(member("pageId", str_node(page_id)));
    }
    let result = new_object(vec![
        member("ok", new_bool(false)),
        member("revision", clone_or_null(source, "revision")),
        member(
            "error",
            new_object(vec![
                member("code", str_node("PRECONDITION_FAILED")),
                member(
                    "message",
                    str_node("The page block points at no page this server can open."),
                ),
                member("retryable", new_bool(false)),
                member("details", details),
            ]),
        ),
        member("warnings", clone_or_null(source, "warnings")),
    ]);
    source_execution(&result)
}
