package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/ticket"
)

const testSecret = "s3cret-value-at-least-32-chars-long!"

// storedName is the shape blobstore generates: 32 hex characters plus a narrow
// extension. Nothing in the file server depends on it, but a test that serves a
// name Put could never have written would prove less.
const storedName = "0123456789abcdef0123456789abcdef.png"

func ticketConfig(t *testing.T) serverConfig {
	t.Helper()

	return serverConfig{
		Config: config.Config{
			Listen:         "127.0.0.1:4000",
			Auth:           config.AuthTicket,
			Secret:         testSecret,
			AllowedOrigins: []string{"https://app.example.com"},
			StorageDir:     t.TempDir(),
		},
		PublicURL:          "https://blok.example.com/files",
		MaxUploadBytes:     32 << 20,
		RateLimitPerMinute: 60,
	}
}

func loopbackConfig(t *testing.T) serverConfig {
	t.Helper()

	return serverConfig{
		Config: config.Config{
			Listen:     "127.0.0.1:4000",
			Auth:       config.AuthNone,
			StorageDir: t.TempDir(),
		},
		PublicURL:      "http://127.0.0.1:4000/files",
		MaxUploadBytes: 32 << 20,
	}
}

func build(t *testing.T, cfg serverConfig) http.Handler {
	t.Helper()

	h, err := buildServer(cfg, "1.10.1")
	if err != nil {
		t.Fatalf("buildServer: %v", err)
	}

	return h
}

func do(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)

	return rec
}

// The whole point of the wiring: a service started with --auth ticket must
// actually verify something. Options.Auth and Options.Secret left at their zero
// values make every one of these requests succeed.
func TestTicketModeRefusesAnUnauthenticatedRequest(t *testing.T) {
	h := build(t, ticketConfig(t))

	t.Run("no pass", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com", nil)
		r.Header.Set("Origin", "https://app.example.com")

		if rec := do(h, r); rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("unlisted origin", func(t *testing.T) {
		token, err := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: time.Now().Add(time.Hour).Unix()})
		if err != nil {
			t.Fatalf("sign: %v", err)
		}

		r := httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com", nil)
		r.Header.Set("Origin", "https://evil.example.net")
		r.Header.Set("Authorization", "Bearer "+token)

		if rec := do(h, r); rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("a valid pass gets through", func(t *testing.T) {
		token, err := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: time.Now().Add(time.Hour).Unix()})
		if err != nil {
			t.Fatalf("sign: %v", err)
		}

		r := httptest.NewRequest(http.MethodGet, "/unfurl", nil)
		r.Header.Set("Origin", "https://app.example.com")
		r.Header.Set("Authorization", "Bearer "+token)

		// No url parameter: the handler answers 400 without fetching anything,
		// which is enough to show the request reached it.
		if rec := do(h, r); rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

func TestAStoreRegistersTheUploadRoutes(t *testing.T) {
	h := build(t, loopbackConfig(t))

	for name, r := range map[string]*http.Request{
		"/upload":        httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("")),
		"/upload-by-url": httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader("not json")),
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(h, r)
			if rec.Code == http.StatusNotFound {
				t.Fatalf("status = 404: %s is not registered", name)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 from the handler itself", rec.Code)
			}
		})
	}
}

