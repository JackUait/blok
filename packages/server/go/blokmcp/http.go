package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	mcpPath      = "/mcp"
	metadataPath = "/.well-known/oauth-protected-resource"
	// maxBodyBytes matches the SDK's own default body bound.
	maxBodyBytes = 4 << 20
)

// MCP clients are not browsers: only a loopback page may drive this server.
var loopbackOrigin = regexp.MustCompile(`^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`)

// A DNS-rebound page sends no Origin on a same-origin call, but its Host
// still names the attacker's domain.
var loopbackHostNames = map[string]bool{"localhost": true, "127.0.0.1": true, "[::1]": true}

type identityKey struct{}

// isLoopbackHost wants a loopback caller, a loopback name and the port the
// request came in on. A caller can type any Host, so only its own address
// shows it is on this machine: an embedder's listener may be open to the
// network.
func isLoopbackHost(r *http.Request) bool {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(remote); err != nil || ip == nil || !ip.IsLoopback() {
		return false
	}
	host := r.Host
	at := strings.LastIndexByte(host, ':')
	if at <= 0 || !loopbackHostNames[strings.ToLower(host[:at])] {
		return false
	}
	local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
	if !ok {
		return false
	}
	_, port, err := net.SplitHostPort(local.String())
	return err == nil && host[at+1:] == port
}

// Handler serves stateless streamable HTTP at /mcp, plus the OAuth
// protected-resource metadata when OAuth is on. Mount it at the root. The
// server must have Transport.Kind "http": New checks the HTTP rules
// (authorize hook, OAuth for --public) only for that kind. New checks the
// loopback bind only on Transport.Listen, which Handler does not use, so
// without Public the handler itself refuses a caller whose address is not
// loopback. Behind a reverse proxy every caller looks loopback: set Public
// and OAuth there.
func (s *Server) Handler() (http.Handler, error) {
	if s.options.Transport.Kind != "http" {
		return nil, &ConfigError{Message: `Handler needs Transport.Kind "http", so that New checks the HTTP rules`}
	}
	return s.handler(), nil
}

func (s *Server) handler() http.Handler {
	var verifier *jwtVerifier
	var metadataURL string
	if s.options.Auth.Kind == "oauth" {
		verifier = newJWTVerifier(s.options.Auth)
		if audience, err := url.Parse(s.options.Auth.Audience); err == nil {
			metadataURL = audience.ResolveReference(&url.URL{Path: metadataPath}).String()
		}
	}
	sdk := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		who, _ := r.Context().Value(identityKey{}).(identity)
		return s.newSDKServer(who)
	}, &mcp.StreamableHTTPOptions{Stateless: true, DisableLocalhostProtection: true, MaxRequestBodyBytes: -1})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin, hasOrigin := r.Header["Origin"]
		if (hasOrigin && !loopbackOrigin.MatchString(strings.Join(origin, ", "))) || (!s.options.Transport.Public && !isLoopbackHost(r)) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if verifier != nil && r.Method == http.MethodGet && r.URL.Path == metadataPath {
			body, _ := marshal(map[string]any{
				"resource":                 s.options.Auth.Audience,
				"authorization_servers":    []string{s.options.Auth.Issuer},
				"scopes_supported":         []string{"blok.read", "blok.write"},
				"bearer_methods_supported": []string{"header"},
			})
			w.Header()["Content-Type"] = []string{"application/json"}
			_, _ = w.Write(body)
			return
		}
		if r.URL.Path != mcpPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method != http.MethodPost {
			w.Header()["Allow"] = []string{"POST"}
			writeRPCError(w, http.StatusMethodNotAllowed, -32000, "Method not allowed.")
			return
		}
		who := identity{principal: s.options.principal()}
		// The bearer gate reads only the header, so a refused caller never
		// gets a body read.
		if verifier != nil {
			info, ok := verifier.gate(w, r, metadataURL)
			if !ok {
				return
			}
			who = identity{principal: info.principal, scopes: info.scopes}
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
		if err != nil {
			return
		}
		if len(body) > maxBodyBytes {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		if !json.Valid(body) {
			writeRPCError(w, http.StatusBadRequest, -32700, "Parse error: Invalid JSON")
			return
		}
		body = liftBody(body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		// Node's SDK still takes the 2024-10-07 header; the Go SDK refuses it.
		if r.Header.Get("Mcp-Protocol-Version") == "2024-10-07" {
			r.Header.Set("Mcp-Protocol-Version", "2024-11-05")
		}
		answer := &recorder{header: http.Header{}}
		sdk.ServeHTTP(answer, r.WithContext(context.WithValue(r.Context(), identityKey{}, who)))
		answer.send(w, r.Header.Get("Mcp-Protocol-Version") >= modernVersion)
	})
}

