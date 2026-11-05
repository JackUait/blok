package outbound

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// The S3 and doc-endpoint clients run on dotnet.SocketsTransport, and C#'s
// run on HttpClient: the same rows as the guarded fetcher, through the
// operator transport. A failed request is BlockedDestination here.
func TestTheOperatorTransportReadsResponseHeadsAsDotNetDoes(t *testing.T) {
	raw, err := os.ReadFile("../../../../../test/unit/server-conformance/fixtures/outbound-response-heads.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Response string `json:"response"`
		} `json:"cases"`
		Answers []string `json:"answers"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HTTP_PROXY", "")
	t.Setenv("ALL_PROXY", "")
	pad := regexp.MustCompile(`\{PAD:(\d+)\}`)
	client := &http.Client{Transport: dotnet.NewSocketsTransport(dotnet.SocketsOptions{ConnectTimeout: 2 * time.Second})}
	for i, c := range fixture.Cases {
		// net/http gives a 101 a body only for an Upgrade request, which
		// the operator clients never send.
		if strings.HasPrefix(c.Response, "HTTP/1.1 101 ") {
			continue
		}
		wire := pad.ReplaceAllStringFunc(c.Response, func(m string) string {
			n, _ := strconv.Atoi(pad.FindStringSubmatch(m)[1])
			return strings.Repeat("a", n)
		})
		if got := operatorGet(t, client, latin1(wire)); got != fixture.Answers[i] {
			t.Errorf("%q: got %q, C# %q", c.Response, got, fixture.Answers[i])
		}
	}
}

func operatorGet(t *testing.T, client *http.Client, wire []byte) string {
	t.Helper()
	address := serveOnce(t, wire, nil)
	response, err := client.Get("http://" + address + "/")
	if err != nil {
		return "BlockedDestination"
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	if err != nil {
		return "BlockedDestination"
	}
	return bytesAsChars(strconv.Itoa(response.StatusCode) + " ct=" + contentType(response.Header.Get("Content-Type")) +
		" x=" + strings.Join(response.Header.Values("X-Probe"), "|") + " b=" + string(body))
}

// serveOnce answers each request on a connection with wire, then closes it.
func serveOnce(t *testing.T, wire []byte, accepted *atomic.Int32) string {
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
			if accepted != nil {
				accepted.Add(1)
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				buffer := make([]byte, 4096)
				_, _ = conn.Read(buffer)
				_, _ = conn.Write(wire)
			}()
		}
	}()
	return listener.Addr().String()
}

// A pooled connection still carries the next request after a head with
// control bytes, chunked with a trailer: the reader keeps the framing.
func TestTheOperatorTransportReusesAConnAfterAControlByteHead(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var accepted atomic.Int32
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			accepted.Add(1)
			go func() {
				defer conn.Close()
				reader := newLineReader(conn)
				for range 3 {
					if !reader.skipRequest() {
						return
					}
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nX-Probe: a\x01b\x00c\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\nX-T: a\x01\r\n\r\n")
				}
			}()
		}
	}()
	client := &http.Client{Transport: dotnet.NewSocketsTransport(dotnet.SocketsOptions{ConnectTimeout: 2 * time.Second})}
	for round := range 3 {
		response, err := client.Get("http://" + listener.Addr().String() + "/")
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if got := response.Header.Get("X-Probe"); string(body) != "ok" || got != "a\x01b c" {
			t.Fatalf("round %d: %q %q", round, got, body)
		}
	}
	if n := accepted.Load(); n != 1 {
		t.Fatalf("%d connections for 3 requests", n)
	}
}

// lineReader skips one request head at a time.
type lineReader struct {
	conn net.Conn
	buf  []byte
}

func newLineReader(conn net.Conn) *lineReader { return &lineReader{conn: conn} }

func (l *lineReader) skipRequest() bool {
	for {
		if i := strings.Index(string(l.buf), "\r\n\r\n"); i >= 0 {
			l.buf = l.buf[i+4:]
			return true
		}
		chunk := make([]byte, 4096)
		n, err := l.conn.Read(chunk)
		if n == 0 || err != nil {
			return false
		}
		l.buf = append(l.buf, chunk[:n]...)
	}
}
