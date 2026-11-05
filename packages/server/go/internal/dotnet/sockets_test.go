package dotnet

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
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

// tlsConnectProxy is an https:// proxy: CONNECT arrives inside TLS. It
// counts the connections it accepts in opened, when given.
func tlsConnectProxy(t *testing.T, opened ...*atomic.Int32) *url.URL {
	t.Helper()
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			http.Error(w, "CONNECT only", http.StatusMethodNotAllowed)
			return
		}
		target, err := net.Dial("tcp", r.Host)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer target.Close()
		w.WriteHeader(http.StatusOK)
		client, buffered, err := http.NewResponseController(w).Hijack()
		if err != nil {
			return
		}
		defer client.Close()
		go func() { _, _ = io.Copy(target, buffered) }()
		_, _ = io.Copy(client, target)
	}))
	if len(opened) > 0 {
		proxy.Config.ConnState = func(_ net.Conn, state http.ConnState) {
			if state == http.StateNew {
				opened[0].Add(1)
			}
		}
	}
	proxy.StartTLS()
	t.Cleanup(proxy.Close)
	parsed, _ := url.Parse(proxy.URL)
	return parsed
}

// tlsForwardProxy is an https:// proxy that forwards plain http requests.
func tlsForwardProxy(t *testing.T) *url.URL {
	t.Helper()
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request, err := http.NewRequest(r.Method, r.URL.String(), r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		response, err := http.DefaultTransport.RoundTrip(request)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		_, _ = io.Copy(w, response.Body)
	}))
	proxy.StartTLS()
	t.Cleanup(proxy.Close)
	parsed, _ := url.Parse(proxy.URL)
	return parsed
}

// The connect budget ends when the connection is handed out, however many
// TLS layers sit on it: an answer slower than ConnectTimeout still arrives.
func TestTheConnectDeadlineEndsAtHandOutOnEveryRoute(t *testing.T) {
	const budget = 300 * time.Millisecond
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * budget)
		_, _ = io.WriteString(w, "ok")
	})
	secure := httptest.NewTLSServer(slow)
	defer secure.Close()
	plain := httptest.NewServer(slow)
	defer plain.Close()
	trust := secure.Client().Transport.(*http.Transport).TLSClientConfig

	cases := []struct {
		name   string
		target string
		proxy  func() *url.URL
		socks  string
	}{
		{name: "direct https", target: secure.URL},
		{name: "direct http", target: plain.URL},
		{name: "http proxy, https target", target: secure.URL, proxy: func() *url.URL { return connectProxy(t, 0) }},
		{name: "https proxy, https target", target: secure.URL, proxy: func() *url.URL { return tlsConnectProxy(t) }},
		{name: "https proxy, http target", target: plain.URL, proxy: func() *url.URL { return tlsForwardProxy(t) }},
		{name: "socks4, https target", target: secure.URL, socks: "socks4"},
		{name: "socks4a, https target", target: strings.Replace(secure.URL, "127.0.0.1", "localhost", 1), socks: "socks4a"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.socks != "" {
				t.Setenv("ALL_PROXY", c.socks+"://"+socks4Tunneler(t))
			}
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: budget})
			if c.proxy != nil {
				transport.Transport.Proxy = http.ProxyURL(c.proxy())
			}
			transport.Transport.TLSClientConfig = trust.Clone()
			transport.Transport.TLSClientConfig.ServerName = "127.0.0.1"
			client := &http.Client{Transport: transport}
			for round := range 2 {
				response, err := client.Get(c.target)
				if err != nil {
					t.Fatalf("round %d: %v", round, err)
				}
				body, _ := io.ReadAll(response.Body)
				response.Body.Close()
				if string(body) != "ok" {
					t.Fatalf("round %d: body %q", round, body)
				}
			}
		})
	}
}