// A nil Fetcher took the connection down on the first request: the route was
// registered unconditionally and the handler dereferenced the nil interface.
func TestUnfurlIsReachableAndDoesNotPanic(t *testing.T) {
	h := build(t, loopbackConfig(t))

	// A loopback target the address filter refuses without touching the
	// network, so this test needs no server and no internet.
	rec := do(h, httptest.NewRequest(http.MethodGet, "/unfurl?url=http%3A%2F%2F127.0.0.1%3A1%2F", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Success int `json:"success"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Success != 0 {
		t.Fatalf("success = %d, want 0 for a refused address", body.Success)
	}
}

// --no-unfurl is the emergency lever for a reported filter bypass, and the
// bypass would be in the guard both outbound routes share. It therefore closes
// /upload-by-url too, not only /unfurl.
func TestNoUnfurlClosesEveryOutboundRoute(t *testing.T) {
	cfg := loopbackConfig(t)
	cfg.UnfurlDisabled = true
	h := build(t, cfg)

	for path, want := range map[string]int{
		"/unfurl?url=https%3A%2F%2Fexample.com": http.StatusNotFound,
		"/upload-by-url":                        http.StatusNotFound,
	} {
		method := http.MethodGet
		if strings.HasPrefix(path, "/upload") {
			method = http.MethodPost
		}

		rec := do(h, httptest.NewRequest(method, path, strings.NewReader("{}")))
		if rec.Code != want {
			t.Fatalf("%s: status = %d, want %d", path, rec.Code, want)
		}
	}

	if rec := do(h, httptest.NewRequest(http.MethodGet, "/health", nil)); rec.Code != http.StatusOK {
		t.Fatalf("/health status = %d, want 200 — the lever must not take the service down", rec.Code)
	}

	rec := do(h, httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("")))
	if rec.Code == http.StatusNotFound {
		t.Fatal("/upload is 404: --no-unfurl must leave plain uploads alone")
	}
}

// Serving the storage directory is where stored XSS opens: whatever mounts it
// decides the type of an uploaded .html, and a bare http.FileServer sniffs.
func TestServedFilesRefuseToRenderAsAPage(t *testing.T) {
	cfg := ticketConfig(t)
	cfg.PublicURL = "http://127.0.0.1:4000/files"
	if err := os.WriteFile(filepath.Join(cfg.StorageDir, storedName), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	h := build(t, cfg)

	// No Origin and no pass: an <img> carries neither, so this prefix cannot be
	// behind the guard or every image 401s in ticket mode.
	rec := do(h, httptest.NewRequest(http.MethodGet, "/files/"+storedName, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := rec.Header().Get("Content-Disposition"); got != "attachment" {
		t.Fatalf("Content-Disposition = %q, want attachment", got)
	}
	if body := rec.Body.String(); body != "<h1>hi</h1>" {
		t.Fatalf("body = %q, want the stored bytes", body)
	}
}

// Random names are the whole access model for local blobs; a listing hands them
// all out.
func TestTheStorageDirectoryIsNotListable(t *testing.T) {
	cfg := loopbackConfig(t)
	if err := os.WriteFile(filepath.Join(cfg.StorageDir, storedName), []byte("x"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	h := build(t, cfg)

	rec := do(h, httptest.NewRequest(http.MethodGet, "/files/", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), storedName) {
		t.Fatalf("body listed a stored name: %q", rec.Body.String())
	}
}

// The API must still be reachable with the file prefix mounted in front of it.
func TestHealthAnswersBesideTheFilePrefix(t *testing.T) {
	h := build(t, loopbackConfig(t))

	rec := do(h, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"version":"1.10.1"`) {
		t.Fatalf("body = %q, want the version", rec.Body.String())
	}
}

func TestS3InterlocksRefuseAnIncompleteConfiguration(t *testing.T) {
	complete := s3Settings{
		Endpoint:  "https://s3.eu-central-1.amazonaws.com",
		Region:    "eu-central-1",
		Bucket:    "blok-uploads",
		PublicURL: "https://blok-uploads.s3.eu-central-1.amazonaws.com",
		AccessKey: "AKIAEXAMPLE",
		SecretKey: "secret",
	}

	for name, tc := range map[string]struct {
		mutate func(*s3Settings)
		names  string
	}{
		// resolveTarget validates the endpoint, the bucket and the addressing
		// style — but deliberately NOT the region, so an empty one signs a
		// syntactically valid, garbage scope that only fails at the first real
		// request. This interlock is the only thing that catches it.
		"no region":       {func(s *s3Settings) { s.Region = "" }, "--s3-region"},
		"no endpoint":     {func(s *s3Settings) { s.Endpoint = "" }, "--s3-endpoint"},
		"schemeless host": {func(s *s3Settings) { s.Endpoint = "s3.amazonaws.com" }, "--s3-endpoint"},
		"no bucket url":   {func(s *s3Settings) { s.PublicURL = "" }, "--s3-bucket-url"},
		"no access key":   {func(s *s3Settings) { s.AccessKey = "" }, "BLOK_S3_ACCESS_KEY"},
		"no secret key":   {func(s *s3Settings) { s.SecretKey = "" }, "BLOK_S3_SECRET_KEY"},
		"bad addressing":  {func(s *s3Settings) { s.Addressing = "dns" }, "--s3-addressing"},
	} {
		t.Run(name, func(t *testing.T) {
			cfg := loopbackConfig(t)
			cfg.S3 = complete
			tc.mutate(&cfg.S3)

			_, err := buildServer(cfg, "1.10.1")
			if err == nil {
				t.Fatal("buildServer accepted the configuration, want a refusal")
			}
			if !strings.Contains(err.Error(), tc.names) {
				t.Fatalf("error = %q, want it to name %s", err, tc.names)
			}
		})
	}

	t.Run("a complete configuration builds", func(t *testing.T) {
		cfg := loopbackConfig(t)
		cfg.S3 = complete
		h := build(t, cfg)

		if rec := do(h, httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader(""))); rec.Code == http.StatusNotFound {
			t.Fatal("/upload is 404 with an S3 bucket configured")
		}
		// The bucket serves the blobs, so nothing local is mounted.
		if rec := do(h, httptest.NewRequest(http.MethodGet, "/files/"+storedName, nil)); rec.Code != http.StatusNotFound {
			t.Fatalf("/files status = %d, want 404 — S3 deployments serve no local directory", rec.Code)
		}
	})
}

