package httpapi_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
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
		Fetcher:            stubFetcher{resp: &fetchguard.Response{Body: []byte("<html></html>"), FinalURL: "https://example.com/a", StatusCode: http.StatusOK}},
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

// --- beyond the plan: the defects its middleware sketch carried ---

func preflightRequest(origin, requestedHeaders string) *http.Request {
	r := httptest.NewRequest(http.MethodOptions, "/unfurl", nil)
	r.Header.Set("Origin", origin)
	r.Header.Set("Access-Control-Request-Method", http.MethodGet)
	if requestedHeaders != "" {
		r.Header.Set("Access-Control-Request-Headers", requestedHeaders)
	}

	return r
}

// In ticket mode the browser sends Authorization, which makes the request
// non-simple and fires an OPTIONS preflight first. With no OPTIONS pattern
// registered, ServeMux answers 405 and the real request is never sent — so
// ticket mode, the only mode that needs a browser, would not work from one.
func TestAnswersTheCorsPreflightAheadOfTheRealRequest(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, preflightRequest("https://app.example.com", "authorization"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	h := rec.Header()
	if got := h.Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := h.Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodGet) {
		t.Fatalf("Access-Control-Allow-Methods = %q, want it to name GET", got)
	}
	if got := h.Get("Access-Control-Max-Age"); got == "" {
		t.Fatal("Access-Control-Max-Age is unset: every request would preflight again")
	}
	if !slices.Contains(h.Values("Vary"), "Origin") {
		t.Fatalf("Vary = %v, want it to contain Origin", h.Values("Vary"))
	}
}

// A preflight carries no pass — the browser strips Authorization from it — so
// it must be answered without one. Gating it behind the pass fails every
// ticket-mode request before the real one is ever sent.
func TestAnswersThePreflightWithoutAPass(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, preflightRequest("https://app.example.com", ""))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
}

func TestRefusesAPreflightFromAnOriginOutsideTheAllowlist(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, preflightRequest("https://evil.example.net", "authorization"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want none for a refused origin", got)
	}
}

// BookmarkConfig.headers in src/tools/link/metadata-fetcher.ts lets a consumer
// send arbitrary headers. A fixed Allow-Headers list silently blocks whichever
// one they chose, and the failure surfaces as an opaque CORS error.
func TestEchoesTheHeadersThePreflightAsksFor(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, preflightRequest("https://app.example.com", "authorization, x-tenant-id"))

	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "authorization, x-tenant-id" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want the request echoed", got)
	}
	if !slices.Contains(rec.Header().Values("Vary"), "Access-Control-Request-Headers") {
		t.Fatalf("Vary = %v, want it to contain Access-Control-Request-Headers", rec.Header().Values("Vary"))
	}
}

// A preflight fetches nothing, and a 429 on one reaches the page as an opaque
// CORS failure rather than a status it can read. Spending the budget on
// preflights would also halve it: in ticket mode every real request is preceded
// by one until the browser's cache warms.
func TestThePreflightDoesNotSpendTheRateLimit(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})
	h := ticketServer(t, now)

	for i := 0; i < 5; i++ { // well past RateLimitPerMinute = 2
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, preflightRequest("https://app.example.com", "authorization"))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("preflight %d: status = %d, want 204", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unfurlRequest("https://app.example.com", token))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: preflights spent the budget", rec.Code)
	}
}

// Access-Control-Allow-Origin echoes the REQUEST's origin, so a shared cache
// that does not key on it serves one origin's response to another.
func TestMarksGatedResponsesAsVaryingByOrigin(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, unfurlRequest("https://app.example.com", token))

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if !slices.Contains(rec.Header().Values("Vary"), "Origin") {
		t.Fatalf("Vary = %v, want it to contain Origin", rec.Header().Values("Vary"))
	}
}

// Without Access-Control-Allow-Origin on a rejection the browser hands fetch()
// an opaque TypeError, so the app cannot tell "the pass expired, mint another"
// from "the service is down". The header therefore goes on before the pass is
// checked and before the limiter runs.
func TestRejectionsStayReadableByTheCallingPage(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})
	h := ticketServer(t, now)

	unauthorized := httptest.NewRecorder()
	h.ServeHTTP(unauthorized, unfurlRequest("https://app.example.com", ""))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", unauthorized.Code)
	}
	if got := unauthorized.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("401 Access-Control-Allow-Origin = %q, want the origin echoed", got)
	}

	for i := 0; i < 2; i++ {
		h.ServeHTTP(httptest.NewRecorder(), unfurlRequest("https://app.example.com", token))
	}

	limited := httptest.NewRecorder()
	h.ServeHTTP(limited, unfurlRequest("https://app.example.com", token))
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", limited.Code)
	}
	if got := limited.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("429 Access-Control-Allow-Origin = %q, want the origin echoed", got)
	}
}