// socks4Tunneler grants every SOCKS4 or SOCKS4a tunnel and relays it.
func socks4Tunneler(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				head := make([]byte, 8)
				if _, err := io.ReadFull(reader, head); err != nil {
					return
				}
				_, _ = reader.ReadBytes(0)
				host := net.IP(head[4:8]).String()
				if head[4] == 0 && head[5] == 0 && head[6] == 0 && head[7] != 0 {
					name, _ := reader.ReadBytes(0)
					host = string(name[:len(name)-1])
				}
				port := int(head[2])<<8 | int(head[3])
				target, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
				if err != nil {
					return
				}
				defer target.Close()
				_, _ = conn.Write([]byte{0, 90, 0, 0, 0, 0, 0, 0})
				go func() { _, _ = io.Copy(target, reader) }()
				_, _ = io.Copy(conn, target)
			}()
		}
	}()
	return listener.Addr().String()
}

// .NET retires an expired connection only on rent, on return and in the
// idle scavenger (HttpConnectionPool.CheckExpirationOnGet/OnReturn,
// System.Net.Http 10.0.11, decompiled): never one a request is using. A
// PUT cannot be replayed, so a conn cut under it fails the request.
func TestTheLifetimeNeverCutsARequestInFlight(t *testing.T) {
	var opened, closing atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// C# never asks the server to close: it just stops using the conn.
		if r.Close {
			closing.Add(1)
		}
		_, _ = io.Copy(io.Discard, r.Body)
		time.Sleep(20 * time.Millisecond)
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			opened.Add(1)
		}
	}
	server.Start()
	defer server.Close()
	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: time.Second, PooledConnectionLifetime: 40 * time.Millisecond})
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}

	var ok, failed atomic.Int32
	var first atomic.Value
	stop := time.Now().Add(3 * time.Second)
	var group sync.WaitGroup
	for range 32 {
		group.Go(func() {
			for time.Now().Before(stop) {
				request, _ := http.NewRequest(http.MethodPut, server.URL, strings.NewReader("{}"))
				response, err := client.Do(request)
				if err != nil {
					failed.Add(1)
					first.CompareAndSwap(nil, err.Error())
					continue
				}
				_, _ = io.Copy(io.Discard, response.Body)
				response.Body.Close()
				ok.Add(1)
			}
		})
	}
	group.Wait()
	if failed.Load() != 0 {
		t.Fatalf("ok=%d failed=%d, first: %v", ok.Load(), failed.Load(), first.Load())
	}
	t.Logf("ok=%d opened=%d", ok.Load(), opened.Load())
	if closing.Load() != 0 {
		t.Fatalf("%d requests said Connection: close", closing.Load())
	}
	// 32 conns live 40 ms each: over 3 s they must have been replaced.
	if opened.Load() <= 64 {
		t.Fatalf("only %d connections opened: the lifetime retired nothing", opened.Load())
	}
}

// Through an https proxy the dialed conn sits under two TLS layers; its
// lifetime still retires it.
func TestTheLifetimeRetiresAConnThroughAnHTTPSProxy(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer server.Close()
	var opened atomic.Int32
	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: time.Second, PooledConnectionLifetime: 300 * time.Millisecond})
	transport.Transport.Proxy = http.ProxyURL(tlsConnectProxy(t, &opened))
	transport.Transport.TLSClientConfig = server.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	put := func() {
		t.Helper()
		request, _ := http.NewRequest(http.MethodPut, server.URL, strings.NewReader("{}"))
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
		t.Fatalf("opened %d proxy connections", opened.Load())
	}
}

// A body net/http cannot replay is never refused: it would fail. It goes
// out on the expired conn and asks the server to close it instead.
func TestAnExpiredConnCarriesABodyItCannotReplay(t *testing.T) {
	var opened, closing atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Close {
			closing.Add(1)
		}
		_, _ = io.Copy(io.Discard, r.Body)
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			opened.Add(1)
		}
	}
	server.Start()
	defer server.Close()
	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: time.Second, PooledConnectionLifetime: 200 * time.Millisecond})
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	put := func() {
		t.Helper()
		body := struct{ io.Reader }{strings.NewReader("{}")}
		request, _ := http.NewRequest(http.MethodPut, server.URL, body)
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
	put()
	time.Sleep(300 * time.Millisecond)
	put()
	put()
	if closing.Load() != 1 || opened.Load() != 2 {
		t.Fatalf("closing=%d opened=%d", closing.Load(), opened.Load())
	}
}
