package dotnet

import (
	"bufio"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// rawProbe answers with a header .NET keeps and net/http refuses. .NET
// trims before it turns the NUL into a space, so the value is "a\x01b ".
var rawProbe = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	conn, buffered, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	_, _ = buffered.WriteString("HTTP/1.1 200 OK\r\nX-Probe: a\x01b\x00\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
	_ = buffered.Flush()
})

// socks5Tunneler grants every SOCKS5 CONNECT with no auth and relays it.
func socks5Tunneler(t *testing.T, used *atomic.Int32) string {
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
			used.Add(1)
			go func() {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				greeting := make([]byte, 2)
				if _, err := io.ReadFull(reader, greeting); err != nil {
					return
				}
				_, _ = io.ReadFull(reader, make([]byte, greeting[1]))
				_, _ = conn.Write([]byte{5, 0})
				head := make([]byte, 4)
				if _, err := io.ReadFull(reader, head); err != nil {
					return
				}
				var host string
				switch head[3] {
				case 1:
					ip := make([]byte, 4)
					_, _ = io.ReadFull(reader, ip)
					host = net.IP(ip).String()
				case 3:
					size, _ := reader.ReadByte()
					name := make([]byte, size)
					_, _ = io.ReadFull(reader, name)
					host = string(name)
				default:
					return
				}
				port := make([]byte, 2)
				_, _ = io.ReadFull(reader, port)
				target, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port)))))
				if err != nil {
					return
				}
				defer target.Close()
				_, _ = conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
				go func() { _, _ = io.Copy(target, reader) }()
				_, _ = io.Copy(conn, target)
			}()
		}
	}()
	return listener.Addr().String()
}

// rawForwardProxy is an http or https forward proxy that answers every
// request itself with rawProbe.
func rawForwardProxy(t *testing.T, secure bool, used *atomic.Int32) *url.URL {
	t.Helper()
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		used.Add(1)
		rawProbe(w, r)
	}))
	if secure {
		proxy.StartTLS()
	} else {
		proxy.Start()
	}
	t.Cleanup(proxy.Close)
	parsed, _ := url.Parse(proxy.URL)
	return parsed
}

// The S3 and doc-endpoint clients read responses as C#'s HttpClient does
// on every route SocketsHttpHandler has: direct, an http or https proxy
// (CONNECT or forward), and SOCKS4, SOCKS4a and SOCKS5.
func TestEveryRouteReadsAHeaderNetHTTPWouldRefuse(t *testing.T) {
	secure := httptest.NewTLSServer(rawProbe)
	defer secure.Close()
	plain := httptest.NewServer(rawProbe)
	defer plain.Close()
	trust := secure.Client().Transport.(*http.Transport).TLSClientConfig
	byName := func(raw string) string { return strings.Replace(raw, "127.0.0.1", "localhost", 1) }
	var used atomic.Int32

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
		{name: "http proxy, http target", target: plain.URL, proxy: func() *url.URL { return rawForwardProxy(t, false, &used) }},
		{name: "https proxy, http target", target: plain.URL, proxy: func() *url.URL { return rawForwardProxy(t, true, &used) }},
		{name: "socks4, https target", target: secure.URL, socks: "socks4://" + socks4Tunneler(t)},
		{name: "socks4a, https target", target: byName(secure.URL), socks: "socks4a://" + socks4Tunneler(t)},
		{name: "socks5, https target", target: byName(secure.URL), socks: "socks5://" + socks5Tunneler(t, &used)},
		{name: "socks5, http target", target: plain.URL, socks: "socks5://" + socks5Tunneler(t, &used)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			used.Store(0)
			t.Setenv("ALL_PROXY", c.socks)
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})
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
				if got := response.Header.Get("X-Probe"); got != "a\x01b " || string(body) != "ok" {
					t.Fatalf("round %d: X-Probe %q, body %q", round, got, body)
				}
			}
			if counted := strings.Contains(c.socks, "socks5") || strings.HasSuffix(c.name, "http target") && c.proxy != nil; counted && used.Load() == 0 {
				t.Fatal("the proxy was not used")
			}
		})
	}
}

// fakeConn reads a fixed stream and discards writes.
type fakeConn struct {
	net.Conn
	in io.Reader
}

func (f fakeConn) Read(p []byte) (int, error)  { return f.in.Read(p) }
func (f fakeConn) Write(p []byte) (int, error) { return len(p), nil }
func (f fakeConn) Close() error                { return nil }

