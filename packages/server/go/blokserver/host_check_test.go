package blokserver

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// A DNS-rebinding page sends a same-origin GET under its own name and no
// Origin. A loopback server must not answer it with a document.
func TestALoopbackServerRefusesACollabReadUnderAForeignHost(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"secret note"}}]}`)
	}))
	defer endpoint.Close()
	o := collabOptions(t)
	o.Auth = new("none")
	o.StorageDirectory = ""
	o.DocEndpoint = endpoint.URL + "/docs"
	o.LoopbackHostCheck = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	h := s.Handler("")
	for _, path := range []string{"/sync/doc/state", "/sync/doc/history"} {
		request := httptest.NewRequest(http.MethodGet, "http://attacker.example:4000"+path, nil)
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, request)
		body := recorder.Body.String()
		if strings.Contains(body, "secret note") || recorder.Code != http.StatusMisdirectedRequest {
			t.Errorf("%s under Host attacker.example:4000: %d %s", path, recorder.Code, strings.TrimSpace(body))
		}
	}
}

// The same rebinding GET reaches /frame-check and /unfurl, which fetch for
// the caller.
func TestALoopbackServerRefusesAFrameCheckUnderAForeignHost(t *testing.T) {
	o := DefaultOptions()
	o.UnfurlEnabled = true
	o.Auth = new("proxy")
	o.LoopbackHostCheck = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://attacker.example:4000/frame-check?url=https%3A%2F%2Fexample.com%2F", nil)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMisdirectedRequest || recorder.Body.String() != "host not allowed\n" ||
		recorder.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("%d %q %v", recorder.Code, recorder.Body.String(), recorder.Header())
	}
}

// An app that mounts the handler on its own public name, with the check
// off, keeps serving that name.
func TestTheHostCheckIsOffUnlessAsked(t *testing.T) {
	o := DefaultOptions()
	o.UnfurlEnabled = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://app.example.com/frame-check", nil)
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code == http.StatusMisdirectedRequest {
		t.Fatalf("%d %q", recorder.Code, recorder.Body.String())
	}
}

// Ticket mode already needs an allowed Origin and a pass, and a proxy in
// front of it may forward the public Host, so it keeps any Host.
func TestTicketModeKeepsAnyHost(t *testing.T) {
	o := DefaultOptions()
	o.Auth = new("ticket")
	o.Secret = guardSecret
	o.AllowedOrigins = []string{"https://app.example.com"}
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	o.LoopbackHostCheck = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://blok.example.com/delete", strings.NewReader(`{"url":"x"}`))
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Authorization", "Bearer "+pass(t, false, nil))
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden || recorder.Body.String() != "write access required\n" {
		t.Fatalf("%d %q", recorder.Code, recorder.Body.String())
	}
}

const requestHostsFixture = "../../../../test/unit/server-conformance/fixtures/request-hosts.json"

func TestRequestHostsMatchTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile(requestHostsFixture)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		AllowedOrigins []string `json:"allowedOrigins"`
		PublicURL      string   `json:"publicUrl"`
		Cases          []struct {
			Host    string `json:"host"`
			Allowed bool   `json:"allowed"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	names := hostNames(fixture.AllowedOrigins, fixture.PublicURL)
	for _, c := range fixture.Cases {
		if got := hostAllowed(c.Host, names); got != c.Allowed {
			t.Errorf("Host %q: allowed %v, want %v", c.Host, got, c.Allowed)
		}
	}
}
