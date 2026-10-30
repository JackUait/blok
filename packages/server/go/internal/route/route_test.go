package route

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// named answers with its own name and the {doc} value, so a test can see
// which route ran and what it captured.
func named(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, name+"|"+r.PathValue("doc"))
	})
}

// testRouter mirrors the C# route table shape: a method route, then the
// pattern's any-method 405 fallback.
func testRouter() *Router {
	router := &Router{}
	router.Handle("/health", []string{"GET", "HEAD"}, named("health"))
	router.Handle("/health", nil, MethodNotAllowed("GET, HEAD"))
	router.Handle("/sync/{doc}", []string{"GET"}, named("sync"))
	router.Handle("/sync/{doc}", nil, MethodNotAllowed("GET"))
	router.Handle("/sync/{doc}/state", []string{"GET"}, named("state"))
	router.Handle("/sync/{doc}/state", []string{"OPTIONS"}, named("preflight"))
	router.Handle("/sync/{doc}/state", nil, MethodNotAllowed("GET, OPTIONS"))
	return router
}

type answer struct {
	status int
	header http.Header
	body   string
}

func serve(t *testing.T, router http.Handler, method, target string) answer {
	t.Helper()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	result := recorder.Result()
	body, _ := io.ReadAll(result.Body)
	return answer{result.StatusCode, result.Header, string(body)}
}

func TestMatchesLikeKestrel(t *testing.T) {
	cases := []struct{ method, target, body string }{
		{"GET", "/health", "health|"},
		{"GET", "/HEALTH", "health|"},
		{"GET", "/Health/", "health|"},
		{"HEAD", "/health/", "health|"},
		{"GET", "/./health", "health|"},
		{"GET", "/x/../health", "health|"},
		{"GET", "/../health", "health|"},
		{"GET", "/%2e/health", "health|"},
		{"GET", "/%2E%2E/health", "health|"},
		{"GET", "/%68ealth", "health|"},
		{"GET", "/health?x=1", "health|"},
		{"GET", "/health/.", "health|"},
		{"GET", "/health/./", "health|"},
		{"GET", "/SYNC/AbC/STATE/", "state|AbC"},
		{"GET", "/sync/a%20b", "sync|a b"},
		{"GET", "/sync/a%2Fb", "sync|a%2Fb"},
		{"GET", "/sync/a%2fb/state", "state|a%2fb"},
		{"GET", "/sync/a%5Cb/state", `state|a\b`},
		{"GET", "/sync/a%252Fb", "sync|a%2Fb"},
		{"OPTIONS", "/sync/x/state", "preflight|x"},
	}
	router := testRouter()
	for _, c := range cases {
		got := serve(t, router, c.method, c.target)
		if got.status != 200 || got.body != c.body {
			t.Errorf("%s %s: %d %q, want 200 %q", c.method, c.target, got.status, got.body, c.body)
		}
	}
}

func TestUnmatchedPathsGetTheCatchAll(t *testing.T) {
	router := testRouter()
	for _, target := range []string{
		"//health",
		"/health//",
		"/health%2F",
		"/health%2fx",
		"/health/x",
		"/health/..",
		"/",
		"*",
		"/nope",
		"/sync",
		"/sync/",
		"/sync//state",
		"/sync/x/state//",
		"/sync/%2e%2e/state",
		// "ſ" upper-cases to "S" in Unicode; literals fold ASCII only.
		"/%C5%BFync/x/state",
	} {
		for _, method := range []string{"GET", "POST", "OPTIONS"} {
			got := serve(t, router, method, target)
			if got.status != 404 || got.body != "404 page not found\n" ||
				got.header.Get("Content-Type") != "text/plain; charset=utf-8" ||
				got.header.Get("Allow") != "" ||
				got.header.Get("X-Content-Type-Options") != "" {
				t.Errorf("%s %s: %d %q %v", method, target, got.status, got.body, got.header)
			}
		}
	}
}

