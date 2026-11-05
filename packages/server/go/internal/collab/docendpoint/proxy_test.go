package docendpoint

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// DocEndpointClient keeps SocketsHttpHandler's environment proxy, the rules
// s3-proxy.json pins for S3: ALL_PROXY counts, "*" bypasses nothing, and a
// loopback endpoint is proxied too.
func TestUsesDotnetsEnvironmentProxy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	lines := make(chan string, 8)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			line, _ := bufio.NewReader(conn).ReadString('\n')
			lines <- strings.TrimRight(line, "\r\n")
			conn.Write([]byte("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
			conn.Close()
		}
	}()
	proxy := "http://" + listener.Addr().String()
	for _, c := range []struct {
		endpoint  string
		variables map[string]string
	}{
		{"http://docs.blok-proxy.invalid/docs", map[string]string{"ALL_PROXY": proxy}},
		{"http://127.0.0.1:9/docs", map[string]string{"HTTP_PROXY": proxy}},
		{"http://docs.blok-proxy.invalid/docs", map[string]string{"HTTP_PROXY": proxy, "NO_PROXY": "*"}},
	} {
		for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "GATEWAY_INTERFACE", "REQUEST_METHOD"} {
			t.Setenv(name, "")
			os.Unsetenv(name)
		}
		for name, value := range c.variables {
			t.Setenv(name, value)
		}
		endpoint, _ := dotnet.ParseAbsoluteURI(c.endpoint)
		_, err := New(Options{Endpoint: endpoint, RequestTimeout: 5 * time.Second}, nil).Load(bg, "a")
		var answer *Error
		if !errors.As(err, &answer) || answer.StatusCode != http.StatusBadGateway {
			t.Fatalf("%s %v: got %v", c.endpoint, c.variables, err)
		}
		select {
		case line := <-lines:
			if want := "GET " + c.endpoint + "/a HTTP/1.1"; line != want {
				t.Fatalf("%s %v: proxy got %q", c.endpoint, c.variables, line)
			}
		default:
			t.Fatalf("%s %v: the proxy saw nothing", c.endpoint, c.variables)
		}
	}
}
