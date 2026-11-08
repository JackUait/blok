//! The engine bundle's MCP operations. Every pure MCP rule lives in the
//! bundle (docs/plans/2026-11-06-csharp-mcp-research/08-bundle-contract.md);
//! this crate only does IO.

use std::time::Duration;

use blok_jsruntime::{Options, Pool};
use serde_json::Value;
use serde_json::value::RawValue;

/// A bundle call that threw: a host bug or an engine failure. Node answers
/// these as JSON-RPC -32603.
#[derive(Debug, Clone)]
pub struct BundleError(pub String);

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BundleError {}

pub struct Bundle {
    pool: Pool,
    /// Tests only: a call to this op whose input holds this text fails.
    #[cfg(test)]
    pub(crate) fail: std::sync::Mutex<Option<(&'static str, &'static str)>>,
    /// Tests only: this many matching calls pass before `fail` fails one.
    #[cfg(test)]
    pub(crate) fail_after: std::sync::atomic::AtomicUsize,
    /// Tests only: a live room fails a batch right after writing it.
    #[cfg(test)]
    pub(crate) fail_after_room_write: std::sync::atomic::AtomicBool,
    /// Tests only: a live room cannot give its document.
    #[cfg(test)]
    pub(crate) fail_room_read: std::sync::atomic::AtomicBool,
    /// Tests only: this op's answer loses this top-level member.
    #[cfg(test)]
    pub(crate) drop_member: std::sync::Mutex<Option<(&'static str, &'static str)>>,
}

// A big batch can take seconds; the pool's own 10 s default would cut it.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
// Each call is charged what it holds, not every byte it allocates. A batch
// of 300 inserts of 2000 characters allocates about 620 MiB but holds under
// 32 MiB; one that fills the 4 MiB HTTP body (1300 inserts) holds under
// 64 MiB. Node runs both, its heap peaking at 46 and 66 MiB. The limit is
// per engine, and loading the bundle needs about 30 MiB of it.
const MEMORY_BUDGET: i64 = 256 << 20;

impl Bundle {
    /// Loads the engines. Every process start pays for each one, and the
    /// conformance suite starts one process per case, so keep the pool small.
    pub fn new(pool_size: usize) -> Result<Bundle, BundleError> {
        Bundle::with_budget(pool_size, MEMORY_BUDGET)
    }

    /// `budget`: the bytes one call may hold at once.
    pub fn with_budget(pool_size: usize, budget: i64) -> Result<Bundle, BundleError> {
        let pool = Pool::new(Options {
            pool_size: Some(pool_size),
            timeout: Some(CALL_TIMEOUT),
            memory_budget: Some(budget),
        })
        .map_err(|e| BundleError(e.to_string()))?
        .charging_held();
        Ok(Bundle {
            pool,
            #[cfg(test)]
            fail: std::sync::Mutex::default(),
            #[cfg(test)]
            fail_after: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            fail_after_room_write: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            fail_room_read: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            drop_member: std::sync::Mutex::default(),
        })
    }

    /// The engines, for the collab converter's HTML reads.
    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub async fn call_text(&self, op: &str, input: &str) -> Result<String, BundleError> {
        // A client's number past f64 crosses rmcp as a stand-in (lenient.rs);
        // the engine reads it back as Infinity. mcpCheckCall keeps it: the
        // step it gives back would carry Infinity as null.
        let restored;
        let input = if op != "mcpCheckCall" && input.contains(crate::lenient::INFINITY_STAND_IN) {
            restored = crate::lenient::restore_infinities(input);
            restored.as_str()
        } else {
            input
        };
        #[cfg(test)]
        if self.fails(op, input) {
            return Err(BundleError(format!("{op}: failed for a test")));
        }
        self.pool
            .invoke(op, input, None)
            .await
            .map_err(|e| BundleError(format!("{op}: {e}")))
    }

    /// Tests only: whether `fail` fails this call.
    #[cfg(test)]
    fn fails(&self, op: &str, input: &str) -> bool {
        matches!(*self.fail.lock().unwrap(), Some((failing, marker)) if op == failing && input.contains(marker))
            && self
                .fail_after
                .try_update(
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::SeqCst,
                    |left| left.checked_sub(1),
                )
                .is_err()
    }

