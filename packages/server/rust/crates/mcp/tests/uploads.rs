//! An agent's upload goes through the host's own uploader, as Node's
//! programmatic `uploads` option does. The answers are the ones Node's
//! createBlokMcpServer gave for the same calls.

use std::sync::{Arc, Mutex};

use blok_mcp::bundle::Bundle;
use blok_mcp::server::{Approval, Caller, Mcp, Outcome};
use blok_mcp::uploads::{BoxFuture, UploadContext, UploadFile, Uploaded, Uploader, Uploads};
use serde_json::{Value, json};

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

#[derive(Default)]
struct Memory {
    calls: Mutex<Vec<Value>>,
}

impl Uploader for Memory {
    fn upload_by_file(
        &self,
        file: UploadFile,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, String>> {
        Box::pin(async move {
            let mut calls = self.calls.lock().unwrap();
            calls.push(json!({ "name": file.name, "type": file.mime_type, "size": file.bytes.len(), "kind": ctx.kind, "tool": ctx.tool }));
            let n = calls.len();
            if file.name.starts_with("boom") {
                return Err("the uploader broke".to_owned());
            }
            Ok(Uploaded {
                url: format!("https://cdn.test/{n}/{}", file.name),
                file_name: None,
                size: (ctx.kind == "file").then_some(999),
                mime_type: (ctx.kind == "file").then(|| "application/x-host".to_owned()),
            })
        })
    }

    fn takes_urls(&self) -> bool {
        true
    }

    fn upload_by_url(
        &self,
        url: String,
        ctx: UploadContext,
    ) -> BoxFuture<'_, Result<Uploaded, String>> {
        Box::pin(async move {
            let mut calls = self.calls.lock().unwrap();
            calls.push(json!({ "url": url, "kind": ctx.kind, "tool": ctx.tool }));
            let n = calls.len();
            Ok(Uploaded {
                url: format!("https://cdn.test/{n}/copied"),
                file_name: Some("copied.png".to_owned()),
                size: None,
                mime_type: None,
            })
        })
    }
}

async fn execute(mcp: &Mcp, handle: &str, commands: Value) -> Value {
    let caller = Caller {
        principal: "local".to_owned(),
        client_name: None,
        scopes: None,
    };
    let args = json!({ "handle": handle, "commands": commands });
    match mcp
        .call(
            "blok_execute",
            &args,
            &caller,
            &Approval::default(),
            &|| false,
        )
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        other => panic!("{other:?}"),
    }
}

fn upload(kind: &str, name: &str) -> Value {
    json!([{ "name": format!("{kind}.uploadFile"), "args": { "data": PNG, "fileName": name } }])
}

