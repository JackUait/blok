package outbound

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/mediatype"
)

// UserAgent is sent with every fetch, and no other header but Host.
const UserAgent = "blok-server (+https://blokeditor.com)"

const connectAttemptTimeout = time.Second

// maxResponseHeaderBytes is .NET's default MaxResponseHeadersLength, 64 KiB;
// C# sets the same value explicitly.
const maxResponseHeaderBytes = 64 << 10

var errMappedAddress = errors.New("address family not supported by protocol family")

// Limits are GuardedFetchLimits.
type Limits struct {
	Timeout      time.Duration
	MaxBytes     int64
	MaxRedirects int
	// Hop, when set, is asked before every redirect hop. A false answer
	// fails the fetch as RateLimited, so one request cannot fan out.
	Hop func() bool
	// Truncate keeps the first MaxBytes of the body instead of failing past
	// them. Content-Length is not checked.
	Truncate bool
	// Upload takes a slot from the upload pool, so long downloads never
	// starve the short checks.
	Upload bool
	// Caller is the rate-limit key. A caller runs at most two fetches at
	// once in each pool; more wait for one of its own slots. Empty is no cap.
	Caller string
}

// Response is GuardedResponse. Release frees the concurrency slot; callers
// hold it until they are done with the body, as C# holds it until dispose.
type Response struct {
	StatusCode  int
	Body        []byte
	ContentType string
	FinalURL    string
	// Header is the final response's header lines as received.
	Header    http.Header
	Redirects int
	release   func()
}

// Release frees the fetch slot. It is safe to call twice.
func (r *Response) Release() {
	if r.release != nil {
		r.release()
		r.release = nil
	}
}

// Resolver looks a host up. Tests replace it.
type Resolver func(ctx context.Context, host string) ([]netip.Addr, error)

// Fetcher is GuardedOutboundFetcher: at most four checks and four uploads
// at once across the whole server, at most two of each per caller, each
// pinned to addresses the policy vetted.
type Fetcher struct {
	Policy  Policy
	Resolve Resolver
	// RootCAs replaces the system roots; tests set it.
	RootCAs *x509.CertPool
	// denied holds the certs the trust settings deny, by certHash. With
	// RootCAs nil the system's set is used.
	denied  map[string]bool
	permits chan struct{}
	uploads chan struct{}
	// checkCallers and uploadCallers are each pool's per-caller lanes.
	checkCallers  callerLanes
	uploadCallers callerLanes
	dialHook      func(network, address string)
}

// NewFetcher returns a fetcher over policy with the system resolver.
func NewFetcher(policy Policy) *Fetcher {
	return &Fetcher{Policy: policy, Resolve: systemResolve,
		permits: make(chan struct{}, 4), uploads: make(chan struct{}, 4)}
}

// fetchesPerCaller is each caller's share of a pool of four, so one caller
// cannot fill a pool alone.
const fetchesPerCaller = 2

// callerLanes holds a lane of fetchesPerCaller slots per caller key, kept
// while anyone holds or waits for one of its slots.
type callerLanes struct {
	mu    sync.Mutex
	lanes map[string]*callerLane
}

type callerLane struct {
	slots chan struct{}
	users int
}

// enter takes one of key's slots, waiting until ctx ends. An empty key has
// no lane.
func (c *callerLanes) enter(ctx context.Context, key string) (func(), error) {
	if key == "" {
		return func() {}, nil
	}
	c.mu.Lock()
	if c.lanes == nil {
		c.lanes = map[string]*callerLane{}
	}
	lane := c.lanes[key]
	if lane == nil {
		lane = &callerLane{slots: make(chan struct{}, fetchesPerCaller)}
		c.lanes[key] = lane
	}
	lane.users++
	c.mu.Unlock()
	done := func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if lane.users--; lane.users == 0 {
			delete(c.lanes, key)
		}
	}
	select {
	case lane.slots <- struct{}{}:
		return func() {
			<-lane.slots
			done()
		}, nil
	case <-ctx.Done():
		done()
		return nil, ctx.Err()
	}
}

