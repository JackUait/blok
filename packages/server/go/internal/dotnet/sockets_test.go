package dotnet

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// slowListener holds every accepted connection before its first byte.
type slowListener struct {
	net.Listener
	delay time.Duration
}

func (l slowListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err == nil {
		time.Sleep(l.delay)
	}
	return conn, err
}

// connectProxy answers CONNECT after delay, then tunnels.
func connectProxy(t *testing.T, delay time.Duration) *url.URL {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer client.Close()
				request, err := http.ReadRequest(bufio.NewReader(client))
				if err != nil {
					return
				}
				time.Sleep(delay)
				target, err := net.Dial("tcp", request.Host)
				if err != nil {
					return
				}
				defer target.Close()
				_, _ = io.WriteString(client, "HTTP/1.1 200 Connection established\r\n\r\n")
				go func() { _, _ = io.Copy(target, client) }()
				_, _ = io.Copy(client, target)
			}()
		}
	}()
	return &url.URL{Scheme: "http", Host: listener.Addr().String()}
}

// HttpConnectionPool.ConnectAsync runs the TCP connect, the proxy tunnel
// and the TLS handshake under one ConnectTimeout token (System.Net.Http
// 10.0.11, decompiled).
func TestTheConnectTimeoutIsOneBudgetForTunnelAndTLS(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Listener = slowListener{server.Listener, 600 * time.Millisecond}
	server.StartTLS()
	defer server.Close()

	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: time.Second})
	transport.Transport.Proxy = http.ProxyURL(connectProxy(t, 600*time.Millisecond))
	transport.Transport.TLSClientConfig = server.Client().Transport.(*http.Transport).TLSClientConfig.Clone()

	start := time.Now()
	response, err := (&http.Client{Transport: transport}).Get(server.URL)
	if err == nil {
		response.Body.Close()
		t.Fatalf("connected after %v", time.Since(start))
	}
	if elapsed := time.Since(start); elapsed > 1500*time.Millisecond {
		t.Fatalf("failed after %v: %v", elapsed, err)
	}
	if netError, ok := err.(net.Error); !ok || !netError.Timeout() {
		t.Fatalf("not a timeout: %v", err)
	}

	// Inside the budget the same route connects.
	fast := NewSocketsTransport(SocketsOptions{ConnectTimeout: 3 * time.Second})
	fast.Transport.Proxy = http.ProxyURL(connectProxy(t, 100*time.Millisecond))
	fast.Transport.TLSClientConfig = transport.Transport.TLSClientConfig
	response, err = (&http.Client{Transport: fast}).Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
}

// PooledConnectionLifetime: a connection past it is not used again, so a
// DNS change is picked up under steady traffic. PooledConnectionIdleTimeout
// keeps .NET's 1 minute default.
func TestAPooledConnectionRetiresAfterItsLifetime(t *testing.T) {
	var opened atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			opened.Add(1)
		}
	}
	server.Start()
	defer server.Close()

	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: time.Second, PooledConnectionLifetime: 300 * time.Millisecond})
	if transport.Transport.IdleConnTimeout != time.Minute {
		t.Fatalf("idle timeout %v", transport.Transport.IdleConnTimeout)
	}
	client := &http.Client{Transport: transport}
	// The doc endpoint saves with PUT: net/http copies a request with a
	// body before it picks a connection.
	put := func() {
		t.Helper()
		request, err := http.NewRequest(http.MethodPut, server.URL, strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
	put()
	put()
	if opened.Load() != 1 {
		t.Fatalf("a young connection was not reused: %d", opened.Load())
	}
	time.Sleep(400 * time.Millisecond)
	put()
	put()
	if opened.Load() != 2 {
		t.Fatalf("opened %d connections", opened.Load())
	}
}

// socks4Proxy grants one SOCKS4 tunnel, records the handshake, then answers
// the tunnelled request itself.
func socks4Proxy(t *testing.T) (string, <-chan []byte) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	handshakes := make(chan []byte, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		head := make([]byte, 8)
		if _, err := io.ReadFull(reader, head); err != nil {
			return
		}
		user, _ := reader.ReadBytes(0)
		handshake := append(head, user...)
		if head[4] == 0 && head[5] == 0 && head[6] == 0 && head[7] != 0 {
			host, _ := reader.ReadBytes(0)
			handshake = append(handshake, host...)
		}
		handshakes <- handshake
		_, _ = conn.Write([]byte{0, 90, 0, 0, 0, 0, 0, 0})
		if _, err := http.ReadRequest(reader); err != nil {
			return
		}
		_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
	}()
	return listener.Addr().String(), handshakes
}

// SocksHelper.EstablishSocks4TunnelAsync (System.Net.Http 10.0.11,
// decompiled): SOCKS4 sends an IPv4 address and the user name; SOCKS4a
// hands a name to the proxy behind 0.0.0.255.
func TestTunnelsThroughSocks4AndSocks4aAsDotNetDoes(t *testing.T) {
	cases := []struct {
		scheme, target string
		want           []byte
	}{
		{"socks4", "http://127.0.0.1:8080/a", append([]byte{4, 1, 0x1f, 0x90, 127, 0, 0, 1}, "user\x00"...)},
		{"socks4a", "http://docs.blok-proxy.invalid/a", append([]byte{4, 1, 0, 80, 0, 0, 0, 255}, "user\x00docs.blok-proxy.invalid\x00"...)},
	}
	for _, c := range cases {
		address, handshakes := socks4Proxy(t)
		t.Setenv("ALL_PROXY", c.scheme+"://user@"+address)
		transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 5 * time.Second})
		response, err := (&http.Client{Transport: transport, Timeout: 5 * time.Second}).Get(c.target)
		if err != nil {
			t.Fatalf("%s: %v", c.scheme, err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if string(body) != "ok" {
			t.Fatalf("%s: body %q", c.scheme, body)
		}
		if got := <-handshakes; string(got) != string(c.want) {
			t.Fatalf("%s: handshake % x, want % x", c.scheme, got, c.want)
		}
	}
}
