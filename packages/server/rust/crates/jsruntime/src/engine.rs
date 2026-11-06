use std::cmp::Ordering;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use icu_collator::{Collator, CollatorBorrowed};
use rquickjs::context::intrinsic;
use rquickjs::convert::Coerced;
use rquickjs::function::{Opt, This};
use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Function, Object, Persistent, Value};

use crate::budget::{Budget, Charge};
use crate::guard::Guard;
use crate::runtime::{Error, JsError, Stop};

/// QuickJS's own stack limit. It must stay below the worker thread's stack
/// (`worker::THREAD_STACK`), or deep recursion overflows the native stack and
/// aborts the process instead of throwing a RangeError. It is set on QuickJS
/// directly: rquickjs 0.14's `set_max_stack_size` treats any limit above
/// 16 MiB as no limit at all.
///
/// Sized so plain text converts 11049 outline levels and fails at 11050, as
/// Jint's stack guard does in a warm C# process (both measured; a cold first
/// C# call stops near 7000). HTML and Markdown stop
/// earlier, on the memory budget, as in C#.
pub(crate) const MAX_STACK: usize = (40 << 20) + (317 << 10);

const _: () = assert!(MAX_STACK + (8 << 20) <= crate::worker::THREAD_STACK);

/// Sets QuickJS's stack limit, measured from the stack top QuickJS took
/// when the runtime was built (see `worker::THREAD_STACK`).
#[allow(unsafe_code)]
fn set_max_stack(ctx: &Ctx<'_>, limit: usize) {
    // SAFETY: ctx is a live context of this thread's runtime, and rquickjs
    // holds the runtime lock for the whole `with` closure.
    unsafe {
        rquickjs::qjs::JS_SetMaxStackSize(
            rquickjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr()),
            limit as _,
        );
    }
}

/// The guards of one pooled call.
pub(crate) struct Limits {
    pub(crate) deadline: Instant,
    pub(crate) budget: i64,
    /// Charge the bytes the call holds at its peak, not every allocation.
    pub(crate) held: bool,
    pub(crate) cancel: Option<Arc<AtomicBool>>,
}

/// One QuickJS engine with the bundle loaded. Not `Send`: it never leaves
/// the thread that built it.
// Field order is drop order: the persistent handles must go before the
// context, which holds the runtime.
pub(crate) struct Engine {
    invoke: Persistent<Function<'static>>,
    well_formed: Persistent<Function<'static>>,
    ctx: Context,
    guard: Guard,
    budget: Budget,
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
        let budget = Budget::default();
        let rt = rquickjs::Runtime::new_with_alloc(budget.allocator()).map_err(engine_error)?;
        let guard = Guard::new();
        rt.set_interrupt_handler(Some(Box::new(guard.handler(budget.clone()))));
        // JS_NewContext's intrinsics minus atob/btoa (and the DOMException
        // they bring) and performance: Jint and goja have none of them.
        let ctx = Context::custom::<(
            intrinsic::Date,
            intrinsic::Eval,
            intrinsic::RegExp,
            intrinsic::Json,
            intrinsic::Proxy,
            intrinsic::MapSet,
            intrinsic::TypedArrays,
            intrinsic::Promise,
            intrinsic::WeakRef,
        )>(&rt)
        .map_err(engine_error)?;

