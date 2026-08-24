package main

import (
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
)

// version is stamped at build time via -ldflags.
var version = "dev"

const (
	// defaultMaxUploadBytes clears the ceiling the editor applies on its own
	// side. src/tools/file/constants.ts refuses anything over 30 MiB before it
	// is ever sent, and multipart framing puts the request BODY somewhat over
	// the file — a cap of exactly 30 MiB would refuse a file the editor was
	// willing to send. Raising this past a few tens of MiB means raising
	// readTimeout with it.
	defaultMaxUploadBytes = 32 << 20

	// defaultTicketRateLimit is the per-caller budget a public service starts
	// with: one request a second sustained, which absorbs a page that unfurls
	// every link it holds at once and a burst of uploads beside it, while
	// leaving anyone using this service as a scanner one probe a second per
	// pass (or per address, for a pass that names no user).
	defaultTicketRateLimit = 60

	// rateLimitAuto is the --rate-limit value meaning "let the access mode
	// decide". It is negative because 0 already means something else: OFF.
	rateLimitAuto = -1
)

// A default http.Server sets NONE of the four timeouts below, so a handful of
// slow connections hold it open indefinitely. Every value here is a compromise
// with one legitimately slow operation: a large upload.
const (
	// readHeaderTimeout is the slowloris bound. Request headers arrive in one
	// burst or the caller is not a caller.
	readHeaderTimeout = 10 * time.Second

	// readTimeout bounds the whole request, body included, so it is sized by
	// the largest upload rather than by anything a request needs: at the
	// 32 MiB default cap it leaves a floor of roughly 55 KB/s sustained. A
	// deployment that raises --max-upload well past that default has to raise
	// this with it, or long uploads die at the deadline while making progress.
	readTimeout = 10 * time.Minute

	// writeTimeout is reset when a request's headers are read, so it covers the
	// handler and the response together. /upload-by-url fetches through the
	// media guard (mediaFetchTimeout) and then writes to the store, and the S3
	// driver bounds one request at 5 minutes of its own — a value below their
	// sum cuts the response off mid-flight.
	writeTimeout = 10 * time.Minute

	// idleTimeout is how long a kept-alive connection may sit unused. Without
	// it, Go falls back to readTimeout, which is minutes.
	idleTimeout = 2 * time.Minute
)

type s3Settings struct {
	Endpoint   string
	Region     string
	Bucket     string
	PublicURL  string
	Addressing string

	// Credentials come from the environment and never from flags: a flag lands
	// in this machine's process list, where any other user reads it with `ps`.
	AccessKey string
	SecretKey string
}

// serverConfig is everything the process learned from its flags and its
// environment. config.Config is the part with startup interlocks in
// internal/config; the fields beside it are wiring that package does not judge.
type serverConfig struct {
	config.Config

	PublicURL          string
	MaxUploadBytes     int64
	RateLimitPerMinute int
	S3                 s3Settings
	conformanceSettings

	// secretFromFlag records that the secret arrived on the command line, which
	// is what main warns about. It is not a configuration value.
	secretFromFlag bool
}

// rawFlags holds flag values that still need resolving after the parse: the
// access mode is a string until it is checked, the origins are one CSV field,
// the rate limit may be "auto", and the public URL is derived from --listen
// when it is absent.
type rawFlags struct {
	auth      string
	origins   string
	publicURL string
	rateLimit int
	secret    string
}

