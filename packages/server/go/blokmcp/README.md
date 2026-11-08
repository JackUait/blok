# blokmcp

Blok's MCP server in Go. It lets an MCP client read and edit [Blok](https://blokeditor.com) documents.

It takes the same flags and environment variables as the Node server, `@bloklabs/mcp`, and gives the same answers. The shared MCP conformance suite checks that (`node scripts/test-mcp-conformance.mjs --target go`).

## The command

```sh
go install github.com/JackUait/blok/packages/server/go/v2/cmd/blok-mcp@latest
blok-mcp --source files:./docs
```

Each GitHub release also carries `blok-mcp-go_<os>_<arch>` archives, with their sums in `checksums-go.txt`.

## In your app

```go
server, err := blokmcp.New(blokmcp.Options{
	Transport: blokmcp.Transport{Kind: "http", Listen: "127.0.0.1:3001"},
	Auth:      blokmcp.Auth{Kind: "none"},
	Source:    &blokmcp.Source{Kind: "files", Dir: "./docs"},
	// Your own check: may this principal open this document?
	Authorize: func(ctx context.Context, principal, documentID string, write bool) (bool, error) {
		return mayOpen(principal, documentID, write), nil
	},
})
if err != nil {
	log.Fatal(err)
}
defer server.Close()

handler, err := server.Handler()
if err != nil {
	log.Fatal(err)
}
log.Fatal(http.ListenAndServe("127.0.0.1:3001", handler))
```

- `Options` mirror the flags. Their JSON form is what the CLI reads.
- `Handler()` serves `/mcp`, so mount it at the root. It needs `Transport.Kind` set to `"http"`.
- `ServeStdio` serves one client over stdin and stdout instead.
- `Uploads` turns on `<tool>.uploadFile` through your own `Uploader`.
  - When your uploader returns an error, the agent sees `TOOL_ACTION_FAILED` with "The upload failed." Your error's text never reaches the agent, because it may name hosts, paths or credentials. The server logs the full error to stderr.
  - To tell the agent something, return a `*blokmcp.UploadError` (wrapped is fine). The agent sees its `AgentMessage`: `&blokmcp.UploadError{Err: err, AgentMessage: "The storage is full."}`.
- Set `Rooms` to `AgentExecutor()` of a `blokserver.Server` with collaboration on. Live handles then open on that process's own rooms.

## On your own MCP server

`Embed` adds Blok's `blok_*` tools and prompts to a go-sdk server you build yourself. Your server keeps its name, instructions, tools, prompts and wire. A full example is `examples/mcp-embed`.

```go
options, err := blokmcp.ParseArgs(os.Args[1:], env) // the blok-mcp flags, or build Options yourself
if err != nil {
	log.Fatal(err)
}
blok, err := blokmcp.Embed(options, blokmcp.EmbedOptions{})
if err != nil {
	log.Fatal(err)
}
defer blok.Close()

handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "my-host", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: "My instructions.\n\n" + blok.Instructions(),
	})
	server.AddTool(myTool, myHandler) // your own tools first
	if err := blok.Attach(server); err != nil {
		return nil
	}
	return server
}, &mcp.StreamableHTTPOptions{Stateless: true})
```

- Build Blok once with `Embed`. Call `Attach` on every server you make (one per request over stateless HTTP). Open handles live in the `*Attached`, not in a server.
- `Instructions()` is Blok's primer. go-sdk takes instructions only in `NewServer`, so put it into your own text. Blok never sets them.
- `ToolNames()`, `PromptNames()` and `Version()` describe what Blok serves. `Close()` waits for calls in flight and closes every handle.
- `Attach` serves Blok through a receiving middleware, not `AddTool`:
  - It answers `tools/call` and `prompts/get` for Blok's names. Every other name goes to your server untouched.
  - It appends Blok's entries to your `tools/list` and `prompts/list` (first page only). The SDK then neither checks Blok's arguments nor enforces `Mcp-Param-*` headers for them.
  - It adds the `tools` and `prompts` capabilities only when your server lacks them.
- Call `Attach` after your own `AddTool` and `AddPrompt`. Each `Attach` lists them through an in-memory session that your middleware also sees. On a stateless server that is one extra handshake per request. A name Blok serves fails `Attach` (`Blok already serves …`). A clashing tool or prompt added later fails `tools/list` or `prompts/list` instead.
- Who calls:
  - By default, Blok reads `req.Extra.TokenInfo`, which `auth.RequireBearerToken` sets. `UserID` is the principal. The token's scopes are ignored, because your server owns auth.
  - `EmbedOptions.Caller` replaces that. Return nil for an anonymous caller. Return `Scopes` (not nil) to have Blok enforce `blok.read` and `blok.write`.
  - An anonymous caller gets JSON-RPC `-32600` "Blok needs a signed-in caller.". A caller without a principal gets `-32600` "Blok needs a named caller (sub or NameIdentifier).".
  - `EmbedOptions.AnonymousPrincipal` serves anonymous callers as that one principal. They all share its handles and its handle cap.
  - A handle belongs to the principal that opened it. Anyone else gets `UNKNOWN_HANDLE`.
