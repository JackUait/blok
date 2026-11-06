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
}

// A big batch can take seconds; the pool's own 10 s default would cut it.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

impl Bundle {
    /// Loads the engines. Every process start pays for each one, and the
    /// conformance suite starts one process per case, so keep the pool small.
    pub fn new(pool_size: usize) -> Result<Bundle, BundleError> {
        let pool = Pool::new(Options {
            pool_size: Some(pool_size),
            timeout: Some(CALL_TIMEOUT),
            memory_budget: None,
        })
        .map_err(|e| BundleError(e.to_string()))?;
        Ok(Bundle { pool })
    }

    /// The engines, for the collab converter's HTML reads.
    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub async fn call_text(&self, op: &str, input: &str) -> Result<String, BundleError> {
        self.pool
            .invoke(op, input, None)
            .await
            .map_err(|e| BundleError(format!("{op}: {e}")))
    }

    pub async fn call(&self, op: &str, input: &str) -> Result<Value, BundleError> {
        let text = self.call_text(op, input).await?;
        serde_json::from_str(&text).map_err(|e| BundleError(format!("{op}: {e}")))
    }

    /// The answer's top-level members, kept as their exact JSON text.
    pub async fn call_raw(&self, op: &str, input: &str) -> Result<RawObject, BundleError> {
        let text = self.call_text(op, input).await?;
        RawObject::parse(&text).map_err(|e| BundleError(format!("{op}: {e}")))
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
#[derive(Default)]
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
        async move { bundle.pool.invoke(&op, &input, timeout).await }
    }
}
