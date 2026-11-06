//! Errors the host raises. `retryable` depends on which Node helper built
//! the error, so each one names its helper and the bundle sets the flag.

use serde_json::{Map, Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Helper {
    /// Node's surfaceError: handles, sources, tickets, rooms, authorize.
    Surface,
    /// The engine's failure(): open cancelled, page-title errors.
    Failure,
    /// Already carries `retryable` (a re-wrap or a bundle-built error).
    AsIs,
}

impl Helper {
    fn name(self) -> &'static str {
        match self {
            Helper::Surface => "surface",
            Helper::Failure => "failure",
            Helper::AsIs => "as-is",
        }
    }
}

/// A model-fixable error: it becomes a tool answer, never a JSON-RPC error.
#[derive(Debug, Clone, PartialEq)]
pub struct HostError {
    pub helper: Helper,
    /// `{ code, message, details?, retryable? }`.
    pub error: Value,
}

impl HostError {
    pub fn surface(code: &str, message: impl Into<String>) -> HostError {
        HostError {
            helper: Helper::Surface,
            error: json!({ "code": code, "message": message.into() }),
        }
    }

    pub fn surface_with(code: &str, message: impl Into<String>, details: Value) -> HostError {
        HostError {
            helper: Helper::Surface,
            error: json!({ "code": code, "message": message.into(), "details": details }),
        }
    }

    pub fn failure(code: &str, message: impl Into<String>) -> HostError {
        HostError {
            helper: Helper::Failure,
            error: json!({ "code": code, "message": message.into() }),
        }
    }

    /// An AgentError the bundle already built.
    pub fn as_is(error: Value) -> HostError {
        HostError {
            helper: Helper::AsIs,
            error,
        }
    }

    pub fn code(&self) -> &str {
        self.error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    /// The `{ tool, helper, error }` input mcpErrorAnswer takes.
    pub fn answer_input(&self, tool: &str) -> String {
        json!({ "tool": tool, "helper": self.helper.name(), "error": self.error }).to_string()
    }

    /// The `{ helper, error }` that mcpExecuteAnswer's `failed` takes.
    pub fn failed_input(&self) -> Value {
        let mut map = Map::new();
        map.insert(
            "helper".to_owned(),
            Value::String(self.helper.name().to_owned()),
        );
        map.insert("error".to_owned(), self.error.clone());
        Value::Object(map)
    }
}

/// Why a tool call failed. Host errors are answers; internal ones are
/// JSON-RPC -32603, as an exception is in Node.
#[derive(Debug, Clone)]
pub enum Fault {
    Host(HostError),
    Internal(String),
}

impl From<HostError> for Fault {
    fn from(err: HostError) -> Self {
        Fault::Host(err)
    }
}

impl From<crate::bundle::BundleError> for Fault {
    fn from(err: crate::bundle::BundleError) -> Self {
        Fault::Internal(err.0)
    }
}
