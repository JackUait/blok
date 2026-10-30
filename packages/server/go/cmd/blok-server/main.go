// Command blok-server is the Go build of the Blok server host.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// version is stamped at build time: -ldflags "-X main.version=1.2.3".
// Not debug.ReadBuildInfo: a local build reports "(devel)".
var version = "dev"

// usage is a byte copy of HostArguments.Usage in the C# host.
const usage = `Usage of blok-server:
  --listen value
    address to listen on (default "127.0.0.1:4000")
  --auth value
    access mode: none, proxy, or ticket (default "none")
  --secret value
    shared secret for --auth ticket; prefer BLOK_SECRET
  --allow-origin value
    comma-separated origins allowed to call this service
  --storage-dir value
    directory for uploaded files (default "./blok-uploads")
  --public-url value
    URL prefix uploaded files are handed out under
  --max-upload value
    largest upload accepted, in bytes (default 33554432)
  --rate-limit value
    requests a minute per caller (ticket mode defaults to 60; other modes default to 0)
  --no-unfurl
    close GET /unfurl and POST /upload-by-url
  --s3-endpoint value
    S3-compatible endpoint
  --s3-region value
    S3 region
  --s3-bucket value
    S3 bucket
  --s3-bucket-url value
    public S3 bucket URL prefix
  --s3-addressing value
    "path" or "virtual"
  --collab
    serve collaborative sync rooms (needs --doc-endpoint)
  --doc-endpoint value
    HTTP(S) URL sync rooms seed documents from and export them to
  --doc-endpoint-auth value
    Authorization header for --doc-endpoint; prefer BLOK_DOC_ENDPOINT_AUTH
  --collab-dir value
    directory for the collaboration working set (default "./blok-collab")
  --collab-s3-prefix value
    S3 key prefix for the collaboration working set (needs --s3-bucket)
  --collab-journal
    keep an operation journal under --collab-dir: edit receipts, key dedupe, blok-sync.v2
    (needs --collab; refused with --collab-s3-prefix; or set BLOK_COLLAB_JOURNAL)
  --rich-text-fields value
    your custom tools' rich text fields as JSON, e.g. {"callout":["title"]};
    list what each tool's richTextFields declares (or set BLOK_RICH_TEXT_FIELDS)
`

// shutdownGrace stays under the 2s the conformance harness waits before SIGKILL.
const shutdownGrace = 1500 * time.Millisecond

type options struct {
	listen string
	auth   string
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	code := run(ctx, os.Args[1:], os.Stderr)
	stop()
	os.Exit(code)
}

// parseArguments returns code -1 when the host should start.
func parseArguments(args []string, stderr io.Writer) (options, int) {
	parsed := options{}
	flags := flag.NewFlagSet("blok-server", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() { fmt.Fprint(stderr, usage) }

	flags.StringVar(&parsed.listen, "listen", "127.0.0.1:4000", "")
	flags.StringVar(&parsed.auth, "auth", "none", "")
	// Accepted so the C# command lines parse. Not acted on yet: the Go host
	// serves only the ungated /health, and every other path is 404.
	for _, name := range []string{
		"secret", "allow-origin", "storage-dir", "public-url", "max-upload",
		"rate-limit", "s3-endpoint", "s3-region", "s3-bucket", "s3-bucket-url",
		"s3-addressing", "doc-endpoint", "doc-endpoint-auth", "collab-dir",
		"collab-s3-prefix", "rich-text-fields",
	} {
		flags.String(name, "", "")
	}
	for _, name := range []string{"no-unfurl", "collab", "collab-journal"} {
		flags.Bool(name, false, "")
	}

	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return parsed, 0
		}
		return parsed, 2
	}
	return parsed, -1
}

// bindAddress copies the C# host: a bare ":PORT" binds IPv4 any.
func bindAddress(listen string) string {
	if strings.HasPrefix(listen, ":") {
		return "0.0.0.0" + listen
	}
	return listen
}

func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodHead {
			return
		}
		body, _ := json.Marshal(struct {
			Status  string `json:"status"`
			Version string `json:"version"`
		}{"ok", version})
		_, _ = w.Write(append(body, '\n'))
	})
	return mux
}

func run(ctx context.Context, args []string, stderr io.Writer) int {
	parsed, code := parseArguments(args, stderr)
	if code >= 0 {
		return code
	}

	listener, err := net.Listen("tcp", bindAddress(parsed.listen))
	if err != nil {
		fmt.Fprintf(stderr, "blok-server refused to start: %v\n", err)
		return 1
	}

	server := &http.Server{Handler: newHandler(), ReadHeaderTimeout: 10 * time.Second}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()

	// The harness trusts /health only after this line, so it must follow the bind.
	fmt.Fprintf(stderr, "blok-server %s listening on %s (--auth %s)\n", version, parsed.listen, parsed.auth)

	select {
	case err := <-served:
		fmt.Fprintf(stderr, "blok-server stopped: %v\n", err)
		return 1
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	_ = server.Shutdown(shutdown)
	return 0
}
