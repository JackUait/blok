//go:build darwin

package dotnet

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// With no roots of its own, the operator transport asks trustd the way
// SslStream does for HttpClient's defaults (sectrust.Operator), with the
// chain as sent and the request's host.
func TestTheOperatorTransportAsksTrustdAsSslStreamDoes(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer server.Close()
	saved := operatorTrusts
	defer func() { operatorTrusts = saved }()
	var host string
	var sent int
	trusted := true
	operatorTrusts = func(chain [][]byte, name string, anchors [][]byte) bool {
		host, sent = name, len(chain)
		return trusted && anchors == nil
	}
	get := func() error {
		transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 5 * time.Second})
		transport.Transport.Proxy = nil
		response, err := (&http.Client{Transport: transport}).Get(server.URL)
		if err == nil {
			response.Body.Close()
		}
		return err
	}
	if err := get(); err != nil {
		t.Fatal(err)
	}
	if host != "127.0.0.1" || sent != 1 {
		t.Fatalf("asked for %q with %d cert(s)", host, sent)
	}
	trusted = false
	if get() == nil {
		t.Fatal("a chain trustd refuses connected")
	}
}
