// Command blok-server is the Go build of the Blok server host.
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
	"github.com/JackUait/blok/packages/server/go/internal/collab/synchttp"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
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

// newline is .NET's Environment.NewLine, which Console.Error.WriteLine ends
// every C# record with: "\r\n" in the Windows CoreLib.
var newline = map[bool]string{true: "\r\n", false: "\n"}[runtime.GOOS == "windows"]

// shutdownGrace is C#'s HostCollab.ShutdownTimeout: a ceiling for the drain
// and the graceful stop, not a wait.
const shutdownGrace = 30 * time.Second

const (
	defaultRequestTimeout = 10 * time.Minute
	keepAliveTimeout      = 2 * time.Minute
	headerTimeout         = 10 * time.Second
)

func main() {
	// SIGQUIT from the start: Go's default dumps every goroutine and exits
	// 2, where .NET dies by the signal before its handlers and stops
	// gracefully after them. Go cannot reach the OS default.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGQUIT)
	// .NET decodes argv and the environment itself: bytes that are not
	// UTF-8 become U+FFFD, not raw bytes in paths and error lines.
	args := make([]string, 0, len(os.Args))
	for _, arg := range os.Args[1:] {
		args = append(args, dotnet.NativeText(arg))
	}
	getenv := func(name string) string { return dotnet.NativeText(os.Getenv(name)) }
	code := run(ctx, args, getenv, os.Stderr)
	stop()
	os.Exit(code)
}

// notifyShutdown runs just before the bind, where C#'s StartAsync registers
// its signal handlers: a SIGTERM or SIGINT before it takes the default
// action, as in C#.
var notifyShutdown = func(ctx context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(ctx, syscall.SIGTERM, os.Interrupt)
}

// newHTTPServer is Kestrel's limits: 2 min idle, and every request cut off
// with 504 at the request deadline. The 10 s header limit needs the
// listener wrapped too: serve on a headerListener.
func newHTTPServer(handler http.Handler, requestTimeout time.Duration) *http.Server {
	server := &http.Server{
		Handler:     withServerHeader(withDeadline(dotnet.RecoverLikeKestrel(handler), requestTimeout)),
		IdleTimeout: keepAliveTimeout,
		// Without this net/http answers "OPTIONS *" itself.
		DisableGeneralOptionsHandler: true,
		// The C# host clears Kestrel's loggers: a handler panic, an accept
		// retry or a misused writer reaches no one, never raw on stderr.
		ErrorLog: log.New(io.Discard, "", 0),
		// The stream holds Kestrel's head limits; this caps heads only after
		// it stops rewriting (a chunked trailer, an upgrade). net/http adds 4096.
		MaxHeaderBytes: maxRequestLine + maxHeaderBlock - 4096,
	}
	restoreTargets(server)
	limitRequestHeaders(server, headerTimeout, keepAliveTimeout)
	return server
}

// withServerHeader is Kestrel's AddServerHeader default: every answer says
// "Server: Kestrel". kestrelAnswer and ws.Upgrade carry it too.
func withServerHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "Kestrel")
		next.ServeHTTP(w, r)
	})
}

// maxUpgradedConnections is HostCollab.DefaultMaxUpgradedConnections: an
// accept-and-hold flood cannot pin every socket the process can hold. It is
// both the service count (503) and the backstop in limitUpgrades (500).
const maxUpgradedConnections = 1024

// limitUpgrades is the Kestrel backstop HostCollab.Configure sets with
// collab: it counts the sockets the sync door accepts only to close, which
// the service count does not.
func limitUpgrades(handler http.Handler, options blokserver.Options) http.Handler {
	if !options.CollabEnabled {
		return handler
	}
	return synchttp.LimitUpgrades(handler, maxUpgradedConnections)
}

// configureCollab is HostCollab.Configure.
func configureCollab(options *blokserver.Options, stderr io.Writer) {
	if options.CollabEnabled {
		options.CollabMaxConnections = maxUpgradedConnections
		options.Logger = newCollabLogger(stderr)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, stderr io.Writer) int {
	hostArgs, conformance, conformanceErr := parseConformanceArguments(args)
	if conformanceErr != "" {
		fmt.Fprint(stderr, conformanceErr+newline)
		fmt.Fprint(stderr, usage)
		return 2
	}
	parsed := parseHostArguments(hostArgs, getenv)
	if parsed.help {
		fmt.Fprint(stderr, usage)
		return 0
	}
	if parsed.err != "" {
		fmt.Fprint(stderr, parsed.err+newline)
		fmt.Fprint(stderr, usage)
		return 2
	}
	options := parsed.options
	options.Version = version
	options.LoopbackHostCheck = true
	configureCollab(&options, stderr)
	server, err := blokserver.New(options)
	if err != nil {
		fmt.Fprintf(stderr, "blok-server refused to start: %v%s", err, newline)
		return 1
	}
	if parsed.secretFromFlag {
		fmt.Fprint(stderr, "warning: --secret puts the shared secret in this machine's process list; set BLOK_SECRET in the environment instead"+newline)
	}
	if parsed.docEndpointAuthFromFlag {
		fmt.Fprint(stderr, "warning: --doc-endpoint-auth puts the credential in this machine's process list; set BLOK_DOC_ENDPOINT_AUTH in the environment instead"+newline)
	}
	applyConformance(server, conformance)

	ctx, stopSignals := notifyShutdown(ctx)
	defer stopSignals()
	listeners, err := listen(options.ListenAddress)
	if err != nil {
		fmt.Fprintf(stderr, "blok-server refused to start: %v%s", err, newline)
		return 1
	}
	httpServer := newHTTPServer(limitUpgrades(server.Handler(""), options), defaultRequestTimeout)
	served := make(chan error, len(listeners))
	for _, listener := range listeners {
		go func() { served <- httpServer.Serve(headerListener{listener, headerTimeout, keepAliveTimeout}) }()
	}

	// The harness trusts /health only after this line, so it must follow the bind.
	fmt.Fprintf(stderr, "blok-server %s listening on %s (--auth %s)%s", version, options.ListenAddress, options.Auth, newline)

	select {
	case err := <-served:
		fmt.Fprintf(stderr, "blok-server stopped: %v%s", err, newline)
		return 1
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := server.Drain(shutdown); err != nil {
		_ = writeLogLine(stderr, "warning", "collab: the shutdown drain did not complete: "+err.Error())
	}
	_ = httpServer.Shutdown(shutdown)
	return 0
}
