# Blok Backend Service Implementation Plan

> **Status:** historical implementation record; do not continue this plan. The Go
> service it produced is frozen as a parity oracle and will be deleted after the C#
> replacement passes the removal gate in
> [`2026-08-23-blok-dotnet-library-design.md`](2026-08-23-blok-dotnet-library-design.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `blok-server` — a small Go sidecar that handles file uploads and link previews for Blok consumers, so they write no backend code for either.

**Architecture:** One Go binary exposing four routes behind one guarded outbound HTTP client. Both routes that fetch a consumer-supplied URL (`/unfurl`, `/upload-by-url`) share that client — there is no second path. Storage is BYO through a `BlobStore` interface with a local-directory driver and an S3-compatible driver. Access is one of three modes chosen by flag, with startup interlocks that make an accidentally-public open service impossible.

**Tech Stack:** Go 1.25, `github.com/doyensec/safeurl` (SSRF-guarded HTTP client), Go stdlib `net/http` + `html` for parsing, goreleaser + GHCR for release, a thin npm wrapper for `npx`.

**Spec:** `docs/plans/2026-08-22-backend-service-design.md`

## Global Constraints

- **Version lockstep with the `@bloklabs/*` family.** Current version: `1.10.1`. The service takes the family version; the container image is rebuilt only when `packages/server/` changed.
- **Response shapes are fixed by existing client parsers.** Unfurl must match `src/tools/link/metadata-fetcher.ts`; uploads must match `src/tools/file/uploader.ts` `parseResponse`. Changing either breaks consumers who already wrote their own backend.
- **One guarded outbound HTTP client.** Every server-side fetch of a consumer-supplied URL goes through `internal/fetchguard`, or it does not ship.
- **The address filter is not hand-rolled.** Use `github.com/doyensec/safeurl`.
- **Nothing auto-iterates workspaces.** `scripts/build-all.mjs`, `.github/workflows/ci.yml`, and `scripts/release.mjs` all use explicit lists — the new package must be registered in each deliberately.
- **`yarn install --immutable` is a hard CI gate (YN0028).** Any workspace addition ships with its `yarn.lock` entry in the same commit.
- **The service stores no documents.** No `/documents/*` routes, no bundled database.
- **No hosted service.** Nothing in this plan deploys anything we operate.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/server/go.mod` | Go module definition |
| `packages/server/package.json` | npm wrapper manifest (`npx @bloklabs/server`) |
| `packages/server/bin/blok-server.mjs` | npm wrapper: resolves/downloads the platform binary, execs it |
| `packages/server/cmd/blok-server/main.go` | Flag parsing, config validation, process wiring |
| `packages/server/internal/config/config.go` | Config struct + startup interlocks |
| `packages/server/internal/fetchguard/client.go` | The single SSRF-guarded outbound HTTP client |
| `packages/server/internal/unfurl/parse.go` | HTML → metadata extraction (no network) |
| `packages/server/internal/blobstore/blobstore.go` | `BlobStore` interface |
| `packages/server/internal/blobstore/localdir.go` | Local-directory driver |
| `packages/server/internal/blobstore/s3.go` | S3-compatible driver |
| `packages/server/internal/ticket/verify.go` | Pass (JWT/HMAC) verification |
| `packages/server/internal/httpapi/router.go` | Route table, middleware chain |
| `packages/server/internal/httpapi/health.go` | `GET /health` |
| `packages/server/internal/httpapi/unfurl.go` | `GET /unfurl` |
| `packages/server/internal/httpapi/upload.go` | `POST /upload`, `POST /upload-by-url` |
| `packages/server/internal/httpapi/middleware.go` | Origin allowlist, rate limit, auth |
| `.goreleaser.yaml` | Binary + image build |

Parsing lives apart from HTTP so it can be tested without a server; the fetch guard lives apart from both so every caller is forced through it.

---

### Task 1: Go module, workspace registration, and `/health`

**Files:**
- Create: `packages/server/go.mod`, `packages/server/cmd/blok-server/main.go`, `packages/server/internal/httpapi/router.go`, `packages/server/internal/httpapi/health.go`, `packages/server/package.json`
- Test: `packages/server/internal/httpapi/health_test.go`
- Modify: `yarn.lock` (workspace entry), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `httpapi.New(opts httpapi.Options) http.Handler` where `type Options struct { Version string }`. Every later task adds fields to `Options` and routes to `router.go`.

- [ ] **Step 1: Write the failing test**

`packages/server/internal/httpapi/health_test.go`:

```go
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

func TestHealthReportsVersion(t *testing.T) {
	h := httpapi.New(httpapi.Options{Version: "1.10.1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" || body.Version != "1.10.1" {
		t.Fatalf("body = %+v, want status=ok version=1.10.1", body)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/httpapi/
```

Expected: build failure — package `httpapi` does not exist.

- [ ] **Step 3: Create the module and the minimal implementation**

`packages/server/go.mod`:

```
module github.com/JackUait/blok/packages/server

go 1.25
```

`packages/server/internal/httpapi/health.go`:

```go
package httpapi

import (
	"encoding/json"
	"net/http"
)

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": s.opts.Version,
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
```

`packages/server/internal/httpapi/router.go`:

```go
package httpapi

import "net/http"

// Options carries everything the HTTP layer needs. Later tasks add fields;
// they are all optional so tests can construct a server with only what they use.
type Options struct {
	Version string
}

type server struct {
	opts Options
	mux  *http.ServeMux
}

func New(opts Options) http.Handler {
	s := &server{opts: opts, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /health", s.handleHealth)

	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}
```

`packages/server/cmd/blok-server/main.go`:

```go
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

// version is stamped at build time via -ldflags.
var version = "dev"

func main() {
	listen := flag.String("listen", "127.0.0.1:4000", "address to listen on")
	flag.Parse()

	log.Printf("blok-server %s listening on %s", version, *listen)

	if err := http.ListenAndServe(*listen, httpapi.New(httpapi.Options{Version: version})); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

Expected: PASS.

- [ ] **Step 5: Register the workspace**

`packages/server/package.json`:

```json
{
  "name": "@bloklabs/server",
  "version": "1.10.1",
  "description": "Blok backend service — file uploads and link previews",
  "bin": { "blok-server": "bin/blok-server.mjs" },
  "files": ["bin"],
  "engines": { "node": "^20.19.0 || ^22.13.0 || >=24.0.0" },
  "publishConfig": { "access": "public" },
  "license": "Apache-2.0"
}
```

Create a placeholder `packages/server/bin/blok-server.mjs` (Task 10 replaces its body):

```js
#!/usr/bin/env node
console.error('blok-server: binary resolution is implemented in Task 10');
process.exit(1);
```

Then, from the repo root:

```bash
yarn install --mode=update-lockfile
yarn install --immutable
```

Expected: the second command exits 0. If it reports **YN0028**, the first command did not run — do not proceed, and do not pass `--no-immutable` in CI.

- [ ] **Step 6: Add the CI job**

In `.github/workflows/ci.yml`, add a job alongside the existing ones:

```yaml
  server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25'
          cache-dependency-path: packages/server/go.sum
      - name: Test
        working-directory: packages/server
        run: go vet ./... && go test ./...
```

- [ ] **Step 7: Commit**

```bash
git add packages/server yarn.lock .github/workflows/ci.yml
git commit -m "feat(server): scaffold the Go service with a health route"
```

---

### Task 2: The guarded outbound HTTP client

This task exists before any route that fetches, so no route can be written without it.

**Files:**
- Create: `packages/server/internal/fetchguard/client.go`
- Test: `packages/server/internal/fetchguard/client_test.go`, `packages/server/internal/fetchguard/integration_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fetchguard.New(cfg fetchguard.Config) *fetchguard.Client`
  - `type Config struct { Timeout time.Duration; MaxBytes int64; MaxRedirects int }`
  - `(*Client).Get(ctx context.Context, rawURL string) (*fetchguard.Response, error)`
  - `type Response struct { Body []byte; ContentType string; FinalURL string }`
  - Sentinel errors: `fetchguard.ErrBlockedAddress`, `fetchguard.ErrTooLarge`, `fetchguard.ErrTooManyRedirects`, `fetchguard.ErrBadScheme`

- [ ] **Step 1: Write the failing security tests**

`packages/server/internal/fetchguard/client_test.go`:

```go
package fetchguard_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

func newClient() *fetchguard.Client {
	return fetchguard.New(fetchguard.Config{
		Timeout:      2 * time.Second,
		MaxBytes:     1 << 20, // 1 MiB
		MaxRedirects: 3,
	})
}

// The cloud metadata address, written four ways. Every one of these must be
// refused: decimal and IPv6-mapped forms are the classic filter bypasses.
func TestRejectsMetadataAddressInEveryNotation(t *testing.T) {
	for _, raw := range []string{
		"http://169.254.169.254/latest/meta-data/",
		"http://2852039166/latest/meta-data/",
		"http://[::ffff:169.254.169.254]/latest/meta-data/",
		"http://127.0.0.1:22/",
	} {
		t.Run(raw, func(t *testing.T) {
			_, err := newClient().Get(context.Background(), raw)
			if !errors.Is(err, fetchguard.ErrBlockedAddress) {
				t.Fatalf("err = %v, want ErrBlockedAddress", err)
			}
		})
	}
}

func TestRejectsNonHTTPScheme(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "gopher://example.com/", "ftp://example.com/"} {
		if _, err := newClient().Get(context.Background(), raw); !errors.Is(err, fetchguard.ErrBadScheme) {
			t.Fatalf("%s: err = %v, want ErrBadScheme", raw, err)
		}
	}
}

// A public host that redirects into a private range must be refused at the hop,
// not merely validated once at the start.
func TestRejectsRedirectIntoPrivateRange(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://10.0.0.1/internal", http.StatusFound)
	}))
	defer srv.Close()

	_, err := newClient().Get(context.Background(), srv.URL)
	if !errors.Is(err, fetchguard.ErrBlockedAddress) {
		t.Fatalf("err = %v, want ErrBlockedAddress", err)
	}
}

func TestRejectsRedirectLoop(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL+"/next", http.StatusFound)
	}))
	defer srv.Close()

	_, err := newClient().Get(context.Background(), srv.URL)
	if !errors.Is(err, fetchguard.ErrTooManyRedirects) {
		t.Fatalf("err = %v, want ErrTooManyRedirects", err)
	}
}

func TestStopsReadingOversizedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := strings.Repeat("x", 64*1024)
		for i := 0; i < 64; i++ { // 4 MiB, well past the 1 MiB cap
			_, _ = w.Write([]byte(chunk))
		}
	}))
	defer srv.Close()

	_, err := newClient().Get(context.Background(), srv.URL)
	if !errors.Is(err, fetchguard.ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	defer srv.Close()

	c := fetchguard.New(fetchguard.Config{Timeout: 200 * time.Millisecond, MaxBytes: 1 << 20, MaxRedirects: 3})
	if _, err := c.Get(context.Background(), srv.URL); err == nil {
		t.Fatal("err = nil, want a timeout error")
	}
}

func TestAllowsAnOrdinaryPublicResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><head><title>hi</title></head></html>"))
	}))
	defer srv.Close()

	resp, err := newClient().Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if !strings.Contains(string(resp.Body), "<title>hi</title>") {
		t.Fatalf("body = %q", resp.Body)
	}
}
```

**Note on `httptest`:** these servers bind `127.0.0.1`, which the guard blocks in production. Implement `Config.AllowLoopbackForTests bool` and set it in `newClient()`; it is settable only from Go code, never from a CLI flag, so it cannot be enabled in a shipped binary. `TestRejectsMetadataAddressInEveryNotation` deliberately keeps `127.0.0.1:22` in the list and must therefore construct its own client **without** that escape hatch — split it into a second helper `newStrictClient()`.

`packages/server/internal/fetchguard/integration_test.go` (network-dependent, excluded from the default run):

```go
//go:build integration

package fetchguard_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

// nip.io resolves 10-0-0-1.nip.io to 10.0.0.1: a public hostname pointing at a
// private address. Validating the hostname instead of the resolved IP passes this.
func TestRejectsPublicHostnameResolvingToPrivateAddress(t *testing.T) {
	c := fetchguard.New(fetchguard.Config{Timeout: 5 * time.Second, MaxBytes: 1 << 20, MaxRedirects: 3})

	_, err := c.Get(context.Background(), "http://10-0-0-1.nip.io/")
	if !errors.Is(err, fetchguard.ErrBlockedAddress) {
		t.Fatalf("err = %v, want ErrBlockedAddress", err)
	}
}
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd packages/server && go test ./internal/fetchguard/
```

Expected: build failure — package `fetchguard` does not exist.

- [ ] **Step 3: Add the dependency and implement**

```bash
cd packages/server && go get github.com/doyensec/safeurl@latest
```

`packages/server/internal/fetchguard/client.go`:

```go
// Package fetchguard is the ONLY place this service fetches a consumer-supplied
// URL. Both /unfurl and /upload-by-url go through it. Adding a second outbound
// http.Client anywhere in this service reintroduces the SSRF hole this package
// exists to close.
package fetchguard

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/doyensec/safeurl"
)

var (
	ErrBlockedAddress   = errors.New("fetchguard: address is not permitted")
	ErrTooLarge         = errors.New("fetchguard: response exceeded the size cap")
	ErrTooManyRedirects = errors.New("fetchguard: too many redirects")
	ErrBadScheme        = errors.New("fetchguard: only http and https are permitted")
)

type Config struct {
	Timeout      time.Duration
	MaxBytes     int64
	MaxRedirects int

	// AllowLoopbackForTests lets httptest servers on 127.0.0.1 be reached.
	// Settable from Go only — never wire this to a CLI flag or env var.
	AllowLoopbackForTests bool
}

type Response struct {
	Body        []byte
	ContentType string
	FinalURL    string
}

type Client struct {
	cfg  Config
	http *http.Client
}

func New(cfg Config) *Client {
	builder := safeurl.GetConfigBuilder().
		SetAllowedSchemes("http", "https").
		SetAllowedPorts(80, 443)

	if cfg.AllowLoopbackForTests {
		builder = builder.SetAllowedIPs("127.0.0.1")
	}

	client := safeurl.Client(builder.Build())
	client.Timeout = cfg.Timeout
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= cfg.MaxRedirects {
			return ErrTooManyRedirects
		}
		// safeurl re-validates each hop at dial time; this only bounds the chain.
		return nil
	}

	return &Client{cfg: cfg, http: client}
}

func (c *Client) Get(ctx context.Context, rawURL string) (*Response, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrBadScheme, rawURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%w: %s", ErrBadScheme, parsed.Scheme)
	}

	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "blok-server (+https://blokeditor.com)")

	resp, err := c.http.Do(req)
	if err != nil {
		if errors.Is(err, ErrTooManyRedirects) {
			return nil, ErrTooManyRedirects
		}
		// safeurl refuses a blocked address at dial time; every such failure
		// surfaces here and must not leak the internal address back to callers.
		return nil, fmt.Errorf("%w: %v", ErrBlockedAddress, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.cfg.MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > c.cfg.MaxBytes {
		return nil, ErrTooLarge
	}

	return &Response{
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
		FinalURL:    resp.Request.URL.String(),
	}, nil
}
```

**Implementation note:** `safeurl.Client` returns a `*http.Client`; confirm that `Timeout` and `CheckRedirect` are assignable on the returned value. If the library returns its own wrapper type without those fields, keep the `context.WithTimeout` above as the timeout (it already bounds the whole request) and enforce the redirect cap by counting hops in a custom `http.RoundTripper` around safeurl's transport. Do not fall back to `http.DefaultClient` — that removes the guard.

Wiring `ErrBlockedAddress` from safeurl's own error is deliberate: the guard must fail closed, so any dial-time refusal is reported as blocked rather than inspected and possibly waved through.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./internal/fetchguard/ -v
```

Expected: all PASS. Then, once, with network:

```bash
cd packages/server && go test -tags integration ./internal/fetchguard/ -run Rebind -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): add the single SSRF-guarded outbound HTTP client"
```

---

### Task 3: Metadata parsing (no network)

**Files:**
- Create: `packages/server/internal/unfurl/parse.go`
- Test: `packages/server/internal/unfurl/parse_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `unfurl.Parse(html []byte, finalURL string) unfurl.Meta` where

```go
type Meta struct {
	Title       string
	Description string
	Image       string
	Favicon     string
	Domain      string
}
```

- [ ] **Step 1: Write the failing test**

`packages/server/internal/unfurl/parse_test.go`:

```go
package unfurl_test

import (
	"testing"

	"github.com/JackUait/blok/packages/server/internal/unfurl"
)

const page = `<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="OpenGraph Title">
<meta name="description" content="Plain description">
<meta property="og:image" content="/img/cover.png">
<link rel="icon" href="/favicon.ico">
</head><body>ignored</body></html>`

func TestPrefersOpenGraphOverTitleTag(t *testing.T) {
	m := unfurl.Parse([]byte(page), "https://example.com/article?x=1")

	if m.Title != "OpenGraph Title" {
		t.Fatalf("Title = %q", m.Title)
	}
	if m.Description != "Plain description" {
		t.Fatalf("Description = %q", m.Description)
	}
	if m.Domain != "example.com" {
		t.Fatalf("Domain = %q", m.Domain)
	}
}

func TestResolvesRelativeImageAndFaviconAgainstFinalURL(t *testing.T) {
	m := unfurl.Parse([]byte(page), "https://example.com/article")

	if m.Image != "https://example.com/img/cover.png" {
		t.Fatalf("Image = %q", m.Image)
	}
	if m.Favicon != "https://example.com/favicon.ico" {
		t.Fatalf("Favicon = %q", m.Favicon)
	}
}

func TestFallsBackToTitleTagAndDefaultFavicon(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><head><title>Only Title</title></head></html>`), "https://example.com/x")

	if m.Title != "Only Title" {
		t.Fatalf("Title = %q", m.Title)
	}
	if m.Favicon != "https://example.com/favicon.ico" {
		t.Fatalf("Favicon = %q", m.Favicon)
	}
}

func TestReturnsDomainOnlyForAPageWithNoMetadata(t *testing.T) {
	m := unfurl.Parse([]byte(`<html><body>nothing</body></html>`), "https://example.com/x")

	if m.Title != "" {
		t.Fatalf("Title = %q, want empty", m.Title)
	}
	if m.Domain != "example.com" {
		t.Fatalf("Domain = %q", m.Domain)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/unfurl/
```

Expected: build failure — package `unfurl` does not exist.

- [ ] **Step 3: Implement**

```bash
cd packages/server && go get golang.org/x/net/html@latest
```

`packages/server/internal/unfurl/parse.go`:

```go
package unfurl

import (
	"bytes"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

type Meta struct {
	Title       string
	Description string
	Image       string
	Favicon     string
	Domain      string
}

// Parse extracts preview metadata. It never performs I/O, so it is safe to run
// on any bytes the guard returned. Preference order per key is OpenGraph,
// then Twitter cards, then the plain HTML element.
func Parse(page []byte, finalURL string) Meta {
	base, _ := url.Parse(finalURL)

	var (
		meta      = Meta{}
		titleTag  string
		ogTitle   string
		twTitle   string
		ogDesc    string
		twDesc    string
		plainDesc string
		iconHref  string
	)

	doc, err := html.Parse(bytes.NewReader(page))
	if err == nil {
		var walk func(*html.Node)
		walk = func(n *html.Node) {
			if n.Type == html.ElementNode {
				switch n.Data {
				case "title":
					if n.FirstChild != nil && titleTag == "" {
						titleTag = strings.TrimSpace(n.FirstChild.Data)
					}
				case "meta":
					property, name, content := attr(n, "property"), attr(n, "name"), attr(n, "content")
					switch {
					case property == "og:title":
						ogTitle = content
					case name == "twitter:title":
						twTitle = content
					case property == "og:description":
						ogDesc = content
					case name == "twitter:description":
						twDesc = content
					case name == "description":
						plainDesc = content
					case property == "og:image" && meta.Image == "":
						meta.Image = content
					case name == "twitter:image" && meta.Image == "":
						meta.Image = content
					}
				case "link":
					if iconHref == "" && strings.Contains(attr(n, "rel"), "icon") {
						iconHref = attr(n, "href")
					}
				}
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
		walk(doc)
	}

	meta.Title = firstNonEmpty(ogTitle, twTitle, titleTag)
	meta.Description = firstNonEmpty(ogDesc, twDesc, plainDesc)

	if base != nil {
		meta.Domain = strings.TrimPrefix(base.Hostname(), "www.")
		meta.Image = absolute(base, meta.Image)

		if iconHref == "" {
			iconHref = "/favicon.ico"
		}
		meta.Favicon = absolute(base, iconHref)
	}

	return meta
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return strings.TrimSpace(a.Val)
		}
	}

	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}

	return ""
}

func absolute(base *url.URL, ref string) string {
	if ref == "" {
		return ""
	}
	parsed, err := url.Parse(ref)
	if err != nil {
		return ""
	}

	return base.ResolveReference(parsed).String()
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./internal/unfurl/ -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): parse OpenGraph and Twitter-card metadata"
```

---

### Task 4: `GET /unfurl`

**Files:**
- Create: `packages/server/internal/httpapi/unfurl.go`
- Modify: `packages/server/internal/httpapi/router.go`
- Test: `packages/server/internal/httpapi/unfurl_test.go`

**Interfaces:**
- Consumes: `fetchguard.Client.Get`, `unfurl.Parse`.
- Produces: `Options.Fetcher fetchguard.Getter`, where

```go
type Getter interface {
	Get(ctx context.Context, rawURL string) (*fetchguard.Response, error)
}
```

Declaring the interface (in `fetchguard`) is what lets the HTTP tests substitute a stub without reaching the network.

- [ ] **Step 1: Write the failing test**

`packages/server/internal/httpapi/unfurl_test.go`:

```go
package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

type stubFetcher struct {
	resp *fetchguard.Response
	err  error
}

func (s stubFetcher) Get(context.Context, string) (*fetchguard.Response, error) {
	return s.resp, s.err
}

// The response shape is fixed by src/tools/link/metadata-fetcher.ts. Note that
// `image` is an OBJECT, not a string — changing it breaks every consumer.
func TestUnfurlReturnsTheShapeTheClientParses(t *testing.T) {
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{resp: &fetchguard.Response{
		Body:     []byte(`<html><head><meta property="og:title" content="T"><meta name="description" content="D"><meta property="og:image" content="https://example.com/i.png"></head></html>`),
		FinalURL: "https://example.com/a",
	}}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com%2Fa", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var body struct {
		Success int    `json:"success"`
		Link    string `json:"link"`
		Meta    struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Image       struct {
				URL string `json:"url"`
			} `json:"image"`
			Domain string `json:"domain"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Success != 1 || body.Link != "https://example.com/a" {
		t.Fatalf("body = %+v", body)
	}
	if body.Meta.Title != "T" || body.Meta.Description != "D" {
		t.Fatalf("meta = %+v", body.Meta)
	}
	if body.Meta.Image.URL != "https://example.com/i.png" {
		t.Fatalf("image = %q", body.Meta.Image.URL)
	}
	if body.Meta.Domain != "example.com" {
		t.Fatalf("domain = %q", body.Meta.Domain)
	}
}

// A blocked or unreachable target is NOT a server error: the service is healthy,
// the target simply yielded nothing. 200 + success:0 lets the client tell this
// apart from "the service is down" and degrade to a plain link.
func TestUnfurlReportsFailureAsSuccessZero(t *testing.T) {
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{err: fetchguard.ErrBlockedAddress}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl?url=http%3A%2F%2F10.0.0.1%2F", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Success int `json:"success"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.Success != 0 {
		t.Fatalf("success = %d, want 0", body.Success)
	}
}

func TestUnfurlRejectsAMissingURLParameter(t *testing.T) {
	h := httpapi.New(httpapi.Options{Fetcher: stubFetcher{err: errors.New("must not be called")}})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/unfurl", nil))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/httpapi/ -run Unfurl
```

Expected: compile error — `Options` has no field `Fetcher`.

- [ ] **Step 3: Implement**

Add to `packages/server/internal/fetchguard/client.go`:

```go
// Getter is the seam the HTTP layer depends on, so handlers can be tested
// without a network. *Client is the only production implementation.
type Getter interface {
	Get(ctx context.Context, rawURL string) (*Response, error)
}
```

`packages/server/internal/httpapi/unfurl.go`:

```go
package httpapi

import (
	"net/http"

	"github.com/JackUait/blok/packages/server/internal/unfurl"
)

type unfurlImage struct {
	URL string `json:"url,omitempty"`
}

type unfurlMeta struct {
	Title       string      `json:"title,omitempty"`
	Description string      `json:"description,omitempty"`
	Image       unfurlImage `json:"image"`
	Favicon     string      `json:"favicon,omitempty"`
	Domain      string      `json:"domain,omitempty"`
}

type unfurlResponse struct {
	Success int         `json:"success"`
	Link    string      `json:"link,omitempty"`
	Meta    *unfurlMeta `json:"meta,omitempty"`
}

func (s *server) handleUnfurl(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		writeJSON(w, http.StatusBadRequest, unfurlResponse{Success: 0})

		return
	}

	resp, err := s.opts.Fetcher.Get(r.Context(), target)
	if err != nil {
		// Deliberately opaque: the caller learns nothing about why an address
		// was refused, which would otherwise make this a network scanner.
		writeJSON(w, http.StatusOK, unfurlResponse{Success: 0})

		return
	}

	m := unfurl.Parse(resp.Body, resp.FinalURL)

	writeJSON(w, http.StatusOK, unfurlResponse{
		Success: 1,
		Link:    resp.FinalURL,
		Meta: &unfurlMeta{
			Title:       m.Title,
			Description: m.Description,
			Image:       unfurlImage{URL: m.Image},
			Favicon:     m.Favicon,
			Domain:      m.Domain,
		},
	})
}
```

In `router.go`, add the field and the route:

```go
type Options struct {
	Version string
	Fetcher fetchguard.Getter
}
```

```go
	s.mux.HandleFunc("GET /unfurl", s.handleUnfurl)
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): serve GET /unfurl in the shape the client already parses"
```

---

### Task 5: Config and the startup interlocks

**Files:**
- Create: `packages/server/internal/config/config.go`
- Modify: `packages/server/cmd/blok-server/main.go`
- Test: `packages/server/internal/config/config_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.Validate(c config.Config) error`, `type AuthMode string` with `AuthNone`, `AuthProxy`, `AuthTicket`, and (the `UnfurlDisabled` field is the spec's emergency lever)

```go
type Config struct {
	Listen        string
	Auth          AuthMode
	Secret        string
	AllowedOrigins []string
	StorageDir    string
}
```

- [ ] **Step 1: Write the failing test**

`packages/server/internal/config/config_test.go`:

```go
package config_test

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
)

// The interlock that makes "forgot to turn dev mode off" impossible.
func TestAuthNoneRefusesANonLoopbackBind(t *testing.T) {
	err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthNone})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--auth none") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

func TestAuthNoneAllowsLoopback(t *testing.T) {
	for _, listen := range []string{"127.0.0.1:4000", "localhost:4000", "[::1]:4000"} {
		if err := config.Validate(config.Config{Listen: listen, Auth: config.AuthNone}); err != nil {
			t.Fatalf("%s: err = %v, want nil", listen, err)
		}
	}
}

func TestProxyModeRefusesANonLoopbackBind(t *testing.T) {
	if err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthProxy}); err == nil {
		t.Fatal("err = nil, want a refusal")
	}
}

