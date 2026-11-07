//! The host's own uploader, as Node's programmatic `uploads` option takes it
//! (packages/mcp/types/index.d.ts McpUploads, src/mcp/uploads.ts), and the
//! upload folder reader (src/mcp/local-files.ts).

use std::future::Future;
use std::path::{Path, PathBuf};
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

/// Why an upload failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadError {
    /// The host's own error. It goes to the server log (stderr) in full;
    /// the agent sees only "The upload failed.", so storage details, keys
    /// or paths never reach it.
    Failed(String),
    /// A message meant for the agent (Node's `agentMessage`), shown as
    /// given unless it is blank.
    Agent(String),
}

impl From<String> for UploadError {
    fn from(message: String) -> Self {
        UploadError::Failed(message)
    }
}

/// What the agent sees for an `UploadError::Failed`.
const UPLOAD_FAILED: &str = "The upload failed.";

/// The bundle's answer for a failed upload: the agent sees a plain line
/// unless the host chose its words.
fn upload_failure(error: UploadError) -> Value {
    let message = match error {
        UploadError::Failed(message) => {
            eprintln!("blok-mcp: the host's uploader failed: {message}");
            UPLOAD_FAILED.to_owned()
        }
        UploadError::Agent(message) if !js_trim(&message).is_empty() => message,
        UploadError::Agent(_) => UPLOAD_FAILED.to_owned(),
    };
    json!({ "failure": { "code": "TOOL_ACTION_FAILED", "message": message, "retryable": false } })
}

/// JS String.prototype.trim: it also takes U+FEFF, and leaves U+0085.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'))
}

/// Node checks the path length in UTF-16 units.
fn path_too_long(path: &str) -> bool {
    path.encode_utf16().count() > MAX_PATH
}

/// Node's createLocalFileReader refuses, at start, a root that is not a folder.
pub fn check_root(root: &Path) -> Result<(), String> {
    match std::fs::canonicalize(root).and_then(std::fs::metadata) {
        Ok(meta) if meta.is_dir() => Ok(()),
        _ => Err(format!(
            "The upload root \"{}\" is not a folder",
            root.display()
        )),
    }
}

