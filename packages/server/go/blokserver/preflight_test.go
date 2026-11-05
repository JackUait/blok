package blokserver

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func preflightServer(t *testing.T) http.Handler {
	t.Helper()
	o := DefaultOptions()
	o.UnfurlEnabled = true
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.AllowedOrigins = []string{" http://k.example "}
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	return s.Handler("")
}

func preflight(h http.Handler, path string, headers ...string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodOptions, path, nil)
	for i := 0; i < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

// Answers as routing-contract.test.ts and the http-host goldens record them.
func TestPreflightAnswersAnAllowedOrigin(t *testing.T) {
	h := preflightServer(t)
	for _, c := range []struct {
		name, path, origin, requested string
		want                          http.Header
	}{
		{"GET route", "/unfurl", "http://k.example", "", http.Header{
			"Access-Control-Allow-Origin":  {"http://k.example"},
			"Access-Control-Allow-Methods": {"GET, OPTIONS"},
			"Access-Control-Max-Age":       {"600"},
			"Vary":                         {"Origin"},
		}},
		// The origin is echoed as sent, matched without case.
		{"POST route, origin in upper case", "/upload", "HTTP://K.EXAMPLE", "authorization", http.Header{
			"Access-Control-Allow-Origin":  {"HTTP://K.EXAMPLE"},
			"Access-Control-Allow-Methods": {"POST, OPTIONS"},
			"Access-Control-Allow-Headers": {"authorization"},
			"Access-Control-Max-Age":       {"600"},
			"Vary":                         {"Access-Control-Request-Headers", "Origin"},
		}},
	} {
		headers := []string{"Origin", c.origin, "Access-Control-Request-Method", "GET"}
		if c.requested != "" {
			headers = append(headers, "Access-Control-Request-Headers", c.requested)
		}
		got := preflight(h, c.path, headers...)
		if got.Code != http.StatusNoContent || got.Body.Len() != 0 || !reflect.DeepEqual(got.Header(), c.want) {
			t.Errorf("%s: got %d %v %q, want 204 %v", c.name, got.Code, got.Header(), got.Body.String(), c.want)
		}
	}
}

func TestPreflightRefusesAnOriginNotAllowed(t *testing.T) {
	h := preflightServer(t)
	for name, origin := range map[string]string{
		"no Origin":   "",
		"another":     "http://other.example",
		"kelvin sign": "http://K.example",
	} {
		var headers []string
		if origin != "" {
			headers = []string{"Origin", origin}
		}
		got := preflight(h, "/unfurl", headers...)
		if got.Code != http.StatusForbidden || got.Body.String() != "origin not allowed\n" ||
			got.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("%s: got %d %v %q", name, got.Code, got.Header(), got.Body.String())
		}
	}
}

// Kestrel throws on a response header outside tab and 0x20-0x7E, so echoing
// such a request header gives an empty 500.
func TestPreflightRefusesRequestedHeadersItCannotEcho(t *testing.T) {
	h := preflightServer(t)
	for name, requested := range map[string]string{
		"control byte": "x-a\x01b",
		"DEL":          "x-a\x7fb",
		"non-ASCII":    "x-é",
	} {
		got := preflight(h, "/unfurl", "Origin", "http://k.example", "Access-Control-Request-Headers", requested)
		want := http.Header{"Content-Length": {"0"}}
		if got.Code != http.StatusInternalServerError || got.Body.Len() != 0 || !reflect.DeepEqual(got.Header(), want) {
			t.Errorf("%s: got %d %v %q", name, got.Code, got.Header(), got.Body.String())
		}
	}
	// A tab is a legal field byte.
	if got := preflight(h, "/unfurl", "Origin", "http://k.example", "Access-Control-Request-Headers", "x-a\tb"); got.Code != http.StatusNoContent {
		t.Errorf("tab: got %d", got.Code)
	}
}
