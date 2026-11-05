package dotnet

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const connReusePath = "../../../../../test/unit/server-conformance/fixtures/outbound-conn-reuse.json"

type connReuseFixture struct {
	Cases []struct {
		Answer string `json:"answer"`
		Close  bool   `json:"close"`
	} `json:"cases"`
	Answers []struct {
		Tunnel string `json:"tunnel"`
		Plain  string `json:"plain"`
	} `json:"answers"`
}

var padPattern = regexp.MustCompile(`\{PAD:(\d+)\}`)

func expandPad(s string) string {
	return padPattern.ReplaceAllStringFunc(s, func(m string) string {
		n, _ := strconv.Atoi(padPattern.FindStringSubmatch(m)[1])
		return strings.Repeat("a", n)
	})
}

// reuseServer is the C# fixture test's Serve: it logs "conn method" for
// each request, answers the run's first request with first and every
// later one with rest, and hangs up after the first when closing.
func reuseServer(t *testing.T, first, rest string, closing bool) (string, func() []string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var mu sync.Mutex
	var seen []string
	var conns, requests atomic.Int32
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			id := conns.Add(1)
			go func() {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				for {
					request, err := http.ReadRequest(reader)
					if err != nil {
						return
					}
					mu.Lock()
					seen = append(seen, strconv.Itoa(int(id))+" "+request.Method)
					mu.Unlock()
					isFirst := requests.Add(1) == 1
					answer := rest
					if isFirst {
						answer = first
					}
					if _, err := io.WriteString(conn, answer); err != nil {
						return
					}
					if isFirst && closing {
						return
					}
				}
			}()
		}
	}()
	return listener.Addr().String(), func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// The twin of C#'s ConnectionReuseMatchesTheFixture: after each answer the
// next request takes the conn SocketsHttpHandler would take.
func TestConnectionReuseMatchesTheFixture(t *testing.T) {
	raw, err := os.ReadFile(connReusePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture connReuseFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for i, c := range fixture.Cases {
		answer, want := expandPad(c.Answer), fixture.Answers[i]
		t.Run(strconv.Itoa(i)+" tunnel", func(t *testing.T) {
			address, seen := reuseServer(t, answer, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", c.Close)
			transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 10 * time.Second})
			transport.Transport.Proxy = http.ProxyURL(&url.URL{Scheme: "http", Host: address, User: url.UserPassword("u", "p")})
			outcome := "error "
			if response, err := (&http.Client{Transport: transport}).Get("https://localhost:1/"); err == nil {
				response.Body.Close()
				outcome = strconv.Itoa(response.StatusCode)
			} else if strings.Contains(err.Error(), "CONNECT answered ") {
				outcome = "error " + err.Error()[strings.LastIndex(err.Error(), " ")+1:]
			}
			if got := strings.Join(append([]string{outcome}, seen()...), "|"); got != want.Tunnel {
				t.Errorf("case %d %q\ngot %q\nC#  %q", i, c.Answer[:min(len(c.Answer), 160)], got, want.Tunnel)
			}
		})
		t.Run(strconv.Itoa(i)+" plain", func(t *testing.T) {
			address, seen := reuseServer(t, answer, "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", c.Close)
			client := &http.Client{Transport: NewSocketsTransport(SocketsOptions{ConnectTimeout: 10 * time.Second})}
			var outcomes []string
			for range 2 {
				response, err := client.Get("http://" + address + "/")
				if err != nil {
					outcomes = append(outcomes, "error")
					continue
				}
				_, _ = io.Copy(io.Discard, response.Body)
				response.Body.Close()
				outcomes = append(outcomes, strconv.Itoa(response.StatusCode))
			}
			if got := strings.Join(append(outcomes, seen()...), "|"); got != want.Plain {
				t.Errorf("case %d %q\ngot %q\nC#  %q", i, c.Answer[:min(len(c.Answer), 160)], got, want.Plain)
			}
		})
	}
}
