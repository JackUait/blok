package dotnet

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"net/url"
	"strconv"
	"sync"
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
	// socks4 is the environment's SOCKS4 or SOCKS4a proxy for a request;
	// net/http dials only SOCKS5, so the dial opens these itself.
	socks4 func(*http.Request) *url.URL
}

type socks4Key struct{}

// pooledConnectionIdleTimeout is HttpHandlerDefaults.DefaultPooledConnectionIdleTimeout.
const pooledConnectionIdleTimeout = time.Minute

// NewSocketsTransport honours the environment proxy, asks for no
// compression, and follows .NET's pool timeouts.
func NewSocketsTransport(options SocketsOptions) *SocketsTransport {
	dialer := &net.Dialer{}
	environment := OSProxy()
	socks4 := func(request *http.Request) *url.URL {
		if environment == nil {
			return nil
		}
		proxy, _ := environment(request)
		if proxy == nil || proxy.Scheme != "socks4" && proxy.Scheme != "socks4a" {
			return nil
		}
		return proxy
	}
	proxy := environment
	if environment != nil {
		proxy = func(request *http.Request) (*url.URL, error) {
			if socks4(request) != nil {
				return nil, nil
			}
			return environment(request)
		}
	}
	return &SocketsTransport{
		options: options,
		socks4:  socks4,
		Transport: &http.Transport{
			Proxy: proxy,
			DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
				born := time.Now()
				if options.ConnectTimeout > 0 {
					var cancel context.CancelFunc
					ctx, cancel = context.WithDeadline(ctx, born.Add(options.ConnectTimeout))
					defer cancel()
				}
				target := address
				socks, _ := ctx.Value(socks4Key{}).(*url.URL)
				if socks != nil {
					address = socks.Host
				}
				conn, err := dialer.DialContext(ctx, network, address)
				if err != nil {
					return nil, err
				}
				if socks != nil {
					if deadline, ok := ctx.Deadline(); ok {
						_ = conn.SetDeadline(deadline)
					}
					if err := socks4Tunnel(ctx, conn, socks, target); err != nil {
						conn.Close()
						return nil, err
					}
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

// pooledConn knows its age. .NET drops a connection past
// PooledConnectionLifetime on rent, on return and in its idle scavenger,
// never under a request. Closing a conn from outside net/http is never safe:
// an idle conn can be handed to a request before any trace runs, and
// CloseIdleConnections can close a conn whose bodiless answer is still on
// its way to the caller.
//
// So an expired conn refuses the next request's first write. Nothing
// reaches the wire, net/http closes it, and it retries a request on a
// reused conn that wrote nothing when the body can be replayed
// (transport.go shouldRetryRequest, nothingWrittenError). net/http pools a
// conn before a bodiless answer reaches its caller, and closing it then
// fails that caller, so the refusal first waits for the last request on
// the conn to return.
type pooledConn struct {
	net.Conn
	born time.Time
	mu   sync.Mutex
	// holder is closed when the RoundTrip that last took the conn returns.
	holder chan struct{}
	// refusing is the holder before the request that refuses; nil means
	// write normally.
	refusing chan struct{}
}

var errExpired = errors.New("dotnet: the pooled connection is past its lifetime")

// take records the RoundTrip that now holds the conn and, when refuse is
// set, makes its writes fail.
func (c *pooledConn) take(done chan struct{}, refuse bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if refuse {
		c.refusing = c.holder
		if c.refusing == nil {
			c.refusing = closedChannel
		}
	}
	c.holder = done
}

var closedChannel = func() chan struct{} { c := make(chan struct{}); close(c); return c }()

func (c *pooledConn) Write(b []byte) (int, error) {
	c.mu.Lock()
	previous := c.refusing
	c.mu.Unlock()
	if previous != nil {
		<-previous
		return 0, errExpired
	}
	return c.Conn.Write(b)
}

func (t *SocketsTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	ctx := request.Context()
	if proxy := t.socks4(request); proxy != nil {
		ctx = context.WithValue(ctx, socks4Key{}, proxy)
	}
	request = request.Clone(ctx)
	header := request.Header
	lifetime := t.options.PooledConnectionLifetime
	replayable := request.Body == nil || request.Body == http.NoBody || request.GetBody != nil
	done := make(chan struct{})
	defer close(done)
	trace := &httptrace.ClientTrace{
		// Runs before the request is written. net/http's copy of a request
		// with a body shares this header map.
		GotConn: func(info httptrace.GotConnInfo) {
			pooled := findPooled(info.Conn)
			if pooled == nil {
				return
			}
			_ = pooled.SetDeadline(time.Time{})
			expired := lifetime > 0 && time.Since(pooled.born) > lifetime
			refuse := expired && info.Reused && replayable
			pooled.take(done, refuse)
			if !expired || refuse {
				return
			}
			// net/http would not retry this one: it goes out on the old
			// conn and asks the server to close it.
			header.Set("Connection", "close")
		},
	}
	request = request.WithContext(httptrace.WithClientTrace(request.Context(), trace))
	return t.Transport.RoundTrip(request)
}

// findPooled unwraps every TLS layer: an https proxy puts the target's TLS
// over the proxy's.
func findPooled(conn net.Conn) *pooledConn {
	for {
		switch c := conn.(type) {
		case *pooledConn:
			return c
		case interface{ NetConn() net.Conn }:
			conn = c.NetConn()
		default:
			return nil
		}
	}
}

// CloseIdleConnections closes the pool's idle connections.
func (t *SocketsTransport) CloseIdleConnections() { t.Transport.CloseIdleConnections() }

// socks4Tunnel is SocksHelper.EstablishSocks4TunnelAsync (System.Net.Http
// 10.0.11, decompiled): an IPv4 address (an IPv4-mapped one unmapped),
// else SOCKS4 resolves the name to IPv4 here and SOCKS4a sends it behind
// 0.0.0.255; then the user name. Reply 90 grants the tunnel.
func socks4Tunnel(ctx context.Context, conn net.Conn, proxy *url.URL, target string) error {
	host, portText, err := net.SplitHostPort(target)
	if err != nil {
		return err
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return err
	}
	var address netip.Addr
	if parsed, err := netip.ParseAddr(host); err == nil {
		if !parsed.Unmap().Is4() {
			return errors.New("socks: SOCKS4 does not support IPv6 addresses")
		}
		address = parsed.Unmap()
	} else if proxy.Scheme == "socks4" {
		found, err := net.DefaultResolver.LookupNetIP(ctx, "ip4", host)
		if err != nil || len(found) == 0 {
			return errors.New("socks: no IPv4 address for the host")
		}
		address = found[0].Unmap()
	}
	request := []byte{4, 1, byte(port >> 8), byte(port)}
	if address.IsValid() {
		ip := address.As4()
		request = append(request, ip[:]...)
	} else {
		request = append(request, 0, 0, 0, 255)
	}
	request = append(append(request, proxy.User.Username()...), 0)
	if !address.IsValid() {
		request = append(append(request, host...), 0)
	}
	if _, err := conn.Write(request); err != nil {
		return err
	}
	reply := make([]byte, 8)
	if _, err := io.ReadFull(conn, reply); err != nil {
		return err
	}
	switch reply[1] {
	case 90:
		return nil
	case 93:
		return errors.New("socks: the proxy refused the user")
	default:
		return fmt.Errorf("socks: the proxy refused the connect (%02X)", reply[1])
	}
}
