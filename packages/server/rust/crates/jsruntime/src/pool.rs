use std::fmt;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot};

use crate::engine::{Engine, Limits};
use crate::runtime::{BUNDLE, Error, Stop};
use crate::worker::{self, Worker};

/// The default wall-clock budget of one call and of each load, as C#.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
/// Catches a host that passed milliseconds meaning seconds, as C#.
pub const MINIMUM_TIMEOUT: Duration = Duration::from_millis(100);
/// Bounds the bytes one call allocates, freed or not, as C#'s 512 MiB
/// bounds Jint's count of every allocation (see budget.rs). QuickJS
/// allocates less than Jint for most documents, so a document can fit here
/// that C# refuses: the shared ops.json big.* cases need 8 to 168 MiB here
/// and 11 to 281 MiB in C# (measured, fresh engine each).
pub const DEFAULT_MEMORY_BUDGET: i64 = 512 << 20;
/// C#'s floor.
pub const MINIMUM_MEMORY_BUDGET: i64 = 8 << 20;

/// Why a call failed. The values match C# BlokConversionFailure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Unknown,
    InvalidDocument,
    TimedOut,
    DocumentTooLarge,
}

/// A call the bundle could not finish.
#[derive(Debug)]
pub struct Failure {
    pub kind: Kind,
    pub err: Error,
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "jsruntime: failure {:?}: {}", self.kind, self.err)
    }
}

impl std::error::Error for Failure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.err)
    }
}

/// Which limit a bundle load ran past.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupCause {
    Failed,
    TimedOut,
    OverBudget,
}

/// A pool whose engines could not load the bundle.
#[derive(Debug)]
pub struct StartupError {
    pub cause: StartupCause,
    pub message: String,
    pub err: Error,
}

impl fmt::Display for StartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for StartupError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.err)
    }
}

/// A limit below its floor, named by its `Options` field. Its text is C#'s
/// ArgumentOutOfRangeException message, word for word: C#'s parameter name
/// and values in .NET's format.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConstraintError {
    pub param: &'static str,
    pub value: String,
    pub floor: String,
    text: String,
}

impl ConstraintError {
    /// ThrowIfLessThan's message for `name`, `value` and `floor` as .NET
    /// prints them.
    fn new(param: &'static str, name: &str, value: String, floor: String) -> ConstraintError {
        let text = format!(
            "{name} ('{value}') must be greater than or equal to '{floor}'. (Parameter '{name}')\nActual value was {value}."
        );
        ConstraintError {
            param,
            value,
            floor,
            text,
        }
    }

    fn timeout(param: &'static str, value: Duration) -> ConstraintError {
        ConstraintError::new(
            param,
            "timeout",
            time_span(value),
            time_span(MINIMUM_TIMEOUT),
        )
    }
}

/// TimeSpan.ToString(), the "c" format: `[d.]hh:mm:ss[.fffffff]`. A TimeSpan
/// counts 100 ns ticks, so the nanoseconds under a tick are cut.
pub(crate) fn time_span(value: Duration) -> String {
    const SECOND: u128 = 10_000_000;
    const DAY: u128 = 86_400 * SECOND;
    let ticks = value.as_nanos() / 100;
    let (days, rest) = (ticks / DAY, ticks % DAY);
    let mut out = if days > 0 {
        format!("{days}.")
    } else {
        String::new()
    };
    out.push_str(&format!(
        "{:02}:{:02}:{:02}",
        rest / (3600 * SECOND),
        rest / (60 * SECOND) % 60,
        rest / SECOND % 60
    ));
    if rest % SECOND != 0 {
        out.push_str(&format!(".{:07}", rest % SECOND));
    }
    out
}

impl fmt::Display for ConstraintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

impl std::error::Error for ConstraintError {}

/// What `Pool::invoke` refuses or fails with. A caller's own cancellation is
/// dropping the future; it is never an error.
#[derive(Debug)]
pub enum InvokeError {
    Failure(Failure),
    Constraint(ConstraintError),
}

