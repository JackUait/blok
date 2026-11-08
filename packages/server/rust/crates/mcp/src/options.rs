//! Typed start options for a Rust host, as a Node host passes
//! BlokMcpOptions (packages/mcp/types/index.d.ts), and the hooks that are
//! functions there.

use std::sync::Arc;

use serde_json::{Map, Value, json};

pub use crate::authorize::Authorize;

#[derive(Debug, Clone, Default)]
pub enum Transport {
    #[default]
    Stdio,
    Http {
        listen: String,
        public: bool,
    },
}

#[derive(Debug, Clone, Default)]
pub enum Auth {
    #[default]
    None,
    OAuth {
        issuer: String,
        audience: String,
        jwks_url: String,
    },
}

#[derive(Debug, Clone)]
pub struct SyncOptions {
    pub url: String,
    pub origin: Option<String>,
}

#[derive(Debug, Clone)]
pub enum Tickets {
    Secret { secret: String },
    Url { url: String, host_token: String },
}

#[derive(Debug, Clone)]
pub enum Source {
    Endpoint {
        url: String,
        endpoint_auth: String,
        list: Option<String>,
    },
    Files {
        dir: String,
    },
}

/// BlokMcpOptions without its functions; those are in `Hooks`.
#[derive(Debug, Clone, Default)]
pub struct McpOptions {
    pub transport: Transport,
    pub auth: Auth,
    /// None: no live mode.
    pub sync: Option<SyncOptions>,
    pub tickets: Option<Tickets>,
    pub source: Option<Source>,
    /// A custom tools file, as `--manifest` loads it.
    pub manifest: Option<Value>,
    /// "off" or "page-map".
    pub page_titles: Option<String>,
    pub overrides: Option<Value>,
    pub rich_text_fields: Option<Value>,
    /// "envelope", "full" or "mixed".
    pub schema: Option<String>,
    pub handle_idle_ms: Option<u64>,
    pub max_handles_per_principal: Option<u64>,
    /// stdio and auth none only. Default "local".
    pub principal: Option<String>,
    pub comments: Option<bool>,
}

impl McpOptions {
    /// The options object mcpParseArgs gives, which the rest of blok-mcp reads.
    pub fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert(
            "transport".to_owned(),
            match &self.transport {
                Transport::Stdio => json!({ "kind": "stdio" }),
                Transport::Http { listen, public } => {
                    let mut http = json!({ "kind": "http", "listen": listen });
                    if *public {
                        http["public"] = Value::Bool(true);
                    }
                    http
                }
            },
        );
        out.insert(
            "auth".to_owned(),
            match &self.auth {
                Auth::None => json!({ "kind": "none" }),
                Auth::OAuth {
                    issuer,
                    audience,
                    jwks_url,
                } => {
                    json!({ "kind": "oauth", "issuer": issuer, "audience": audience, "jwksUrl": jwks_url })
                }
            },
        );
        if let Some(sync) = &self.sync {
            let mut value = json!({ "url": sync.url });
            if let Some(origin) = &sync.origin {
                value["origin"] = json!(origin);
            }
            out.insert("sync".to_owned(), value);
        }
        if let Some(tickets) = &self.tickets {
            let value = match tickets {
                Tickets::Secret { secret } => json!({ "kind": "secret", "secret": secret }),
                Tickets::Url { url, host_token } => {
                    json!({ "kind": "url", "url": url, "hostToken": host_token })
                }
            };
            out.insert("tickets".to_owned(), value);
        }
        if let Some(source) = &self.source {
            let value = match source {
                Source::Files { dir } => json!({ "kind": "files", "dir": dir }),
                Source::Endpoint {
                    url,
                    endpoint_auth,
                    list,
                } => {
                    let mut value =
                        json!({ "kind": "endpoint", "url": url, "endpointAuth": endpoint_auth });
                    if let Some(list) = list {
                        value["list"] = json!(list);
                    }
                    value
                }
            };
            out.insert("source".to_owned(), value);
        }
        let mut put = |key: &str, value: Option<Value>| {
            if let Some(value) = value {
                out.insert(key.to_owned(), value);
            }
        };
        put("manifest", self.manifest.clone());
        put("pageTitles", self.page_titles.clone().map(Value::String));
        put("overrides", self.overrides.clone());
        put("richTextFields", self.rich_text_fields.clone());
        put("schema", self.schema.clone().map(Value::String));
        put("handleIdleMs", self.handle_idle_ms.map(|n| json!(n)));
        put(
            "maxHandlesPerPrincipal",
            self.max_handles_per_principal.map(|n| json!(n)),
        );
        put("principal", self.principal.clone().map(Value::String));
        put("comments", self.comments.map(Value::Bool));
        Value::Object(out)
    }
}

/// Node's AgentActor; `kind` is always "agent".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentActor {
    pub id: String,
    pub name: String,
    pub on_behalf_of: Option<String>,
    /// A presence colour (#rgb, #rgba, #rrggbb or #rrggbbaa).
    pub color: Option<String>,
}

impl AgentActor {
    pub fn to_value(&self) -> Value {
        let mut actor = json!({ "id": self.id, "name": self.name, "kind": "agent" });
        if let Some(on_behalf_of) = &self.on_behalf_of {
            actor["onBehalfOf"] = json!(on_behalf_of);
        }
        if let Some(color) = &self.color {
            actor["color"] = json!(color);
        }
        actor
    }
}

/// Node's `agentActor(principal, clientName)` option.
pub type AgentActorFn = Arc<dyn Fn(&str, &str) -> AgentActor + Send + Sync>;

/// The options that are functions or host objects in Node.
#[derive(Default)]
pub struct Hooks {
    pub authorize: Option<Arc<dyn Authorize>>,
    pub agent_actor: Option<AgentActorFn>,
    pub uploads: Option<crate::uploads::Uploads>,
    /// The host's own collab rooms (`Server::agent_executor()`).
    pub rooms: Option<Arc<blok_blokagent::Executor>>,
    /// The host's own document store, in place of `McpOptions::source`.
    pub source: Option<Arc<dyn crate::document_source::DocumentSource>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_stdio_with_no_auth() {
        assert_eq!(
            McpOptions::default().to_value(),
            json!({ "transport": { "kind": "stdio" }, "auth": { "kind": "none" } })
        );
    }

    #[test]
    fn names_follow_blok_mcp_options() {
        let options = McpOptions {
            transport: Transport::Http {
                listen: "127.0.0.1:0".to_owned(),
                public: false,
            },
            tickets: Some(Tickets::Url {
                url: "https://h/t".to_owned(),
                host_token: "x".to_owned(),
            }),
            source: Some(Source::Endpoint {
                url: "https://h/d".to_owned(),
                endpoint_auth: "Bearer y".to_owned(),
                list: None,
            }),
            page_titles: Some("page-map".to_owned()),
            handle_idle_ms: Some(1000),
            ..McpOptions::default()
        };
        assert_eq!(
            options.to_value(),
            json!({
                "transport": { "kind": "http", "listen": "127.0.0.1:0" },
                "auth": { "kind": "none" },
                "tickets": { "kind": "url", "url": "https://h/t", "hostToken": "x" },
                "source": { "kind": "endpoint", "url": "https://h/d", "endpointAuth": "Bearer y" },
                "pageTitles": "page-map",
                "handleIdleMs": 1000,
            })
        );
    }
}
