use std::fmt;

use crate::worker::Worker;

/// The bundle C# embeds too. scripts/build-server-runtime.mjs writes Go's
/// committed copy; a vitest law fails when it drifts from a fresh build.
pub(crate) const BUNDLE: &str =
    include_str!("../../../../go/internal/jsruntime/blok-server-runtime.js");

/// Which host limit stopped a call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    Timeout,
    Budget,
    Cancel,
}

/// A JavaScript error thrown or rejected by the bundle.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsError {
    pub name: String,
    pub message: String,
}

impl fmt::Display for JsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

/// Why one engine call or load did not give a string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    Js(JsError),
    /// The bundle's promise had not settled when the job queue ran dry.
    Pending,
    /// The bundle answered with something other than a primitive string.
    /// C# (Jint AsString) throws on it and replaces the engine.
    NotAString,
    /// A host limit stopped the engine mid-run.
    Stopped(Stop),
    /// A host limit stopped the input rewrite (`json_input.rs`) before the
    /// engine ran, so the engine is still sound.
    InputStopped(Stop),
    /// The bundle does not define `blokServerInvoke` as a function.
    NoEntryPoint,
    /// The engine itself failed or panicked.
    Engine(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Js(err) => err.fmt(f),
            Error::Pending => f.write_str("jsruntime: promise still pending after the call"),
            Error::NotAString => f.write_str("jsruntime: the bundle did not answer with a string"),
            Error::Stopped(Stop::Timeout) => {
                f.write_str("jsruntime: the call ran past its timeout")
            }
            Error::Stopped(Stop::Budget) => {
                f.write_str("jsruntime: the call ran past its memory budget")
            }
            Error::Stopped(Stop::Cancel) => f.write_str("jsruntime: the caller cancelled the call"),
            Error::InputStopped(stop) => {
                write!(f, "{} while reading the input", Error::Stopped(*stop))
            }
            Error::NoEntryPoint => {
                f.write_str("jsruntime: bundle does not define blokServerInvoke")
            }
            Error::Engine(message) => write!(f, "jsruntime: {message}"),
        }
    }
}

impl std::error::Error for Error {}

/// One engine with the bundle loaded, on its own thread. Calls run one at a
/// time and have no deadline or budget; `Pool` adds those.
pub struct Runtime {
    worker: Worker,
}

impl Runtime {
    /// Builds an engine from the embedded bundle.
    pub fn new() -> Result<Runtime, Error> {
        Runtime::from_source("blok-server-runtime.js", BUNDLE)
    }

    pub(crate) fn from_source(name: &str, source: &str) -> Result<Runtime, Error> {
        let (name, source) = (name.to_owned(), source.to_owned());
        let worker = Worker::spawn(move || crate::engine::Engine::load(&name, &source, None))?;
        Ok(Runtime { worker })
    }

    /// Runs one operation of the bundle and returns its string result.
    pub fn invoke(&mut self, op: &str, input: &str) -> Result<String, Error> {
        self.worker.invoke(op, input, None)
    }
}
