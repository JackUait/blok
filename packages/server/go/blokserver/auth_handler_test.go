package blokserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// requireTestUser stands in for a host's own authentication: 401 unless
// X-Test-User is set.
func requireTestUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Test-User") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authorizedHandler(t *testing.T) http.Handler {
	t.Helper()
	o := DefaultOptions()
	o.AllowedOrigins = []string{"https://app.example.test"}
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	return s.HandlerWithAuth("/blok", requireTestUser)
}

func serveAuthorized(handler http.Handler, method, path string, headers map[string]string) int {
	request := httptest.NewRequest(method, path, nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

// BlokServerRegistrationTests 'ApplicationAuthorizationProtectsGuardedRoutesOnly':
// MapBlokServer(...).RequireAuthorization() keeps /health and CORS
// preflights anonymous (AllowAnonymous).
func TestApplicationAuthorizationProtectsGuardedRoutesOnly(t *testing.T) {
	handler := authorizedHandler(t)
	if code := serveAuthorized(handler, "GET", "/blok/unfurl", nil); code != http.StatusUnauthorized {
		t.Fatalf("anonymous unfurl %d", code)
	}
	if code := serveAuthorized(handler, "GET", "/blok/unfurl", map[string]string{"X-Test-User": "signed-in"}); code != http.StatusBadRequest {
		t.Fatalf("signed-in unfurl %d", code)
	}
	if code := serveAuthorized(handler, "GET", "/blok/health", nil); code != http.StatusOK {
		t.Fatalf("health %d", code)
	}
	preflight := map[string]string{"Origin": "https://app.example.test", "Access-Control-Request-Method": "GET"}
	if code := serveAuthorized(handler, "OPTIONS", "/blok/unfurl", preflight); code != http.StatusNoContent {
		t.Fatalf("preflight %d", code)
	}
}

// BlokServerRegistrationTests 'ApplicationAuthorizationCoversTheFallbacksButNotHealth':
// the group's 405 fallbacks and its catch-all 404 need the host's auth;
// /health's 405 and a path outside the group do not.
func TestApplicationAuthorizationCoversTheFallbacksButNotHealth(t *testing.T) {
	handler := authorizedHandler(t)
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"PUT", "/blok/unfurl", http.StatusUnauthorized},
		{"GET", "/blok/missing", http.StatusUnauthorized},
		{"PUT", "/blok/health", http.StatusMethodNotAllowed},
		{"GET", "/elsewhere", http.StatusNotFound},
	} {
		if code := serveAuthorized(handler, c.method, c.path, nil); code != c.want {
			t.Errorf("%s %s: %d, want %d", c.method, c.path, code, c.want)
		}
	}
}