        let limit = budget;
        if let Some((timeout, budget)) = limits {
            guard.arm(Instant::now() + timeout, None);
            limit.arm(budget, Charge::Held);
        }
        let loaded = ctx.with(|ctx| {
            set_max_stack(&ctx, MAX_STACK);
            // Taken before the bundle runs, so a script cannot swap it.
            let well_formed: Function = ctx
                .globals()
                .get::<_, Object>("String")?
                .get::<_, Object>("prototype")?
                .get("toWellFormed")?;
            install_locale_compare(&ctx)?;
            install_json_parse_depth(&ctx, &well_formed)?;
            // A base object in QuickJS, absent from Jint and goja.
            ctx.globals().remove("queueMicrotask")?;
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
            stopped(&guard, &limit)
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
                Error::Js(js_error(&ctx, thrown, None))
            })),
            Ok(Ok((_, None))) => Err(Error::NoEntryPoint),
            Ok(Ok((well_formed, Some(invoke)))) => Ok(Engine {
                invoke,
                well_formed,
                budget: limit,
                ctx,
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
            let charge = if limits.held {
                Charge::Held
            } else {
                Charge::Allocated
            };
            self.budget.arm(limits.budget, charge);
        }
        let settled = self.ctx.with(|ctx| self.run(&ctx, op, input));
        // The limit comes off before any host-side read: reading a result
        // allocates inside QuickJS too.
        let fired = if limits.is_some() {
            stopped(&self.guard, &self.budget)
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
                    Err(Error::Js(js_error(&ctx, thrown, Some(&well_formed))))
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

/// Ends a guarded run. A run that went over budget is stopped even when
/// JS caught the failed allocation and finished.
fn stopped(guard: &Guard, budget: &Budget) -> Option<Stop> {
    let over = budget.disarm();
    let fired = guard.disarm();
    if over { Some(Stop::Budget) } else { fired }
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

/// ICU's root collation. Jint compares with the host's current culture, and
/// the C# host on Linux runs ICU under the invariant culture, which is root.
static COLLATOR: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| {
    Collator::try_new(Default::default(), Default::default())
        .expect("icu_collator: compiled root collation data")
});

/// QuickJS's localeCompare compares UTF-16 code units; Jint (ICU), goja
/// and node collate. A lone surrogate compares as U+FFFD; Jint throws on it.
// The closure must not hold a JS value: QuickJS's GC cannot see into it,
// and the engine would abort on free with a leaked object.
/// Jint's Options.Json.MaxParseDepth default, which C# keeps: its
/// JSON.parse refuses a 65th nested array or object, wherever the text came
/// from.
const MAX_JSON_DEPTH: usize = 64;

/// Takes the engine's JSON.parse and a scan that answers the UTF-16 index of
/// the first bracket nested past the cap, -1 for none, or -2 for text that
/// must be made well formed first. A method, so it is named "parse", has
/// length 2, and is no constructor. Go installs the same wrapper.
const JSON_PARSE_WRAPPER: &str = r#"(parse, tooDeepAt, SyntaxErrorType, wellFormed) => {
  const wrapped = {
    parse(text, reviver) {
      const source = `${text}`;
      let at = tooDeepAt(source);
      if (at === -2) {
        at = tooDeepAt(wellFormed.call(source));
      }
      if (at >= 0) {
        throw new SyntaxErrorType('Max. depth level of JSON reached at position ' + at);
      }
      return parse(source, reviver);
    },
  }.parse;
  Object.defineProperty(JSON, 'parse', { value: wrapped, writable: true, enumerable: false, configurable: true });
}"#;

fn install_json_parse_depth<'js>(
    ctx: &Ctx<'js>,
    well_formed: &Function<'js>,
) -> rquickjs::Result<()> {
    let install: Function = ctx.eval(JSON_PARSE_WRAPPER)?;
    let too_deep = Function::new(
        ctx.clone(),
        |text: rquickjs::String<'js>| -> rquickjs::Result<i64> {
            match text.to_string() {
                Ok(text) => Ok(json_too_deep_at(&text)),
                Err(rquickjs::Error::Utf8(_)) => Ok(-2),
                Err(err) => Err(err),
            }
        },
    )?;
    let parse: Function = ctx.globals().get::<_, Object>("JSON")?.get("parse")?;
    let syntax_error: Value = ctx.globals().get("SyntaxError")?;
    install.call((parse, too_deep, syntax_error, well_formed.clone()))
}

/// Scans brackets outside strings. It does not check the rest of the
/// syntax: JSON.parse still does, and both fail as SyntaxError.
pub(crate) fn json_too_deep_at(text: &str) -> i64 {
    let (mut depth, mut index) = (0usize, 0i64);
    let (mut in_string, mut escaped) = (false, false);
    for c in text.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if c == '[' || c == '{' {
            depth += 1;
            if depth > MAX_JSON_DEPTH {
                return index;
            }
        } else if c == ']' || c == '}' {
            depth = depth.saturating_sub(1);
        }
        index += c.len_utf16() as i64;
    }
    -1
}

fn install_locale_compare<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<()> {
    let compare = Function::new(
        ctx.clone(),
        |ctx: Ctx<'js>,
         this: This<Coerced<rquickjs::String<'js>>>,
         that: Opt<Coerced<rquickjs::String<'js>>>|
         -> rquickjs::Result<i32> {
            let text = |value: rquickjs::String<'js>| match value.to_string() {
                Ok(text) => Ok(text),
                Err(_) => ctx
                    .globals()
                    .get::<_, Object>("String")?
                    .get::<_, Object>("prototype")?
                    .get::<_, Function>("toWellFormed")?
                    .call::<_, rquickjs::String>((This(value),))?
                    .to_string(),
            };
            let left = text(this.0.0)?;
            let right = match that.0 {
                Some(Coerced(that)) => text(that)?,
                None => "undefined".to_owned(),
            };
            Ok(match COLLATOR.compare(&left, &right) {
                Ordering::Less => -1,
                Ordering::Equal => 0,
                Ordering::Greater => 1,
            })
        },
    )?;
    let descriptor = Object::new(ctx.clone())?;
    descriptor.set("value", compare)?;
    descriptor.set("writable", true)?;
    descriptor.set("configurable", true)?;
    let object: Object = ctx.globals().get("Object")?;
    let define: Function = object.get("defineProperty")?;
    let prototype: Object = ctx.globals().get::<_, Object>("String")?.get("prototype")?;
    define.call::<_, Value>((prototype, "localeCompare", descriptor))?;
    Ok(())
}
