package dotnet

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
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

	"golang.org/x/net/proxy"
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
// connection rules. Transport holds the settings and may be adjusted before
// the first request; the requests run on a copy of it whose dials own the
// proxy tunnels and TLS, so every response is read under net/http by
// wireConn, as .NET reads it.
type SocketsTransport struct {
	Transport *http.Transport
	options   SocketsOptions
	once      sync.Once
	inner     *http.Transport
}

// routeKey carries a request's route to the dials.
type routeKey struct{}

type route struct {
	scheme string
	proxy  *url.URL
}

// pooledConnectionIdleTimeout is HttpHandlerDefaults.DefaultPooledConnectionIdleTimeout.
const pooledConnectionIdleTimeout = time.Minute

// NewSocketsTransport honours the environment proxy, asks for no
// compression, and follows .NET's pool timeouts.
func NewSocketsTransport(options SocketsOptions) *SocketsTransport {
	return &SocketsTransport{
		options: options,
		Transport: &http.Transport{
			Proxy:              OSProxy(),
			IdleConnTimeout:    pooledConnectionIdleTimeout,
			DisableCompression: true,
		},
	}
}

// transport is the copy requests run on. net/http sees a proxy only for
// an http target behind an http or https proxy, where it writes the
// absolute-form request; every other route is tunnelled in the dial.
func (t *SocketsTransport) transport() *http.Transport {
	t.once.Do(func() {
		inner := t.Transport.Clone()
		inner.Proxy = func(request *http.Request) (*url.URL, error) {
			r, _ := request.Context().Value(routeKey{}).(*route)
			if r == nil || r.proxy == nil || r.scheme == "https" || r.proxy.Scheme != "http" && r.proxy.Scheme != "https" {
				return nil, nil
			}
			return r.proxy, nil
		}
		inner.DialContext = func(ctx context.Context, _, address string) (net.Conn, error) {
			return t.dial(ctx, address, false)
		}
		inner.DialTLSContext = func(ctx context.Context, _, address string) (net.Conn, error) {
			return t.dial(ctx, address, true)
		}
		t.inner = inner
	})
	return t.inner
}

// dial opens address under one ConnectTimeout for the connect, any proxy
// TLS and tunnel, and the target's TLS. secure is net/http asking for TLS:
// to the target, or to an https proxy of an http target.
func (t *SocketsTransport) dial(ctx context.Context, address string, secure bool) (net.Conn, error) {
	born := time.Now()
	if t.options.ConnectTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, born.Add(t.options.ConnectTimeout))
		defer cancel()
	}
	r, _ := ctx.Value(routeKey{}).(*route)
	if r == nil {
		r = &route{scheme: "http"}
		if secure {
			r.scheme = "https"
		}
	}
	proxy := r.proxy
	hop, tunnel := address, ""
	if proxy != nil && (r.scheme == "https" || proxy.Scheme != "http" && proxy.Scheme != "https") {
		hop, tunnel = proxyAddress(proxy), address
	}
	var dialer net.Dialer
	raw, err := dialer.DialContext(ctx, "tcp", hop)
	if err != nil {
		return nil, err
	}
	pooled := &pooledConn{Conn: raw, born: born}
	var conn net.Conn = pooled
	fail := func(err error) (net.Conn, error) {
		raw.Close()
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		// Lifted once the connection is handed out.
		_ = raw.SetDeadline(deadline)
	}
	if proxy != nil && proxy.Scheme == "https" {
		if conn, err = t.handshake(ctx, conn, proxy.Hostname()); err != nil {
			return fail(err)
		}
	}
	if tunnel != "" {
		switch proxy.Scheme {
		case "socks4", "socks4a":
			err = socks4Tunnel(ctx, conn, proxy, tunnel)
		case "socks5", "socks5h":
			err = socks5Tunnel(ctx, conn, proxy, tunnel)
		default:
			err = connectTunnel(conn, proxy, tunnel)
		}
		if err != nil {
			return fail(err)
		}
	}
	if secure && r.scheme == "https" {
		host, _, _ := net.SplitHostPort(address)
		if conn, err = t.handshake(ctx, conn, host); err != nil {
			return fail(err)
		}
	}
	return newWireConn(conn), nil
}