// writeRPCError answers a request that never reached the SDK, as Node's
// SDK words it: a JSON-RPC error with a null id.
func writeRPCError(w http.ResponseWriter, status int, code int64, message string) {
	body, _ := marshal(map[string]any{"jsonrpc": "2.0", "error": map[string]any{"code": code, "message": message}, "id": nil})
	w.Header()["Content-Type"] = []string{"application/json"}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// liftBody applies liftInputResponses to a single tools/call request.
func liftBody(body []byte) []byte {
	var message struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if json.Unmarshal(body, &message) != nil || message.Method != "tools/call" || len(message.Params) == 0 {
		return body
	}
	var members map[string]json.RawMessage
	if json.Unmarshal(body, &members) != nil {
		return body
	}
	members["params"] = liftInputResponses(message.Params)
	written, err := json.Marshal(members)
	if err != nil {
		return body
	}
	return written
}

// recorder holds the SDK's answer, so it can be fixed before it is sent.
// Stateless requests answer once, so nothing streams.
type recorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *recorder) Header() http.Header { return r.header }
func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.body.Write(b)
}
func (r *recorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}
func (r *recorder) Flush() {}

var (
	eventBreak = regexp.MustCompile(`\r?\n\r?\n`)
	lineBreak  = regexp.MustCompile(`\r?\n`)
)

// sseMessages reads the data lines of an event stream.
func sseMessages(body []byte) [][]byte {
	var messages [][]byte
	for _, event := range eventBreak.Split(string(body), -1) {
		var data []string
		for _, line := range lineBreak.Split(event, -1) {
			if rest, ok := strings.CutPrefix(line, "data:"); ok {
				data = append(data, strings.TrimLeft(rest, " "))
			}
		}
		if len(data) > 0 {
			messages = append(messages, []byte(strings.Join(data, "\n")))
		}
	}
	return messages
}

// fixMessage words "method not found" as Node's SDK does, and gives a
// refused 2026 request the data member Node's SDK always sends.
func fixMessage(message []byte, refused bool) []byte {
	var members map[string]json.RawMessage
	if json.Unmarshal(message, &members) != nil {
		return message
	}
	var failure struct {
		Code    int64           `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if json.Unmarshal(members["error"], &failure) != nil || failure.Code == 0 {
		return message
	}
	switch {
	case failure.Code == -32601:
		members["error"], _ = json.Marshal(map[string]any{"code": failure.Code, "message": "Method not found"})
	case refused && len(failure.Data) == 0:
		members["error"], _ = json.Marshal(map[string]any{"code": failure.Code, "message": failure.Message, "data": map[string]string{"reason": failure.Message}})
	default:
		return message
	}
	written, err := json.Marshal(members)
	if err != nil {
		return message
	}
	return written
}

// send writes the recorded answer: a 2026 request gets plain JSON, as
// Node's SDK answers it.
func (r *recorder) send(w http.ResponseWriter, modern bool) {
	body := r.body.Bytes()
	contentType := r.header.Get("Content-Type")
	refused := modern && r.status == http.StatusBadRequest
	switch {
	case strings.HasPrefix(contentType, "text/event-stream"):
		messages := sseMessages(body)
		if modern && len(messages) == 1 {
			r.header.Set("Content-Type", "application/json")
			body = fixMessage(messages[0], refused)
			break
		}
		var out bytes.Buffer
		for _, message := range messages {
			out.WriteString("event: message\ndata: ")
			out.Write(fixMessage(message, refused))
			out.WriteString("\n\n")
		}
		body = out.Bytes()
	case strings.HasPrefix(contentType, "application/json"):
		body = fixMessage(body, refused)
	}
	for name, values := range r.header {
		w.Header()[name] = values
	}
	if r.header.Get("Content-Length") != "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	}
	if r.status == 0 {
		r.status = http.StatusOK
	}
	w.WriteHeader(r.status)
	_, _ = w.Write(body)
}

// ListenAndServe serves Handler on the listen address until ctx ends.
// onListening gets the base URL once the port is bound.
func (s *Server) ListenAndServe(ctx context.Context, onListening func(url string)) error {
	listen := s.options.Transport.Listen
	at := strings.LastIndexByte(listen, ':')
	if at < 0 {
		return &ConfigError{Message: "Refusing to bind " + listen + ": a non-loopback address needs --public"}
	}
	host := strings.TrimSuffix(strings.TrimPrefix(listen[:at], "["), "]")
	listener, err := net.Listen("tcp", net.JoinHostPort(host, listen[at+1:]))
	if err != nil {
		return err
	}
	address, _ := listener.Addr().(*net.TCPAddr)
	shown := address.IP.String()
	if address.IP.To4() == nil {
		shown = "[" + shown + "]"
	}
	onListening("http://" + shown + ":" + strconv.Itoa(address.Port))
	server := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 30 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		// Work first, with new connections still taken, then the listener:
		// requests in flight finish writing their answers, within the same
		// deadline, and the rest are dropped.
		deadline := time.Now().Add(stopDrain)
		s.drain(deadline)
		shutdown, cancel := context.WithDeadline(context.Background(), deadline)
		defer cancel()
		if server.Shutdown(shutdown) != nil {
			_ = server.Close()
		}
		if err := <-done; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
