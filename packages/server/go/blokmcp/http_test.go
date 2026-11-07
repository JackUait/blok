package blokmcp

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testHTTPServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	front := httptest.NewServer(testHandler(t))
	t.Cleanup(front.Close)
	return front, front.URL[strings.LastIndexByte(front.URL, ':')+1:]
}

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	runtime := fakeRuntime{
		"mcpCheckOptions": func(string) string { return "{}" },
		"version":         func(string) string { return "1.0.0" },
		"mcpSurface": func(string) string {
			return `{"tools":[],"instructions":"","prompts":[],"contractRevision":{"stored":"s","live":"l"},"liveUnavailableCommands":[]}`
		},
	}
	server, err := newServer(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func send(t *testing.T, method, url string, header map[string]string, body string) (*http.Response, string) {
	t.Helper()
	request, _ := http.NewRequest(method, url, strings.NewReader(body))
	for name, value := range header {
		if name == "Host" {
			request.Host = value
			continue
		}
		request.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	read, _ := io.ReadAll(response.Body)
	return response, string(read)
}

func TestRefusesAForeignOriginAndAWrongPortWithAnEmpty403(t *testing.T) {
	front, port := testHTTPServer(t)
	for _, header := range []map[string]string{
		{"Origin": "http://LOCALHOST"},
		{"Origin": "http://127.0.0.1:80/x"},
		{"Host": "localhost:1"},
		{"Host": "127.0.0.1"},
		{"Host": "127.0.0.1:0" + port},
	} {
		response, body := send(t, http.MethodPost, front.URL+"/mcp", header, "{}")
		if response.StatusCode != http.StatusForbidden || body != "" || response.Header.Get("Content-Type") != "" {
			t.Errorf("%v: %d %q %q", header, response.StatusCode, body, response.Header.Get("Content-Type"))
		}
	}
	response, _ := send(t, http.MethodGet, front.URL+"/nowhere", map[string]string{"Host": "LOCALHOST:" + port}, "")
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("upper-case localhost with the right port: %d", response.StatusCode)
	}
}

func TestAnswersGETWith405AndAllowPOST(t *testing.T) {
	front, _ := testHTTPServer(t)
	response, body := send(t, http.MethodGet, front.URL+"/mcp", nil, "")
	if response.StatusCode != http.StatusMethodNotAllowed || response.Header.Get("Allow") != "POST" ||
		body != `{"error":{"code":-32000,"message":"Method not allowed."},"id":null,"jsonrpc":"2.0"}` {
		t.Fatalf("%d %q %q", response.StatusCode, response.Header.Get("Allow"), body)
	}
}

func TestRefusesABodyOverFourMiBWith413(t *testing.T) {
	front, _ := testHTTPServer(t)
	response, body := send(t, http.MethodPost, front.URL+"/mcp", nil, strings.Repeat("a", maxBodyBytes+1))
	if response.StatusCode != http.StatusRequestEntityTooLarge || body != "" {
		t.Fatalf("%d %q", response.StatusCode, body)
	}
	response, _ = send(t, http.MethodPost, front.URL+"/mcp", nil, strings.Repeat("a", maxBodyBytes))
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("exactly 4 MiB: %d", response.StatusCode)
	}
}

// New checks the HTTP rules only for an HTTP transport, so a stdio server
// must not hand out an HTTP handler that skipped them.
func TestAStdioServerHasNoHTTPHandler(t *testing.T) {
	runtime := fakeRuntime{
		"mcpCheckOptions": func(string) string { return "{}" },
		"version":         func(string) string { return "1.0.0" },
		"mcpSurface": func(string) string {
			return `{"tools":[],"instructions":"","prompts":[],"contractRevision":{"stored":"s","live":"l"},"liveUnavailableCommands":[]}`
		},
	}
	server, err := newServer(Options{Transport: Transport{Kind: "stdio"}}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	if _, err := server.Handler(); err == nil {
		t.Fatal("a stdio server gave out an HTTP handler")
	}
}

// An embedder may mount Handler on a listener open to the network. A
// remote caller can type any Host, so only its own address tells.
func TestHandlerRefusesARemoteCallerThatNamesLocalhost(t *testing.T) {
	handler := testHandler(t)
	for remote, want := range map[string]int{
		"203.0.113.9:40000":   http.StatusForbidden,
		"[2001:db8::1]:40000": http.StatusForbidden,
		"127.0.0.1:40000":     http.StatusNotFound,
		"[::1]:40000":         http.StatusNotFound,
	} {
		request := httptest.NewRequest(http.MethodGet, "/nowhere", nil)
		request.RemoteAddr = remote
		request.Host = "localhost:8443"
		local := &net.TCPAddr{IP: net.IPv4zero, Port: 8443}
		request = request.WithContext(context.WithValue(request.Context(), http.LocalAddrContextKey, local))
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != want {
			t.Errorf("%s: %d, want %d", remote, recorder.Code, want)
		}
	}
}