func systemResolve(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// Get fetches raw. The timeout covers the wait for a slot. Every failure
// but the caller's own cancellation and bad limits becomes an *Error.
func (f *Fetcher) Get(ctx context.Context, raw string, limits Limits) (*Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateLimits(limits); err != nil {
		return nil, err
	}
	deadline, cancel := context.WithTimeout(ctx, limits.Timeout)
	defer cancel()
	permits, callers := f.permits, &f.checkCallers
	if limits.Upload {
		permits, callers = f.uploads, &f.uploadCallers
	}
	// The caller's own lane comes first, so a waiting fetch never holds a
	// pool slot others could use.
	leave, err := callers.enter(deadline, limits.Caller)
	if err != nil {
		return nil, f.collapse(ctx, deadline, err)
	}
	select {
	case permits <- struct{}{}:
	case <-deadline.Done():
		leave()
		return nil, f.collapse(ctx, deadline, deadline.Err())
	}
	release := func() {
		<-permits
		leave()
	}
	response, err := f.get(deadline, raw, limits)
	if err != nil {
		release()
		return nil, f.collapse(ctx, deadline, err)
	}
	response.release = release
	return response, nil
}

// maxArrayLength is .NET's Array.MaxLength, C#'s byte cap ceiling.
const maxArrayLength = 0x7FFFFFC7

// validateLimits is C# ValidateLimits: ArgumentOutOfRangeException, so not
// an *Error.
func validateLimits(limits Limits) error {
	if limits.MaxBytes < 0 || limits.MaxBytes > maxArrayLength {
		return errors.New("The response byte limit is outside the supported range.")
	}
	if limits.MaxRedirects < 0 {
		return errors.New("The redirect limit cannot be negative.")
	}
	return nil
}

func (f *Fetcher) collapse(ctx, deadline context.Context, err error) error {
	var guarded *Error
	switch {
	case errors.As(err, &guarded):
		return guarded
	case ctx.Err() != nil:
		return ctx.Err()
	case deadline.Err() != nil:
		return fail(TimedOut)
	}
	return fail(Blocked)
}

func (f *Fetcher) get(ctx context.Context, raw string, limits Limits) (*Response, error) {
	redirects := 0
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		target, err := f.Policy.Validate(raw, nil)
		if err != nil {
			return nil, err
		}
		addresses := []netip.Addr{target.Literal}
		if !target.Literal.IsValid() {
			addresses, err = f.Resolve(ctx, target.Host)
			if err != nil {
				return nil, err
			}
		}
		if len(addresses) == 0 {
			return nil, fail(Blocked)
		}
		for _, address := range addresses {
			if !f.Policy.AddressAllowed(address) {
				return nil, fail(Blocked)
			}
		}
		response, err := f.roundTrip(ctx, target, addresses)
		if err != nil {
			return nil, err
		}
		// C# follows only a Location .NET parses as a Uri; else the 3xx is
		// the answer.
		if location := headerText(response.Header.Get("Location")); isRedirect(response.StatusCode) && location != "" &&
			dotnet.ParsesAsURI(location) {
			_ = response.Body.Close()
			if redirects >= limits.MaxRedirects {
				return nil, fail(TooManyRedirects)
			}
			next, err := f.Policy.Validate(location, target.URL)
			if err != nil {
				return nil, err
			}
			if target.URL.Scheme == "https" && next.URL.Scheme != "https" {
				return nil, fail(Blocked)
			}
			if limits.Hop != nil && !limits.Hop() {
				return nil, fail(RateLimited)
			}
			raw = next.URL.AbsoluteURI
			redirects++
			continue
		}
		body, err := readBounded(response, limits.MaxBytes, limits.Truncate)
		_ = response.Body.Close()
		if err != nil {
			return nil, err
		}
		return &Response{
			StatusCode:  response.StatusCode,
			Body:        body,
			ContentType: contentType(response.Header.Get("Content-Type")),
			FinalURL:    target.URL.AbsoluteURI,
			Header:      response.Header,
			Redirects:   redirects,
		}, nil
	}
}

func isRedirect(status int) bool {
	switch status {
	case 301, 302, 303, 307, 308:
		return true
	}
	return false
}