// A public service with no origin allowlist is a free scanning proxy.
func TestTicketModeRefusesAnEmptyOriginAllowlist(t *testing.T) {
	err := config.Validate(config.Config{Listen: "0.0.0.0:4000", Auth: config.AuthTicket, Secret: "s3cret-value-at-least-32-chars-long!"})
	if err == nil {
		t.Fatal("err = nil, want a refusal")
	}
	if !strings.Contains(err.Error(), "--allow-origin") {
		t.Fatalf("err = %q, want it to name the flag", err)
	}
}

func TestTicketModeRefusesAShortSecret(t *testing.T) {
	if err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket, Secret: "short",
		AllowedOrigins: []string{"https://app.example.com"},
	}); err == nil {
		t.Fatal("err = nil, want a refusal")
	}
}

// The emergency lever the spec promises: previews can be switched off by
// configuration, with no release, if a bypass is reported.
func TestUnfurlCanBeDisabled(t *testing.T) {
	c := config.Config{Listen: "127.0.0.1:4000", Auth: config.AuthNone, UnfurlDisabled: true}
	if err := config.Validate(c); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if !c.UnfurlDisabled {
		t.Fatal("UnfurlDisabled did not survive validation")
	}
}

func TestTicketModeAcceptsAFullConfiguration(t *testing.T) {
	if err := config.Validate(config.Config{
		Listen: "0.0.0.0:4000", Auth: config.AuthTicket,
		Secret:         "s3cret-value-at-least-32-chars-long!",
		AllowedOrigins: []string{"https://app.example.com"},
	}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/config/
```

Expected: build failure — package `config` does not exist.

- [ ] **Step 3: Implement**

`packages/server/internal/config/config.go`:

```go
package config

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

type AuthMode string

const (
	AuthNone   AuthMode = "none"
	AuthProxy  AuthMode = "proxy"
	AuthTicket AuthMode = "ticket"
)

// minSecretLen is a floor, not a policy: a 32-byte secret makes an HMAC forgery
// attempt hopeless, and a shorter one usually means someone typed a password.
const minSecretLen = 32

type Config struct {
	Listen         string
	Auth           AuthMode
	Secret         string
	AllowedOrigins []string
	StorageDir     string

	// UnfurlDisabled turns off link previews without a release. This is the
	// emergency lever for a reported filter bypass: flip it, restart, ship the
	// fix on a normal schedule.
	UnfurlDisabled bool
}

// Validate refuses to let the process start in a configuration that would be
// unsafe. These are interlocks, not warnings: every one of them describes a
// mistake that silently exposes the consumer rather than failing loudly.
func Validate(c Config) error {
	switch c.Auth {
	case AuthNone:
		if !isLoopback(c.Listen) {
			return fmt.Errorf("--auth none serves anyone who can reach %s; it may only bind loopback. Use --auth ticket to expose this service", c.Listen)
		}
	case AuthProxy:
		if !isLoopback(c.Listen) {
			return fmt.Errorf("--auth proxy trusts every caller, so it may only bind loopback, not %s", c.Listen)
		}
	case AuthTicket:
		if len(c.Secret) < minSecretLen {
			return fmt.Errorf("--secret must be at least %d characters", minSecretLen)
		}
		if len(c.AllowedOrigins) == 0 {
			return errors.New("a public service needs --allow-origin: without it anyone who finds this address can drive requests at third-party sites from your IP")
		}
	default:
		return fmt.Errorf("--auth must be none, proxy, or ticket (got %q)", c.Auth)
	}

	return nil
}

func isLoopback(listen string) bool {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		host = listen
	}
	host = strings.Trim(host, "[]")

	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)

	return ip != nil && ip.IsLoopback()
}
```

Then wire the flags in `cmd/blok-server/main.go`, replacing the body of `main`:

```go
func main() {
	var (
		listen  = flag.String("listen", "127.0.0.1:4000", "address to listen on")
		auth    = flag.String("auth", "none", "access mode: none, proxy, or ticket")
		secret  = flag.String("secret", "", "shared secret for --auth ticket")
		origins = flag.String("allow-origin", "", "comma-separated origins allowed to call this service")
		storage = flag.String("storage-dir", "./blok-uploads", "directory for uploaded files")
		noUnfurl = flag.Bool("no-unfurl", false, "disable link previews entirely")
	)
	flag.Parse()

	cfg := config.Config{
		Listen:     *listen,
		Auth:       config.AuthMode(*auth),
		Secret:         *secret,
		StorageDir:     *storage,
		UnfurlDisabled: *noUnfurl,
	}
	if *origins != "" {
		cfg.AllowedOrigins = strings.Split(*origins, ",")
	}

	if err := config.Validate(cfg); err != nil {
		log.Fatalf("blok-server refused to start: %v", err)
	}
	...
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Verify the interlock by hand**

```bash
cd packages/server && go run ./cmd/blok-server --listen 0.0.0.0:4000 --auth none
```

Expected: exits non-zero with the message naming `--auth none`.

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): refuse to start in configurations that would expose the consumer"
```

---

### Task 6: Pass verification

**Files:**
- Create: `packages/server/internal/ticket/verify.go`
- Test: `packages/server/internal/ticket/verify_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `ticket.Verify(secret, token string, now time.Time) (ticket.Claims, error)` with