impl fmt::Display for InvokeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InvokeError::Failure(err) => err.fmt(f),
            InvokeError::Constraint(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for InvokeError {}

/// Configures a Pool. Zero values take the defaults.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    /// Bounds concurrent calls; callers wait for a free engine. None means
    /// max(1, min(cores, 4)); 0 is refused, as C#.
    pub pool_size: Option<usize>,
    /// The default wall-clock budget of one call and of each load. None
    /// means 10 s; under MINIMUM_TIMEOUT, zero too, is refused, as C#.
    pub timeout: Option<Duration>,
    /// The bytes one call may allocate; a load may grow what the engine
    /// holds by as much. See budget.rs. None means the default; under
    /// MINIMUM_MEMORY_BUDGET, zero too, is refused, as C#.
    pub memory_budget: Option<i64>,
}

/// Refuses a pool size under 1. None means the default.
pub fn validate_pool_size(size: Option<usize>) -> Result<(), ConstraintError> {
    match size {
        Some(0) => Err(ConstraintError::new(
            "PoolSize",
            "poolSize",
            "0".to_owned(),
            "1".to_owned(),
        )),
        _ => Ok(()),
    }
}

/// Refuses a timeout or budget below its floor. None means the default and
/// passes.
pub fn validate_constraints(
    timeout: Option<Duration>,
    budget: Option<i64>,
) -> Result<(), ConstraintError> {
    if let Some(budget) = budget.filter(|b| *b < MINIMUM_MEMORY_BUDGET) {
        return Err(ConstraintError::new(
            "MemoryBudget",
            "allocationBudgetBytes",
            budget.to_string(),
            MINIMUM_MEMORY_BUDGET.to_string(),
        ));
    }
    if let Some(timeout) = timeout.filter(|t| *t < MINIMUM_TIMEOUT) {
        return Err(ConstraintError::timeout("Timeout", timeout));
    }
    Ok(())
}

type LoadFn = Arc<dyn Fn() -> Result<Engine, StartupError> + Send + Sync>;

struct Shared {
    load: Mutex<LoadFn>,
    free: mpsc::UnboundedSender<Worker>,
}

/// A fixed set of engines with the bundle loaded, each on its own thread.
pub struct Pool {
    shared: Arc<Shared>,
    free: tokio::sync::Mutex<mpsc::UnboundedReceiver<Worker>>,
    #[cfg(test)]
    size: usize,
    timeout: Duration,
    budget: i64,
}

/// Set when the caller drops the future, so the engine stops at its next
/// interrupt poll and is replaced. `woken` wakes an engine that waits on a
/// pending promise.
struct CancelOnDrop(Option<(Arc<AtomicBool>, Arc<Woken>)>);

type Woken = (Mutex<bool>, Condvar);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some((flag, woken)) = self.0.take() {
            flag.store(true, Ordering::SeqCst);
            *woken.0.lock().unwrap_or_else(|p| p.into_inner()) = true;
            woken.1.notify_all();
        }
    }
}

/// Blocks until the caller cancels or `deadline` passes. True on the cancel.
fn wait_for_cancel(woken: &Woken, deadline: Instant) -> bool {
    let guard = woken.0.lock().unwrap_or_else(|p| p.into_inner());
    let wait = deadline.saturating_duration_since(Instant::now());
    let (guard, _) = woken
        .1
        .wait_timeout_while(guard, wait, |cancelled| !*cancelled)
        .unwrap_or_else(|p| p.into_inner());
    *guard
}

impl Pool {
    /// Builds every engine up front from the embedded bundle. Blocks while
    /// the engines load.
    pub fn new(options: Options) -> Result<Pool, PoolError> {
        validate_constraints(options.timeout, options.memory_budget)
            .map_err(PoolError::Constraint)?;
        validate_pool_size(options.pool_size).map_err(PoolError::Constraint)?;
        let size = options.pool_size.unwrap_or_else(|| {
            std::thread::available_parallelism().map_or(1, |n| n.get().clamp(1, 4))
        });
        Pool::build(
            "blok-server-runtime.js",
            BUNDLE,
            size,
            // build reads zero as the default.
            options.timeout.unwrap_or_default(),
            options.memory_budget.unwrap_or_default(),
        )
    }

    #[cfg(test)]
    pub(crate) fn from_source(
        source: &str,
        size: usize,
        timeout: Duration,
        budget: i64,
    ) -> Result<Pool, PoolError> {
        Pool::build("pool.js", source, size, timeout, budget)
    }

