package blokmcp

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

// Node's listen takes the first address the resolver gives for a name
// (::1 for localhost on macOS); Go's own listen prefers IPv4.
func TestListenBindsTheFirstResolvedAddressAsNode(t *testing.T) {
	addresses, err := net.DefaultResolver.LookupIPAddr(context.Background(), "localhost")
	if err != nil || len(addresses) == 0 {
		t.Skip("localhost does not resolve here")
	}
	first := addresses[0].IP.String()
	if addresses[0].IP.To4() == nil {
		first = "[" + first + "]"
	}
	server := testServerFor(t, Options{Transport: Transport{Kind: "http", Listen: "localhost:0"}})
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	listening := make(chan string, 1)
	go func() { _ = server.ListenAndServe(ctx, func(url string) { listening <- url }) }()
	select {
	case url := <-listening:
		if !strings.HasPrefix(url, "http://"+first+":") {
			t.Fatalf("listening on %s, want %s", url, first)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("not listening")
	}
}

func testServerFor(t *testing.T, options Options) *Server {
	t.Helper()
	runtime := fakeRuntime{
		"mcpCheckOptions": func(string) string { return "{}" },
		"version":         func(string) string { return "1.0.0" },
		"mcpSurface": func(string) string {
			return `{"tools":[],"instructions":"","prompts":[],"contractRevision":{"stored":"s","live":"l"},"liveUnavailableCommands":[]}`
		},
	}
	server, err := newServer(options, runtime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return server
}
