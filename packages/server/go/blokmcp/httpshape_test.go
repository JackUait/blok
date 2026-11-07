package blokmcp

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const (
	acceptBoth    = "application/json, text/event-stream"
	notAcceptable = `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}`
	pingBody      = `{"jsonrpc":"2.0","id":7,"method":"ping"}`
)

func sameJSON(t *testing.T, got, want string) bool {
	t.Helper()
	got, want = strings.TrimPrefix(got, "event: message\ndata: "), strings.TrimPrefix(want, "event: message\ndata: ")
	var a, b any
	if json.Unmarshal([]byte(got), &a) != nil || json.Unmarshal([]byte(want), &b) != nil {
		return got == want
	}
	return reflect.DeepEqual(a, b)
}

// Each answer is Node's, recorded on blok-mcp --http (status, content-type
// and body).
func TestHTTPAnswersMalformedRequestsAsNode(t *testing.T) {
	front, _ := testHTTPServer(t)
	pv := "2025-11-25"
	cases := []struct {
		name, accept, contentType, version, body string
		status                                   int
		wantType, wantBody                       string
	}{
		{"no accept", "", "application/json", pv, pingBody, 406, "application/json", notAcceptable},
		{"json only", "application/json", "application/json", pv, pingBody, 406, "application/json", notAcceptable},
		{"sse only", "text/event-stream", "application/json", pv, pingBody, 406, "application/json", notAcceptable},
		{"star", "*/*", "application/json", pv, pingBody, 406, "application/json", notAcceptable},
		{"no content type", acceptBoth, "", pv, pingBody, 415, "application/json", `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}`},
		{"text plain", acceptBoth, "text/plain", pv, pingBody, 415, "application/json", `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}`},
		{"unknown method", acceptBoth, "application/json", pv, `{"jsonrpc":"2.0","id":9,"method":"nope"}`, 200, "text/event-stream", "event: message\ndata: " + `{"jsonrpc":"2.0","id":9,"error":{"code":-32601,"message":"Method not found"}}` + "\n\n"},
		{"unknown notification", acceptBoth, "application/json", pv, `{"jsonrpc":"2.0","method":"nope"}`, 202, "", ""},
		{"42", acceptBoth, "application/json", pv, `42`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":null}`},
		{"null", acceptBoth, "application/json", pv, `null`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":null}`},
		{"empty batch", acceptBoth, "application/json", pv, `[]`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: empty JSON-RPC batch"},"id":null}`},
		{"batch of one", acceptBoth, "application/json", pv, `[` + pingBody + `]`, 200, "text/event-stream", "event: message\ndata: " + `{"jsonrpc":"2.0","id":7,"result":{}}` + "\n\n"},
		{"no jsonrpc", acceptBoth, "application/json", pv, `{"id":9,"method":"ping"}`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":9}`},
		{"id null", acceptBoth, "application/json", pv, `{"jsonrpc":"2.0","id":null,"method":"ping"}`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":null}`},
		{"id 1.5", acceptBoth, "application/json", pv, `{"jsonrpc":"2.0","id":1.5,"method":"ping"}`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":1.5}`},
		{"id past 2^53", acceptBoth, "application/json", pv, `{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}`, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":9007199254740992}`},
		{"bom", acceptBoth, "application/json", pv, "\ufeff" + pingBody, 200, "text/event-stream", "event: message\ndata: " + `{"jsonrpc":"2.0","id":7,"result":{}}` + "\n\n"},
		{"empty version", acceptBoth, "application/json", "", pingBody, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Unsupported protocol version:  (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)"},"id":null}`},
		{"bad version", acceptBoth, "application/json", "1999-01-01", pingBody, 400, "application/json", `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Unsupported protocol version: 1999-01-01 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)"},"id":null}`},
		{"invalid json, no accept", "", "application/json", pv, `{"jsonrpc":`, 406, "application/json", notAcceptable},
	}
	for _, c := range cases {
		header := map[string]string{"Host": front.Listener.Addr().String(), "Mcp-Protocol-Version": c.version}
		if c.accept != "" {
			header["Accept"] = c.accept
		}
		if c.contentType != "" {
			header["Content-Type"] = c.contentType
		}
		response, body := sendRaw(t, front, header, c.body)
		if response.StatusCode != c.status || response.Header.Get("Content-Type") != c.wantType || !sameJSON(t, body, c.wantBody) {
			t.Errorf("%s: got %d %q %q, want %d %q %q", c.name, response.StatusCode, response.Header.Get("Content-Type"), body, c.status, c.wantType, c.wantBody)
		}
	}
}

// sendRaw posts to /mcp keeping an empty Mcp-Protocol-Version header.
func sendRaw(t *testing.T, front *httptest.Server, header map[string]string, body string) (*httpResponse, string) {
	t.Helper()
	return postRaw(t, front.URL+"/mcp", header, body)
}

type httpResponse = http.Response

func postRaw(t *testing.T, url string, header map[string]string, body string) (*http.Response, string) {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	for name, value := range header {
		if name == "Host" {
			request.Host = value
			continue
		}
		if name == "Mcp-Protocol-Version" && value == "" {
			request.Header[name] = []string{""}
			continue
		}
		request.Header.Set(name, value)
	}
	if _, ok := header["Content-Type"]; !ok {
		request.Header["Content-Type"] = nil
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	read, _ := io.ReadAll(response.Body)
	return response, string(read)
}

// With OAuth on, Node's bearer gate runs before the method check, so a
// GET or DELETE with no token gets the 401 challenge.
func TestOAuthChallengesEveryMethodBeforeTheMethodCheck(t *testing.T) {
	runtime := fakeRuntime{
		"mcpCheckOptions": func(string) string { return "{}" },
		"version":         func(string) string { return "1.0.0" },
		"mcpSurface": func(string) string {
			return `{"tools":[],"instructions":"","prompts":[],"contractRevision":{"stored":"s","live":"l"},"liveUnavailableCommands":[]}`
		},
	}
	server, err := newServer(Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"},
		Auth: Auth{Kind: "oauth", Issuer: "https://issuer.test", Audience: "http://127.0.0.1/mcp", JWKSURL: "https://issuer.test/jwks"}}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(handler)
	t.Cleanup(front.Close)
	for _, method := range []string{http.MethodGet, http.MethodDelete, http.MethodPut} {
		response, body := send(t, method, front.URL+"/mcp", map[string]string{"Host": front.Listener.Addr().String()}, "")
		challenge := `Bearer error="invalid_token", error_description="Missing Authorization header", scope="blok.read", resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource"`
		if response.StatusCode != http.StatusUnauthorized || response.Header.Get("WWW-Authenticate") != challenge ||
			!sameJSON(t, body, `{"error":"invalid_token","error_description":"Missing Authorization header"}`) {
			t.Errorf("%s: %d %q %q", method, response.StatusCode, response.Header.Get("WWW-Authenticate"), body)
		}
	}
}