    fn build(
        name: &str,
        source: &str,
        size: usize,
        timeout: Duration,
        budget: i64,
    ) -> Result<Pool, PoolError> {
        if size < 1 {
            return Err(PoolError::Constraint(ConstraintError::new(
                "PoolSize",
                "poolSize",
                size.to_string(),
                "1".to_owned(),
            )));
        }
        if budget < 0 {
            // The constructor's own check, under C#'s name for it.
            return Err(PoolError::Constraint(ConstraintError::new(
                "MemoryBudget",
                "budget",
                budget.to_string(),
                "1".to_owned(),
            )));
        }
        let timeout = if timeout.is_zero() {
            DEFAULT_TIMEOUT
        } else {
            timeout
        };
        let budget = if budget == 0 {
            DEFAULT_MEMORY_BUDGET
        } else {
            budget
        };
        let (name, source) = (name.to_owned(), source.to_owned());
        let load: LoadFn = Arc::new(move || load_guarded(&name, &source, timeout, budget));
        let (free, waiting) = mpsc::unbounded_channel();
        for _ in 0..size {
            let load = load.clone();
            let worker = Worker::spawn(move || load()).map_err(PoolError::Startup)?;
            let _ = free.send(worker);
        }
        Ok(Pool {
            shared: Arc::new(Shared {
                load: Mutex::new(load),
                free,
            }),
            free: tokio::sync::Mutex::new(waiting),
            #[cfg(test)]
            size,
            timeout,
            budget,
        })
    }

    #[cfg(test)]
    pub(crate) fn set_load(
        &self,
        load: impl Fn() -> Result<Engine, StartupError> + Send + Sync + 'static,
    ) {
        *self.shared.load.lock().unwrap_or_else(|p| p.into_inner()) = Arc::new(load);
    }

    #[cfg(test)]
    pub(crate) fn limits(&self) -> (Duration, i64, usize) {
        (self.timeout, self.budget, self.size)
    }

    #[cfg(test)]
    pub(crate) async fn free_engines(&self) -> usize {
        self.free.lock().await.len()
    }

    /// Runs one operation on a free engine, waiting for one if all are busy.
    /// None uses the pool's timeout; any other value, zero too, must be at
    /// least `MINIMUM_TIMEOUT`. Dropping the future stops the call.
    pub async fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Option<Duration>,
    ) -> Result<String, InvokeError> {
        let timeout = match timeout {
            None => self.timeout,
            Some(t) if t < MINIMUM_TIMEOUT => {
                return Err(InvokeError::Constraint(ConstraintError::timeout(
                    "timeout", t,
                )));
            }
            Some(t) => t,
        };
        let worker = {
            let mut free = self.free.lock().await;
            free.recv()
                .await
                .expect("jsruntime: the pool holds its own sender")
        };

        let cancel = Arc::new(AtomicBool::new(false));
        let woken: Arc<Woken> = Arc::default();
        let mut on_drop = CancelOnDrop(Some((cancel.clone(), woken.clone())));
        let (reply, answer) = oneshot::channel();
        let (op, input) = (op.to_owned(), input.to_owned());
        let (budget, shared, slot) = (self.budget, self.shared.clone(), worker.clone());
        worker.send(Box::new(move |engine| {
            let deadline = Instant::now() + timeout;
            let limits = Limits {
                deadline,
                budget,
                cancel: Some(cancel),
            };
            let mut run = worker::run(engine, &op, &input, Some(&limits));
            // No event loop: a pending promise can never settle. As in C#,
            // the wait ends at the caller's cancel or the call timeout,
            // whichever comes first, so one request cannot hold an engine
            // for good.
            if matches!(run, Err(Error::Pending)) && !wait_for_cancel(&woken, deadline) {
                run = Err(Error::Stopped(Stop::Timeout));
            }
            let (result, reusable) = classify(run);
            let _ = reply.send(result);
            if !reusable {
                // A slot that is not refilled is lost for good, so a rebuild
                // that fails or panics keeps the spent engine.
                let load = shared
                    .load
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .clone();
                if let Ok(Ok(fresh)) = catch_unwind(AssertUnwindSafe(|| load())) {
                    *engine = fresh;
                }
            }
            let _ = shared.free.send(slot);
        }));
        let result = answer.await;
        on_drop.0 = None;
        result.unwrap_or_else(|_| {
            Err(InvokeError::Failure(Failure {
                kind: Kind::Unknown,
                err: Error::Engine("the engine thread died".to_owned()),
            }))
        })
    }
}