#[tokio::test(flavor = "multi_thread")]
async fn uploads_go_through_the_hosts_uploader_as_node_answers_them() {
    let work = std::env::temp_dir().join(format!("blok-mcp-uploads-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    let (docs, root) = (work.join("docs"), work.join("root"));
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(docs.join("doc.json"), r#"{"blocks":[]}"#).unwrap();
    let png = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, PNG).unwrap();
    std::fs::write(root.join("a.png"), &png).unwrap();
    std::fs::write(work.join("outside.png"), &png).unwrap();
    std::os::unix::fs::symlink(work.join("outside.png"), root.join("link.png")).unwrap();

    let memory = Arc::new(Memory::default());
    let uploads = Uploads {
        uploader: memory.clone(),
        root: Some(root.clone()),
        limits: json!({ "image": { "types": ["image/png"] } }),
    };
    let options = json!({
        "transport": { "kind": "stdio" }, "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": docs.to_string_lossy() },
    });
    let mcp = Mcp::with_uploads(
        Arc::new(Bundle::new(1).unwrap()),
        &options,
        None,
        None,
        Some(uploads),
    )
    .await
    .unwrap();
    let caller = Caller {
        principal: "local".to_owned(),
        client_name: None,
        scopes: None,
    };
    let opened = match mcp
        .call(
            "blok_open",
            &json!({ "documentId": "doc", "write": true }),
            &caller,
            &Approval::default(),
            &|| false,
        )
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str::<Value>(&answer.structured).unwrap(),
        other => panic!("{other:?}"),
    };
    let handle = opened["handle"].as_str().unwrap().to_owned();

    let ok = execute(&mcp, &handle, upload("image", "a.png")).await;
    assert_eq!(ok["ok"], true, "{ok}");
    assert_eq!(
        ok["blocks"][0]["data"],
        json!({ "url": "https://cdn.test/1/a.png", "fileName": "a.png" })
    );
    let file = execute(&mcp, &handle, upload("file", "r.pdf")).await;
    assert_eq!(
        file["blocks"][0]["data"],
        json!({ "url": "https://cdn.test/2/r.pdf", "fileName": "r.pdf", "size": 999, "mimeType": "application/x-host" })
    );
    let threw = execute(&mcp, &handle, upload("image", "boom.png")).await;
    assert_eq!(
        threw["error"],
        json!({ "code": "TOOL_ACTION_FAILED", "message": "A prepare step failed: the uploader broke", "commandIndex": 0, "retryable": false })
    );
    let jpeg = execute(&mcp, &handle, upload("image", "a.jpg")).await;
    assert_eq!(
        jpeg["error"]["message"],
        "This host does not take image/jpeg for image. It takes: image/png."
    );
    let inserted = execute(&mcp, &handle, json!([{ "name": "block.insert", "args": { "type": "image", "id": "img", "data": { "url": "https://old.test/x.png" } } }])).await;
    assert_eq!(inserted["ok"], true);
    let copied = execute(&mcp, &handle, json!([{ "name": "image.setSource", "args": { "id": "img", "url": "https://example.com/x.png" } }])).await;
    assert_eq!(
        copied["blocks"][0]["data"],
        json!({ "url": "https://cdn.test/4/copied", "fileName": "copied.png" })
    );
    let read = execute(
        &mcp,
        &handle,
        json!([{ "name": "image.uploadFile", "args": { "path": "a.png" } }]),
    )
    .await;
    assert_eq!(
        read["blocks"][0]["data"],
        json!({ "url": "https://cdn.test/5/a.png", "fileName": "a.png" })
    );
    let escaped = execute(
        &mcp,
        &handle,
        json!([{ "name": "image.uploadFile", "args": { "path": "link.png" } }]),
    )
    .await;
    assert_eq!(
        escaped["error"],
        json!({ "code": "PRECONDITION_FAILED", "message": "\"link.png\" is not a file under the upload folder.", "path": "/path", "retryable": false, "commandIndex": 0 })
    );

    let calls = memory.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 5, "{calls:?}");
    assert_eq!(
        calls[0],
        json!({ "name": "a.png", "type": "image/png", "size": 70, "kind": "image", "tool": "image" })
    );
    assert_eq!(calls[4]["size"], 70);
    let saved = std::fs::read_to_string(docs.join("doc.json")).unwrap();
    assert!(saved.contains("https://cdn.test/5/a.png"), "{saved}");
    let _ = std::fs::remove_dir_all(&work);
}

// Node takes base64 uploads up to its 30 MiB data limit; 7.4 MiB passes there.
#[tokio::test(flavor = "multi_thread")]
async fn a_7_mib_base64_upload_reaches_the_uploader_as_in_node() {
    let work = std::env::temp_dir().join(format!("blok-mcp-big-upload-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    let docs = work.join("docs");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(docs.join("doc.json"), r#"{"blocks":[]}"#).unwrap();
    let memory = Arc::new(Memory::default());
    let uploads = Uploads {
        uploader: memory.clone(),
        root: None,
        limits: json!({}),
    };
    let options = json!({
        "transport": { "kind": "stdio" }, "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": docs.to_string_lossy() },
    });
    let mcp = Mcp::with_uploads(
        Arc::new(Bundle::new(1).unwrap()),
        &options,
        None,
        None,
        Some(uploads),
    )
    .await
    .unwrap();
    let caller = Caller {
        principal: "local".to_owned(),
        client_name: None,
        scopes: None,
    };
    let opened = match mcp
        .call(
            "blok_open",
            &json!({ "documentId": "doc", "write": true }),
            &caller,
            &Approval::default(),
            &|| false,
        )
        .await
    {
        Ok(Outcome::Answer(answer)) => serde_json::from_str::<Value>(&answer.structured).unwrap(),
        other => panic!("{other:?}"),
    };
    let handle = opened["handle"].as_str().unwrap().to_owned();
    let bytes = vec![7u8; 7_759_000];
    let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let answer = execute(
        &mcp,
        &handle,
        json!([{ "name": "file.uploadFile", "args": { "data": data, "fileName": "big.bin" } }]),
    )
    .await;
    assert_eq!(
        answer["ok"],
        json!(true),
        "{}",
        answer.to_string().chars().take(600).collect::<String>()
    );
    assert_eq!(memory.calls.lock().unwrap()[0]["size"], json!(bytes.len()));
    let _ = std::fs::remove_dir_all(&work);
}
