//! Start-up: argv and env to options, as Node's runCli does it, in its order.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::bundle::{Bundle, BundleError};

/// A refusal at start: printed as `blok-mcp: <message>`, exit code 2.
#[derive(Debug)]
pub enum StartError {
    Config(String),
    /// Not a refusal Node names (e.g. a config path that is a folder): exit code 1.
    Failed(String),
    Bundle(BundleError),
}

impl From<BundleError> for StartError {
    fn from(err: BundleError) -> Self {
        StartError::Bundle(err)
    }
}

/// The authorize hook named by `--authorize`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorizeSpec {
    Webhook(String),
}

/// What runCli has before it builds the server.
#[derive(Debug, Clone)]
pub struct Started {
    /// The `options` of mcpParseArgs, plus the validated manifest and overrides.
    pub options: Value,
    pub authorize: Option<AuthorizeSpec>,
    /// `--create-page <url>`: the host's page creator webhook.
    pub create_page: Option<String>,
    /// `--handle-store files:<dir>`: the files handle store's directory.
    pub handle_store: Option<String>,
}

/// The env vars the options read. Only BLOK_* names matter (src/shared/mcp/config.ts).
pub fn blok_env(vars: impl Iterator<Item = (String, String)>) -> Value {
    Value::Object(
        vars.filter(|(name, _)| name.starts_with("BLOK_"))
            .map(|(name, value)| (name, Value::String(value)))
            .collect(),
    )
}

/// runCli's start: the flags (`parse`), then the standalone server's checks.
pub async fn start(
    bundle: &Bundle,
    argv: &[String],
    env: Value,
    cwd: &Path,
) -> Result<Started, StartError> {
    let started = parse(bundle, argv, env, cwd).await?;
    let options = &started.options;
    let mut checked_options = options.clone();
    if started.authorize.is_some() {
        checked_options["authorize"] = Value::Bool(true);
    }
    if started.create_page.is_some() {
        checked_options["createPage"] = Value::Bool(true);
    }
    if started.handle_store.is_some() {
        checked_options["handleStore"] = Value::Bool(true);
    }
    let checked = bundle
        .call(
            "mcpCheckOptions",
            &json!({ "options": checked_options }).to_string(),
        )
        .await?;
    if let Some(error) = checked.get("error").and_then(Value::as_str) {
        return Err(StartError::Config(error.to_owned()));
    }
    let stdio = options.pointer("/transport/kind").and_then(Value::as_str) != Some("http");
    if stdio && options.pointer("/auth/kind").and_then(Value::as_str) != Some("none") {
        return Err(StartError::Config(
            "OAuth authentication needs the HTTP transport (--http)".to_owned(),
        ));
    }
    Ok(started)
}

/// Node's parseBlokMcpArgs: the blok-mcp flags and env as options, with the
/// manifest files read, and none of the standalone server's checks. A host
/// that serves Blok's tools (`embed::BlokTools`) reads its flags this way.
pub async fn parse(
    bundle: &Bundle,
    argv: &[String],
    env: Value,
    cwd: &Path,
) -> Result<Started, StartError> {
    let parsed = bundle
        .call(
            "mcpParseArgs",
            &json!({ "argv": argv, "env": env }).to_string(),
        )
        .await?;
    if let Some(error) = parsed.get("error").and_then(Value::as_str) {
        return Err(StartError::Config(error.to_owned()));
    }
    let ok = parsed.get("ok").cloned().unwrap_or(Value::Null);
    let mut options = ok.get("options").cloned().unwrap_or_else(|| json!({}));
    let files = ok.get("files").cloned().unwrap_or_else(|| json!({}));
    let file = |key: &str| files.get(key).and_then(Value::as_str).map(str::to_owned);

    let authorize = match file("authorize") {
        None => None,
        Some(spec) => Some(authorize_spec(&spec, cwd)?),
    };
    for (key, kind) in [("manifest", "manifest"), ("overrides", "overrides")] {
        if let Some(path) = file(key) {
            let value = read_json_file(&path, cwd)?;
            let checked = bundle
                .call(
                    "mcpConfigFile",
                    &json!({ "kind": kind, "value": value }).to_string(),
                )
                .await?;
            if let Some(error) = checked.get("error").and_then(Value::as_str) {
                return Err(StartError::Config(error.to_owned()));
            }
            options[key] = checked.get("value").cloned().unwrap_or(Value::Null);
        }
    }
    Ok(Started {
        options,
        authorize,
        create_page: file("createPage"),
        handle_store: file("handleStore"),
    })
}

