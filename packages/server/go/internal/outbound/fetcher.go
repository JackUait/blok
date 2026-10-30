package outbound

import (
	"compress/gzip"
	"compress/zlib"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/andybalholm/brotli"

	"github.com/JackUait/blok/packages/server/go/internal/mediatype"
)

// UserAgent is sent with every fetch, and no other header but Host.
const UserAgent = "blok-server (+https://blokeditor.com)"

const connectAttemptTimeout = time.Second

// Limits are GuardedFetchLimits.
type Limits struct {
	Timeout      time.Duration
	MaxBytes     int64
	MaxRedirects int
}

// Response is GuardedResponse. Release frees the concurrency slot; callers
// hold it until they are done with the body, as C# holds it until dispose.
type Response struct {
	StatusCode  int
	Body        []byte
	ContentType string
	FinalURL    string
	release     func()
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

// Fetcher is GuardedOutboundFetcher: at most four fetches at once across the
// whole server, each pinned to addresses the policy vetted.
type Fetcher struct {
	Policy  Policy
	Resolve Resolver
	// RootCAs replaces the system roots; tests set it.
	RootCAs  *x509.CertPool
	permits  chan struct{}
	dialHook func(network, address string)
}

// NewFetcher returns a fetcher over policy with the system resolver.
func NewFetcher(policy Policy) *Fetcher {
	return &Fetcher{Policy: policy, Resolve: systemResolve, permits: make(chan struct{}, 4)}
}

func systemResolve(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// Get fetches raw. The timeout covers the wait for a slot. Every failure
// but the caller's own cancellation becomes an *Error.
func (f *Fetcher) Get(ctx context.Context, raw string, limits Limits) (*Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	deadline, cancel := context.WithTimeout(ctx, limits.Timeout)
	defer cancel()
	select {
	case f.permits <- struct{}{}:
	case <-deadline.Done():
		return nil, f.collapse(ctx, deadline, deadline.Err())
	}
	release := func() { <-f.permits }
	response, err := f.get(deadline, raw, limits)
	if err != nil {
		release()
		return nil, f.collapse(ctx, deadline, err)
	}
	response.release = release
	return response, nil
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
		if location := response.Header.Get("Location"); isRedirect(response.StatusCode) && location != "" {
			_ = response.Body.Close()
			if redirects >= limits.MaxRedirects {
				return nil, fail(TooManyRedirects)
			}
			next, err := f.Policy.Validate(location, target.URL)
			if err != nil {
				return nil, err
			}
			raw = next.URL.AbsoluteURI
			redirects++
			continue
		}
		body, err := readBounded(response, limits.MaxBytes)
		_ = response.Body.Close()
		if err != nil {
			return nil, err
		}
		return &Response{
			StatusCode:  response.StatusCode,
			Body:        body,
			ContentType: contentType(response.Header.Get("Content-Type")),
			FinalURL:    target.URL.AbsoluteURI,
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
	dialer := &net.Dialer{}
	transport := &http.Transport{
		Proxy:              nil,
		DisableCompression: true,
		DisableKeepAlives:  true,
		ForceAttemptHTTP2:  false,
		TLSClientConfig:    f.tlsConfig(target),
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
	if !target.Literal.IsValid() {
		config.ServerName = target.Host
	}
	return config
}

func hostHeader(target Target) string {
	host := target.Host
	if target.Literal.Is6() && !target.Literal.Is4In6() {
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

func readBounded(response *http.Response, max int64) ([]byte, error) {
	if response.ContentLength > max {
		return nil, fail(TooLarge)
	}
	var encodings []string
	for _, value := range response.Header.Values("Content-Encoding") {
		for _, encoding := range strings.Split(value, ",") {
			if encoding = strings.TrimSpace(encoding); encoding != "" {
				encodings = append(encodings, encoding)
			}
		}
	}
	if len(encodings) > 1 {
		return nil, fail(UnsupportedContentEncoding)
	}
	raw := &boundedReader{r: response.Body, remaining: max}
	if len(encodings) == 0 || strings.EqualFold(encodings[0], "identity") {
		return readAll(raw, max)
	}
	var decoded io.Reader
	switch strings.ToLower(encodings[0]) {
	case "gzip":
		reader, err := gzip.NewReader(raw)
		if err != nil {
			return nil, err
		}
		decoded = reader
	case "br":
		decoded = brotli.NewReader(raw)
	case "deflate":
		reader, err := zlib.NewReader(raw)
		if err != nil {
			return nil, err
		}
		decoded = reader
	default:
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
