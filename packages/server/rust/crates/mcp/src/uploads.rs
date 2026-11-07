//! The host's own uploader, as Node's programmatic `uploads` option takes it
//! (packages/mcp/types/index.d.ts McpUploads, src/mcp/uploads.ts), and the
//! upload folder reader (src/mcp/local-files.ts).

use std::future::Future;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{Value, json};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The file an agent uploads.
pub struct UploadFile {
    pub name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

/// McpUploadContext.
pub struct UploadContext {
    pub kind: String,
    pub tool: String,
}

/// What the uploader stored. A file card keeps `size` and `mime_type`.
pub struct Uploaded {
    pub url: String,
    pub file_name: Option<String>,
    pub size: Option<u64>,
    pub mime_type: Option<String>,
}

/// The host's uploader. An `Err` is the message of what it threw.
pub trait Uploader: Send + Sync {
    fn upload_by_file(
        &self,
        file: UploadFile,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, String>>;

    /// True when upload_by_url is there: `<tool>.setSource` then copies a
    /// linked file to the host too.
    fn takes_urls(&self) -> bool {
        false
    }

    fn upload_by_url(
        &self,
        url: String,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, String>> {
        let _ = (url, ctx);
        Box::pin(async { Err("This uploader takes no URLs.".to_owned()) })
    }
}

/// McpUploads.
#[derive(Clone)]
pub struct Uploads {
    pub uploader: Arc<dyn Uploader>,
    /// A folder the agent may upload from by path. None: base64 bytes only.
    pub root: Option<PathBuf>,
    /// Per kind `{ types?, maxSize? }`, as a media tool's `types` and `maxSize`.
    pub limits: Value,
}

impl Uploads {
    /// The bundle's `uploader` input.
    pub fn spec(&self) -> Value {
        let mut spec = json!({ "limits": self.limits.clone() });
        if self.uploader.takes_urls() {
            spec["byUrl"] = json!(true);
        }
        if self.root.is_some() {
            spec["local"] = json!(true);
        }
        spec
    }

    /// Makes the call the bundle named in `need`, and answers its outcome.
    /// `batch` is the upload's own batch: its data is the bytes to send.
    pub async fn answer(&self, need: &Value, batch: &Value, read: &mut Option<Vec<u8>>) -> Value {
        let text = |key: &str| {
            need.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let ctx = UploadContext {
            kind: text("kind"),
            tool: text("tool"),
        };
        let stored = |uploaded: Uploaded| {
            let mut value = json!({ "url": uploaded.url });
            if let Some(name) = uploaded.file_name {
                value["fileName"] = json!(name);
            }
            if let Some(size) = uploaded.size {
                value["size"] = json!(size);
            }
            if let Some(mime) = uploaded.mime_type {
                value["mimeType"] = json!(mime);
            }
            json!({ "value": value })
        };
        let thrown = |message: String| json!({ "error": { "message": message } });
        match need.get("call").and_then(Value::as_str) {
            Some("readLocal") => {
                let Some(root) = &self.root else {
                    return thrown("This host reads no local files.".to_owned());
                };
                // Only the path of the upload command the bundle checked.
                match upload_args(batch, None) {
                    Ok(args)
                        if args.get("path").and_then(Value::as_str)
                            == Some(text("path").as_str()) => {}
                    _ => {
                        return thrown(
                            "The upload read is not the one this batch makes.".to_owned(),
                        );
                    }
                }
                let max = need.get("maxBytes").and_then(Value::as_u64).unwrap_or(0);
                match read_local(root, &text("path"), max) {
                    Ok((bytes, name)) => {
                        *read = Some(bytes);
                        json!({ "value": { "name": name } })
                    }
                    Err(error) => json!({ "error": error }),
                }
            }
            Some("uploadByFile") => {
                // A read file's bytes (the reader bounds them by maxBytes), or the
                // data of the one upload command the bundle checked, at the size
                // it checked.
                let bytes = match read.take() {
                    Some(bytes) => bytes,
                    None => {
                        let data = match upload_args(batch, Some(&ctx.tool)) {
                            Ok(args) => {
                                args.get("data").and_then(Value::as_str).unwrap_or_default()
                            }
                            Err(message) => return thrown(message),
                        };
                        let Ok(bytes) = base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            data,
                        ) else {
                            return thrown("The upload's data is not base64.".to_owned());
                        };
                        if need.get("size").and_then(Value::as_u64) != Some(bytes.len() as u64) {
                            return thrown(
                                "The upload's bytes are not the size the batch was checked at."
                                    .to_owned(),
                            );
                        }
                        bytes
                    }
                };
                let file = UploadFile {
                    name: text("name"),
                    mime_type: text("type"),
                    bytes,
                };
                match self.uploader.upload_by_file(file, ctx).await {
                    Ok(uploaded) => stored(uploaded),
                    Err(message) => thrown(message),
                }
            }
            Some("uploadByUrl") => match self.uploader.upload_by_url(text("url"), ctx).await {
                Ok(uploaded) => stored(Uploaded {
                    size: None,
                    mime_type: None,
                    ..uploaded
                }),
                Err(message) => thrown(message),
            },
            _ => thrown("The bundle asked for an unknown upload call.".to_owned()),
        }
    }
}

/// The args of the batch's one command, when it is `<tool>.uploadFile`:
/// an upload is the only command in its batch, as the bundle requires.
/// A read names no tool (`None`): any upload command then.
fn upload_args<'a>(batch: &'a Value, tool: Option<&str>) -> Result<&'a Value, String> {
    let commands = batch.get("commands").and_then(Value::as_array);
    let named = |command: &Value| {
        let name = command
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match tool {
            Some(tool) => name == format!("{tool}.uploadFile"),
            None => name.ends_with(".uploadFile"),
        }
    };
    match commands.map(Vec::as_slice) {
        Some([command]) if named(command) => command
            .get("args")
            .ok_or_else(|| "The upload command has no args.".to_owned()),
        _ => Err("The upload is not the one command of this batch.".to_owned()),
    }
}

const MAX_PATH: usize = 4096;

fn refusal(code: &str, message: String) -> Value {
    json!({ "code": code, "message": message, "path": "/path", "retryable": false })
}

fn refuse(message: String) -> Value {
    refusal("PRECONDITION_FAILED", message)
}

fn too_large(size: u64, max: u64) -> Value {
    refuse(format!(
        "The file is too large: {size} bytes, and this host takes at most {max}."
    ))
}

/// Node's createLocalFileReader: a path that resolves outside `root`, a
/// hidden file, a hard-linked file or one that is not regular is refused,
/// with one answer for missing and outside.
pub fn read_local(root: &Path, path: &str, max_bytes: u64) -> Result<(Vec<u8>, String), Value> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    if path.is_empty() || path.chars().count() > MAX_PATH || path.contains('\0') {
        return Err(refusal(
            "INVALID_ARGS",
            format!("path must be 1 to {MAX_PATH} characters with no NUL byte."),
        ));
    }
    let not_here = || refuse(format!("\"{path}\" is not a file under the upload folder."));
    let real_root = std::fs::canonicalize(root).map_err(|_| not_here())?;
    let resolve_inside = || -> Result<PathBuf, Value> {
        let real = std::fs::canonicalize(real_root.join(path)).map_err(|_| not_here())?;
        let Ok(inside) = real.strip_prefix(&real_root) else {
            return Err(not_here());
        };
        if inside
            .components()
            .any(|part| matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.')))
        {
            return Err(refuse(format!(
                "\"{path}\" is a hidden file or in a hidden folder, and uploads never read those."
            )));
        }
        Ok(real)
    };
    let real = resolve_inside()?;
    let before = std::fs::metadata(&real).map_err(|_| not_here())?;
    if !before.is_file() {
        return Err(refuse(format!("\"{path}\" is not a regular file.")));
    }
    if before.len() > max_bytes {
        return Err(too_large(before.len(), max_bytes));
    }
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&real)
        .map_err(|_| refuse(format!("\"{path}\" could not be opened.")))?;
    let opened = file
        .metadata()
        .map_err(|_| refuse(format!("\"{path}\" could not be opened.")))?;
    if !opened.is_file() || opened.nlink() != 1 {
        return Err(refuse(format!(
            "\"{path}\" is not a regular file with one name."
        )));
    }
    let again = resolve_inside()?;
    let named = std::fs::symlink_metadata(&again).map_err(|_| not_here())?;
    if named.ino() != opened.ino() || named.dev() != opened.dev() {
        return Err(refuse(format!(
            "\"{path}\" changed while it was being read."
        )));
    }
    // One byte past the cap tells a file that grew meanwhile from one that fits.
    let mut bytes = Vec::new();
    (&mut file)
        .take(opened.len().min(max_bytes) + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| refuse(format!("\"{path}\" could not be opened.")))?;
    if bytes.len() as u64 > max_bytes {
        return Err(too_large(bytes.len() as u64, max_bytes));
    }
    let name = again
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((bytes, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Counting(AtomicUsize);

    impl Uploader for Counting {
        fn upload_by_file(
            &self,
            _file: UploadFile,
            _ctx: UploadContext,
        ) -> BoxFuture<'_, Result<Uploaded, String>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(Uploaded {
                    url: "https://cdn.test/x".to_owned(),
                    file_name: None,
                    size: None,
                    mime_type: None,
                })
            })
        }
    }

    fn uploads() -> (Arc<Counting>, Uploads) {
        let counting = Arc::new(Counting::default());
        (
            counting.clone(),
            Uploads {
                uploader: counting,
                root: None,
                limits: Value::Null,
            },
        )
    }

    fn need(size: usize) -> Value {
        json!({ "call": "uploadByFile", "name": "a.png", "type": "image/png", "size": size, "kind": "image", "tool": "image" })
    }

    #[tokio::test]
    async fn uploads_only_the_bytes_of_the_upload_command_the_bundle_checked() {
        let (counting, uploads) = uploads();
        let two = json!({ "commands": [
            { "name": "doc.setTitle", "args": { "title": "T", "data": "QUJD" } },
            { "name": "image.uploadFile", "args": { "data": "QUJD", "fileName": "a.png" } },
        ] });
        let outcome = uploads.answer(&need(3), &two, &mut None).await;
        assert!(outcome.get("error").is_some(), "{outcome}");
        assert_eq!(counting.0.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn bad_base64_or_another_size_is_an_error_not_empty_bytes() {
        let (counting, uploads) = uploads();
        let batch = |data: &str| json!({ "commands": [{ "name": "image.uploadFile", "args": { "data": data, "fileName": "a.png" } }] });
        assert!(
            uploads
                .answer(&need(3), &batch("Q!JD"), &mut None)
                .await
                .get("error")
                .is_some()
        );
        assert!(
            uploads
                .answer(&need(9), &batch("QUJD"), &mut None)
                .await
                .get("error")
                .is_some()
        );
        assert_eq!(counting.0.load(Ordering::SeqCst), 0);
        let fine = uploads.answer(&need(3), &batch("QUJD"), &mut None).await;
        assert!(fine.get("value").is_some(), "{fine}");
    }
}