```go
type Claims struct {
	User  string `json:"user"`
	Doc   string `json:"doc,omitempty"`
	Write bool   `json:"write"`
	Exp   int64  `json:"exp"`
}
```

and `ticket.Sign(secret string, c Claims) (string, error)` — used by tests here and by the Go integration tests in Task 8; the JS minting helper lands in the client plan.

- [ ] **Step 1: Write the failing test**

`packages/server/internal/ticket/verify_test.go`:

```go
package ticket_test

import (
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/ticket"
)

const secret = "s3cret-value-at-least-32-chars-long!"

func TestRoundTrip(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, err := ticket.Sign(secret, ticket.Claims{User: "u1", Doc: "doc-42", Write: true, Exp: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	claims, err := ticket.Verify(secret, token, now)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.User != "u1" || claims.Doc != "doc-42" || !claims.Write {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestRejectsATamperedPayload(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	parts := strings.Split(token, ".")
	parts[1] = "eyJ1c2VyIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9" // {"user":"admin","exp":9999999999}

	if _, err := ticket.Verify(secret, strings.Join(parts, "."), now); err == nil {
		t.Fatal("err = nil, want a signature failure")
	}
}

func TestRejectsAWrongSecret(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	if _, err := ticket.Verify("another-secret-that-is-long-enough!!", token, now); err == nil {
		t.Fatal("err = nil, want a signature failure")
	}
}

func TestRejectsAnExpiredPass(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(-time.Second).Unix()})

	if _, err := ticket.Verify(secret, token, now); err == nil {
		t.Fatal("err = nil, want an expiry failure")
	}
}

// "alg": "none" is the oldest JWT hole there is. It must not be honoured.
func TestRejectsTheNoneAlgorithm(t *testing.T) {
	// {"alg":"none","typ":"JWT"} . {"user":"admin","exp":9999999999} . (empty)
	token := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9." // gitleaks:allow

	if _, err := ticket.Verify(secret, token, time.Unix(1_700_000_000, 0)); err == nil {
		t.Fatal("err = nil, want a rejection")
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/ticket/
```