// handshake is net/http's addTLS: the configured TLS, named host when the
// config names nothing.
func (t *SocketsTransport) handshake(ctx context.Context, conn net.Conn, host string) (net.Conn, error) {
	config := &tls.Config{}
	if t.Transport.TLSClientConfig != nil {
		config = t.Transport.TLSClientConfig.Clone()
	}
	if config.ServerName == "" {
		config.ServerName = host
	}
	secure := tls.Client(conn, config)
	if err := secure.HandshakeContext(ctx); err != nil {
		return nil, err
	}
	return secure, nil
}

// proxyAddress is the proxy's host:port; with no port, GetUriFromString's
// default (proxy.go): 443 for https, else 80.
func proxyAddress(proxy *url.URL) string {
	if proxy.Port() != "" {
		return proxy.Host
	}
	port := "80"
	if proxy.Scheme == "https" {
		port = "443"
	}
	return net.JoinHostPort(proxy.Hostname(), port)
}

// connectTunnel asks an http or https proxy to CONNECT, as Rust's operator
// client does: Host, and Basic credentials when the proxy URL has them.
// Any 2xx opens the tunnel; bytes after the answer are refused.
func connectTunnel(conn net.Conn, proxy *url.URL, target string) error {
	head := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n"
	if user := proxy.User; user != nil {
		password, _ := user.Password()
		head += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(user.Username()+":"+password)) + "\r\n"
	}
	if _, err := io.WriteString(conn, head+"\r\n"); err != nil {
		return err
	}
	in := bufio.NewReader(conn)
	status, _, _, err := NewResponseReader(in, maxResponseHeadersBytes).ReadHead()
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("proxy: CONNECT answered %d", status)
	}
	if in.Buffered() > 0 {
		return errors.New("proxy: bytes after the tunnel answer")
	}
	return nil
}

// socks5Tunnel opens a SOCKS5 tunnel on conn with the dialer net/http
// bundles (x/net's socks), the proxy's credentials included.
func socks5Tunnel(ctx context.Context, conn net.Conn, proxyURL *url.URL, target string) error {
	var auth *proxy.Auth
	if user := proxyURL.User; user != nil {
		password, _ := user.Password()
		auth = &proxy.Auth{User: user.Username(), Password: password}
	}
	dialer, err := proxy.SOCKS5("tcp", proxyURL.Host, auth, nil)
	if err != nil {
		return err
	}
	withConn, ok := dialer.(interface {
		DialWithConn(context.Context, net.Conn, string, string) (net.Addr, error)
	})
	if !ok {
		return errors.New("socks: no dialer over a conn")
	}
	_, err = withConn.DialWithConn(ctx, conn, "tcp", target)
	return err
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
	inner := t.transport()
	r := &route{scheme: request.URL.Scheme}
	if t.Transport.Proxy != nil {
		proxy, err := t.Transport.Proxy(request)
		if err != nil {
			return nil, err
		}
		r.proxy = proxy
	}
	request = request.Clone(context.WithValue(request.Context(), routeKey{}, r))
	header := request.Header
	method := request.Method
	lifetime := t.options.PooledConnectionLifetime
	replayable := request.Body == nil || request.Body == http.NoBody || request.GetBody != nil
	done := make(chan struct{})
	defer close(done)
	var wire *wireConn
	trace := &httptrace.ClientTrace{
		// Runs before the request is written. net/http's copy of a request
		// with a body shares this header map.
		GotConn: func(info httptrace.GotConnInfo) {
			if w, ok := info.Conn.(*wireConn); ok {
				w.expect(method)
				wire = w
			}
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
	response, err := inner.RoundTrip(request)
	if err == nil && wire != nil {
		response.Header = wire.header()
	}
	return response, err
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
func (t *SocketsTransport) CloseIdleConnections() { t.transport().CloseIdleConnections() }

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
