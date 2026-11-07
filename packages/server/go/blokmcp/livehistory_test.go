package blokmcp

import (
	"context"
	"encoding/json"
	"net"
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