Expected: build failure — package `ticket` does not exist.

- [ ] **Step 3: Implement**

Written against the stdlib rather than a JWT library: the accepted algorithm set is exactly one, which removes the whole family of algorithm-confusion holes by construction.

`packages/server/internal/ticket/verify.go`:

```go
package ticket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrMalformed = errors.New("ticket: malformed")
	ErrSignature = errors.New("ticket: signature does not match")
	ErrExpired   = errors.New("ticket: expired")
)

type Claims struct {
	User  string `json:"user"`
	Doc   string `json:"doc,omitempty"`
	Write bool   `json:"write"`
	Exp   int64  `json:"exp"`
}

// header is fixed, not parsed. Accepting an algorithm from the token is how
// "alg": "none" forgeries succeed; there is exactly one algorithm here.
const header = `{"alg":"HS256","typ":"JWT"}`

var enc = base64.RawURLEncoding

func Sign(secret string, c Claims) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signing := enc.EncodeToString([]byte(header)) + "." + enc.EncodeToString(payload)

	return signing + "." + enc.EncodeToString(mac(secret, signing)), nil
}

func Verify(secret, token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrMalformed
	}
	if parts[0] != enc.EncodeToString([]byte(header)) {
		return Claims{}, ErrSignature
	}

	sig, err := enc.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	if !hmac.Equal(sig, mac(secret, parts[0]+"."+parts[1])) {
		return Claims{}, ErrSignature
	}

	raw, err := enc.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return Claims{}, ErrMalformed
	}
	if claims.Exp <= now.Unix() {
		return Claims{}, ErrExpired
	}

	return claims, nil
}

func mac(secret, signing string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(signing))

	return h.Sum(nil)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./internal/ticket/ -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): verify access passes with a single fixed algorithm"
```