- `Embed` refuses `Auth.Kind: "oauth"` and `Principal`: signing in is your server's job. It needs `Authorize`, unless it serves live rooms only, with a ticket URL and no source. Origin and Host checks, body limits and OAuth also belong to your server.
- Approvals answer as the standalone server does. A 2026-07-28 client gets `resultType: "input_required"`, and Blok reads its reply from `inputResponses`. A 2025 client gets `elicitation/create` inside the call (tested over stdio). go-sdk decodes `inputResponses` itself, so a reply that is not an elicitation result may fail the whole request, where the standalone server asks again.
- An unexpected error in a Blok call (your `Caller` hook, a bug in your source, page creator or handle store, or Blok's own) is logged in full to stderr. The client gets JSON-RPC `-32603` "Blok could not run this call.", never the error's text. The standalone server keeps sending the text.
- Stateful HTTP servers are not a supported target. Stateless ones are.

## Your own document store

Set `Options.DocumentSource` to load and save stored documents through your own code. It cannot be combined with `Source`. It counts as a source in every safety check.

```go
type store struct{ db *sql.DB }

func (s store) Load(ctx context.Context, caller blokmcp.DocumentCaller, id string) (*blokmcp.StoredDocument, error) {
	text, version, found, err := s.read(ctx, id)
	if err != nil || !found {
		return nil, err // nil, nil: never saved
	}
	return &blokmcp.StoredDocument{DocumentText: text, Version: version}, nil
}

func (s store) Save(ctx context.Context, caller blokmcp.DocumentCaller, id, text string, ifVersion *string) (string, error) {
	version, conflict, err := s.write(ctx, id, text, ifVersion)
	if conflict {
		return "", &blokmcp.SourceError{Kind: blokmcp.SourceChanged}
	}
	return version, err
}
```

- Every call gets the `DocumentCaller` that opened the handle: principal, client name, scopes and agent actor. A listing gets the caller that lists.
- `Load` answers nil for a document never saved. A stored document comes as JSON text with a non-empty version. Blok parses the text the way the endpoint source does: the last of a repeated key wins, a lone surrogate reads as U+FFFD, and more than 48 levels of nesting is refused. A text without a `blocks` array is refused too.
- `Save` gets compact JSON. A nil `ifVersion` means the document must not exist yet. Any other value must equal the stored version. Answer the new, non-empty version.
- Add `List` (`DocumentLister`) to support `blok_list_documents`. Blok still asks `Authorize` about every listed id.
- Blok refuses the ids `""`, `"."` and `".."` before it calls you.
- To refuse with a code, return a `*blokmcp.SourceError` (wrapped is fine):
  - `SourceChanged` → `DOCUMENT_CHANGED`. The handle reloads your document.
  - `SourceUnavailable` → `SOURCE_UNAVAILABLE`.
  - `SourceForbidden` → `FORBIDDEN`.
  - `SourceInvalidID` → `INVALID_ARGS`.
  - The agent sees `AgentMessage`, or Blok's own words when it is blank. Keep hosts, paths and secrets out of it.
- Any other error is logged in full to stderr. The agent sees `SOURCE_UNAVAILABLE` in generic words. After a failed save the handle reloads, so no unsaved edit or undo step stays in memory.
- A save answered with an empty version is `SOURCE_UNAVAILABLE`: "The host may have saved this document but did not say which version. Read it before you retry." The handle reloads.

## Sub-pages your app creates

With `PageTitles: "page-map"` and a source, each page block the agent inserts gets its own document. By default Blok mints the id, asks `Authorize` about it, and saves an empty document. Set `Options.CreatePage` to make that document yourself, for example as a new article under the parent:

```go
options.CreatePage = func(ctx context.Context, request blokagent.PageCreateRequest) (string, error) {
	if !mayCreateUnder(request.Principal, request.ParentDocumentID) {
		return "", blokmcp.ErrPageRefused
	}
	return createArticle(ctx, request.ParentDocumentID, request.Actor) // your own id
}
```

- The request has the open document (`ParentDocumentID`), the principal and agent actor that opened the handle, and an id Blok minted (`SuggestedPageID`) that you may use.
- Blok then asks no `Authorize` about the new id, checks no emptiness, and saves nothing to it: you own it. Opening it later with `blok_open` goes through `Authorize` as usual.
- Your id becomes the page block's `data.pageId`. It must be 1-512 code points of valid UTF-8, with no control characters (U+0000-U+001F, U+007F-U+009F), and not `.` or `..`. Your source must be able to open it.
- `ErrPageRefused` (wrapped is fine) fails the insert with `FORBIDDEN` "You may not create a page document here." Nothing is saved.
- Any other error, or an id that breaks the rules above, is logged in full to stderr. On the batch's first page the agent sees `SOURCE_UNAVAILABLE` "The host could not create the page.". After earlier pages the batch fails with `ORPHANED_SIDE_EFFECT`: `details.orphaned` lists the pages you made, and `details.cause` is `APPLY_FAILED` (or `FORBIDDEN` for a refusal). Delete those pages. A page the parent already links is left out.
- Pages are made one at a time, before the batch runs, at most 25 per batch. A batch over that limit never calls you. Undo, redo and deleting a page block never call you.
- `CreatePage` needs stored mode: with `Sync`, `Rooms` or no source the server refuses to start.
- `blok-mcp --create-page <url>` sets it to `CreatePageWebhook(url)`: `POST <url>` with `{"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"}`. A `200 {"pageId":"<id>"}` is the id, `200 {"pageId":null}` is a refusal, and anything else (another status, a redirect, a timeout after 10 s, a body without a string or null `pageId`) is an error.
- In `blokagent`, a `PageCreator` that also implements `PageCreatorFor` gets `CreateFor` with the same request instead of `Create`. In a room the parent is the room's document id. As with `Create`, an empty id refuses.

## Handles shared between processes

By default each process keeps its open handles in memory, so a call must reach the process that opened its handle. Set `Options.HandleStore` (or `blok-mcp --handle-store files:<dir>`) to keep stored-mode handles where every process sharing the store can serve them, for example two replicas behind one load balancer.

- Per call Blok leases the handle, rebuilds it from its record (no source load), runs the call (the source save happens here), saves the record if it changed, and releases the lease.
- The record (`HandleRecord`, `v: 1`) carries the opener (principal, client name, scopes, actor), the document id and access, the source version, the document and its undo steps. A call from another principal gets `UNKNOWN_HANDLE`. A handle opened on a server with another tool contract gets `VERSION_SKEW`; the agent opens it again. A record with another `v` gets `UNKNOWN_HANDLE`.
- Undo steps hold only for the document they were made on. If the record's document changed under them, undo answers `CONFLICT`.
- If the record cannot be saved after the source save, the answer stands, the error is logged, and the handle is removed: the next call gets `UNKNOWN_HANDLE`.
- Any other store error is logged in full. The agent sees `SOURCE_UNAVAILABLE` "The handle store is unavailable. Retry shortly.". A lease still held after 30 s answers `SOURCE_UNAVAILABLE` "Another call is using this handle. Retry shortly.".
- Blok checks every handle a client sends (`^[A-Za-z0-9_-]{1,128}$`) before the store sees it.
- Live handles hold sockets, so they stay in the process that opened them. The cap (`MaxHandlesPerPrincipal`) counts the store's handles plus this process's live ones.
- Stopping a process waits for its calls and leaves the store as it is. Blok calls `Sweep` every 60 s to delete expired records.

Writing your own store (Redis, SQL):

- `TryAdd` must count and add in one step per principal (a row lock, `SELECT … FOR UPDATE`, or a Lua script). A plain count, then insert, lets a principal past the cap.
- Leases are time-limited: renew them while held, and let a dead holder's lease end on its own. `Save` and `Remove` must check the lease's token and answer `ErrLeaseLost` (changing nothing) when another holder took it over; `Release` then does nothing. So exclusivity is best effort: a paused process can lose its lease, and correctness then rests on your document source's version check (`DOCUMENT_CHANGED`). A source that does not check versions can lose writes across replicas.
- A handle expires after the idle time without a lease; a leased handle never expires. Delete expired records (`Sweep`, or your store's own expiry): they hold document text.
- Records are trusted. Anyone who can write the store can forge an actor, scopes or history, so only Blok's processes may write it.
- Values can be large: the history keeps whole documents and is not bounded in bytes. Use `LONGTEXT`/JSON columns, not `TEXT`.
- Keep `scopes` null and `[]` distinct (no `omitempty`).

The files store (`NewFilesHandleStore`) is for tests and several processes on one machine. It makes the directory with mode 0700 and refuses to start if the directory is a link, not a directory, reachable by group or world, or (POSIX) owned by another user. Every file in it is 0600. Its leases are renewed every 5 s and taken over after 30 s without renewal. On Windows the mode checks are skipped: Go cannot read the directory's ACL, so restricting it is your job.

## Docs

[https://blokeditor.com/docs](https://blokeditor.com/docs) and [the server page](https://blokeditor.com/server#mcp).
