package blokmcp

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// No answer from the sync server is worth a retry, as Node's fetch error
// says; a refused ticket is not.
func TestAnUnreachableHistoryRouteIsRetryable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	room := newLiveRoom("http://"+address+"/sync/doc", "doc", nil, func(bool) (string, error) { return "t", nil }, nil)
	t.Cleanup(room.close)
	loaded := room.loadVersions(context.Background(), json.RawMessage(`{"commands":[{"name":"history.versions","args":{}}]}`))
	if loaded["retryable"] != true || loaded["failed"] != "The sync server could not be reached: fetch failed" {
		t.Fatalf("loaded %v", loaded)
	}
}

// A restore sends If-Match with the newest version the agent saw, and a
// refusal reads as Node's (recorded on a sync host: verify-live restore404,
// restore412, restore500 with 503).
func TestARestoreIsPinnedAndRefusedAsNode(t *testing.T) {
	const version = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1"
	previous := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:2"
	cases := []struct {
		status int
		want   string
	}{
		{http.StatusNotFound, `{"ok":false,"revision":"l0","error":{"code":"VERSION_NOT_FOUND","message":"There is no version \"` + version + `\". history.versions lists them.","path":"/commands/0/args/version","retryable":false,"commandIndex":0},"warnings":[]}`},
		{http.StatusPreconditionFailed, `{"ok":false,"revision":"l0","error":{"code":"STALE","message":"The document changed since the version history was read, so nothing was restored. Read it again, then retry.","commandIndex":0,"retryable":true},"warnings":[]}`},
		{http.StatusServiceUnavailable, `{"ok":false,"revision":"l0","error":{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The sync server answered 503: {\"error\":\"x\"}","retryable":true,"commandIndex":0,"path":"/commands/0/args"},"warnings":[]}`},
		{http.StatusInternalServerError, `{"ok":false,"revision":"l0","error":{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The sync server answered 500: {\"error\":\"x\"}","retryable":false,"commandIndex":0,"path":"/commands/0/args"},"warnings":[]}`},
		{http.StatusOK, ``},
	}
	for _, c := range cases {
		var ifMatch string
		host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ifMatch = r.Header.Get("If-Match")
			w.WriteHeader(c.status)
			_, _ = w.Write([]byte(`{"error":"x"}`))
		}))
		room := newLiveRoom(host.URL+"/sync/doc", "doc", nil, func(bool) (string, error) { return "t", nil }, nil)
		session := &liveSession{room: room}
		got := session.restore(context.Background(), version, &previous)
		room.close()
		host.Close()
		if string(got) != c.want {
			t.Errorf("%d: got %s\nwant %s", c.status, got, c.want)
		}
		if ifMatch != `"`+previous+`"` {
			t.Errorf("%d: If-Match %q", c.status, ifMatch)
		}
	}
}
