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

## Docs

[https://blokeditor.com/docs](https://blokeditor.com/docs) and [the server page](https://blokeditor.com/server#mcp).