/// Node's loadAuthorizeHook: an http(s) spec (lower case only) is a
/// webhook; anything else is a module path resolved against cwd.
pub fn authorize_spec(spec: &str, cwd: &Path) -> Result<AuthorizeSpec, StartError> {
    if spec.starts_with("http://") || spec.starts_with("https://") {
        return Ok(AuthorizeSpec::Webhook(spec.to_owned()));
    }
    let path = resolve_like_node(cwd, spec);
    if std::fs::metadata(&path).is_err() {
        return Err(StartError::Config(format!(
            "--authorize {spec}: no module at {}",
            path.display()
        )));
    }
    // A module hook is JavaScript; only the Node blok-mcp can load it.
    Err(StartError::Config(format!(
        "--authorize {spec}: a module hook needs the Node blok-mcp; pass an http(s) webhook URL"
    )))
}

/// Node's path.resolve(cwd, spec) on POSIX: lexical, `//` collapsed, `.`
/// and `..` applied, no trailing slash.
pub fn resolve_like_node(cwd: &Path, spec: &str) -> PathBuf {
    let joined = if spec.starts_with('/') {
        spec.to_owned()
    } else {
        format!("{}/{spec}", cwd.display())
    };
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    PathBuf::from(format!("/{}", parts.join("/")))
}

fn read_json_file(path: &str, cwd: &Path) -> Result<Value, StartError> {
    let full = cwd.join(path);
    let bytes = match std::fs::read(&full) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(StartError::Config(format!(
                "Cannot read \"{path}\": no such file"
            )));
        }
        Err(err) => {
            return Err(StartError::Failed(format!("Cannot read \"{path}\": {err}")));
        }
    };
    let text = String::from_utf8_lossy(&bytes);
    serde_json::from_str(&text)
        .map_err(|err| StartError::Config(format!("Invalid JSON in \"{path}\": {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_module_paths_as_node_path_resolve() {
        let cwd = Path::new("/work/dir");
        assert_eq!(
            resolve_like_node(cwd, "HTTP://127.0.0.1:9/a"),
            PathBuf::from("/work/dir/HTTP:/127.0.0.1:9/a")
        );
        assert_eq!(
            resolve_like_node(cwd, "./nope.mjs"),
            PathBuf::from("/work/dir/nope.mjs")
        );
        assert_eq!(
            resolve_like_node(cwd, "../x/./y//z/"),
            PathBuf::from("/work/x/y/z")
        );
        assert_eq!(resolve_like_node(cwd, "/abs/../b"), PathBuf::from("/b"));
    }

    // Node's readJsonFile rethrows any error but ENOENT, so the start fails with 1.
    #[test]
    fn a_config_file_that_cannot_be_read_is_not_a_config_refusal() {
        let dir = std::env::temp_dir();
        match read_json_file(".", &dir) {
            Err(StartError::Failed(message)) => assert!(message.contains("Is a directory")),
            other => panic!("expected a start failure, got {other:?}"),
        }
        assert!(matches!(
            read_json_file("no-such-file.json", &dir),
            Err(StartError::Config(_))
        ));
    }

    #[test]
    fn only_lower_case_http_schemes_are_webhooks() {
        let cwd = Path::new("/nowhere-at-all");
        assert_eq!(
            authorize_spec("https://h/a", cwd).ok(),
            Some(AuthorizeSpec::Webhook("https://h/a".to_owned()))
        );
        match authorize_spec("HTTP://h/a", cwd) {
            Err(StartError::Config(message)) => {
                assert_eq!(
                    message,
                    "--authorize HTTP://h/a: no module at /nowhere-at-all/HTTP:/h/a"
                );
            }
            other => panic!("expected a config error, got {other:?}"),
        }
    }
}
