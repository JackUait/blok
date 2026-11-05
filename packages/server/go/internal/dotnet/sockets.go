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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/proxy"

	"github.com/JackUait/blok/packages/server/go/internal/sectrust"
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

	// parked are proxy conns a finished NTLM handshake signed, keyed by
	// proxy and address. The dial hands them out first, as .NET's pool
	// would reuse them.
	parkedMu sync.Mutex
	parked   map[string][]parkedConn
}

type parkedConn struct {
	conn net.Conn
	at   time.Time
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
			// net/http would send the user's Basic up front; forward
			// answers the 407 instead.
			proxy := *r.proxy
			proxy.User = nil
			return &proxy, nil
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
	if forwarded(r) {
		if conn := t.unpark(parkKey(r)); conn != nil {
			return t.forwardConn(conn, r), nil
		}
	}
	// open makes the first hop: TCP, then TLS to an https proxy.
	open := func() (net.Conn, error) {
		var dialer net.Dialer
		raw, err := dialer.DialContext(ctx, "tcp", hop)
		if err != nil {
			return nil, err
		}
		if deadline, ok := ctx.Deadline(); ok {
			// Lifted once the connection is handed out.
			_ = raw.SetDeadline(deadline)
		}
		var conn net.Conn = &pooledConn{Conn: raw, born: born}
		if proxy != nil && proxy.Scheme == "https" {
			if conn, err = t.handshake(ctx, conn, proxy.Hostname()); err != nil {
				raw.Close()
				return nil, err
			}
		}
		return conn, nil
	}
	conn, err := open()
	if err != nil {
		return nil, err
	}
	fail := func(err error) (net.Conn, error) {
		if conn != nil {
			conn.Close()
		}
		return nil, err
	}
	if tunnel != "" {
		switch proxy.Scheme {
		case "socks4", "socks4a":
			err = socks4Tunnel(ctx, conn, proxy, tunnel)
		case "socks5", "socks5h":
			err = socks5Tunnel(ctx, conn, proxy, tunnel)
		default:
			conn, err = connectTunnel(ctx, conn, proxy, tunnel, open)
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
	if forwarded(r) {
		return t.forwardConn(conn, r), nil
	}
	return newWireConn(conn), nil
}

// forwarded is a route whose requests go to an http or https proxy in
// absolute form, with credentials to answer a 407.
func forwarded(r *route) bool {
	return r.proxy != nil && r.proxy.User != nil && r.scheme == "http" &&
		(r.proxy.Scheme == "http" || r.proxy.Scheme == "https")
}

// forwardConn is the wireConn of a forwarded route: an NTLM or Negotiate
// 407 makes net/http give it up, so the handshake keeps it (forward).
func (t *SocketsTransport) forwardConn(conn net.Conn, r *route) *wireConn {
	wire := newWireConn(conn)
	wire.claim = func(status int, header http.Header) bool {
		if status != http.StatusProxyAuthRequired {
			return false
		}
		scheme := chooseChallenge(authChallenges(header.Values("Proxy-Authenticate")))
		return scheme == "negotiate" || scheme == "ntlm"
	}
	return wire
}

// parkKey names a signed conn by proxy and the credentials that signed it.
func parkKey(r *route) string {
	return r.proxy.Scheme + "://" + r.proxy.User.String() + "@" + proxyAddress(r.proxy)
}

// park keeps a signed conn for the pool's next dial to key.
func (t *SocketsTransport) park(key string, conn net.Conn) {
	t.parkedMu.Lock()
	defer t.parkedMu.Unlock()
	if t.parked == nil {
		t.parked = map[string][]parkedConn{}
	}
	t.parked[key] = append(t.parked[key], parkedConn{conn: conn, at: time.Now()})
}

// unpark is the newest parked conn for key that is still open and within
// the idle timeout, as the pool takes its newest idle conn; nil for none.
func (t *SocketsTransport) unpark(key string) net.Conn {
	for {
		t.parkedMu.Lock()
		list := t.parked[key]
		if len(list) == 0 {
			t.parkedMu.Unlock()
			return nil
		}
		last := list[len(list)-1]
		t.parked[key] = list[:len(list)-1]
		t.parkedMu.Unlock()
		if time.Since(last.at) < t.Transport.IdleConnTimeout && idleAlive(last.conn) {
			return last.conn
		}
		last.conn.Close()
	}
}

// idleAlive is the pool's check of an idle conn: nothing to read, and not
// closed by the peer.
func idleAlive(conn net.Conn) bool {
	_ = conn.SetReadDeadline(time.Now().Add(time.Millisecond))
	defer func() { _ = conn.SetReadDeadline(time.Time{}) }()
	var one [1]byte
	_, err := conn.Read(one[:])
	var timeout net.Error
	return errors.As(err, &timeout) && timeout.Timeout()
}

// pinned runs the rest of one NTLM handshake on its own conn: a private
// transport whose every dial is that conn, and every response gives the
// conn up again (detached), so no other request ever gets it. A first 407
// that closed allows one real dial instead.
type pinned struct {
	t         *SocketsTransport
	transport *http.Transport
	mu        sync.Mutex
	conn      net.Conn
	fresh     bool
}

func (t *SocketsTransport) pin() *pinned {
	p := &pinned{t: t, transport: t.transport().Clone()}
	take := func(ctx context.Context, address string, secure bool) (net.Conn, error) {
		p.mu.Lock()
		conn, fresh := p.conn, p.fresh
		p.conn, p.fresh = nil, false
		p.mu.Unlock()
		if conn == nil && fresh {
			dialed, err := t.dial(ctx, address, secure)
			if err != nil {
				return nil, err
			}
			conn = dialed.(*wireConn).Conn
		}
		if conn == nil {
			return nil, errNtlmDrain
		}
		wire := newWireConn(conn)
		wire.claim = func(int, http.Header) bool { return true }
		return wire, nil
	}
	p.transport.DialContext = func(ctx context.Context, _, address string) (net.Conn, error) {
		return take(ctx, address, false)
	}
	p.transport.DialTLSContext = func(ctx context.Context, _, address string) (net.Conn, error) {
		return take(ctx, address, true)
	}
	return p
}

// hold makes conn the one the next request gets; nil allows one dial.
func (p *pinned) hold(conn net.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.conn, p.fresh = conn, conn == nil
}

// release parks a detached conn once its response body was read to the
// end and nothing says close; any other end closes it.
func (t *SocketsTransport) release(response *http.Response, conn *wireConn, key string) {
	body := response.Body
	keep := !headClosesConn(response.Header)
	response.Body = &releasingBody{ReadCloser: body, eof: response.ContentLength == 0, done: func(clean bool) {
		if clean && keep && !conn.ended.Load() {
			t.park(key, conn.Conn)
			return
		}
		conn.Conn.Close()
	}}
}

type releasingBody struct {
	io.ReadCloser
	once sync.Once
	eof  bool
	done func(clean bool)
}

func (b *releasingBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if errors.Is(err, io.EOF) {
		b.eof = true
	}
	return n, err
}

func (b *releasingBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(func() { b.done(b.eof) })
	return err
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
	// SocketsHttpHandler offers no ALPN on an HTTP/1.1 connection; net/http
	// puts h2 in a nil TLSClientConfig, which the HTTP/1.1 reader cannot speak.
	config.NextProtos = nil
	// With no roots of its own, trustd checks the chain as SslStream does
	// for HttpClient's defaults; Go's own check is off then. Go's platform
	// verifier would use an SSL policy, which refuses chains .NET accepts.
	if sectrust.Available && config.RootCAs == nil && !config.InsecureSkipVerify && config.VerifyConnection == nil {
		name := config.ServerName
		config.InsecureSkipVerify = true
		config.VerifyConnection = func(state tls.ConnectionState) error {
			chain := make([][]byte, len(state.PeerCertificates))
			for i, c := range state.PeerCertificates {
				chain[i] = c.Raw
			}
			if !operatorTrusts(chain, name, nil) {
				return errUntrustedChain
			}
			return nil
		}
	}
	secure := tls.Client(conn, config)
	if err := secure.HandshakeContext(ctx); err != nil {
		return nil, err
	}
	return secure, nil
}

// operatorTrusts is swapped by tests.
var operatorTrusts = sectrust.Operator

var errUntrustedChain = errors.New("dotnet: trustd does not trust the certificate chain")

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

// connectTunnel is HttpConnectionPool.EstablishProxyTunnelAsync (System.Net.Http
// 10.0.11, decompiled; measured by C#'s ProxyConnectTunnelTests):
//   - Host, and a User-Agent only when the request has one
//     (HttpConnectionPool.cs:308-312, :660-664); the operator requests
//     have none.
//   - Credentials only after a 407 challenge: SendWithProxyAuthAsync
//     passes preAuthenticate false (AuthenticationHelper.cs:481). Basic
//     resends with UTF-8 "user:password" (:328-329); Digest gets one more
//     try on a stale nonce.
//   - NTLM and Negotiate are SendWithNtAuthAsync (:630-745): Type 1 and
//     Type 3 go on one conn. Only the first 407 may close it and make a new
//     one; after the Type 3 the answer is final.
//   - The retry reuses the conn unless the 407 closed it; then open makes
//     a new one. Only 200 opens the tunnel (HttpConnectionPool.cs:666).
//
// It returns the conn the tunnel runs on.
func connectTunnel(ctx context.Context, conn net.Conn, proxy *url.URL, target string, open func() (net.Conn, error)) (net.Conn, error) {
	// The CONNECT request's URI is the proxy's, so Digest signs "/".
	auth := &proxyAuth{proxy: proxy, method: "CONNECT", uri: "/"}
	for {
		head := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n"
		if auth.authorization != "" {
			head += "Proxy-Authorization: " + auth.authorization + "\r\n"
		}
		if _, err := io.WriteString(conn, head+"\r\n"); err != nil {
			return conn, err
		}
		count := &drainCount{src: conn}
		in := bufio.NewReader(count)
		count.in = in
		reader := NewResponseReader(in, maxResponseHeadersBytes)
		status, _, header, err := reader.ReadHead()
		if err != nil {
			return conn, err
		}
		count.reset()
		if status != http.StatusProxyAuthRequired {
			if err := auth.checkFinal(header); err != nil {
				return conn, err
			}
		}
		if status == http.StatusOK {
			if in.Buffered() > 0 {
				// .NET hands these to the tunnel; before the server's TLS
				// answer they fail its handshake there too.
				return conn, errors.New("proxy: bytes after the tunnel answer")
			}
			return conn, nil
		}
		next := ""
		if status == http.StatusProxyAuthRequired {
			if next, err = auth.answer(ctx, header); err != nil {
				return conn, err
			}
		}
		if next == "" {
			return conn, fmt.Errorf("proxy: CONNECT answered %d", status)
		}
		first := auth.authorization == ""
		auth.authorization = next
		body, framing := reader.Body(status, false, header)
		if auth.nt != nil {
			// SendWithNtAuthAsync: only a first 407 that says close moves to
			// a new conn; every other answer is drained or the request fails.
			if first && connectionHeaderCloses(header) {
				conn.Close()
				if conn, err = open(); err != nil {
					return nil, err
				}
				continue
			}
			if err := drainForNtAuth(ctx, conn, in, count, body, framing, header); err != nil {
				return conn, err
			}
			continue
		}
		// SendWithAuthAsync disposes the answer, which drains it; a conn
		// that cannot be drained, or that the answer closes, is dropped.
		keep := framing != FramedClose && !headClosesConn(header) &&
			drainResponse(ctx, conn, in, count, body, framing) == nil && in.Buffered() == 0
		if !keep {
			conn.Close()
			if conn, err = open(); err != nil {
				return nil, err
			}
		}
	}
}

// proxyAuth is where one request's proxy authentication stands: .NET's
// SendWithProxyAuthAsync, which passes preAuthenticate false, so nothing
// goes out before a 407 asks (AuthenticationHelper.cs:481).
//   - The challenge is picked in .NET's order: Negotiate, NTLM, Digest,
//     Basic. Basic resends with UTF-8 "user:password" (:328-329); Digest
//     gets one more try on a stale nonce.
//   - NTLM and Negotiate are SendWithNtAuthAsync (:630-745): Type 1 and
//     Type 3 go on one conn.
type proxyAuth struct {
	proxy *url.URL
	// method and uri are what Digest signs; content is the body text for
	// auth-int, nil for none.
	method, uri string
	content     func() (string, error)
	// authorization is the Proxy-Authorization the next request carries.
	authorization string
	// sent is the scheme answered, lower case.
	sent  string
	stale bool
	nt    *ntlmAuth
}

// answer is the Proxy-Authorization a 407 asks for next, "" when .NET
// stops and the 407 is the answer. A value .NET cannot write as ASCII (a
// Digest realm or nonce from the proxy) fails before it goes out.
func (a *proxyAuth) answer(ctx context.Context, header http.Header) (string, error) {
	next, err := a.nextAuthorization(ctx, header)
	if err == nil && !isASCII(next) {
		return "", errHeaderNotASCII
	}
	return next, err
}

// errHeaderNotASCII is HttpConnection.WriteString's refusal.
var errHeaderNotASCII = errors.New("Request headers must contain only ASCII characters.")

func (a *proxyAuth) nextAuthorization(ctx context.Context, header http.Header) (string, error) {
	if a.proxy.User == nil {
		return "", nil
	}
	challenges := authChallenges(header.Values("Proxy-Authenticate"))
	user, domain := proxyCredential(a.proxy.User.Username())
	password, _ := a.proxy.User.Password()
	digest := func(parameters map[string]string) (string, error) {
		token, err := digestToken(user, password, a.method, a.uri, a.content, parameters)
		if token == "" || err != nil {
			return "", err
		}
		return "Digest " + token, nil
	}
	switch {
	case a.sent == "":
		// SendWithAuthAsync's first answer.
		a.sent = chooseChallenge(challenges)
		switch a.sent {
		case "negotiate", "ntlm":
			next, nt, err := ntlmFirst(ctx, a.sent, challenges[a.sent], a.proxy, user, domain, password)
			a.nt = nt
			return next, err
		case "digest":
			if parameters, ok := parseDigest(challenges["digest"]); ok {
				return digest(parameters)
			}
		case "basic":
			// SetBasicAuthToken puts a domain back in front.
			if domain != "" {
				user = domain + `\` + user
			}
			return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+password)), nil
		}
	case a.nt != nil && !a.nt.authenticated:
		data, ok := challenges[a.sent]
		if !ok {
			return "", nil
		}
		// A bare challenge is an empty blob: NTLM throws on it, SPNEGO
		// gives no token.
		challenge, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return "", errNtlmThrow
		}
		token, check, err := a.nt.respond(challenge)
		if err != nil {
			return "", err
		}
		if token != nil && check <= statusContinue {
			return ntlmScheme(a.sent) + " " + base64.StdEncoding.EncodeToString(token), nil
		}
	case a.sent == "digest" && !a.stale:
		// One more try when the server calls the nonce stale.
		if data, ok := challenges["digest"]; ok {
			if parameters, ok := parseDigest(data); ok && parameters["stale"] == "true" {
				a.stale = true
				return digest(parameters)
			}
		}
	}
	return "", nil
}

// checkFinal is SendWithNtAuthAsync's last step: an answer that is not a
// 407 but carries the scheme's token, while the handshake is still open
// (RequestMic), is read, and a failed read fails the request with 401.
func (a *proxyAuth) checkFinal(header http.Header) error {
	if a.nt == nil || a.nt.authenticated || a.authorization == "" {
		return nil
	}
	data, ok := authChallenges(header.Values("Proxy-Authenticate"))[a.sent]
	if !ok {
		return nil
	}
	blob, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return errNtlmThrow
	}
	if _, check, err := a.nt.respond(blob); err != nil {
		return err
	} else if check > statusContinue {
		return fmt.Errorf("proxy: CONNECT answered %d", http.StatusUnauthorized)
	}
	return nil
}

// maxResponseDrainSize and maxResponseDrainTime are SocketsHttpHandler's
// MaxResponseDrainSize and ResponseDrainTimeout defaults.
const (
	maxResponseDrainSize = 1 << 20
	maxResponseDrainTime = 2 * time.Second
)

var errDrain = errors.New("proxy: the answer could not be drained")

// drainCount sits under a conn's bufio.Reader and counts as
// ChunkedEncodingReadStream.DrainAsync does: every byte after the head,
// framing too, and the bytes still unparsed at each read once more. While
// armed, a read with the count at the cap fails instead: the body is not
// done, and .NET stops there.
type drainCount struct {
	src   io.Reader
	in    *bufio.Reader
	count atomic.Int64
	armed atomic.Bool
}

func (d *drainCount) Read(p []byte) (int, error) {
	if d.armed.Load() && d.count.Load() >= maxResponseDrainSize {
		return 0, errDrain
	}
	// Inside bufio's fill: what it holds now is what .NET still holds.
	left := d.in.Buffered()
	n, err := d.src.Read(p)
	d.count.Add(int64(left + n))
	return n, err
}

// reset starts the count at a head's end: the bytes read past it.
func (d *drainCount) reset() { d.count.Store(int64(d.in.Buffered())) }

// drainResponse is HttpContentReadStream.DrainAsync: a length body is not
// read when more than the cap is left past what count has seen; a chunked
// one fails at a read with count at the cap. Both stop at the drain time.
func drainResponse(ctx context.Context, conn net.Conn, in *bufio.Reader, count *drainCount, body io.Reader, framing Framing) error {
	switch framing {
	case FramedNone:
		return nil
	case FramedLength:
		if body.(*lengthReader).remaining-int64(in.Buffered()) > maxResponseDrainSize {
			return errDrain
		}
	case FramedClose:
		return errDrain
	}
	_ = conn.SetReadDeadline(time.Now().Add(maxResponseDrainTime))
	defer func() {
		deadline, _ := ctx.Deadline()
		_ = conn.SetReadDeadline(deadline)
	}()
	if framing == FramedChunked {
		count.armed.Store(true)
		defer count.armed.Store(false)
	}
	_, err := io.Copy(io.Discard, body)
	return err
}

// drainForNtAuth is HttpConnection.DrainResponseAsync: the request fails
// when the answer closes the conn, cannot be drained, or leaves bytes
// after it. A body read to the close fails too, before the next message
// goes out (C#'s drain1-closeframed and drain2-closeframed rows).
func drainForNtAuth(ctx context.Context, conn net.Conn, in *bufio.Reader, count *drainCount, body io.Reader, framing Framing, header http.Header) error {
	if framing == FramedClose || headClosesConn(header) {
		return errNtlmDrain
	}
	if err := drainResponse(ctx, conn, in, count, body, framing); err != nil || in.Buffered() > 0 {
		return errNtlmDrain
	}
	return nil
}

var errNtlmDrain = errors.New("proxy: the authentication conn failed")

// connectionHeaderCloses is HttpHeaders.ConnectionClose alone, without
// Keep-Alive.
func connectionHeaderCloses(header http.Header) bool {
	for _, value := range header.Values("Connection") {
		if connectionLineCloses(value) {
			return true
		}
	}
	return false
}

// proxyCredential is GetCredentialsFromString's NetworkCredential: the
// user name split at its first backslash into domain and user. Digest and
// NTLM send the user alone; Basic puts a domain back in front.
func proxyCredential(name string) (user, domain string) {
	if at := strings.IndexByte(name, '\\'); at >= 0 {
		return name[at+1:], name[:at]
	}
	return name, ""
}

// ntlmScheme is the scheme name .NET writes, whatever the server's case.
func ntlmScheme(sent string) string {
	if sent == "negotiate" {
		return "Negotiate"
	}
	return "NTLM"
}

// ntlmFirst starts SendWithNtAuthAsync; the SPN is "HTTP/" and the proxy
// host. The first challenge's data is decoded, which can throw, and then
// not read.
func ntlmFirst(ctx context.Context, sent, data string, proxy *url.URL, user, domain, password string) (string, *ntlmAuth, error) {
	if data != "" {
		if _, err := base64.StdEncoding.DecodeString(data); err != nil {
			return "", nil, errNtlmThrow
		}
	}
	nt := newNtlmAuth(sent == "negotiate", user, domain, password, "HTTP/"+ntlmSpnHost(ctx, proxy.Hostname()))
	if nt == nil {
		return "", nil, nil
	}
	return ntlmScheme(sent) + " " + base64.StdEncoding.EncodeToString(nt.initial()), nt, nil
}

// ntlmSpnHost is the SPN host of a proxy: an IP literal as it is (IPv6
// without brackets), else Dns.GetHostEntryAsync's HostName, getaddrinfo's
// canonical name. Without cgo the nearest source is Go's own resolver: it
// reads /etc/hosts first, as getaddrinfo does, and then follows CNAMEs.
// The system resolver's LookupCNAME skips /etc/hosts on macOS. A name it
// cannot answer (mDNS, other NSS sources) stands as given: the dial has
// found it.
func ntlmSpnHost(ctx context.Context, host string) string {
	if _, err := netip.ParseAddr(host); err == nil {
		return host
	}
	name, err := (&net.Resolver{PreferGo: true}).LookupCNAME(ctx, host)
	if err != nil || name == "" {
		return host
	}
	return strings.TrimSuffix(name, ".")
}

// authChallenges reads Proxy-Authenticate lines into each scheme's
// parameter text, the first one of a scheme kept. Each line is a list of
// AuthenticationHeaderValue (System.Net.Http 10.0.11, decompiled); a line
// with any bad value is dropped whole, as HttpHeaders keeps it invalid.
func authChallenges(values []string) map[string]string {
	challenges := map[string]string{}
	for _, value := range values {
		parsed, ok := parseChallengeLine(value)
		if !ok {
			continue
		}
		for _, c := range parsed {
			if _, seen := challenges[c[0]]; !seen {
				challenges[c[0]] = c[1]
			}
		}
	}
	return challenges
}

// parseChallengeLine is BaseHeaderParser.TryParseValue over one line:
// values split by commas, empty ones skipped. Each item is the lower-case
// scheme and its parameter text.
func parseChallengeLine(line string) ([][2]string, bool) {
	var out [][2]string
	i := 0
	for i < len(line) {
		next, _ := nextNonEmpty(line, i)
		if next == len(line) {
			break
		}
		scheme, parameter, length := authenticationValue(line, next)
		if length == 0 {
			return nil, false
		}
		out = append(out, [2]string{asciiLower(scheme), parameter})
		var separator bool
		if i, separator = nextNonEmpty(line, next+length); !separator && i < len(line) {
			return nil, false
		}
	}
	return out, true
}

// nextNonEmpty is HeaderUtilities.GetNextNonEmptyOrWhitespaceIndex with
// empty values skipped.
func nextNonEmpty(s string, i int) (int, bool) {
	i += spaceLength(s, i)
	if i == len(s) || s[i] != ',' {
		return i, false
	}
	i++
	i += spaceLength(s, i)
	for i < len(s) && s[i] == ',' {
		i++
		i += spaceLength(s, i)
	}
	return i, true
}

// authenticationValue is AuthenticationHeaderValue.GetAuthenticationLength:
// a scheme token, then either nothing or whitespace and a first blob of
// any chars up to a comma, then name=value pairs. A token without "=" ends
// the value: it starts the next challenge.
func authenticationValue(s string, start int) (scheme, parameter string, length int) {
	if strings.ContainsAny(s[start:], "\r\n\x00") {
		return "", "", 0
	}
	n := tokenLength(s, start)
	if n == 0 {
		return "", "", 0
	}
	scheme = s[start : start+n]
	i := start + n
	space := spaceLength(s, i)
	i += space
	if i == len(s) || s[i] == ',' {
		return scheme, "", i - start
	}
	if space == 0 {
		return "", "", 0
	}
	from, end := i, i
	for i < len(s) && s[i] != ',' {
		if s[i] == '"' {
			q := quotedStringLength(s, i)
			if q == 0 {
				return "", "", 0
			}
			i += q
			end = i - 1
		} else if w := spaceLength(s, i); w > 0 {
			i += w
		} else {
			end = i
			i++
		}
	}
	if i < len(s) {
		// TryGetParametersEndIndex, from the comma at i.
		for {
			j, _ := nextNonEmpty(s, i+1)
			if j == len(s) {
				i = j
				break
			}
			t := tokenLength(s, j)
			if t == 0 {
				return "", "", 0
			}
			j += t
			j += spaceLength(s, j)
			if j == len(s) || s[j] != '=' {
				break
			}
			j++
			j += spaceLength(s, j)
			v := 0
			if j < len(s) {
				if v = tokenLength(s, j); v == 0 {
					v = quotedStringLength(s, j)
				}
			}
			if v == 0 {
				return "", "", 0
			}
			j += v
			end = j - 1
			i = j + spaceLength(s, j)
			if i >= len(s) || s[i] != ',' {
				break
			}
		}
	}
	return scheme, s[from : end+1], i - start
}

// chooseChallenge is TryGetAuthenticationChallenge's order: Negotiate,
// NTLM, Digest, Basic.
func chooseChallenge(challenges map[string]string) string {
	for _, scheme := range []string{"negotiate", "ntlm", "digest", "basic"} {
		if _, ok := challenges[scheme]; ok {
			return scheme
		}
	}
	return ""
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
	r := &route{scheme: request.URL.Scheme}
	if t.Transport.Proxy != nil {
		proxy, err := t.Transport.Proxy(request)
		if err != nil {
			return nil, err
		}
		r.proxy = proxy
	}
	if forwarded(r) {
		return t.forward(request, r)
	}
	return t.attempt(t.transport(), request, r, nil)
}

// forward sends an http target's request through an http or https proxy
// as SendWithProxyAuthAsync does: no credentials until a 407 asks, then
// the request again, on the same conn unless the 407 closes it. A 407
// that .NET does not answer is the response. Measured by C#'s
// AuthenticatesAForwardedRequestAsSocketsHttpHandlerDoes.
//
// SendWithNtProxyAuthAsync holds its conn for the whole handshake, which
// net/http's pool cannot: so an NTLM or Negotiate 407 detaches its conn
// from the pool (forwardConn), the rest of the handshake runs on it alone
// (pin), and once the answer is read the signed conn is parked for the
// pool's next dial (C#'s ConcurrentNtlmHandshakesEachKeepTheirConn).
func (t *SocketsTransport) forward(request *http.Request, r *route) (*http.Response, error) {
	auth := &proxyAuth{proxy: r.proxy, method: request.Method, uri: request.URL.RequestURI()}
	auth.content = func() (string, error) {
		var content []byte
		if request.GetBody != nil {
			if body, err := request.GetBody(); err == nil {
				content, _ = io.ReadAll(body)
				body.Close()
			}
		}
		types := request.Header.Values("Content-Type")
		if len(types) == 0 {
			return bodyText(content, "", false)
		}
		return bodyText(content, types[0], true)
	}
	replayable := request.Body == nil || request.Body == http.NoBody || request.GetBody != nil
	var conn *wireConn
	onConn := func(c *wireConn) { conn = c }
	var pin *pinned
	key := parkKey(r)
	// lost ends a detached conn the handshake will not use.
	lost := func() {
		if conn != nil && conn.detached.Load() {
			conn.Conn.Close()
		}
	}
	response, err := t.attempt(t.transport(), request, r, onConn)
	for {
		if err != nil {
			return nil, err
		}
		if response.StatusCode != http.StatusProxyAuthRequired {
			if err := auth.checkFinal(response.Header); err != nil {
				response.Body.Close()
				lost()
				return nil, err
			}
			if conn != nil && conn.detached.Load() {
				t.release(response, conn, key)
			}
			return response, nil
		}
		answer, err := auth.answer(request.Context(), response.Header)
		if err != nil {
			response.Body.Close()
			lost()
			return nil, err
		}
		if answer == "" || !replayable {
			if conn != nil && conn.detached.Load() {
				t.release(response, conn, key)
			}
			return response, nil
		}
		first := auth.authorization == ""
		auth.authorization = answer
		next := request.Clone(request.Context())
		next.Header.Set("Proxy-Authorization", answer)
		if request.GetBody != nil {
			if next.Body, err = request.GetBody(); err != nil {
				response.Body.Close()
				lost()
				return nil, err
			}
		}
		if auth.nt == nil {
			// SendWithAuthAsync disposes the answer, which drains it; an
			// answer left unread makes net/http drop the conn.
			drainBody(response.Body)
			response.Body.Close()
			response, err = t.attempt(t.transport(), next, r, onConn)
			continue
		}
		if conn == nil || !conn.detached.Load() {
			response.Body.Close()
			return nil, errNtlmDrain
		}
		if pin == nil {
			pin = t.pin()
		}
		if first && connectionHeaderCloses(response.Header) {
			// The Type 1 goes on a new conn.
			response.Body.Close()
			conn.Conn.Close()
			pin.hold(nil)
		} else {
			framing := responseFraming(response.Header)
			drained := framing != FramedClose && !headClosesConn(response.Header) &&
				drainNtBody(conn, response, framing) && !conn.ended.Load()
			response.Body.Close()
			if !drained {
				conn.Conn.Close()
				return nil, errNtlmDrain
			}
			pin.hold(conn.Conn)
		}
		conn = nil
		response, err = t.attempt(pin.transport, next, r, onConn)
	}
}

// responseFraming is how the head frames a 407's body.
func responseFraming(header http.Header) Framing {
	switch {
	case transferEncodingChunked(header.Values("Transfer-Encoding")):
		return FramedChunked
	case ResponseContentLength(header) == 0:
		return FramedNone
	case ResponseContentLength(header) > 0:
		return FramedLength
	}
	return FramedClose
}

// drainBody is DrainAsync on a body net/http reads: true when it ends
// within the drain size and time.
func drainBody(body io.ReadCloser) bool {
	timer := time.AfterFunc(maxResponseDrainTime, func() { body.Close() })
	defer timer.Stop()
	n, err := io.Copy(io.Discard, io.LimitReader(body, maxResponseDrainSize+1))
	return err == nil && n <= maxResponseDrainSize
}

// drainNtBody is DrainAsync on a 407 net/http reads, as DrainResponseAsync
// awaits it: a length body with more than the cap left past what came is
// not read; a chunked one fails at a read with the conn's count at the cap.
func drainNtBody(conn *wireConn, response *http.Response, framing Framing) bool {
	switch framing {
	case FramedLength:
		if response.ContentLength-min(conn.count.count.Load(), response.ContentLength) > maxResponseDrainSize {
			return false
		}
	case FramedChunked:
		conn.count.armed.Store(true)
		defer conn.count.armed.Store(false)
	}
	timer := time.AfterFunc(maxResponseDrainTime, func() { response.Body.Close() })
	defer timer.Stop()
	_, err := io.Copy(io.Discard, response.Body)
	return err == nil
}

// attempt is one request on the pool. onConn, when set, learns the conn.
func (t *SocketsTransport) attempt(inner *http.Transport, request *http.Request, r *route, onConn func(*wireConn)) (*http.Response, error) {
	request = request.Clone(context.WithValue(request.Context(), routeKey{}, r))
	header := request.Header
	method := request.Method
	lifetime := t.options.PooledConnectionLifetime
	replayable := request.Body == nil || request.Body == http.NoBody || request.GetBody != nil
	done := make(chan struct{})
	defer close(done)
	trace := &httptrace.ClientTrace{
		// Runs before the request is written. net/http's copy of a request
		// with a body shares this header map.
		GotConn: func(info httptrace.GotConnInfo) {
			if wire, ok := info.Conn.(*wireConn); ok {
				wire.expect(method)
				if onConn != nil {
					onConn(wire)
				}
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
	if err == nil {
		response.Header = takeHeader(response)
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

// CloseIdleConnections closes the pool's idle connections, the parked
// ones too.
func (t *SocketsTransport) CloseIdleConnections() {
	t.transport().CloseIdleConnections()
	t.parkedMu.Lock()
	parked := t.parked
	t.parked = nil
	t.parkedMu.Unlock()
	for _, list := range parked {
		for _, p := range list {
			p.conn.Close()
		}
	}
}

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
