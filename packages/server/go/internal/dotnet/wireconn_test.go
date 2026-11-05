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