    pub async fn call(&self, op: &str, input: &str) -> Result<Value, BundleError> {
        let text = self.call_text(op, input).await?;
        serde_json::from_str(&text).map_err(|e| BundleError(format!("{op}: {e}")))
    }

    /// The answer's top-level members, kept as their exact JSON text.
    pub async fn call_raw(&self, op: &str, input: &str) -> Result<RawObject, BundleError> {
        let text = self.call_text(op, input).await?;
        #[allow(unused_mut)]
        let mut raw = RawObject::parse(&text).map_err(|e| BundleError(format!("{op}: {e}")))?;
        #[cfg(test)]
        if let Some((dropping, member)) = *self.drop_member.lock().unwrap()
            && op == dropping
        {
            raw.0.retain(|(key, _)| key != member);
        }
        Ok(raw)
    }
}

/// A JSON object whose member values stay as text, in order.
#[derive(Debug, Default)]
pub struct RawObject(Vec<(String, Box<RawValue>)>);

impl RawObject {
    pub fn parse(text: &str) -> Result<RawObject, serde_json::Error> {
        let members: members::Members = serde_json::from_str(text)?;
        Ok(RawObject(members.0))
    }

    pub fn get(&self, key: &str) -> Option<&RawValue> {
        // The last copy wins, as in JSON.parse.
        self.0
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_ref())
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn value(&self, key: &str) -> Option<Value> {
        self.get(key)
            .and_then(|raw| serde_json::from_str(raw.get()).ok())
    }

    pub fn text(&self, key: &str) -> Option<&str> {
        self.get(key).map(RawValue::get)
    }
}

mod members {
    use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
    use serde_json::value::RawValue;

    pub struct Members(pub Vec<(String, Box<RawValue>)>);

    impl<'de> Deserialize<'de> for Members {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct V;
            impl<'de> Visitor<'de> for V {
                type Value = Members;
                fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    f.write_str("a JSON object")
                }
                fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Members, A::Error> {
                    let mut out = Vec::new();
                    while let Some((k, v)) = map.next_entry::<String, Box<RawValue>>()? {
                        out.push((k, v));
                    }
                    Ok(Members(out))
                }
            }
            deserializer.deserialize_map(V)
        }
    }
}

/// Builds a JSON object as text, so raw members are written as they came.
#[derive(Clone, Default)]
pub struct Obj {
    text: String,
}

impl Obj {
    pub fn new() -> Obj {
        Obj {
            text: String::from("{"),
        }
    }

    fn key(&mut self, key: &str) {
        if self.text.len() > 1 {
            self.text.push(',');
        }
        self.text
            .push_str(&serde_json::to_string(key).unwrap_or_default());
        self.text.push(':');
    }

    pub fn val(mut self, key: &str, value: &Value) -> Obj {
        self.key(key);
        self.text
            .push_str(&serde_json::to_string(value).unwrap_or_default());
        self
    }

    pub fn str(self, key: &str, value: &str) -> Obj {
        self.val(key, &Value::String(value.to_owned()))
    }

    pub fn bool(self, key: &str, value: bool) -> Obj {
        self.val(key, &Value::Bool(value))
    }

    /// `raw` must be one JSON value.
    pub fn raw(mut self, key: &str, raw: &str) -> Obj {
        self.key(key);
        self.text.push_str(raw);
        self
    }

    pub fn finish(mut self) -> String {
        self.text.push('}');
        self.text
    }
}

/// The bundle's engines as the collab converter's runtime.
#[derive(Clone)]
pub struct BundleInvoker(pub std::sync::Arc<Bundle>);

impl blok_collab_convert::Invoker for BundleInvoker {
    fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Option<Duration>,
    ) -> impl std::future::Future<Output = Result<String, blok_jsruntime::InvokeError>> + Send {
        let bundle = self.0.clone();
        let (op, input) = (op.to_owned(), input.to_owned());
        async move {
            #[cfg(test)]
            if bundle.fails(&op, &input) {
                return Err(blok_jsruntime::InvokeError::Failure(
                    blok_jsruntime::Failure {
                        kind: blok_jsruntime::Kind::Unknown,
                        err: blok_jsruntime::Error::Js(blok_jsruntime::JsError {
                            name: "Error".to_owned(),
                            message: format!("{op}: failed for a test"),
                        }),
                    },
                ));
            }
            bundle.pool.invoke(&op, &input, timeout).await
        }
    }
}