func main() {
	cfg, err := parseArgs(os.Args[1:], os.Getenv)
	if err != nil {
		// flag has already printed the failure and the usage.
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}

		os.Exit(2)
	}

	if err := config.Validate(cfg.Config); err != nil {
		log.Fatalf("blok-server refused to start: %v", err)
	}

	if cfg.secretFromFlag {
		log.Print("warning: --secret puts the shared secret in this machine's process list; set BLOK_SECRET in the environment instead")
	}

	handler, err := buildServer(cfg, version)
	if err != nil {
		log.Fatalf("blok-server refused to start: %v", err)
	}

	log.Printf("blok-server %s listening on %s (--auth %s)", version, cfg.Listen, cfg.Auth)

	switch {
	case cfg.S3.Bucket != "":
		log.Printf("uploads go to the %q bucket at %s", cfg.S3.Bucket, cfg.S3.Endpoint)
	case cfg.StorageDir != "":
		log.Printf("uploads go to %s, handed out as %s", cfg.StorageDir, cfg.PublicURL)
	default:
		log.Print("uploads are disabled: neither --storage-dir nor --s3-bucket is set")
	}

	if err := newHTTPServer(cfg, handler).ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func newFlagSet(cfg *serverConfig) (*flag.FlagSet, *rawFlags) {
	fs := flag.NewFlagSet("blok-server", flag.ContinueOnError)
	raw := &rawFlags{}

	fs.StringVar(&cfg.Listen, "listen", "127.0.0.1:4000", "address to listen on")
	fs.StringVar(&raw.auth, "auth", "none", "access mode: none, proxy, or ticket")
	fs.StringVar(&raw.secret, "secret", "", "shared secret for --auth ticket; prefer the BLOK_SECRET environment variable, because a flag is visible to anyone who can list processes on this machine")
	fs.StringVar(&raw.origins, "allow-origin", "", "comma-separated origins allowed to call this service")
	fs.StringVar(&cfg.StorageDir, "storage-dir", "./blok-uploads", "directory for uploaded files; empty, with no --s3-bucket, leaves the upload routes unregistered")
	fs.StringVar(&raw.publicURL, "public-url", "", "URL prefix uploaded files are handed out under, and the path this service serves them at (default \"http://\" + --listen + \"/files\"). It must be the URL callers actually reach this service at: a stored file's URL is built from this prefix, and deleting one works only for a URL that begins with the same prefix — so reaching the service through a different hostname than the one named here silently fails every delete of a file stored under the old prefix")
	fs.Int64Var(&cfg.MaxUploadBytes, "max-upload", defaultMaxUploadBytes, "largest upload accepted, in bytes; the default is 32 MiB, which clears the editor's own 30 MiB ceiling with room for multipart framing")
	fs.IntVar(&raw.rateLimit, "rate-limit", rateLimitAuto, "requests a minute per caller; 0 disables it, and -1 lets the access mode decide: 60 for --auth ticket, off for a loopback bind, where every request arrives from one address and any limit would be a ceiling for the whole deployment rather than a budget per user")
	fs.BoolVar(&cfg.UnfurlDisabled, "no-unfurl", false, "close both routes that fetch a consumer-supplied URL: GET /unfurl and POST /upload-by-url. They share one guarded client, so the emergency lever closes both")

	fs.StringVar(&cfg.S3.Endpoint, "s3-endpoint", "", "S3-compatible endpoint, e.g. https://s3.eu-central-1.amazonaws.com")
	fs.StringVar(&cfg.S3.Region, "s3-region", "", "S3 region; required with --s3-bucket")
	fs.StringVar(&cfg.S3.Bucket, "s3-bucket", "", "S3 bucket to upload into; without it, files go to --storage-dir. Credentials are read from BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY")
	fs.StringVar(&cfg.S3.PublicURL, "s3-bucket-url", "", "URL prefix the bucket's objects are reachable at; required with --s3-bucket, and the only prefix a delete is recognised under")
	fs.StringVar(&cfg.S3.Addressing, "s3-addressing", "", "\"path\" or \"virtual\"; empty picks virtual-hosted style for AWS and path style everywhere else")

	registerConformanceFlags(fs, cfg)

	return fs, raw
}

func parseArgs(args []string, getenv func(string) string) (serverConfig, error) {
	var cfg serverConfig

	fs, raw := newFlagSet(&cfg)
	if err := fs.Parse(args); err != nil {
		return serverConfig{}, err
	}

	cfg.Auth = config.AuthMode(raw.auth)
	cfg.AllowedOrigins = splitOrigins(raw.origins)
	cfg.RateLimitPerMinute = resolveRateLimit(raw.rateLimit, cfg.Auth)

	cfg.PublicURL = raw.publicURL
	if cfg.PublicURL == "" {
		cfg.PublicURL = defaultPublicURL(cfg.Listen)
	}

	// The environment is the recommended path for the secret, but an operator
	// who put one on the command line meant it — a flag given explicitly wins,
	// the way it does for every other setting here.
	cfg.secretFromFlag = raw.secret != ""
	if cfg.secretFromFlag {
		cfg.Secret = raw.secret
	} else {
		cfg.Secret = getenv("BLOK_SECRET")
	}

	cfg.S3.AccessKey = getenv("BLOK_S3_ACCESS_KEY")
	cfg.S3.SecretKey = getenv("BLOK_S3_SECRET_KEY")

	return cfg, nil
}

func newHTTPServer(cfg serverConfig, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              cfg.Listen,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
}

// resolveRateLimit turns the "auto" flag value into a budget.
//
// The limit exists to stop a PUBLIC service being used as a scanner, and only
// there does it key by something narrow: a pass names a user. On a loopback
// bind — both --auth none and --auth proxy — every request arrives from one
// address, the app's, so any limit would be a ceiling shared by the whole
// deployment rather than a per-user budget. An operator may still set one
// explicitly; that is what the flag is for.
func resolveRateLimit(flagValue int, auth config.AuthMode) int {
	if flagValue != rateLimitAuto {
		return flagValue
	}
	if auth == config.AuthTicket {
		return defaultTicketRateLimit
	}

	return 0
}

// defaultPublicURL is the prefix this process will hand out and serve its own
// storage directory under when --public-url is absent.
func defaultPublicURL(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		host, port = listen, ""
	}
	host = strings.Trim(host, "[]")

	// An address with no host, or an unspecified one, binds every interface and
	// therefore names no reachable host. Loopback is the one address that is
	// certainly this service.
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}

	authority := host
	switch {
	case port != "":
		authority = net.JoinHostPort(host, port)
	case strings.Contains(host, ":"):
		authority = "[" + host + "]"
	}

	return "http://" + authority + "/files"
}

// splitOrigins drops blank entries so a trailing comma cannot leave "" in the
// allowlist, where it would match a request that sent no Origin at all. An
// empty flag yields a nil slice, which is what the ticket interlock refuses.
func splitOrigins(csv string) []string {
	var out []string

	for _, origin := range strings.Split(csv, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			out = append(out, origin)
		}
	}

	return out
}
