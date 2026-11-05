package dotnet

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httptrace"
	"time"
)

// SocketsOptions are the SocketsHttpHandler settings the C# server sets.
type SocketsOptions struct {
	// ConnectTimeout bounds the TCP connect, the proxy tunnel and the TLS
	// handshake together.
	ConnectTimeout time.Duration
	// PooledConnectionLifetime: 0 means none.
	PooledConnectionLifetime time.Duration
}

// SocketsTransport is an http.Transport that keeps SocketsHttpHandler's
// connection rules. Transport may be adjusted before the first request.
type SocketsTransport struct {
	Transport *http.Transport
	options   SocketsOptions
}

// pooledConnectionIdleTimeout is HttpHandlerDefaults.DefaultPooledConnectionIdleTimeout.
const pooledConnectionIdleTimeout = time.Minute

// NewSocketsTransport honours the environment proxy, asks for no
// compression, and follows .NET's pool timeouts.
func NewSocketsTransport(options SocketsOptions) *SocketsTransport {
	dialer := &net.Dialer{}
	return &SocketsTransport{
		options: options,
		Transport: &http.Transport{
			Proxy: OSProxy(),
			DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
				born := time.Now()
				if options.ConnectTimeout > 0 {
					var cancel context.CancelFunc
					ctx, cancel = context.WithDeadline(ctx, born.Add(options.ConnectTimeout))
					defer cancel()
				}
				conn, err := dialer.DialContext(ctx, network, address)
				if err != nil {
					return nil, err
				}
				if options.ConnectTimeout > 0 {
					// The tunnel and the handshake run on this conn; the
					// deadline is lifted once the connection is handed out.
					_ = conn.SetDeadline(born.Add(options.ConnectTimeout))
				}
				return &pooledConn{Conn: conn, born: born}, nil
			},
			IdleConnTimeout:    pooledConnectionIdleTimeout,
			DisableCompression: true,
		},
	}
}

type pooledConn struct {
	net.Conn
	born time.Time
}

func (t *SocketsTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	trace := &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			conn := info.Conn
			if secure, ok := conn.(*tls.Conn); ok {
				conn = secure.NetConn()
			}
			pooled, ok := conn.(*pooledConn)
			if !ok {
				return
			}
			_ = pooled.SetDeadline(time.Time{})
			// net/http cannot drop a pooled conn before handing it out, so
			// one past its life serves this request and then closes.
			if t.options.PooledConnectionLifetime > 0 && time.Since(pooled.born) >= t.options.PooledConnectionLifetime {
				request.Close = true
			}
		},
	}
	request = request.WithContext(httptrace.WithClientTrace(request.Context(), trace))
	return t.Transport.RoundTrip(request)
}

// CloseIdleConnections closes the pool's idle connections.
func (t *SocketsTransport) CloseIdleConnections() { t.Transport.CloseIdleConnections() }