func TestNoStorageDestinationLeavesTheUploadRoutesUnregistered(t *testing.T) {
	cfg := loopbackConfig(t)
	cfg.StorageDir = ""
	h := build(t, cfg)

	if rec := do(h, httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader(""))); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a nil store must not reach the handler", rec.Code)
	}
	if rec := do(h, httptest.NewRequest(http.MethodGet, "/health", nil)); rec.Code != http.StatusOK {
		t.Fatalf("/health status = %d, want 200", rec.Code)
	}
}

func TestAnUploadCapOfZeroIsRefusedAtStartup(t *testing.T) {
	cfg := loopbackConfig(t)
	cfg.MaxUploadBytes = 0

	_, err := buildServer(cfg, "1.10.1")
	if err == nil || !strings.Contains(err.Error(), "--max-upload") {
		t.Fatalf("error = %v, want a refusal naming --max-upload", err)
	}
}

func TestTicketModeRationsRequestsByDefault(t *testing.T) {
	cfg := ticketConfig(t)
	cfg.RateLimitPerMinute = resolveRateLimit(rateLimitAuto, cfg.Auth)
	h := build(t, cfg)

	token, err := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: time.Now().Add(time.Hour).Unix()})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	send := func() int {
		// No url parameter, so the budget is spent in the guard and nothing is
		// ever fetched.
		r := httptest.NewRequest(http.MethodGet, "/unfurl", nil)
		r.Header.Set("Origin", "https://app.example.com")
		r.Header.Set("Authorization", "Bearer "+token)

		return do(h, r).Code
	}

	for i := range defaultTicketRateLimit {
		if code := send(); code != http.StatusBadRequest {
			t.Fatalf("request %d: status = %d, want 400", i+1, code)
		}
	}
	if code := send(); code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 once the minute's budget is spent", code)
	}
}

// Behind a reverse proxy every request arrives from the app's address, so an
// address-keyed limit is one shared ceiling for the whole deployment.
func TestALoopbackBindIsNotRationed(t *testing.T) {
	cfg := loopbackConfig(t)
	cfg.RateLimitPerMinute = resolveRateLimit(rateLimitAuto, cfg.Auth)
	h := build(t, cfg)

	for i := range defaultTicketRateLimit + 1 {
		rec := do(h, httptest.NewRequest(http.MethodGet, "/unfurl", nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("request %d: status = %d, want 400", i+1, rec.Code)
		}
	}
}
