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

// Node's splitListen and its listen errors: libuv's words for a failed
// bind, getaddrinfo's for a name that does not resolve.
func TestListenErrorsAreWordedAsNode(t *testing.T) {
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	busy := held.Addr().String()
	port := busy[strings.LastIndexByte(busy, ':')+1:]
	portRefusal := func(listen string) string {
		return `--http needs a port from 0 to 65535 after the last ":", got "` + listen + `"`
	}
	cases := []struct{ listen, want string }{
		{busy, "Cannot listen on " + busy + ": listen EADDRINUSE: address already in use 127.0.0.1:" + port},
		{"203.0.113.9:0", "Cannot listen on 203.0.113.9:0: listen EADDRNOTAVAIL: address not available 203.0.113.9"},
		{"nope.invalid:0", "Cannot listen on nope.invalid:0: getaddrinfo ENOTFOUND nope.invalid"},
		{"127.0.0.1:abc", portRefusal("127.0.0.1:abc")},
		{"127.0.0.1:0x10", portRefusal("127.0.0.1:0x10")},
		{"127.0.0.1: 0", portRefusal("127.0.0.1: 0")},
		{"127.0.0.1:65536", portRefusal("127.0.0.1:65536")},
		{"127.0.0.1:000001", portRefusal("127.0.0.1:000001")},
	}
	for _, c := range cases {
		server := testServerFor(t, Options{Transport: Transport{Kind: "http", Listen: c.listen}})
		ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		err := server.ListenAndServe(ctx, func(string) {})
		stop()
		if err == nil || err.Error() != c.want {
			t.Errorf("%s: got %v, want %s", c.listen, err, c.want)
		}
	}
}
