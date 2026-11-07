# 09. A host uploader's error leaks to the agent

Branch `mcp/node-upload-errors`. It is not landed. The user picks one of the two routes below.

## The problem (measured 2026-11-07)

A host passes its own uploader in `BlokMcpOptions.uploads`. When the uploader throws, the agent got the error's message word for word.

Measured on `main` (9061db41) through `assembleMcp(...).dispatch('blok_execute', ...)`:

| Case | Agent saw |
| --- | --- |
| `uploadByFile` throws `Error('connect ECONNREFUSED db.internal:5432 (password=hunter2)')` | `TOOL_ACTION_FAILED` "A prepare step failed: connect ECONNREFUSED db.internal:5432 (password=hunter2)" |
| `uploadByUrl` (via `image.setSource`) throws `Error('S3 AccessDenied arn:aws:iam::123:role/x')` | `TOOL_ACTION_FAILED` "A prepare step failed: S3 AccessDenied arn:aws:iam::123:role/x" |
| A file over `limits.image.maxSize` | `PRECONDITION_FAILED` "The file is too large: 3 bytes, and this host takes at most 2." |
| A `.txt` sent to `image.uploadFile` | `PRECONDITION_FAILED` "This host does not take text/plain for image. It takes: image/*." |

Nothing went to stderr: `console.error` was never called.

The server runtime bundle did the same. A Go host answers a failed upload with `{ error: err.Error() }`. The bundle threw `new Error(answer.error)`, so the agent saw "A prepare step failed: the CDN is down".

## Where the text escapes

- `prepareAt` in `src/shared/agent/executor.ts` puts any non-`AgentFailure` message into "A prepare step failed: ...".
- `replayUploader` in `src/view/server-runtime.ts` turns a host's `{ error }` answer into a plain `Error`.

`prepareAt` is NOT the right place to cut. It also carries Blok's own guidance (`setSource` throws `TypeError('Pass an http(s) URL.')`), page `prepareInsert` errors, and every editor agent and Ask AI error. So the cut is at the uploader, where the host's code is called.

## Route A: redact by default (implemented on the branch, BREAKING)

- Node (`src/mcp/uploads.ts`): `uploadByFile` and `uploadByUrl` are wrapped.
  - A throw (sync or async) becomes `TOOL_ACTION_FAILED` "The upload failed."
  - The full error goes to stderr: `console.error('blok-mcp: the host uploader failed', error)`.
  - If the thrown value has a non-empty string `agentMessage`, the agent sees that text instead. This is the one way for a host to talk to the agent on purpose.
- Bundle (`replayUploader`): an `{ error }` answer becomes the same "The upload failed." The `{ failure }` answer is unchanged, so a host can still send a full agent error on purpose.
- Blok's own refusals (size, type, bad path, hidden file) keep their messages. They are `AgentFailure`s and never reach the wrapper.

Good:
- Safe by default. A host that never thought about it does not leak.
- Same answer in Node and the bundle, so Go/C#/Rust match without per-host redaction code.

Bad:
- Breaks Node hosts that relied on the message reaching the agent, e.g. "quota exceeded". They must set `agentMessage`.
- The agent gets less help to recover. "The upload failed." does not say whether retrying helps.

## Route B: keep forwarding, opt-in redaction (compatible)

- Add `uploads.redactErrors?: boolean` (default `false`).
- `false`: today's behaviour. The agent sees "A prepare step failed: <message>".
- `true`: Route A's behaviour, with stderr logging and `agentMessage`.
- The bundle would take the same flag from the host input (`uploads.redactErrors`), or each host would redact itself before it answers `{ error }`.

Good:
- No breaking change. No host has to change anything.

Bad:
- Unsafe by default. Every host that does not read this flag keeps leaking connection strings, paths or credentials to whatever model the agent uses.
- One more option to document, test and carry in three backends.

## The choice in one line

Route A protects every host now and costs a migration for hosts that wanted their messages shown. Route B costs nothing now and leaves every unaware host leaking.

## Ask AI and the editor agent

Measured on the branch: in the editor, a throwing `config.uploader.uploadByUrl` during `image.setSource` gives the agent `TOOL_ACTION_FAILED` "A prepare step failed: <message>". The editor offers only `uploadByUrl` to the agent (`src/components/modules/api/agent-services.ts`), so there is no `uploadFile` there.

Left unchanged, on purpose:
- The uploader runs in the person's own browser, so the message is already theirs to see.
- The model is the host's own backend (`agent.assistant.model`), not an outside client.
- Changing it would change the shared executor for every editor host.

Unverified: whether the Ask AI bar ever shows a tool result's message to the person. The bar's error line (`assistant/body.ts`) shows `markdown.insert` failures and startup errors; tool results go back to the model.

`test/unit/shared/agent/executor.test.ts` now pins that the executor keeps a prepare step's message.

## What the other hosts must do (Route A)

The bundle cannot write to the host's log. So each host must log the error itself before it answers `{ error }`.

- Go: done on branch `mcp/upload-redact`. `runUpload` logs every failed upload call to stderr ("blok-mcp: the host uploader failed: ..."), answers the bundle `{ error }`, and answers `{ failure: { code: "TOOL_ACTION_FAILED", message, retryable: false } }` for a `*blokmcp.UploadError` with a non-blank `AgentMessage` (found with `errors.As`).
- C# and Rust: their lanes follow the same rule on their own branches: log the exception, answer `{ error }`, and use `{ failure }` only for a message meant for the agent.

## Tests

- `test/unit/mcp/uploads.test.ts`: generic message, stderr log, sync throw, `uploadByUrl`, `agentMessage`, Blok's own refusal kept.
- `test/unit/view/server-runtime-uploads.test.ts`: the bundle's `{ error }` answer is generic.
- `test/unit/server-conformance/fixtures/documents/ops.json`: new case `mcp.execute.upload.thrown`. Go, Rust and C# replay it.
- `packages/server/go/blokmcp/uploads_test.go`: the pinned message is now "The upload failed."
- No black-box MCP conformance case: `test/unit/mcp-conformance` drives the spawned `blok-mcp` binary, and the CLI has no uploader (README: "The CLI adds media by URL only"). The ops fixture case above is the recorded Node answer the other hosts replay.