---

### Task 7: Middleware — origin allowlist, rate limit, auth

**Files:**
- Create: `packages/server/internal/httpapi/middleware.go`
- Modify: `packages/server/internal/httpapi/router.go`
- Test: `packages/server/internal/httpapi/middleware_test.go`

**Interfaces:**
- Consumes: `ticket.Verify`, `config.AuthMode`.
- Produces: `Options` gains `Auth config.AuthMode`, `Secret string`, `AllowedOrigins []string`, `RateLimitPerMinute int`, `Now func() time.Time`. `Now` defaults to `time.Now` and exists so the rate-limit test does not sleep.

- [ ] **Step 1: Write the failing test**

`packages/server/internal/httpapi/middleware_test.go`:

```go
package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
	"github.com/JackUait/blok/packages/server/internal/ticket"
)

const testSecret = "s3cret-value-at-least-32-chars-long!"

func ticketServer(t *testing.T, now time.Time) http.Handler {
	t.Helper()

	return httpapi.New(httpapi.Options{
		Auth:               config.AuthTicket,
		Secret:             testSecret,
		AllowedOrigins:     []string{"https://app.example.com"},
		RateLimitPerMinute: 2,
		Now:                func() time.Time { return now },
		Fetcher:            stubFetcher{resp: &fetchguard.Response{Body: []byte("<html></html>"), FinalURL: "https://example.com/a"}},
	})
}

func unfurlRequest(origin, token string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/unfurl?url=https%3A%2F%2Fexample.com%2Fa", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}

	return r
}

func TestRejectsAnOriginOutsideTheAllowlist(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, unfurlRequest("https://evil.example.net", token))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRejectsAMissingPass(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, unfurlRequest("https://app.example.com", ""))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestAcceptsAValidPassFromAnAllowedOrigin(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, unfurlRequest("https://app.example.com", token))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestRateLimitsPerMinute(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})
	h := ticketServer(t, now)

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, unfurlRequest("https://app.example.com", token))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unfurlRequest("https://app.example.com", token))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
}

// /health must answer without a pass, or every readiness probe fails.
func TestHealthIsNotGated(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/httpapi/ -run 'Rejects|Accepts|RateLimit|HealthIsNot'
```

Expected: compile error — `Options` has no field `Auth`.

- [ ] **Step 3: Implement**

`packages/server/internal/httpapi/middleware.go`:

```go
package httpapi

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/ticket"
)

// rateLimiter is a fixed-window counter keyed by client. A window is coarse but
// sufficient: the goal is to stop this service being used as a scanner, not to
// shape traffic.
type rateLimiter struct {
	mu      sync.Mutex
	perMin  int
	windows map[string]*window
	now     func() time.Time
}

type window struct {
	start time.Time
	count int
}

func newRateLimiter(perMin int, now func() time.Time) *rateLimiter {
	return &rateLimiter{perMin: perMin, windows: map[string]*window{}, now: now}
}

func (l *rateLimiter) allow(key string) bool {
	if l.perMin <= 0 {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) >= time.Minute {
		l.windows[key] = &window{start: now, count: 1}

		return true
	}
	if w.count >= l.perMin {
		return false
	}
	w.count++

	return true
}

func (s *server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.opts.Auth == config.AuthTicket {
			origin := r.Header.Get("Origin")
			if !allowed(origin, s.opts.AllowedOrigins) {
				http.Error(w, "origin not allowed", http.StatusForbidden)

				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)

			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if token == "" {
				http.Error(w, "missing pass", http.StatusUnauthorized)

				return
			}
			if _, err := ticket.Verify(s.opts.Secret, token, s.opts.Now()); err != nil {
				http.Error(w, "invalid pass", http.StatusUnauthorized)

				return
			}
		}

		if !s.limiter.allow(clientKey(r)) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)

			return
		}

		next(w, r)
	}
}

func allowed(origin string, allowlist []string) bool {
	for _, candidate := range allowlist {
		if strings.EqualFold(strings.TrimSpace(candidate), origin) {
			return true
		}
	}

	return false
}

// clientKey buckets by source address. strings.Cut returns
// (before, after, found), so a bare address with no port falls through intact.
func clientKey(r *http.Request) string {
	host, _, found := strings.Cut(r.RemoteAddr, ":")
	if found {
		return host
	}

	return r.RemoteAddr
}
```

In `router.go`, extend `Options`, build the limiter, default `Now`, and wrap only the non-health routes:

