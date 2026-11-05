package dotnet

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// SocketsHttpHandler offers no ALPN on an HTTP/1.1 connection
// (HttpConnectionPool's _sslOptionsHttp11.ApplicationProtocols = null,
// System.Net.Http 10.0.11; measured: a default HttpClient negotiates
// nothing with a server offering h2 and http/1.1). net/http adds h2 to a
// nil TLSClientConfig, and an h2 answer would break the HTTP/1.1 reader.
func TestOffersNoALPNAsSocketsHttpHandlerDoes(t *testing.T) {
	var mu sync.Mutex
	negotiated := "unset"
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		negotiated = r.TLS.NegotiatedProtocol
		mu.Unlock()
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()

	transport := NewSocketsTransport(SocketsOptions{ConnectTimeout: 5 * time.Second})
	transport.Transport.Proxy = nil
	transport.Transport.TLSClientConfig = server.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	transport.Transport.TLSClientConfig.NextProtos = []string{"h2", "http/1.1"}
	response, err := (&http.Client{Transport: transport}).Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	mu.Lock()
	defer mu.Unlock()
	if negotiated != "" || response.ProtoMajor != 1 {
		t.Fatalf("negotiated %q, answered over %s", negotiated, response.Proto)
	}
}