// Origin is absent on same-origin requests and on everything not driven by a
// browser. Refusing those is the contract the design names — the allowlist is
// an interlock for public mode, and config.Validate refuses to start ticket
// mode without one. Pinned so nobody loosens it by accident: a ticket-mode
// deployment served from the app's own origin, and any server-to-server caller
// holding a pass, must send Origin explicitly.
func TestRefusesARequestCarryingNoOrigin(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	rec := httptest.NewRecorder()
	ticketServer(t, now).ServeHTTP(rec, unfurlRequest("", token))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

// Behind a reverse proxy every request arrives from the proxy's address, so an
// address key puts every user of the deployment in one bucket — two users and a
// limit of 2/min would leave the second with nothing. The verified pass names
// the user; that is the key.
func TestRateLimitsPerUserNotPerAddress(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	h := ticketServer(t, now) // RateLimitPerMinute = 2

	spend := func(user string) int {
		token, _ := ticket.Sign(testSecret, ticket.Claims{User: user, Exp: now.Add(time.Minute).Unix()})
		r := unfurlRequest("https://app.example.com", token)
		// One shared source address, the way a reverse proxy presents every user.
		r.RemoteAddr = "10.9.9.9:41234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)

		return rec.Code
	}

	for i := 0; i < 2; i++ {
		if code := spend("u1"); code != http.StatusOK {
			t.Fatalf("u1 request %d: status = %d, want 200", i, code)
		}
	}
	if code := spend("u1"); code != http.StatusTooManyRequests {
		t.Fatalf("u1 third request: status = %d, want 429", code)
	}
	if code := spend("u2"); code != http.StatusOK {
		t.Fatalf("u2 first request: status = %d, want 200 — u1 spent u2's budget", code)
	}
}

// Auth runs before the limiter, so a refused pass never spends a real user's
// budget. Reversing the order would also force the address key that
// TestRateLimitsPerUserNotPerAddress rules out.
func TestARefusedPassDoesNotSpendTheRateLimit(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(testSecret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})
	h := ticketServer(t, now)

	for i := 0; i < 5; i++ { // well past RateLimitPerMinute = 2
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, unfurlRequest("https://app.example.com", ""))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: status = %d, want 401", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unfurlRequest("https://app.example.com", token))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: unauthenticated requests spent the budget", rec.Code)
	}
}

// strings.Cut(r.RemoteAddr, ":") returns "[" for "[::1]:54321", so every IPv6
// client on the internet shares one bucket. net.SplitHostPort does not.
func TestIPv6ClientsDoNotShareOneRateLimitBucket(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	h := httpapi.New(httpapi.Options{
		Auth:               config.AuthNone,
		RateLimitPerMinute: 1,
		Now:                func() time.Time { return now },
		Fetcher:            stubFetcher{resp: &fetchguard.Response{Body: []byte("<html></html>"), FinalURL: "https://example.com/a", StatusCode: http.StatusOK}},
	})

	from := func(remoteAddr string) int {
		r := unfurlRequest("", "")
		r.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)

		return rec.Code
	}

	if code := from("[2001:db8::1]:54321"); code != http.StatusOK {
		t.Fatalf("first client: status = %d, want 200", code)
	}
	if code := from("[2001:db8::2]:54321"); code != http.StatusOK {
		t.Fatalf("second client: status = %d, want 200 — every IPv6 address keyed to the same bucket", code)
	}
	if code := from("[2001:db8::1]:9999"); code != http.StatusTooManyRequests {
		t.Fatalf("first client again: status = %d, want 429 — the port must not be part of the key", code)
	}
}

// Disabled means the route does not exist, not that the handler refuses: no
// part of the fetch path is reachable, preflight included.
func TestDisabledUnfurlIsNotRegisteredAtAll(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		UnfurlDisabled: true,
		Fetcher:        stubFetcher{err: errors.New("must not be called")},
	})

	for name, r := range map[string]*http.Request{
		"GET":     unfurlRequest("", ""),
		"OPTIONS": preflightRequest("https://app.example.com", "authorization"),
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", rec.Code)
			}
		})
	}
}

// The origin ALLOWLIST is enforced only in ticket mode, but the CORS header is
// emitted in every mode: --auth none is local development, where the dev server
// is on another port and therefore another origin, so without this the page
// cannot read the response at all. It is still gated on the allowlist rather
// than opened to "*" — a loopback service that answers any website the
// developer happens to visit is a scanner on their machine.
func TestEmitsTheCorsHeaderOutsideTicketMode(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:           config.AuthNone,
		AllowedOrigins: []string{"http://localhost:5173"},
		Fetcher:        stubFetcher{resp: &fetchguard.Response{Body: []byte("<html></html>"), FinalURL: "https://example.com/a", StatusCode: http.StatusOK}},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unfurlRequest("http://localhost:5173", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: --auth none asks for no pass", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want the origin echoed", got)
	}
}

// An origin the operator did not name gets no header — but outside ticket mode
// it is not REFUSED either, because there the allowlist is a CORS setting and
// the loopback bind is what limits reach.
func TestServesAnUnlistedOriginWithoutTheCorsHeaderOutsideTicketMode(t *testing.T) {
	h := httpapi.New(httpapi.Options{
		Auth:           config.AuthNone,
		AllowedOrigins: []string{"http://localhost:5173"},
		Fetcher:        stubFetcher{resp: &fetchguard.Response{Body: []byte("<html></html>"), FinalURL: "https://example.com/a", StatusCode: http.StatusOK}},
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unfurlRequest("http://localhost:9999", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want none for an unlisted origin", got)
	}
}