```go
type Options struct {
	Version            string
	Fetcher            fetchguard.Getter
	Auth               config.AuthMode
	Secret             string
	AllowedOrigins     []string
	RateLimitPerMinute int
	Now                func() time.Time
}

func New(opts Options) http.Handler {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	s := &server{opts: opts, mux: http.NewServeMux(), limiter: newRateLimiter(opts.RateLimitPerMinute, opts.Now)}

	s.mux.HandleFunc("GET /health", s.handleHealth) // never gated: readiness probes
	if !s.opts.UnfurlDisabled {
		s.mux.HandleFunc("GET /unfurl", s.guard(s.handleUnfurl))
	}

	return s
}
```

`Options` gains `UnfurlDisabled bool`, set from the config in `main.go`. When it is
true the route is never registered, so a disabled service answers 404 rather than
running any part of the fetch path.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): gate routes by origin, pass, and rate limit"
```

---

### Task 8: Uploads — `BlobStore`, local driver, `POST /upload`

**Files:**
- Create: `packages/server/internal/blobstore/blobstore.go`, `packages/server/internal/blobstore/localdir.go`, `packages/server/internal/httpapi/upload.go`
- Modify: `packages/server/internal/httpapi/router.go`, `packages/server/cmd/blok-server/main.go`
- Test: `packages/server/internal/blobstore/localdir_test.go`, `packages/server/internal/httpapi/upload_test.go`

**Interfaces:**
- Consumes: the middleware from Task 7.
- Produces:

```go
type BlobStore interface {
	Put(ctx context.Context, name string, mimeType string, r io.Reader) (url string, err error)
	Delete(ctx context.Context, url string) error
}
```

`Options` gains `Store blobstore.BlobStore` and `MaxUploadBytes int64`.

- [ ] **Step 1: Write the failing tests**

`packages/server/internal/blobstore/localdir_test.go`:

```go
package blobstore_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/blobstore"
)

func TestLocalDirStoresAndReturnsAPublicURL(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if !strings.HasPrefix(url, "https://cdn.example.com/files/") {
		t.Fatalf("url = %q", url)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("wrote %d files, want 1", len(entries))
	}
	got, _ := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if string(got) != "bytes" {
		t.Fatalf("contents = %q", got)
	}
}

// A filename is attacker-controlled. It must never steer the write.
func TestLocalDirIgnoresPathsInTheSuppliedName(t *testing.T) {
	dir := t.TempDir()
	store := blobstore.NewLocalDir(dir, "https://cdn.example.com/files")

	if _, err := store.Put(context.Background(), "../../etc/passwd", "text/plain", strings.NewReader("x")); err != nil {
		t.Fatalf("put: %v", err)
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("wrote %d files into the target dir, want 1", len(entries))
	}
	if strings.Contains(entries[0].Name(), "..") || strings.Contains(entries[0].Name(), "/") {
		t.Fatalf("stored name = %q", entries[0].Name())
	}
}
```

`packages/server/internal/httpapi/upload_test.go`:

```go
package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

type stubStore struct{ lastName, lastMime string }

func (s *stubStore) Put(_ context.Context, name, mime string, r io.Reader) (string, error) {
	s.lastName, s.lastMime = name, mime
	_, _ = io.Copy(io.Discard, r)

	return "https://cdn.example.com/files/abc.png", nil
}

func (s *stubStore) Delete(context.Context, string) error { return nil }

// The response shape is fixed by src/tools/file/uploader.ts parseResponse.
func TestUploadReturnsTheShapeTheClientParses(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: store, MaxUploadBytes: 1 << 20})

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = part.Write([]byte("bytes"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got struct {
		URL      string `json:"url"`
		FileName string `json:"fileName"`
		Size     int64  `json:"size"`
		MimeType string `json:"mimeType"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.URL != "https://cdn.example.com/files/abc.png" {
		t.Fatalf("url = %q", got.URL)
	}
	if got.FileName != "photo.png" || got.Size != 5 {
		t.Fatalf("got = %+v", got)
	}
	if store.lastName != "photo.png" {
		t.Fatalf("store received name %q", store.lastName)
	}
}

func TestUploadRejectsABodyOverTheCap(t *testing.T) {
	h := httpapi.New(httpapi.Options{Auth: config.AuthProxy, Store: &stubStore{}, MaxUploadBytes: 8})

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, _ := mw.CreateFormFile("file", "big.bin")
	_, _ = part.Write(bytes.Repeat([]byte("x"), 1024))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
}
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd packages/server && go test ./internal/blobstore/ ./internal/httpapi/ -run 'LocalDir|Upload'
```

Expected: build failures — package `blobstore` does not exist; `Options` has no field `Store`.

- [ ] **Step 3: Implement**

`packages/server/internal/blobstore/blobstore.go`:

```go
package blobstore

import (
	"context"
	"io"
)

// BlobStore is where uploaded bytes go. The consumer chooses the destination;
// this service only hands bytes over. Implementations must treat `name` as
// untrusted — it comes from the browser.
type BlobStore interface {
	Put(ctx context.Context, name string, mimeType string, r io.Reader) (string, error)
	Delete(ctx context.Context, url string) error
}
```

`packages/server/internal/blobstore/localdir.go`:

```go
package blobstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type LocalDir struct {
	dir       string
	publicURL string
}

func NewLocalDir(dir, publicURL string) *LocalDir {
	return &LocalDir{dir: dir, publicURL: strings.TrimRight(publicURL, "/")}
}

func (l *LocalDir) Put(_ context.Context, name, _ string, r io.Reader) (string, error) {
	if err := os.MkdirAll(l.dir, 0o755); err != nil {
		return "", err
	}

	// The stored name is generated, never derived from the supplied one: only
	// the extension is carried across, and only after stripping any path.
	ext := filepath.Ext(filepath.Base(filepath.FromSlash(name)))
	if strings.ContainsAny(ext, `/\.`+"\x00") && ext != filepath.Ext(ext) {
		ext = ""
	}

	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	stored := hex.EncodeToString(buf) + ext

	f, err := os.Create(filepath.Join(l.dir, stored))
	if err != nil {
		return "", err
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return "", err
	}

	return l.publicURL + "/" + stored, nil
}

func (l *LocalDir) Delete(_ context.Context, url string) error {
	stored := path.Base(url)
	if stored == "." || stored == "/" || strings.Contains(stored, "..") {
		return nil
	}

	return os.Remove(filepath.Join(l.dir, stored))
}
```

`packages/server/internal/httpapi/upload.go`:

```go
package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
)

type uploadResponse struct {
	URL      string `json:"url"`
	FileName string `json:"fileName,omitempty"`
	Size     int64  `json:"size,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.opts.MaxUploadBytes)

	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "file too large", http.StatusRequestEntityTooLarge)

			return
		}
		http.Error(w, "malformed upload", http.StatusBadRequest)

		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file field", http.StatusBadRequest)

		return
	}
	defer file.Close()

	name := filepath.Base(header.Filename)
	mime := header.Header.Get("Content-Type")

	url, err := s.opts.Store.Put(r.Context(), name, mime, file)
	if err != nil {
		http.Error(w, "upload failed", http.StatusBadGateway)

		return
	}

	writeJSON(w, http.StatusOK, uploadResponse{URL: url, FileName: name, Size: header.Size, MimeType: mime})
}
```

Add to `Options`: `Store blobstore.BlobStore` and `MaxUploadBytes int64`; register `s.mux.HandleFunc("POST /upload", s.guard(s.handleUpload))`. In `main.go`, construct `blobstore.NewLocalDir(cfg.StorageDir, publicURL)` where `publicURL` comes from a new `--public-url` flag defaulting to `http://` + the listen address + `/files`, and serve that prefix with `http.FileServer` so a local-directory deployment works without a separate web server.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): accept uploads through a BYO blob store"
```

---

### Task 9: `POST /upload-by-url` through the same guard

This route fetches a consumer-supplied URL. It is the same SSRF sink as `/unfurl` and must use the same client — that is the point of the task.

**Files:**
- Modify: `packages/server/internal/httpapi/upload.go`, `packages/server/internal/httpapi/router.go`
- Test: `packages/server/internal/httpapi/upload_by_url_test.go`
- Create: `packages/server/internal/httpapi/outbound_law_test.go`

**Interfaces:**
- Consumes: `fetchguard.Getter`, `blobstore.BlobStore`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

`packages/server/internal/httpapi/upload_by_url_test.go`:

```go
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

