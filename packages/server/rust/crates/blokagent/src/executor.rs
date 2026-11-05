use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use blok_jsjson::{Kind, Node};
use blok_jsruntime::{Options as PoolOptions, Pool, PoolError};

use crate::cancel::Cancel;
use crate::errors::{Error, from_runtime, no_answer};
use crate::room::{Live, Rooms};
use crate::types::{Actor, Execution, Options};
use crate::wire::{
    actor_node, common, field, get, is_true, member, object, parse, present, revision_of, text,
    write,
};

/// The future one runtime call returns.
pub type InvokeFuture<'a> = Pin<Box<dyn Future<Output = Result<String, Error>> + Send + 'a>>;

/// The runtime seam: blokserver's shared pool, or a scripted runtime in
/// tests. A zero timeout means the runtime's own.
pub trait Invoker: Send + Sync + 'static {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a>;
}

impl Invoker for Pool {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        Box::pin(async move {
            cancel.check()?;
            // Dropping the pool's call stops the engine and rebuilds it.
            tokio::select! {
                reason = cancel.cancelled() => Err(Error::Cancelled(reason)),
                result = Pool::invoke(self, op, input, timeout) => result.map_err(from_runtime),
            }
        })
    }
}

impl<T: Invoker + ?Sized> Invoker for Arc<T> {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        T::invoke(self, cancel, op, input, timeout)
    }
}

/// Configures `Executor::new`. A None limit takes the default, as in
/// blokdocs::Options.
#[derive(Clone, Debug, Default)]
pub struct FactoryOptions {
    pub pool_size: Option<usize>,
    pub timeout: Option<Duration>,
    pub memory_budget: Option<i64>,
    /// When set, `execute_in_room` runs on these live rooms.
    pub rooms: Option<Rooms>,
}

/// Runs agent batches. Safe for concurrent use; a Session is not.
pub struct Executor {
    pub(crate) runtime: Arc<dyn Invoker>,
    pub(crate) live: Option<Live>,
    /// Runs between an undo's head read and its room lane.
    #[cfg(test)]
    pub(crate) before_history_lane: Option<crate::roomreplay::Hook>,
}

impl Executor {
    /// Builds an executor over a fresh engine pool, as C#
    /// BlokDocuments.CreateAgentExecutor does. Building one is expensive, so
    /// hold it for the life of the process. Blocks while the engines load.
    pub fn new(options: FactoryOptions) -> Result<Executor, PoolError> {
        let pool = Pool::new(PoolOptions {
            pool_size: options.pool_size,
            timeout: options.timeout,
            memory_budget: options.memory_budget,
        })?;
        Ok(Executor::new_on_runtime(pool, options.rooms))
    }

    /// An executor over a runtime the caller holds.
    pub fn on_runtime(runtime: impl Invoker) -> Executor {
        Executor::new_on_runtime(runtime, None)
    }

    /// For blokserver: an executor over the server's own engine pool, the
    /// one its rooms read HTML with, as a C# host shares one IBlokRuntime.
    pub fn new_on_runtime(runtime: impl Invoker, rooms: Option<Rooms>) -> Executor {
        Executor {
            runtime: Arc::new(runtime),
            live: rooms.map(Live::attach),
            #[cfg(test)]
            before_history_lane: None,
        }
    }

    pub(crate) async fn invoke(
        &self,
        cancel: &Cancel,
        op: &str,
        input: &Node,
    ) -> Result<String, Error> {
        invoke_on(self.runtime.as_ref(), cancel, op, input).await
    }

    /// Runs a batch on a stored document. The answer holds a document to
    /// save only when the batch succeeded. A plain call keeps no steps, so
    /// history.undo and history.redo are unavailable; `open_session` offers
    /// them.
    pub async fn execute(
        &self,
        cancel: &Cancel,
        document_json: &str,
        batch_json: &str,
        actor: &Actor,
        options: Option<&Options>,
    ) -> Result<Execution, Error> {
        Box::pin(self.run(cancel, document_json, batch_json, actor, options, None))
            .await
            .map(|(execution, _)| execution)
    }

