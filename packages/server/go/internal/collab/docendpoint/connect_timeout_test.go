package docendpoint

import (
	"errors"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// SocketsHttpHandler.ConnectTimeout bounds the TCP connect and the TLS
// handshake, and its cancellation is an OperationCanceledException, which
// SendAsync turns into "timed out after". Measured with dotnet fsi: a
// black-holed SYN and a silent TLS listener both fail at the connect cap.

type dialTimeout struct{}

func (dialTimeout) Error() string   { return "i/o timeout" }
func (dialTimeout) Timeout() bool   { return true }
func (dialTimeout) Temporary() bool { return true }

func TestAConnectTimeoutReadsAsTimedOut(t *testing.T) {
	r := &recorder{respond: func(*http.Request) (*http.Response, error) {
		return nil, &net.OpError{Op: "dial", Net: "tcp", Err: dialTimeout{}}
	}}
	_, err := client(t, r, setup{}).Load(bg, "a")
	var endpoint *Error
	if !errors.As(err, &endpoint) || endpoint.Message != "collab: the doc endpoint GET timed out after 30s." {
		t.Fatalf("got %v", err)
	}
}

func TestAStalledTLSHandshakeDiesAtTheConnectTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		var held []net.Conn
		defer func() {
			for _, conn := range held {
				conn.Close()
			}
		}()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			held = append(held, conn)
		}
	}()
	saved := connectTimeout
	connectTimeout = 300 * time.Millisecond
	t.Cleanup(func() { connectTimeout = saved })
	endpoint, _ := dotnet.ParseAbsoluteURI("https://" + listener.Addr().String() + "/docs")
	c := New(Options{Endpoint: endpoint, RequestTimeout: 3 * time.Second}, nil)

	start := time.Now()
	_, err = c.Load(bg, "a")
	if elapsed := time.Since(start); elapsed > 1500*time.Millisecond {
		t.Fatalf("failed after %v with %v", elapsed, err)
	}
	var timedOut *Error
	if !errors.As(err, &timedOut) || timedOut.Message != "collab: the doc endpoint GET timed out after 3s." {
		t.Fatalf("got %v", err)
	}
}
