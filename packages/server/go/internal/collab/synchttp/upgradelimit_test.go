package synchttp

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Measured on Kestrel with MaxConcurrentUpgradedConnections = 2: a socket
// it accepts only to close takes a slot too, and an upgrade past the limit
// is an empty 500 that keeps the connection, even after the room was joined.
func TestPastTheUpgradeLimitEveryUpgradeIsAnEmpty500(t *testing.T) {
	h := startEndpoint(t, func(c *Config) { c.Connections = NewConnectionTable(3, 8) },
		func(next http.Handler) http.Handler { return LimitUpgrades(next, 2) })
	h.dial(t, "/sync/doc")
	h.dial(t, "/sync/doc")
	for _, path := range []string{"/sync/a%2Fb", "/sync/doc"} {
		client := h.dial(t, path)
		if client.response.StatusCode != 500 || client.body != "" ||
			client.response.Header.Get("Content-Length") != "0" || client.response.Close {
			t.Fatalf("%s: %d %q %v", path, client.response.StatusCode, client.body, client.response.Header)
		}
	}
	if h.rooms.joins() != 3 {
		t.Fatalf("%d joins", h.rooms.joins())
	}
}

type hijackableWriter struct {
	*httptest.ResponseRecorder
	hijacks int
}

func (w *hijackableWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.hijacks++
	conn, peer := net.Pipe()
	_ = peer.Close()
	return conn, bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn)), nil
}

func TestAnUpgradeSlotIsFreedOnceWhenItsSocketCloses(t *testing.T) {
	var conn net.Conn
	var hijackErr error
	limited := LimitUpgrades(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, hijackErr = http.NewResponseController(w).Hijack()
	}), 1)
	upgrade := func() (*hijackableWriter, error) {
		w := &hijackableWriter{ResponseRecorder: httptest.NewRecorder()}
		r := httptest.NewRequest("GET", "/sync/doc", nil)
		r.Header.Set("Connection", "Upgrade")
		r.Header.Set("Upgrade", "websocket")
		r.Header.Set("Sec-WebSocket-Version", "13")
		r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		limited.ServeHTTP(w, r)
		return w, hijackErr
	}
	if _, err := upgrade(); err != nil {
		t.Fatal(err)
	}
	held := conn
	if w, err := upgrade(); err == nil || w.hijacks != 0 {
		t.Fatalf("past the limit: %v, %d hijacks", err, w.hijacks)
	}
	_ = held.Close()
	_ = held.Close()
	if _, err := upgrade(); err != nil {
		t.Fatalf("after close: %v", err)
	}
	if _, err := upgrade(); err == nil {
		t.Fatal("a second close freed a second slot")
	}
}

func TestAPlainRequestKeepsItsOwnWriter(t *testing.T) {
	recorder := httptest.NewRecorder()
	LimitUpgrades(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if w != http.ResponseWriter(recorder) {
			t.Fatalf("wrapped %T", w)
		}
	}), 1).ServeHTTP(recorder, httptest.NewRequest("GET", "/health", nil))
}