// The headers net/http hands back belong to the response that carried
// them, even when the conn has read a later head first.
func TestEachResponseTakesTheHeadersOfItsOwnHead(t *testing.T) {
	wire := newWireConn(fakeConn{in: strings.NewReader(
		"HTTP/1.1 200 OK\r\nX-Probe: one\x01\r\nContent-Length: 1\r\n\r\na" +
			"HTTP/1.1 200 OK\r\nX-Probe: two\x01\r\nContent-Length: 1\r\n\r\nb")})
	reader := bufio.NewReader(wire)
	var responses []*http.Response
	for range 2 {
		response, err := http.ReadResponse(reader, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.ReadAll(response.Body)
		responses = append(responses, response)
	}
	for i, want := range []string{"one\x01", "two\x01"} {
		if got := takeHeader(responses[i]).Get("X-Probe"); got != want {
			t.Errorf("response %d: X-Probe %q, want %q", i, got, want)
		}
	}
	if got := takeHeader(responses[0]); len(got) != 0 {
		t.Errorf("a head was taken twice: %v", got)
	}
	if pending := wire.pendingHeads(); pending != 0 {
		t.Errorf("%d heads left on the conn", pending)
	}
	forged := &http.Response{Header: http.Header{headKey: {"1"}}}
	if got := takeHeader(forged); len(got) != 0 {
		t.Errorf("a made-up id found a head: %v", got)
	}
}

// probeServer answers each request on a conn with X-Probe naming the conn
// and the request, then keeps the conn.
func probeServer(t *testing.T) (string, *atomic.Int32) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var accepted atomic.Int32
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			id := accepted.Add(1)
			go func() {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				for n := 1; ; n++ {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					_, _ = io.Copy(io.Discard, request.Body)
					_, _ = io.WriteString(conn, "HTTP/1.1 103 Early Hints\r\nX-Probe: early\r\n\r\n"+
						"HTTP/1.1 200 OK\r\nX-Probe: c"+strconv.Itoa(int(id))+"r"+strconv.Itoa(n)+"\x01\r\nContent-Length: 2\r\n\r\nok")
				}
			}()
		}
	}()
	return "http://" + listener.Addr().String() + "/", &accepted
}

func probe(t *testing.T, client *http.Client, target string) string {
	t.Helper()
	response, err := client.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if body, _ := io.ReadAll(response.Body); string(body) != "ok" {
		t.Fatalf("body %q", body)
	}
	return response.Header.Get("X-Probe")
}

// Reused requests on one conn each get their own final head, never the
// interim one before it.
func TestReusedRequestsGetTheirOwnFinalHeads(t *testing.T) {
	target, accepted := probeServer(t)
	client := &http.Client{Transport: NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})}
	for n := 1; n <= 5; n++ {
		if got, want := probe(t, client, target), "c1r"+strconv.Itoa(n)+"\x01"; got != want {
			t.Fatalf("request %d: X-Probe %q, want %q", n, got, want)
		}
	}
	if n := accepted.Load(); n != 1 {
		t.Fatalf("%d conns for 5 requests", n)
	}
}

// An expired conn refuses the write and net/http retries on a new one: the
// answer carries the new conn's head, not the dead conn's last one.
func TestARetryOnANewConnTakesTheNewConnsHead(t *testing.T) {
	target, accepted := probeServer(t)
	client := &http.Client{Transport: NewSocketsTransport(SocketsOptions{
		ConnectTimeout: 2 * time.Second, PooledConnectionLifetime: 50 * time.Millisecond})}
	if got := probe(t, client, target); got != "c1r1\x01" {
		t.Fatalf("first: X-Probe %q", got)
	}
	time.Sleep(100 * time.Millisecond)
	if got := probe(t, client, target); got != "c2r1\x01" {
		t.Fatalf("retry: X-Probe %q", got)
	}
	if n := accepted.Load(); n != 2 {
		t.Fatalf("%d conns", n)
	}
}

// badSecondHeadServer answers a conn's first request well and its second
// with bad. It counts every request it reads, on any conn.
func badSecondHeadServer(t *testing.T, bad string) (string, *atomic.Int32) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var requests atomic.Int32
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				for n := 1; ; n++ {
					if _, err := http.ReadRequest(reader); err != nil {
						return
					}
					requests.Add(1)
					if n == 1 {
						_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
						continue
					}
					_, _ = io.WriteString(conn, bad)
					return
				}
			}()
		}
	}()
	return "http://" + listener.Addr().String() + "/", &requests
}

// .NET retries a request only when no byte of its answer arrived
// (HttpConnection.SendAsync sets _canRetry only on an empty read buffer).
// A bad head on a reused conn fails the request; it never goes out twice.
func TestABadHeadOnAReusedConnIsNotSentAgain(t *testing.T) {
	for _, c := range []struct{ name, bad string }{
		{"malformed", "HTTP/1.1 200 OK\r\nbad line\r\n\r\n"},
		{"truncated", "HTTP/1.1 200 OK\r\nContent-Le"},
		{"over 64 KiB", "HTTP/1.1 200 OK\r\nX-Big: " + strings.Repeat("a", 70<<10) + "\r\n\r\n"},
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(c.name+" "+method, func(t *testing.T) {
				target, requests := badSecondHeadServer(t, c.bad)
				client := &http.Client{Transport: NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})}
				for n := 1; n <= 2; n++ {
					request, _ := http.NewRequest(method, target, nil)
					response, err := client.Do(request)
					if err == nil {
						_, _ = io.Copy(io.Discard, response.Body)
						response.Body.Close()
					}
					if (err == nil) != (n == 1) {
						t.Fatalf("request %d: error %v", n, err)
					}
				}
				if n := requests.Load(); n != 2 {
					t.Fatalf("the server read %d requests, .NET sends 2", n)
				}
			})
		}
	}
}