func TestMethodRoutesBeatTheFallback(t *testing.T) {
	cases := []struct{ method, target, allow string }{
		{"POST", "/health", "GET, HEAD"},
		{"OPTIONS", "/HEALTH/", "GET, HEAD"},
		{"HEAD", "/sync/x", "GET"},
		{"OPTIONS", "/sync/x", "GET"},
		{"HEAD", "/sync/x/state", "GET, OPTIONS"},
		{"DELETE", "/sync/x/state/", "GET, OPTIONS"},
	}
	router := testRouter()
	for _, c := range cases {
		got := serve(t, router, c.method, c.target)
		if got.status != 405 || got.header.Get("Allow") != c.allow ||
			got.header.Get("Content-Type") != "text/plain; charset=utf-8" ||
			got.header.Get("X-Content-Type-Options") != "" ||
			got.body != "Method Not Allowed\n" {
			t.Errorf("%s %s: %d %q %v", c.method, c.target, got.status, got.body, got.header)
		}
	}
}

func TestRegistrationOrderDoesNotLetAFallbackWin(t *testing.T) {
	router := &Router{}
	router.Handle("/health", nil, MethodNotAllowed("GET, HEAD"))
	router.Handle("/health", []string{"GET"}, named("health"))
	if got := serve(t, router, "GET", "/health"); got.status != 200 || got.body != "health|" {
		t.Fatalf("GET /health: %d %q", got.status, got.body)
	}
}

func TestMethodNamesFoldCase(t *testing.T) {
	// Kestrel answers "get /health" with 200 and "post /health" with 405.
	router := testRouter()
	if got := serve(t, router, "get", "/health"); got.status != 200 || got.body != "health|" {
		t.Errorf("get /health: %d %q", got.status, got.body)
	}
	if got := serve(t, router, "post", "/health"); got.status != 405 {
		t.Errorf("post /health: %d", got.status)
	}
}

func TestRejectsBadPatterns(t *testing.T) {
	for _, pattern := range []string{"", "health", "/a//b", "/{}", "/{doc", "/a/"} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("pattern %q did not panic", pattern)
				}
			}()
			(&Router{}).Handle(pattern, nil, named("x"))
		}()
	}
}

// The C# host maps the local file route "/{fileName}" before /health. Kestrel
// still sends /health to health, and sends GET /upload to the file route rather
// than to /upload's 405 fallback, which sits one order later.
func TestALiteralBeatsAParameterInTheSamePass(t *testing.T) {
	router := &Router{}
	router.Handle("/{fileName}", []string{"GET", "HEAD"}, named("file"))
	router.Handle("/health", []string{"GET", "HEAD"}, named("health"))
	router.Handle("/health", nil, MethodNotAllowed("GET, HEAD"))
	router.Handle("/upload", []string{"POST"}, named("upload"))
	router.Handle("/upload", nil, MethodNotAllowed("OPTIONS, POST"))
	cases := []struct{ method, target, body string }{
		{"GET", "/health", "health|"},
		{"GET", "/HEALTH/", "health|"},
		{"HEAD", "/health", "health|"},
		{"GET", "/upload", "file|"},
		{"POST", "/upload", "upload|"},
		{"GET", "/other", "file|"},
	}
	for _, c := range cases {
		got := serve(t, router, c.method, c.target)
		if got.status != 200 || got.body != c.body {
			t.Errorf("%s %s: %d %q, want 200 %q", c.method, c.target, got.status, got.body, c.body)
		}
	}
}

// Kestrel refuses a decoded NUL anywhere in the path, before routing, with an
// empty 400. It does not refuse %00 in the query, %2500, or other controls.
func TestEncodedNULInThePathIsABadRequest(t *testing.T) {
	router := testRouter()
	for _, c := range []struct{ method, target string }{
		{"GET", "/health%00"},
		{"HEAD", "/health%00"},
		{"POST", "/x%00"},
		{"GET", "/a%00b/c"},
		{"GET", "/x/../health%00"},
		{"GET", "/sync/a%00/state"},
	} {
		got := serve(t, router, c.method, c.target)
		if got.status != 400 || got.body != "" ||
			got.header.Get("Content-Length") != "0" ||
			got.header.Get("Connection") != "close" ||
			got.header.Get("Content-Type") != "" {
			t.Errorf("%s %s: %d %q %v", c.method, c.target, got.status, got.body, got.header)
		}
	}
	for _, c := range []struct {
		target string
		status int
	}{
		{"/health?x=%00", 200},
		{"/health%2500", 404},
		{"/health%01", 404},
		{"/health%0A", 404},
	} {
		if got := serve(t, router, "GET", c.target); got.status != c.status {
			t.Errorf("GET %s: %d, want %d", c.target, got.status, c.status)
		}
	}
}