// roundTrip sends one GET through a transport that dials only the vetted
// addresses, uses no proxy, sends no Accept-Encoding and follows nothing.
func (f *Fetcher) roundTrip(ctx context.Context, target Target, addresses []netip.Addr) (*http.Response, error) {
	if !target.Literal.IsValid() && !plainHostName(target.Host) {
		return nil, fail(Blocked)
	}
	dialer := &net.Dialer{}
	transport := &http.Transport{
		Proxy:              nil,
		DisableCompression: true,
		// No pooling, and no "Connection: close" header, which
		// DisableKeepAlives would add and .NET does not send.
		MaxIdleConnsPerHost:    -1,
		ForceAttemptHTTP2:      false,
		MaxResponseHeaderBytes: maxResponseHeaderBytes,
		TLSClientConfig:        f.tlsConfig(target),
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if f.dialHook != nil {
				f.dialHook(network, address)
			}
			_, port, err := net.SplitHostPort(address)
			if err != nil || port != strconv.Itoa(target.Port) {
				return nil, fail(Blocked)
			}
			var last error
			for i, ip := range addresses {
				// .NET dials a mapped address on an IPv6-only socket, which
				// fails at once; Go would reach the IPv4 address instead.
				if ip.Is4In6() {
					last = errMappedAddress
					continue
				}
				attempt := ctx
				cancel := context.CancelFunc(func() {})
				if i < len(addresses)-1 {
					attempt, cancel = context.WithTimeout(ctx, connectAttemptTimeout)
				}
				conn, err := dialer.DialContext(attempt, "tcp", netip.AddrPortFrom(ip, uint16(target.Port)).String())
				cancel()
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, last
		},
	}
	defer transport.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.URL.Scheme+"://"+hostHeader(target)+requestURI(target), nil)
	if err != nil {
		return nil, fail(Blocked)
	}
	request.Header.Set("User-Agent", UserAgent)
	return transport.RoundTrip(request)
}

func (f *Fetcher) tlsConfig(target Target) *tls.Config {
	config := &tls.Config{NextProtos: []string{"http/1.1"}}
	config.RootCAs = f.RootCAs
	denied := f.denied
	if config.RootCAs == nil {
		config.RootCAs, denied = defaultRoots(), defaultDenied()
	}
	literal := target.Literal.IsValid()
	if !literal {
		config.ServerName = target.Host
	}
	config.VerifyConnection = func(state tls.ConnectionState) error {
		// Go matches any exact name; .NET refuses these at the certificate
		// check, after the handshake, as this does.
		if !literal && !tlsHostName(target.Host) {
			return errTLSHostName
		}
		if !slices.ContainsFunc(state.VerifiedChains, func(chain []*x509.Certificate) bool {
			return !slices.ContainsFunc(chain, func(c *x509.Certificate) bool { return denied[certHash(c.Raw)] })
		}) {
			return errDeniedCert
		}
		return nil
	}
	return config
}

// errDeniedCert: every chain runs through a cert the trust settings deny.
// trustd checks the leaf and each parent against them
// (SecTrustServer.c:855-875, 910-925) and fails a path with a denied cert
// (SecPolicyServer.c:3425-3440).
var errDeniedCert = errors.New("outbound: the certificate chain holds a denied certificate")

// certHash is a cert's SHA-1 in upper hex, as the trust settings key it.
func certHash(der []byte) string {
	sum := sha1.Sum(der)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

var errTLSHostName = errors.New("outbound: the host is not a name TLS can check")

// tlsHostName is the name rule .NET's TLS check applies (measured on
// SecPolicyCreateSSL; rustls holds the same): labels of 1 to 63 letters,
// digits, '_' or '-', no '-' at a label's ends, at most 253 bytes, and a
// last label that is not all digits. A trailing dot is allowed.
func tlsHostName(host string) bool {
	// rustls counts a trailing dot in the 253.
	if len(host) > 253 {
		return false
	}
	host = strings.TrimSuffix(host, ".")
	if host == "" {
		return false
	}
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if !(c == '-' || c == '_' || '0' <= c && c <= '9' || 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z') {
				return false
			}
		}
	}
	last := labels[len(labels)-1]
	return strings.Trim(last, "0123456789") != ""
}

// plainHostName reports whether host holds only letters, digits, '-', '.'
// and '_'. .NET's HttpClient refuses any other name before it connects, and
// Go would parse one like "a%c3%bcb.com" back into a different host.
func plainHostName(host string) bool {
	for i := 0; i < len(host); i++ {
		c := host[i]
		if !(c == '-' || c == '.' || c == '_' || '0' <= c && c <= '9' || 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z') {
			return false
		}
	}
	return host != ""
}