    /// A stored batch. With history, the bundle takes a session's steps and
    /// hands them back with the batch applied; the host only carries them.
    pub(crate) async fn run(
        &self,
        cancel: &Cancel,
        document_json: &str,
        batch_json: &str,
        actor: &Actor,
        options: Option<&Options>,
        history: Option<&Node>,
    ) -> Result<(Execution, Option<Node>), Error> {
        let mut input = common(options)?;
        let document = parse(document_json)?;
        let batch = parse(batch_json)?;
        let page_target = options
            .filter(|options| options.page_titles)
            .and_then(|options| options.page_target.as_deref());
        let page_action = match page_target {
            Some(_) => has_command(&batch, &["page.rename", "page.setIcon"])?,
            None => false,
        };
        input.members.push(member("document", document));
        input.members.push(member("batch", batch));
        input.members.push(member("actor", actor_node(actor)));

        if let (true, Some(target)) = (page_action, page_target) {
            let done = self.run_page_action(cancel, &input, actor, target).await?;
            let Some(history) = history else {
                return Ok((done, None));
            };
            let result = parse(&done.result_json)?;
            if !is_true(Some(&result), "ok")? {
                return Ok((done, Some(history.clone())));
            }
            let next = crate::session::wrote_another_document(history)?;
            return Ok((done, Some(next)));
        }

        let made = match self
            .create_pages(cancel, &mut input, options, actor)
            .await?
        {
            crate::pagecreate::Created::Refused(refusal) => {
                return Ok((refusal, history.cloned()));
            }
            crate::pagecreate::Created::Pages(made) => made,
        };
        if let Some(history) = history {
            input.members.push(member("history", history.clone()));
        }

        let output = match self.agent_execute(cancel, &input).await {
            Ok(output) => output,
            Err(err) if !made.is_empty() => {
                let stopped = crate::pagecreate::stopped_after_creating(&err, &made)?;
                return Ok((stopped, history.cloned()));
            }
            Err(err) => return Err(err),
        };
        let result = field(Some(&output), "result")?.ok_or_else(|| no_answer("agent result"))?;
        let saved = if is_true(Some(result), "ok")? {
            let document = get(&output, "document")?.ok_or_else(|| no_answer("document"))?;
            Some(write(document)?)
        } else {
            None
        };
        let next = match history {
            Some(_) => Some(
                object(&output, "history")?
                    .ok_or_else(|| no_answer("session history"))?
                    .clone(),
            ),
            None => None,
        };
        Ok((
            Execution {
                result_json: write(result)?,
                document_json: saved,
                revision: revision_of(result)?,
            },
            next,
        ))
    }

    /// The call C# wraps in one try: the invoke, the parse and the null
    /// check all count as the run stopping.
    pub(crate) async fn agent_execute(&self, cancel: &Cancel, input: &Node) -> Result<Node, Error> {
        agent_execute_on(self.runtime.as_ref(), cancel, input).await
    }

    /// The command contract for `execute`.
    pub async fn contract(
        &self,
        cancel: &Cancel,
        options: Option<&Options>,
    ) -> Result<String, Error> {
        let input = common(options)?;
        self.contract_for(cancel, &input).await
    }

    /// The command contract for `execute_in_room`. With rooms whose journal
    /// keeps history it adds the version history reads and restore.
    pub async fn room_contract(
        &self,
        cancel: &Cancel,
        options: Option<&Options>,
    ) -> Result<String, Error> {
        let input = self.room_common(options)?;
        self.contract_for(cancel, &input).await
    }

    pub(crate) async fn contract_for(
        &self,
        cancel: &Cancel,
        input: &Node,
    ) -> Result<String, Error> {
        let answer = self.invoke(cancel, "manifest", input).await?;
        let output = parse(&answer)?;
        let contract = get(&output, "contract")?.ok_or_else(|| no_answer("agent contract"))?;
        write(contract)
    }
}

pub(crate) async fn invoke_on(
    runtime: &dyn Invoker,
    cancel: &Cancel,
    op: &str,
    input: &Node,
) -> Result<String, Error> {
    let written = write(input)?;
    runtime.invoke(cancel, op, &written, Duration::ZERO).await
}

pub(crate) async fn agent_execute_on(
    runtime: &dyn Invoker,
    cancel: &Cancel,
    input: &Node,
) -> Result<Node, Error> {
    let answer = invoke_on(runtime, cancel, "agentExecute", input).await?;
    let output = parse(&answer)?;
    if !present(Some(&output)) {
        return Err(no_answer("agent execution"));
    }
    Ok(output)
}

/// A command with one of `names`, as C# HasInsert and HasPageAction: it
/// stops at the first match, so a bad key after it is never read.
pub(crate) fn has_command(batch: &Node, names: &[&str]) -> Result<bool, Error> {
    if batch.kind != Kind::Object {
        return Ok(false);
    }
    let Some(commands) = get(batch, "commands")?.filter(|c| c.kind == Kind::Array) else {
        return Ok(false);
    };
    for command in commands.items.iter().filter(|c| c.kind == Kind::Object) {
        let Some(value) = text(get(command, "name")?)? else {
            continue;
        };
        if names.contains(&value.as_str()) {
            return Ok(true);
        }
    }
    Ok(false)
}