func TestUploadByURLReHostsThroughTheStore(t *testing.T) {
	store := &stubStore{}
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Store:   store,
		Fetcher: stubFetcher{resp: &fetchguard.Response{Body: []byte("imagebytes"), ContentType: "image/png", FinalURL: "https://example.com/i.png"}},
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(`{"url":"https://example.com/i.png"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got struct {
		URL      string `json:"url"`
		MimeType string `json:"mimeType"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got.URL != "https://cdn.example.com/files/abc.png" {
		t.Fatalf("url = %q", got.URL)
	}
	if store.lastMime != "image/png" {
		t.Fatalf("store received mime %q", store.lastMime)
	}
}

// The whole reason this task exists: a blocked address must be refused here
// exactly as it is on /unfurl, not quietly re-hosted.
func TestUploadByURLRefusesABlockedAddress(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:    config.AuthProxy,
		Store:   &stubStore{},
		Fetcher: stubFetcher{err: fetchguard.ErrBlockedAddress},
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(`{"url":"http://169.254.169.254/"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
```

`packages/server/internal/httpapi/outbound_law_test.go` — a static check that keeps the law true as the service grows:

```go
package httpapi_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// LAW: every server-side fetch of a consumer-supplied URL goes through
// internal/fetchguard. Constructing an http.Client anywhere else silently
// reopens the SSRF hole, so the package tree is scanned for it.
func TestNoOtherPackageConstructsAnHTTPClient(t *testing.T) {
	root := filepath.Join("..", "..", "internal")

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		if strings.Contains(filepath.ToSlash(path), "internal/fetchguard/") || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, banned := range []string{"http.Client{", "http.DefaultClient", "http.Get(", "http.Post("} {
			if strings.Contains(string(src), banned) {
				t.Errorf("%s uses %s — every outbound fetch must go through internal/fetchguard", path, banned)
			}
		}

		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
}
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd packages/server && go test ./internal/httpapi/ -run 'UploadByURL|NoOtherPackage'
```

Expected: 404 from the router for the two route tests; the law test passes already and must keep passing.

- [ ] **Step 3: Implement**

Append to `packages/server/internal/httpapi/upload.go`:

```go
func (s *server) handleUploadByURL(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&payload); err != nil || payload.URL == "" {
		http.Error(w, "expected {\"url\": \"...\"}", http.StatusBadRequest)

		return
	}

	// Same guarded client as /unfurl. There is no second path.
	resp, err := s.opts.Fetcher.Get(r.Context(), payload.URL)
	if err != nil {
		http.Error(w, "the URL could not be fetched", http.StatusBadRequest)

		return
	}

	name := path.Base(resp.FinalURL)
	url, err := s.opts.Store.Put(r.Context(), name, resp.ContentType, bytes.NewReader(resp.Body))
	if err != nil {
		http.Error(w, "upload failed", http.StatusBadGateway)

		return
	}

	writeJSON(w, http.StatusOK, uploadResponse{
		URL:      url,
		FileName: name,
		Size:     int64(len(resp.Body)),
		MimeType: resp.ContentType,
	})
}
```

Add the imports `bytes`, `encoding/json`, `io`, `path`, and register:

```go
	s.mux.HandleFunc("POST /upload-by-url", s.guard(s.handleUploadByURL))
```

**Sizing note:** `fetchguard.Config.MaxBytes` currently bounds an HTML page. Wire `/upload-by-url` to a second guard instance built with `MaxBytes: MaxUploadBytes` so re-hosting a real image is not truncated. Add `Options.MediaFetcher fetchguard.Getter`, defaulting to `Fetcher` when nil, and use it in this handler only.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): re-host by URL through the same guarded client"
```

---

### Task 10: S3-compatible driver

**Files:**
- Create: `packages/server/internal/blobstore/s3.go`
- Modify: `packages/server/cmd/blok-server/main.go`
- Test: `packages/server/internal/blobstore/s3_test.go`

**Interfaces:**
- Consumes: `BlobStore`.
- Produces: `blobstore.NewS3(cfg blobstore.S3Config) *blobstore.S3` with

```go
type S3Config struct {
	Endpoint  string // e.g. https://s3.eu-central-1.amazonaws.com or an R2/MinIO endpoint
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	PublicURL string
}
```

Signing is SigV4 written against the stdlib — the service takes no AWS SDK dependency, which keeps the binary small and the dependency surface auditable.

- [ ] **Step 1: Write the failing test**

`packages/server/internal/blobstore/s3_test.go`:

```go
package blobstore_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/blobstore"
)

func TestS3PutsWithASignedRequestAndReturnsThePublicURL(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAuth   string
		gotBody   string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotMethod, gotPath, gotAuth, gotBody = r.Method, r.URL.Path, r.Header.Get("Authorization"), string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	store := blobstore.NewS3(blobstore.S3Config{
		Endpoint: srv.URL, Region: "us-east-1", Bucket: "media",
		AccessKey: "AKIA", SecretKey: "secret", PublicURL: "https://cdn.example.com",
	})

	url, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("bytes"))
	if err != nil {
		t.Fatalf("put: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Fatalf("method = %s, want PUT", gotMethod)
	}
	if !strings.HasPrefix(gotPath, "/media/") {
		t.Fatalf("path = %q, want it under the bucket", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "AWS4-HMAC-SHA256 Credential=AKIA/") {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody != "bytes" {
		t.Fatalf("body = %q", gotBody)
	}
	if !strings.HasPrefix(url, "https://cdn.example.com/") {
		t.Fatalf("url = %q", url)
	}
}

func TestS3ReportsAFailedPut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	store := blobstore.NewS3(blobstore.S3Config{
		Endpoint: srv.URL, Region: "us-east-1", Bucket: "media",
		AccessKey: "AKIA", SecretKey: "secret", PublicURL: "https://cdn.example.com",
	})

	if _, err := store.Put(context.Background(), "photo.png", "image/png", strings.NewReader("b")); err == nil {
		t.Fatal("err = nil, want a failure")
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd packages/server && go test ./internal/blobstore/ -run S3
```

Expected: build failure — `NewS3` is undefined.

- [ ] **Step 3: Implement**

`packages/server/internal/blobstore/s3.go`:

```go
package blobstore

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

type S3Config struct {
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	PublicURL string
}

type S3 struct {
	cfg S3Config
	// This client talks to the operator's OWN configured endpoint, never to a
	// consumer-supplied URL, so it is the one exemption from the fetchguard law.
	http *http.Client
	now  func() time.Time
}

func NewS3(cfg S3Config) *S3 {
	return &S3{cfg: cfg, http: &http.Client{Timeout: 60 * time.Second}, now: time.Now}
}

func (s *S3) Put(ctx context.Context, name, mimeType string, r io.Reader) (string, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}

	key, err := storedName(name)
	if err != nil {
		return "", err
	}

	resp, err := s.do(ctx, http.MethodPut, key, mimeType, body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("blobstore: s3 PUT returned %d", resp.StatusCode)
	}

	return strings.TrimRight(s.cfg.PublicURL, "/") + "/" + key, nil
}

func (s *S3) Delete(ctx context.Context, publicURL string) error {
	key := publicURL[strings.LastIndex(publicURL, "/")+1:]
	if key == "" || strings.Contains(key, "..") {
		return nil
	}

	resp, err := s.do(ctx, http.MethodDelete, key, "", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("blobstore: s3 DELETE returned %d", resp.StatusCode)
	}

	return nil
}

func (s *S3) do(ctx context.Context, method, key, mimeType string, body []byte) (*http.Response, error) {
	endpoint, err := url.Parse(s.cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	target := *endpoint
	target.Path = "/" + s.cfg.Bucket + "/" + key

	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if mimeType != "" {
		req.Header.Set("Content-Type", mimeType)
	}

	now := s.now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := hex.EncodeToString(sha256sum(body))

	req.Header.Set("Host", target.Host)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)

	// Signed headers are a fixed, sorted set. Keeping it fixed means the
	// canonical request cannot drift from what was actually sent.
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := strings.Join([]string{
		"host:" + target.Host,
		"x-amz-content-sha256:" + payloadHash,
		"x-amz-date:" + amzDate,
	}, "\n") + "\n"

	canonicalRequest := strings.Join([]string{
		method,
		target.EscapedPath(),
		"", // no query string
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := dateStamp + "/" + s.cfg.Region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hex.EncodeToString(sha256sum([]byte(canonicalRequest))),
	}, "\n")

	signingKey := hmacSHA256(
		hmacSHA256(
			hmacSHA256(
				hmacSHA256([]byte("AWS4"+s.cfg.SecretKey), []byte(dateStamp)),
				[]byte(s.cfg.Region)),
			[]byte("s3")),
		[]byte("aws4_request"))

	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.cfg.AccessKey, scope, signedHeaders, signature))

	return s.http.Do(req)
}

// storedName never derives the key from the supplied filename: only the
// extension survives, and only after any path is stripped.
func storedName(name string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}

	return hex.EncodeToString(buf) + filepath.Ext(filepath.Base(filepath.FromSlash(name))), nil
}