/// What `Pool::new` refuses or fails with.
#[derive(Debug)]
pub enum PoolError {
    Constraint(ConstraintError),
    Startup(StartupError),
}

impl fmt::Display for PoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PoolError::Constraint(err) => err.fmt(f),
            PoolError::Startup(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for PoolError {}

fn load_guarded(
    name: &str,
    source: &str,
    timeout: Duration,
    budget: i64,
) -> Result<Engine, StartupError> {
    Engine::load(name, source, Some((timeout, budget))).map_err(|err| match err {
        Error::Stopped(Stop::Budget) => StartupError {
            cause: StartupCause::OverBudget,
            message: format!(
                "Loading Blok's runtime bundle into an engine grew its heap past the {budget}-byte \
                 allocation budget this runtime was created with. Loading runs under the same \
                 budget as a conversion, so raise MemoryBudget: the default is \
                 {DEFAULT_MEMORY_BUDGET} bytes (512 MiB), and {MINIMUM_MEMORY_BUDGET} bytes is the floor \
                 this package accepts at all."
            ),
            err,
        },
        Error::Stopped(Stop::Timeout) => StartupError {
            cause: StartupCause::TimedOut,
            message: format!(
                "Loading Blok's runtime bundle into an engine ran past the {timeout:?} timeout \
                 this runtime was created with. Loading runs under the same timeout as a \
                 conversion, so raise Timeout: the default is {DEFAULT_TIMEOUT:?}, and \
                 {MINIMUM_TIMEOUT:?} is the floor this package accepts at all."
            ),
            err,
        },
        err => StartupError {
            cause: StartupCause::Failed,
            message: "Could not load Blok's runtime bundle into an engine.".to_owned(),
            err,
        },
    })
}

/// Go guardedInvoke: the failure kind, and whether the engine finished
/// normally and may serve the next call.
fn classify(result: Result<String, Error>) -> (Result<String, InvokeError>, bool) {
    let err = match result {
        Ok(text) => return (Ok(text), true),
        Err(err) => err,
    };
    let (kind, reusable) = match &err {
        Error::Stopped(Stop::Timeout) => (Kind::TimedOut, false),
        Error::Stopped(Stop::Budget) => (Kind::DocumentTooLarge, false),
        // C#'s stack guard throws a JS RangeError and keeps the engine; so
        // does QuickJS's stack limit.
        // QuickJS concatenates into ropes, so a string that doubles itself
        // hits the length cap long before the budget. C# counts that growth
        // and stops it as too large.
        Error::Js(err) if err.name == "InternalError" && err.message == "string too long" => {
            (Kind::DocumentTooLarge, true)
        }
        Error::Js(err) => (classify_name(&err.name), true),
        Error::InputStopped(Stop::Timeout) => (Kind::TimedOut, true),
        Error::InputStopped(Stop::Budget) => (Kind::DocumentTooLarge, true),
        Error::InputStopped(Stop::Cancel) => (Kind::Unknown, true),
        // Reached only once the caller has cancelled (see invoke), so nobody
        // reads it; the engine is replaced.
        Error::Pending => (Kind::Unknown, false),
        // C# AsString throws and its catch-all replaces the engine.
        Error::NotAString => (Kind::Unknown, false),
        Error::Stopped(Stop::Cancel) | Error::NoEntryPoint | Error::Engine(_) => {
            (Kind::Unknown, false)
        }
    };
    (Err(InvokeError::Failure(Failure { kind, err })), reusable)
}

/// Reads a JS error's name as C# does: only SyntaxError (from JSON.parse)
/// and TypeError (from the input readers) blame the document.
fn classify_name(name: &str) -> Kind {
    if name == "SyntaxError" || name == "TypeError" {
        Kind::InvalidDocument
    } else {
        Kind::Unknown
    }
}
