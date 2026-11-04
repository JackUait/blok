use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use rquickjs::convert::Coerced;
use rquickjs::function::This;
use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Function, Object, Persistent, Value};

use crate::guard::Guard;
use crate::runtime::{Error, JsError, Stop};

/// QuickJS's own stack limit. It must stay below the worker thread's stack
/// (`worker::THREAD_STACK`), or deep recursion overflows the native stack and
/// aborts the process instead of throwing a RangeError.
pub(crate) const MAX_STACK: usize = 16 << 20;

/// The guards of one pooled call.
pub(crate) struct Limits {
    pub(crate) deadline: Instant,
    pub(crate) budget: i64,
    pub(crate) cancel: Option<Arc<AtomicBool>>,
}

/// One QuickJS engine with the bundle loaded. Not `Send`: it never leaves
/// the thread that built it.
// Field order is drop order: the persistent handles and the context must go
// before the runtime.
pub(crate) struct Engine {
    invoke: Persistent<Function<'static>>,
    well_formed: Persistent<Function<'static>>,
    ctx: Context,
    rt: rquickjs::Runtime,
    guard: Guard,
}

enum Settled {
    Value(Persistent<Value<'static>>),
    Thrown(Persistent<Value<'static>>),
    Pending,
    Failed(Error),
}

fn engine_error(err: rquickjs::Error) -> Error {
    Error::Engine(err.to_string())
}

impl Engine {
    /// Loads `source`. With limits, the load runs under the same deadline and
    /// budget a call does, as Go loadGuarded and C# CreateEngine.
    pub(crate) fn load(
        name: &str,
        source: &str,
        limits: Option<(Duration, i64)>,
    ) -> Result<Engine, Error> {
        let rt = rquickjs::Runtime::new().map_err(engine_error)?;
        rt.set_max_stack_size(MAX_STACK);
        let guard = Guard::new();
        rt.set_interrupt_handler(Some(Box::new(guard.handler())));
        let ctx = Context::full(&rt).map_err(engine_error)?;

        if let Some((timeout, budget)) = limits {
            guard.arm(Instant::now() + timeout, None);
            limit_memory(&rt, budget);
        }
        let loaded = ctx.with(|ctx| {
            // Taken before the bundle runs, so a script cannot swap it.
            let well_formed: Function = ctx
                .globals()
                .get::<_, Object>("String")?
                .get::<_, Object>("prototype")?
                .get("toWellFormed")?;
            let well_formed = Persistent::save(&ctx, well_formed);
            let mut options = rquickjs::context::EvalOptions::default();
            options.filename = Some(name.to_owned());
            options.global = true;
            match ctx.eval_with_options::<(), _>(source, options) {
                Ok(()) => {}
                Err(rquickjs::Error::Exception) => {
                    return Ok(Err(Persistent::save(&ctx, ctx.catch())));
                }
                Err(err) => return Err(err),
            }
            let entry: Value = ctx.globals().get("blokServerInvoke")?;
            Ok(Ok((
                well_formed,
                entry
                    .into_function()
                    .map(|function| Persistent::save(&ctx, function)),
            )))
        });
        let fired = if limits.is_some() {
            rt.set_memory_limit(0);
            guard.disarm()
        } else {
            None
        };
        if let Some(stop) = fired {
            return Err(Error::Stopped(stop));
        }
        match loaded {
            Err(err) => Err(engine_error(err)),
            Ok(Err(thrown)) => Err(ctx.with(|ctx| {
                let thrown = thrown
                    .restore(&ctx)
                    .unwrap_or_else(|_| Value::new_undefined(ctx.clone()));
                thrown_error(&ctx, thrown, limits.is_some(), None)
            })),
            Ok(Ok((_, None))) => Err(Error::NoEntryPoint),
            Ok(Ok((well_formed, Some(invoke)))) => Ok(Engine {
                invoke,
                well_formed,
                ctx,
                rt,
                guard,
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn guard(&self) -> &Guard {
        &self.guard
    }

    /// Runs one operation. Without limits nothing stops it but the stack limit.
    pub(crate) fn invoke(
        &mut self,
        op: &str,
        input: &str,
        limits: Option<&Limits>,
    ) -> Result<String, Error> {
        if let Some(limits) = limits {
            self.guard.arm(limits.deadline, limits.cancel.clone());
            limit_memory(&self.rt, limits.budget);
        }
        let settled = self.ctx.with(|ctx| self.run(&ctx, op, input));
        // The limit comes off before any host-side read: reading a result
        // allocates inside QuickJS too.
        let fired = if limits.is_some() {
            self.rt.set_memory_limit(0);
            self.guard.disarm()
        } else {
            None
        };
        if let Some(stop) = fired {
            return Err(Error::Stopped(stop));
        }
        let well_formed = self.well_formed.clone();
        self.ctx.with(|ctx| {
            let well_formed = well_formed.restore(&ctx).map_err(engine_error)?;
            match settled {
                Settled::Pending => Err(Error::Pending),
                Settled::Failed(err) => Err(err),
                Settled::Thrown(thrown) => {
                    let thrown = thrown.restore(&ctx).map_err(engine_error)?;
                    Err(thrown_error(
                        &ctx,
                        thrown,
                        limits.is_some(),
                        Some(&well_formed),
                    ))
                }
                Settled::Value(value) => {
                    let value = value.restore(&ctx).map_err(engine_error)?;
                    match value.into_string() {
                        Some(text) => to_rust_string(&ctx, text, Some(&well_formed)),
                        None => Err(Error::NotAString),
                    }
                }
            }
        })
    }

    fn run(&self, ctx: &Ctx<'_>, op: &str, input: &str) -> Settled {
        let invoke = match self.invoke.clone().restore(ctx) {
            Ok(invoke) => invoke,
            Err(err) => return Settled::Failed(engine_error(err)),
        };
        let value: Value = match invoke.call((op, input)) {
            Ok(value) => value,
            Err(rquickjs::Error::Exception) => {
                return Settled::Thrown(Persistent::save(ctx, ctx.catch()));
            }
            Err(err) => return Settled::Failed(engine_error(err)),
        };
        // No event loop: what the job queue cannot settle never settles.
        while self.guard.fired().is_none() && ctx.execute_pending_job() {}
        let Some(promise) = value.as_promise() else {
            return Settled::Value(Persistent::save(ctx, value));
        };
        match promise.state() {
            PromiseState::Pending => Settled::Pending,
            PromiseState::Resolved => match promise.result::<Value>() {
                Some(Ok(result)) => Settled::Value(Persistent::save(ctx, result)),
                Some(Err(err)) => Settled::Failed(engine_error(err)),
                None => Settled::Pending,
            },
            PromiseState::Rejected => {
                let _ = promise.result::<Value>();
                Settled::Thrown(Persistent::save(ctx, ctx.catch()))
            }
        }
    }
}

/// QuickJS's limit counts bytes it holds, so the budget is growth above what
/// the engine already holds.
fn limit_memory(rt: &rquickjs::Runtime, budget: i64) {
    let used = usize::try_from(rt.memory_usage().malloc_size).unwrap_or(0);
    let budget = usize::try_from(budget).unwrap_or(usize::MAX);
    rt.set_memory_limit(used.saturating_add(budget).max(1));
}

/// Reads a thrown value. Under a budget, QuickJS's own out-of-memory error
/// is the budget's stop: an InternalError "out of memory", or null when even
/// that error could not be allocated (quickjs.c JS_ThrowError2). So a script
/// that throws null under a budget reads as over budget too.
fn thrown_error<'js>(
    ctx: &Ctx<'js>,
    thrown: Value<'js>,
    budgeted: bool,
    well_formed: Option<&Function<'js>>,
) -> Error {
    if budgeted && thrown.is_null() {
        return Error::Stopped(Stop::Budget);
    }
    let err = js_error(ctx, thrown, well_formed);
    if budgeted && err.name == "InternalError" && err.message == "out of memory" {
        return Error::Stopped(Stop::Budget);
    }
    Error::Js(err)
}

/// Reads name and message as C# does (Get, then ToString). Either read can
/// be missing or run a throwing getter or toString; a name that cannot be
/// read is "", which classifies as Unknown.
fn js_error<'js>(
    ctx: &Ctx<'js>,
    thrown: Value<'js>,
    well_formed: Option<&Function<'js>>,
) -> JsError {
    let text = |value: Value<'js>| -> Option<String> {
        match value.get::<Coerced<rquickjs::String>>() {
            Ok(Coerced(text)) => to_rust_string(ctx, text, well_formed).ok(),
            Err(_) => {
                ctx.catch();
                None
            }
        }
    };
    let Some(object) = thrown.as_object() else {
        return JsError {
            name: "Error".to_owned(),
            message: text(thrown.clone()).unwrap_or_default(),
        };
    };
    let read = |key: &str| -> String {
        match object.get::<_, Value>(key) {
            Ok(field) => text(field).unwrap_or_default(),
            Err(_) => {
                ctx.catch();
                String::new()
            }
        }
    };
    JsError {
        name: read("name"),
        message: read("message"),
    }
}

/// A Rust string cannot hold a lone surrogate, so it leaves as U+FFFD, as
/// C# and Go write it to the wire.
fn to_rust_string<'js>(
    ctx: &Ctx<'js>,
    text: rquickjs::String<'js>,
    well_formed: Option<&Function<'js>>,
) -> Result<String, Error> {
    match text.to_string() {
        Ok(text) => Ok(text),
        Err(rquickjs::Error::Utf8(_)) if well_formed.is_some() => {
            let fixed: Result<rquickjs::String, _> =
                well_formed.map_or(Err(rquickjs::Error::Unknown), |f| f.call((This(text),)));
            match fixed {
                Ok(fixed) => fixed.to_string().map_err(engine_error),
                Err(err) => {
                    ctx.catch();
                    Err(engine_error(err))
                }
            }
        }
        Err(err) => Err(engine_error(err)),
    }
}