func sha256sum(b []byte) []byte {
	sum := sha256.Sum256(b)

	return sum[:]
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)

	return h.Sum(nil)
}
```

**Note on `\n` above:** those are real newline escapes in Go source — write them as
`"\n"` in the file, a single backslash followed by `n`.

Then add the one exemption to the outbound law from Task 9. In
`outbound_law_test.go`, skip `internal/blobstore/s3.go` with the reason stated in
the code, not merely in a list:

```go
		// The S3 driver talks to the operator's OWN configured endpoint, which is
		// never consumer-supplied, so it is not an SSRF sink. This is the only
		// exemption; adding another means re-reading fetchguard's package comment.
		if strings.HasSuffix(filepath.ToSlash(path), "internal/blobstore/s3.go") {
			return nil
		}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd packages/server && go test ./... && go vet ./...
```

- [ ] **Step 5: Wire the flags**

Add `--s3-endpoint`, `--s3-region`, `--s3-bucket`, `--s3-bucket-url` and read `BLOK_S3_ACCESS_KEY` / `BLOK_S3_SECRET_KEY` from the environment — never from flags, which land in process listings. When `--s3-bucket` is set, construct `NewS3`; otherwise `NewLocalDir`.

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): add an S3-compatible blob store without an AWS SDK"
```

---

### Task 11: Release train — goreleaser, GHCR, the npm wrapper

**Files:**
- Create: `.goreleaser.yaml`, `packages/server/Dockerfile`
- Modify: `packages/server/bin/blok-server.mjs`, `scripts/release.mjs:182-185`, `.github/workflows/ci.yml`
- Test: `test/unit/architecture/server-release-wiring.test.ts`

**Interfaces:**
- Consumes: the binary from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

The failure mode this guards is the one the design named: nothing auto-iterates workspaces, so a new package silently drops out of the release.

`test/unit/architecture/server-release-wiring.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('server release wiring', () => {
  it('bumps @bloklabs/server in lockstep with the family', () => {
    const release = readFileSync('scripts/release.mjs', 'utf-8');

    expect(release).toContain("'packages/server/package.json'");
  });

  it('keeps the server package on the family version', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
    const server = JSON.parse(readFileSync('packages/server/package.json', 'utf-8')) as { version: string };

    expect(server.version).toBe(root.version);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/architecture/server-release-wiring.test.ts
```

Expected: FAIL — `release.mjs` does not mention the server manifest.

- [ ] **Step 3: Register the package in the release script**

In `scripts/release.mjs`, add to `WORKSPACE_MANIFESTS`:

```js
  const WORKSPACE_MANIFESTS = [
    'packages/react/package.json',
    'packages/vue/package.json',
    'packages/angular/package.json',
    'packages/cli/package.json',
    'packages/server/package.json',
  ];
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
yarn test test/unit/architecture/server-release-wiring.test.ts
```

- [ ] **Step 5: Add the binary and image build**

`.goreleaser.yaml`:

```yaml
version: 2
project_name: blok-server
builds:
  - id: blok-server
    dir: packages/server
    main: ./cmd/blok-server
    binary: blok-server
    env: [CGO_ENABLED=0]
    goos: [darwin, linux, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{.Version}}
archives:
  - formats: [tar.gz]
    format_overrides:
      - goos: windows
        formats: [zip]
dockers:
  - image_templates:
      - "ghcr.io/jackuait/blok-server:{{ .Version }}"
      - "ghcr.io/jackuait/blok-server:latest"
    dockerfile: packages/server/Dockerfile
```

`packages/server/Dockerfile`:

```dockerfile
FROM gcr.io/distroless/static-debian12
COPY blok-server /blok-server
EXPOSE 4000
ENTRYPOINT ["/blok-server"]
```

- [ ] **Step 6: Implement the npm wrapper**

Replace `packages/server/bin/blok-server.mjs` with a script that resolves the binary for `process.platform`/`process.arch`, downloads it from the matching GitHub release into a cache directory on first run if absent, verifies it against the checksum file goreleaser publishes, then `spawnSync`s it with `process.argv.slice(2)` and exits with its status. On download failure, print the `docker run ghcr.io/jackuait/blok-server` command as the fallback — corporate networks that block the download still have a path.

- [ ] **Step 7: Add the release job**

In CI, add a `release-server` job that runs only on tag pushes, uses `goreleaser/goreleaser-action@v6`, and is skipped when `packages/server/` is unchanged — in that case re-tag the previous image digest instead of rebuilding.

- [ ] **Step 8: Commit**

```bash
git add .goreleaser.yaml packages/server scripts/release.mjs .github/workflows/ci.yml test/unit/architecture/server-release-wiring.test.ts
git commit -m "build(server): release the binary and image alongside the family"
```

---

### Task 12: Documentation

**Files:**
- Create: `docs/src/components/server/server-data.ts` (following the shape of `docs/src/components/tools/tools-data.ts`)
- Modify: the docs navigation/route table alongside the existing pages in `docs/src/pages/`
- Test: `docs/src/components/server/server-data.test.ts`

**Interfaces:**
- Consumes: the flags and routes from every previous task.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { serverPaths, serverCoverageNote } from './server-data';

describe('server docs data', () => {
  it('documents the three deployment paths as separate entries', () => {
    expect(serverPaths.map((p) => p.id)).toEqual(['own-storage', 'own-server', 'serverless']);
  });

  it('states the link-preview coverage limit up front', () => {
    expect(serverCoverageNote).toMatch(/70%/);
    expect(serverCoverageNote).toMatch(/plain link/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd docs && yarn test src/components/server/server-data.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the docs data and pages**

Three pages, one per path, in the spec's order — path 1 (`own-storage`, presets, no service) leads, because an extra service depresses adoption and the design says so explicitly. Each page carries: what to run, the one route to add in their app, the editor config, and the failure modes. `serverCoverageNote` states the ~70% link-preview limit and the plain-link degradation.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd docs && yarn test src/components/server/server-data.test.ts
```

- [ ] **Step 5: Write SECURITY.md**

The spec commits to deciding vulnerability response before shipping, not after the
first report. Create `SECURITY.md` at the repo root covering:

- where to report (a private channel — GitHub private vulnerability reporting on
  `JackUait/blok`, not a public issue)
- the response window we are actually willing to honour, stated as a number
- the emergency lever, named explicitly so a reporter and an operator see the same
  thing: `blok-server --no-unfurl` disables link previews immediately, with no
  release and no redeploy of the consumer's app
- the supported version line: only the current family version receives fixes

- [ ] **Step 6: Commit**

```bash
git add docs SECURITY.md
git commit -m "docs: document the deployment paths and the security contact"
```

---

## Not in this plan

Two sibling plans, each producing working software on its own:

- **Client presets** — `@bloklabs/presets` with `supabaseStorage`, `s3PresignedStorage`, `cloudinaryStorage` implementing the existing `BlokUploader` contract, plus `indexedDBUploader` for demos. Pure TypeScript, no service, no security surface. Path 1 of the design depends on it, and it is the first screen of the docs.
- **Editor wiring** — the `server` config option that replaces the uploader, bookmark endpoint, and save/load wiring in one key; the `blokTicket()` minting helper; and the bookmark tool's graceful degradation to a plain link (`src/tools/link/bookmark/index.ts` currently sets an in-memory `ERROR` state; per the spec it must render a plain link instead).

Both are written after this plan lands, so they can integration-test against a real binary.
