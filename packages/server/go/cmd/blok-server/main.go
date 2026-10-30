// Command blok-server is the Go build of the Blok server host.
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
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

const (
	defaultRequestTimeout = 10 * time.Minute
	keepAliveTimeout      = 2 * time.Minute
	headerTimeout         = 10 * time.Second
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stderr)
	stop()
	os.Exit(code)
}

// bindAddress copies the C# host: a bare ":PORT" binds IPv4 any.
func bindAddress(listen string) string {
	if strings.HasPrefix(listen, ":") {
		return "0.0.0.0" + listen
	}
	return listen
}

// newHTTPServer is Kestrel's limits: headers within 10 s, 2 min idle, and
// every request cut off with 504 at the request deadline.
func newHTTPServer(handler http.Handler, requestTimeout time.Duration) *http.Server {
	return &http.Server{
		Handler:           withDeadline(handler, requestTimeout),
		ReadHeaderTimeout: headerTimeout,
		IdleTimeout:       keepAliveTimeout,
		// Without this net/http answers "OPTIONS *" itself.
		DisableGeneralOptionsHandler: true,
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, stderr io.Writer) int {
	hostArgs, conformance, conformanceErr := parseConformanceArguments(args)
	if conformanceErr != "" {
		fmt.Fprintln(stderr, conformanceErr)
		fmt.Fprint(stderr, usage)
		return 2
	}
	parsed := parseHostArguments(hostArgs, getenv)
	if parsed.help {
		fmt.Fprint(stderr, usage)
		return 0
	}
	if parsed.err != "" {
		fmt.Fprintln(stderr, parsed.err)
		fmt.Fprint(stderr, usage)
		return 2
	}
	options := parsed.options
	options.Version = version
	server, err := blokserver.New(options)
	if err != nil {
		fmt.Fprintf(stderr, "blok-server refused to start: %v\n", err)
		return 1
	}
	if parsed.secretFromFlag {
		fmt.Fprintln(stderr, "warning: --secret puts the shared secret in this machine's process list; set BLOK_SECRET in the environment instead")
	}
	if parsed.docEndpointAuthFromFlag {
		fmt.Fprintln(stderr, "warning: --doc-endpoint-auth puts the credential in this machine's process list; set BLOK_DOC_ENDPOINT_AUTH in the environment instead")
	}
	applyConformance(server, conformance)

	listener, err := net.Listen("tcp", bindAddress(options.ListenAddress))
	if err != nil {
		fmt.Fprintf(stderr, "blok-server refused to start: %v\n", err)
		return 1
	}
	httpServer := newHTTPServer(server.Handler(""), defaultRequestTimeout)
	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(listener) }()

	// The harness trusts /health only after this line, so it must follow the bind.
	fmt.Fprintf(stderr, "blok-server %s listening on %s (--auth %s)\n", version, options.ListenAddress, options.Auth)

	select {
	case err := <-served:
		fmt.Fprintf(stderr, "blok-server stopped: %v\n", err)
		return 1
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := server.Drain(shutdown); err != nil {
		fmt.Fprintf(stderr, "warning: collab: the shutdown drain did not complete: %v\n", err)
	}
	_ = httpServer.Shutdown(shutdown)
	return 0
}