/// The host's uploader. An `Err` says why; see `UploadError`.
pub trait Uploader: Send + Sync {
    fn upload_by_file(
        &self,
        file: UploadFile,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, UploadError>>;

    /// True when upload_by_url is there: `<tool>.setSource` then copies a
    /// linked file to the host too.
    fn takes_urls(&self) -> bool {
        false
    }

    fn upload_by_url(
        &self,
        url: String,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, UploadError>> {
        let _ = (url, ctx);
        Box::pin(async {
            Err(UploadError::Agent(
                "This uploader takes no URLs.".to_owned(),
            ))
        })
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
    /// The bundle's `uploads` input, with the answers given so far.
    pub fn input(&self, answers: &[Value]) -> Value {
        json!({
            "limits": self.limits.clone(),
            "root": self.root.is_some(),
            "byUrl": self.uploader.takes_urls(),
            "answers": answers,
        })
    }

    /// Makes the call agentExecute stopped at (`{ op, … }`) and answers it,
    /// as the next of `uploads.answers`. `batch` is the batch that asked:
    /// only its one upload command's data or path is used. `reads` keeps a
    /// read file's bytes by the index of its answer.
    pub async fn answer(
        &self,
        call: &Value,
        batch: &Value,
        reads: &mut Vec<Option<Vec<u8>>>,
    ) -> Value {
        let text = |key: &str| {
            call.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let ctx = UploadContext {
            kind: text("kind"),
            tool: text("tool"),
        };
        let stored = |uploaded: Uploaded, with_file: bool| {
            let mut value = json!({ "url": uploaded.url });
            if let Some(name) = uploaded.file_name {
                value["fileName"] = json!(name);
            }
            if with_file {
                if let Some(size) = uploaded.size {
                    value["size"] = json!(size);
                }
                if let Some(mime) = uploaded.mime_type {
                    value["mimeType"] = json!(mime);
                }
            }
            value
        };
        let thrown = |message: String| json!({ "error": message });
        let at = reads.len();
        reads.push(None);
        match call.get("op").and_then(Value::as_str) {
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
                let max = call.get("maxBytes").and_then(Value::as_u64).unwrap_or(0);
                match read_local(root, &text("path"), max) {
                    Ok((bytes, name)) => {
                        let size = bytes.len();
                        reads[at] = Some(bytes);
                        json!({ "name": name, "size": size })
                    }
                    Err(error) => json!({ "failure": error }),
                }
            }
            Some("uploadByFile") => {
                let bytes = if let Some(local) = call.get("local").and_then(Value::as_u64) {
                    // The reader bounded these by maxBytes.
                    match reads.get_mut(local as usize).and_then(Option::take) {
                        Some(bytes) => bytes,
                        None => {
                            return thrown("The upload names no file this host read.".to_owned());
                        }
                    }
                } else {
                    // The data of the one upload command the bundle checked, at the size it checked.
                    let data = match upload_args(batch, Some(&ctx.tool)) {
                        Ok(args) => args.get("data").and_then(Value::as_str).unwrap_or_default(),
                        Err(message) => return thrown(message),
                    };
                    if call.get("data").and_then(Value::as_str) != Some(data) {
                        return thrown("The upload's data is not the batch's.".to_owned());
                    }
                    let Some(bytes) = decode_upload(data) else {
                        return thrown("The upload's data is not base64.".to_owned());
                    };
                    if call.get("size").and_then(Value::as_u64) != Some(bytes.len() as u64) {
                        return thrown(
                            "The upload's bytes are not the size the batch was checked at."
                                .to_owned(),
                        );
                    }
                    bytes
                };
                let file = UploadFile {
                    name: text("fileName"),
                    mime_type: text("type"),
                    bytes,
                };
                match self.uploader.upload_by_file(file, ctx).await {
                    Ok(uploaded) => stored(uploaded, true),
                    Err(error) => upload_failure(error),
                }
            }
            Some("uploadByUrl") => match self.uploader.upload_by_url(text("url"), ctx).await {
                Ok(uploaded) => stored(uploaded, false),
                Err(error) => upload_failure(error),
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

#[cfg(unix)]
fn too_large(size: u64, max: u64) -> Value {
    refuse(format!(
        "The file is too large: {size} bytes, and this host takes at most {max}."
    ))
}

/// No local reads off Unix: the checks need a no-follow open and the
/// file's identity, and std has no stable file index on Windows
/// (windows_by_handle).
#[cfg(not(unix))]
pub fn read_local(_root: &Path, path: &str, _max_bytes: u64) -> Result<(Vec<u8>, String), Value> {
    if path.is_empty() || path_too_long(path) || path.contains('\0') {
        return Err(refusal(
            "INVALID_ARGS",
            format!("path must be 1 to {MAX_PATH} characters with no NUL byte."),
        ));
    }
    Err(refuse(format!(
        "\"{path}\" was not read: this host reads upload files only on Unix."
    )))
}

/// Node's createLocalFileReader: a path that resolves outside `root`, a
/// hidden file, a hard-linked file or one that is not regular is refused,
/// with one answer for missing and outside.
#[cfg(unix)]
pub fn read_local(root: &Path, path: &str, max_bytes: u64) -> Result<(Vec<u8>, String), Value> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    use std::path::Component;
    if path.is_empty() || path_too_long(path) || path.contains('\0') {
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

/// The upload's base64, as Node's Buffer.from takes it once the bundle's
/// BASE64 check passed.
fn decode_upload(data: &str) -> Option<Vec<u8>> {
    use base64::engine::{GeneralPurpose, general_purpose};
    const LENIENT: GeneralPurpose = GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        general_purpose::PAD.with_decode_allow_trailing_bits(true),
    );
    base64::Engine::decode(&LENIENT, data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The bundle's BASE64 check and Node's Buffer.from both take "QR==".
    #[test]
    fn base64_with_stray_trailing_bits_decodes_as_node_does() {
        assert_eq!(decode_upload("QR==").as_deref(), Some(&b"A"[..]));
        assert_eq!(decode_upload("QQ==").as_deref(), Some(&b"A"[..]));
        assert_eq!(decode_upload("Q==="), None);
    }
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Counting(AtomicUsize);

    impl Uploader for Counting {
        fn upload_by_file(
            &self,
            _file: UploadFile,
            _ctx: UploadContext,
        ) -> BoxFuture<'_, Result<Uploaded, UploadError>> {
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

    fn call(data: &str, size: usize) -> Value {
        json!({ "op": "uploadByFile", "fileName": "a.png", "type": "image/png", "size": size, "kind": "image", "tool": "image", "data": data })
    }

    #[tokio::test]
    async fn uploads_only_the_bytes_of_the_upload_command_the_bundle_checked() {
        let (counting, uploads) = uploads();
        let two = json!({ "commands": [
            { "name": "doc.setTitle", "args": { "title": "T", "data": "QUJD" } },
            { "name": "image.uploadFile", "args": { "data": "QUJD", "fileName": "a.png" } },
        ] });
        let outcome = uploads
            .answer(&call("QUJD", 3), &two, &mut Vec::new())
            .await;
        assert!(outcome.get("error").is_some(), "{outcome}");
        let one = json!({ "commands": [{ "name": "image.uploadFile", "args": { "data": "QUJD", "fileName": "a.png" } }] });
        let other = uploads
            .answer(&call("QUJE", 3), &one, &mut Vec::new())
            .await;
        assert!(other.get("error").is_some(), "{other}");
        assert_eq!(counting.0.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn bad_base64_or_another_size_is_an_error_not_empty_bytes() {
        let (counting, uploads) = uploads();
        let batch = |data: &str| json!({ "commands": [{ "name": "image.uploadFile", "args": { "data": data, "fileName": "a.png" } }] });
        assert!(
            uploads
                .answer(&call("Q!JD", 3), &batch("Q!JD"), &mut Vec::new())
                .await
                .get("error")
                .is_some()
        );
        assert!(
            uploads
                .answer(&call("QUJD", 9), &batch("QUJD"), &mut Vec::new())
                .await
                .get("error")
                .is_some()
        );
        assert_eq!(counting.0.load(Ordering::SeqCst), 0);
        let fine = uploads
            .answer(&call("QUJD", 3), &batch("QUJD"), &mut Vec::new())
            .await;
        assert_eq!(fine, json!({ "url": "https://cdn.test/x" }));
    }
}
