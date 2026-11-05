use std::fmt;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot};

use crate::engine::{Engine, Limits};
use crate::runtime::{BUNDLE, Error, Stop};
use crate::worker::{self, Worker};

/// The default wall-clock budget of one call and of each load, as C#.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
/// Catches a host that passed milliseconds meaning seconds, as C#.
pub const MINIMUM_TIMEOUT: Duration = Duration::from_millis(100);
/// Bounds the bytes one call allocates, freed or not, scaled to Jint's
/// count, as C#'s 512 MiB bounds Jint's count of every allocation (see
/// budget.rs).
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

/// A limit below its floor, named by its `Options` field.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConstraintError {
    pub param: &'static str,
    pub value: String,
    pub floor: String,
}

impl fmt::Display for ConstraintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "jsruntime: {} is {}, below the floor of {}",
            self.param, self.value, self.floor
        )
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
    /// The default wall-clock budget of one call and of each load.
    pub timeout: Duration,
    /// The bytes one call may allocate, scaled to Jint's count; a load may
    /// grow what the engine holds by as much. See budget.rs.
    pub memory_budget: i64,
}

/// Refuses a pool size under 1. None means the default.
pub fn validate_pool_size(size: Option<usize>) -> Result<(), ConstraintError> {
    match size {
        Some(0) => Err(ConstraintError {
            param: "PoolSize",
            value: "0".to_owned(),
            floor: "1".to_owned(),
        }),
        _ => Ok(()),
    }
}

/// Refuses a timeout or budget below its floor. Zero means the default and
/// passes.
pub fn validate_constraints(timeout: Duration, budget: i64) -> Result<(), ConstraintError> {
    if budget != 0 && budget < MINIMUM_MEMORY_BUDGET {
        return Err(ConstraintError {
            param: "MemoryBudget",
            value: budget.to_string(),
            floor: MINIMUM_MEMORY_BUDGET.to_string(),
        });
    }
    if !timeout.is_zero() && timeout < MINIMUM_TIMEOUT {
        return Err(ConstraintError {
            param: "Timeout",
            value: format!("{timeout:?}"),
            floor: format!("{MINIMUM_TIMEOUT:?}"),
        });
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
/// interrupt poll and is replaced.
struct CancelOnDrop(Option<Arc<AtomicBool>>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(flag) = self.0.take() {
            flag.store(true, Ordering::SeqCst);
        }
    }
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
            options.timeout,
            options.memory_budget,
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
            return Err(PoolError::Constraint(ConstraintError {
                param: "PoolSize",
                value: size.to_string(),
                floor: "1".to_owned(),
            }));
        }
        if budget < 0 {
            return Err(PoolError::Constraint(ConstraintError {
                param: "MemoryBudget",
                value: budget.to_string(),
                floor: "1".to_owned(),
            }));
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
    /// A zero timeout uses the pool's; any other value must be at least
    /// `MINIMUM_TIMEOUT`. Dropping the future stops the call.
    pub async fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Duration,
    ) -> Result<String, InvokeError> {
        if !timeout.is_zero() && timeout < MINIMUM_TIMEOUT {
            return Err(InvokeError::Constraint(ConstraintError {
                param: "timeout",
                value: format!("{timeout:?}"),
                floor: format!("{MINIMUM_TIMEOUT:?}"),
            }));
        }
        let timeout = if timeout.is_zero() {
            self.timeout
        } else {
            timeout
        };
        let worker = {
            let mut free = self.free.lock().await;
            free.recv()
                .await
                .expect("jsruntime: the pool holds its own sender")
        };

        let cancel = Arc::new(AtomicBool::new(false));
        let mut on_drop = CancelOnDrop(Some(cancel.clone()));
        let (reply, answer) = oneshot::channel();
        let (op, input) = (op.to_owned(), input.to_owned());
        let (budget, shared, slot) = (self.budget, self.shared.clone(), worker.clone());
        worker.send(Box::new(move |engine| {
            let limits = Limits {
                deadline: Instant::now() + timeout,
                budget,
                cancel: Some(cancel),
            };
            let (result, reusable) = classify(worker::run(engine, &op, &input, Some(&limits)));
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
        // No event loop: a promise pending now can never settle. The engine
        // itself finished, so it is kept.
        Error::Pending => (Kind::Unknown, true),
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
