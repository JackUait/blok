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

// recordingProxy answers CONNECT by mode, as ProxyConnectTunnelTests'
// proxy does, and logs "conn method auth=..." for each request.
func recordingProxy(t *testing.T, mode string) (*url.URL, func() []string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var mu sync.Mutex
	var seen []string
	var conns atomic.Int32
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			id := conns.Add(1)
			go func() {
				defer client.Close()
				reader := bufio.NewReader(client)
				for {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					auth := request.Header.Get("Proxy-Authorization")
					if auth == "" {
						auth = "no"
					}
					mu.Lock()
					seen = append(seen, strconv.Itoa(int(id))+" "+request.Method+" auth="+auth)
					mu.Unlock()
					answer := ""
					switch {
					case (mode == "challenge" || mode == "challenge-domain" || mode == "challenge-empty-domain") && auth == "no":
						answer = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\n\r\n"
					case mode == "challenge-close" && auth == "no":
						answer = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
					case mode == "no-challenge":
						answer = "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n"
					}
					if answer != "" {
						_, _ = io.WriteString(client, answer)
						if strings.Contains(answer, "Connection: close") {
							return
						}
						continue
					}
					target, err := net.Dial("tcp", request.Host)
					if err != nil {
						return
					}
					defer target.Close()
					status := "200 Connection established"
					if mode == "201" {
						// Tunnels anyway: a client that takes any 2xx gets through.
						status = "201 Created"
					}
					_, _ = io.WriteString(client, "HTTP/1.1 "+status+"\r\n\r\n")
					go func() { _, _ = io.Copy(target, reader) }()
					_, _ = io.Copy(client, target)
					return
				}
			}()
		}
	}()
	// GetCredentialsFromString splits "domain\user": "\u" has an empty
	// domain, the same credential as C#'s plain "challenge" row.
	name := map[string]string{"challenge-domain": `DOM\u`, "challenge-empty-domain": `\u`}[mode]
	if name == "" {
		name = "u"
	}
	proxy := &url.URL{Scheme: "http", Host: listener.Addr().String(), User: url.UserPassword(name, "p")}
	return proxy, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// The twin of C#'s ProxyConnectTunnelTests: SocketsHttpHandler sends the
// proxy credentials only after a 407 Basic challenge
// (AuthenticationHelper.SendWithProxyAuthAsync passes preAuthenticate:
// false), retries on the same conn unless the 407 closed it, and opens the
// tunnel only on 200 (HttpConnectionPool.EstablishProxyTunnelAsync).
func TestOpensATunnelAsSocketsHttpHandlerDoes(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer target.Close()
	trust := target.Client().Transport.(*http.Transport).TLSClientConfig
	for _, c := range []struct{ mode, want string }{
		{"challenge", "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic dTpw"},
		{"challenge-domain", "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic RE9NXHU6cA=="},
		{"challenge-empty-domain", "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic dTpw"},
		{"challenge-close", "200 ok|1 CONNECT auth=no|2 CONNECT auth=Basic dTpw"},
		{"no-challenge", "error|1 CONNECT auth=no"},
		{"201", "error|1 CONNECT auth=no"},
		{"200", "200 ok|1 CONNECT auth=no"},
	} {
		t.Run(c.mode, func(t *testing.T) {
			proxy, seen := recordingProxy(t, c.mode)
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 2 * time.Second})
			transport.Transport.Proxy = http.ProxyURL(proxy)
			transport.Transport.TLSClientConfig = trust.Clone()
			transport.Transport.TLSClientConfig.ServerName = "127.0.0.1"
			outcome := "error"
			if response, err := (&http.Client{Transport: transport}).Get(target.URL); err == nil {
				body, _ := io.ReadAll(response.Body)
				response.Body.Close()
				outcome = strconv.Itoa(response.StatusCode) + " " + string(body)
			}
			if got := strings.Join(append([]string{outcome}, seen()...), "|"); got != c.want {
				t.Errorf("got %q, C# %q", got, c.want)
			}
		})
	}
}
