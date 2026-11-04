package main

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

type pipeHijacker struct{ *httptest.ResponseRecorder }

func (pipeHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, peer := net.Pipe()
	_ = peer.Close()
	return conn, bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn)), nil
}

// HostCollab.Configure sets Kestrel's MaxConcurrentUpgradedConnections to
// 1024 only with collab; without it Kestrel has no limit.
func TestTheHostLimitsUpgradedSocketsOnlyWhenCollaborating(t *testing.T) {
	for _, collab := range []bool{false, true} {
		options := blokserver.DefaultOptions()
		options.CollabEnabled = collab
		refused := 0
		handler := limitUpgrades(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if _, _, err := http.NewResponseController(w).Hijack(); err != nil {
				refused++
			}
		}), options)
		for range 1025 {
			r := httptest.NewRequest("GET", "/sync/doc", nil)
			r.Header.Set("Connection", "Upgrade")
			r.Header.Set("Upgrade", "websocket")
			r.Header.Set("Sec-WebSocket-Version", "13")
			r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
			handler.ServeHTTP(pipeHijacker{httptest.NewRecorder()}, r)
		}
		want := 0
		if collab {
			want = 1
		}
		if refused != want {
			t.Fatalf("collab %v: %d refused", collab, refused)
		}
	}
}
