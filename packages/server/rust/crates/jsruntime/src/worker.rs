use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;

use crate::engine::{Engine, Limits};
use crate::json_input::normalize;
use crate::runtime::{Error, Stop};

/// The native stack of an engine thread. QuickJS stops recursion at
/// `engine::MAX_STACK`; the rest is room for the frames above and below its
/// check. QuickJS measures the limit from the stack top of the thread that
/// built the engine (rquickjs moves it only with its "parallel" feature), so
/// an engine must run on the thread that built it.
pub(crate) const THREAD_STACK: usize = 32 << 20;

pub(crate) type Job = Box<dyn FnOnce(&mut Engine) + Send>;

/// A thread that owns one engine and runs jobs on it in order.
#[derive(Clone)]
pub(crate) struct Worker {
    jobs: mpsc::Sender<Job>,
}

impl Worker {
    /// Builds the engine on the new thread and waits for the load to finish.
    pub(crate) fn spawn<E: Send + 'static>(
        load: impl FnOnce() -> Result<Engine, E> + Send + 'static,
    ) -> Result<Worker, E> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (loaded, outcome) = mpsc::sync_channel::<Result<(), E>>(1);
        thread::Builder::new()
            .name("blok-jsruntime".to_owned())
            .stack_size(THREAD_STACK)
            .spawn(move || {
                let mut engine = match load() {
                    Ok(engine) => engine,
                    Err(err) => {
                        let _ = loaded.send(Err(err));
                        return;
                    }
                };
                let _ = loaded.send(Ok(()));
                drop(loaded);
                while let Ok(job) = inbox.recv() {
                    job(&mut engine);
                }
            })
            .expect("jsruntime: spawn an engine thread");
        match outcome.recv() {
            Ok(Ok(())) => Ok(Worker { jobs }),
            Ok(Err(err)) => Err(err),
            Err(_) => panic!("jsruntime: the engine thread died while loading"),
        }
    }

    pub(crate) fn send(&self, job: Job) {
        // The thread only exits when every sender is gone.
        let _ = self.jobs.send(job);
    }

    /// Runs one call and waits for it. A panic in the engine is an error.
    pub(crate) fn invoke(
        &self,
        op: &str,
        input: &str,
        limits: Option<Limits>,
    ) -> Result<String, Error> {
        let (op, input) = (op.to_owned(), input.to_owned());
        let (reply, answer) = mpsc::sync_channel(1);
        self.send(Box::new(move |engine| {
            let _ = reply.send(run(engine, &op, &input, limits.as_ref()));
        }));
        answer
            .recv()
            .unwrap_or_else(|_| Err(Error::Engine("the engine thread died".to_owned())))
    }
}

/// One call, with a panic turned into an engine error.
pub(crate) fn run(
    engine: &mut Engine,
    op: &str,
    input: &str,
    limits: Option<&Limits>,
) -> Result<String, Error> {
    catch_unwind(AssertUnwindSafe(|| {
        let budget = limits.map_or(i64::MAX, |limits| limits.budget);
        let mut check = || match limits {
            Some(limits)
                if limits
                    .cancel
                    .as_ref()
                    .is_some_and(|c| c.load(Ordering::SeqCst)) =>
            {
                Err(Stop::Cancel)
            }
            Some(limits) if Instant::now() >= limits.deadline => Err(Stop::Timeout),
            _ => Ok(()),
        };
        let input = normalize(input, budget, &mut check).map_err(Error::InputStopped)?;
        engine.invoke(op, &input, limits)
    }))
    .unwrap_or_else(|panic| {
        let message = panic
            .downcast_ref::<&str>()
            .map(|text| (*text).to_owned())
            .or_else(|| panic.downcast_ref::<String>().cloned())
            .unwrap_or_default();
        Err(Error::Engine(format!("engine panicked: {message}")))
    })
}