func hostHeader(target Target) string {
	host := target.Host
	if target.Literal.Is6() {
		host = "[" + host + "]"
	}
	if target.Port != 80 && target.URL.Scheme == "http" || target.Port != 443 && target.URL.Scheme == "https" {
		host += ":" + strconv.Itoa(target.Port)
	}
	return host
}

func requestURI(target Target) string {
	return target.URL.AbsolutePath + target.URL.Query
}

// contentType is HttpContentHeaders.ContentType.ToString(): the header
// re-serialized as "type; name=value", or "" when it does not parse.
func contentType(header string) string {
	mediaType, params, ok := mediatype.Parse(header)
	if !ok {
		return ""
	}
	var b strings.Builder
	b.WriteString(mediaType)
	for _, param := range params {
		b.WriteString("; ")
		b.WriteString(param.Name)
		if param.Value != "" {
			b.WriteString("=")
			b.WriteString(param.Value)
		}
	}
	return b.String()
}

func readBounded(response *http.Response, max int64, truncate bool) ([]byte, error) {
	if !truncate && response.ContentLength > max {
		return nil, fail(TooLarge)
	}
	var encodings []string
	for _, value := range response.Header.Values("Content-Encoding") {
		encodings = append(encodings, encodingTokens(value)...)
	}
	if len(encodings) > 1 {
		return nil, fail(UnsupportedContentEncoding)
	}
	identity := len(encodings) == 0 || strings.EqualFold(encodings[0], "identity")
	if truncate {
		// The first max raw bytes decode as a truncated stream, which both
		// decoders already accept; the output is cut at max too.
		prefix, err := io.ReadAll(io.LimitReader(response.Body, max))
		if err != nil || identity {
			return prefix, err
		}
		decoded, ok := decoder(strings.ToLower(encodings[0]), bytes.NewReader(prefix))
		if !ok {
			return nil, fail(UnsupportedContentEncoding)
		}
		return io.ReadAll(io.LimitReader(decoded, max))
	}
	raw := &boundedReader{r: response.Body, remaining: max}
	if identity {
		return readAll(raw, max)
	}
	decoded, ok := decoder(strings.ToLower(encodings[0]), raw)
	if !ok {
		return nil, fail(UnsupportedContentEncoding)
	}
	body, err := readAll(decoded, max)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(io.Discard, raw); err != nil {
		return nil, err
	}
	return body, nil
}

// encodingTokens is .NET's typed ContentEncoding for one header line: the
// comma-separated tokens, or none when any item is not a token. C# then
// reads the body as identity.
func encodingTokens(line string) []string {
	var tokens []string
	for _, item := range strings.Split(line, ",") {
		item = strings.Trim(item, " \t")
		if item == "" {
			continue
		}
		if !isToken(item) {
			return nil
		}
		tokens = append(tokens, item)
	}
	return tokens
}

func isToken(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' ||
			strings.IndexByte("!#$%&'*+-.^_`|~", c) >= 0) {
			return false
		}
	}
	return true
}

func readAll(r io.Reader, max int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > max {
		return nil, fail(TooLarge)
	}
	return body, nil
}

// boundedReader fails once more than remaining bytes arrive.
type boundedReader struct {
	r         io.Reader
	remaining int64
}

func (b *boundedReader) Read(p []byte) (int, error) {
	if b.remaining == 0 {
		var probe [1]byte
		n, err := b.r.Read(probe[:])
		if n > 0 {
			return 0, fail(TooLarge)
		}
		return 0, err
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.r.Read(p)
	b.remaining -= int64(n)
	return n, err
}

// headerText reads a Location value as .NET does: UTF-8 when the bytes are
// valid UTF-8, else one byte per character (Latin-1). So a raw 0xE9 is "é"
// and a raw 0x85 is the C1 control the policy refuses.
func headerText(value string) string {
	if utf8.ValidString(value) {
		return value
	}
	runes := make([]rune, len(value))
	for i := 0; i < len(value); i++ {
		runes[i] = rune(value[i])
	}
	return string(runes)
}
