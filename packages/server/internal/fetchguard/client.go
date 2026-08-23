// Package fetchguard is the ONLY place this service fetches a consumer-supplied
// URL. Both /unfurl and /upload-by-url go through it. Adding a second outbound
// http.Client anywhere in this service reintroduces the SSRF hole this package
// exists to close.
package fetchguard

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/doyensec/safeurl"
)

var (
	// ErrBlockedAddress is returned for EVERY transport-level failure, not just
	// a refused address: a blocked range, a closed port, a DNS miss and a
	// timeout are deliberately indistinguishable to the caller. Telling them
	// apart is exactly what would turn this service into a network scanner.
	// The underlying cause stays reachable with errors.As for logs and tests.
	ErrBlockedAddress   = errors.New("fetchguard: address is not permitted")
	ErrTooLarge         = errors.New("fetchguard: response exceeded the size cap")
	ErrTooManyRedirects = errors.New("fetchguard: too many redirects")
	ErrBadScheme        = errors.New("fetchguard: only http and https are permitted")
)

type Config struct {
	Timeout      time.Duration
	MaxBytes     int64
	MaxRedirects int

	// TestOnlyAllowedAddrs makes the guard reachable for exactly these
	// "host:port" addresses — the httptest servers a test just started, whose
	// random high port is not knowable until the listener is up.
	//
	// Settable from Go only: never wire this to a CLI flag or an environment
	// variable, or a shipped binary can be told to dial the operator's network.
	//
	// Setting it turns safeurl's IP allowlist EXCLUSIVE: once AllowedIPs is
	// non-nil, every address outside this list is refused, public ones
	// included. A client built with it therefore proves nothing about the
	// production address filter — only strict clients do.
	TestOnlyAllowedAddrs []string
}

type Response struct {
	Body        []byte
	ContentType string
	FinalURL    string
}

type Client struct {
	cfg  Config
	http *safeurl.WrappedClient
}

// Getter is the seam the HTTP layer depends on, so handlers can be tested
// without a network. *Client is the only production implementation.
type Getter interface {
	Get(ctx context.Context, rawURL string) (*Response, error)
}

var _ Getter = (*Client)(nil)

func New(cfg Config) *Client {
	builder := safeurl.GetConfigBuilder().
		SetAllowedSchemes("http", "https").
		SetAllowedPorts(80, 443).
		SetTimeout(cfg.Timeout).
		// safeurl copies Timeout and CheckRedirect into the inner *http.Client
		// at construction, so they have to be set here rather than assigned on
		// the returned wrapper.
		SetCheckRedirect(func(_ *http.Request, via []*http.Request) error {
			// via holds the requests already made, so this follows exactly
			// MaxRedirects hops and refuses the next. Each hop is re-dialed and
			// therefore re-checked by the address filter; this only bounds the
			// length of the chain.
			if len(via) > cfg.MaxRedirects {
				return ErrTooManyRedirects
			}

			return nil
		})

	if len(cfg.TestOnlyAllowedAddrs) > 0 {
		ips, ports := splitTestAddrs(cfg.TestOnlyAllowedAddrs)
		builder = builder.SetAllowedIPs(ips...).SetAllowedPorts(ports...)
	}

	// safeurl.Client returns a *safeurl.WrappedClient. Never replace or bypass
	// its .Client field: the address filter lives in that inner client's
	// Transport.DialContext control function, and scheme/host/credential
	// validation runs only in the wrapper's own Do.
	return &Client{cfg: cfg, http: safeurl.Client(builder.Build())}
}

// splitTestAddrs turns "host:port" pairs into the IP and port allowlists
// safeurl wants. 80 and 443 stay allowed so a test can still exercise a
// redirect to an ordinary port.
func splitTestAddrs(addrs []string) (ips []string, ports []int) {
	ports = []int{80, 443}

	for _, addr := range addrs {
		host, rawPort, err := net.SplitHostPort(addr)
		if err != nil {
			panic(fmt.Sprintf("fetchguard: TestOnlyAllowedAddrs entry %q is not host:port: %v", addr, err))
		}
		if net.ParseIP(host) == nil {
			panic(fmt.Sprintf("fetchguard: TestOnlyAllowedAddrs entry %q must use an IP literal, not a hostname", addr))
		}

		port, err := strconv.Atoi(rawPort)
		if err != nil {
			panic(fmt.Sprintf("fetchguard: TestOnlyAllowedAddrs entry %q has a non-numeric port", addr))
		}

		ips = append(ips, host)
		ports = append(ports, port)
	}

	return ips, ports
}

func (c *Client) Get(ctx context.Context, rawURL string) (*Response, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrBadScheme, rawURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%w: %s", ErrBadScheme, parsed.Scheme)
	}

	// A zero Timeout deadlines immediately, which fails closed. Leave it that
	// way: a caller that forgot to configure one must not get an unbounded fetch.
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "blok-server (+https://blokeditor.com)")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, classify(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.cfg.MaxBytes+1))
	if err != nil {
		return nil, classify(err)
	}
	if int64(len(body)) > c.cfg.MaxBytes {
		return nil, ErrTooLarge
	}

	return &Response{
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
		FinalURL:    resp.Request.URL.String(),
	}, nil
}

// classify collapses every request failure into one of the package sentinels.
// The default is ErrBlockedAddress rather than a pass-through: the guard fails
// closed, so an error nobody anticipated is reported as a refusal instead of
// being inspected and possibly waved through. The original error stays wrapped
// so errors.As still reaches safeurl's own type.
func classify(err error) error {
	if errors.Is(err, ErrTooManyRedirects) {
		return ErrTooManyRedirects
	}

	var schemeErr *safeurl.AllowedSchemeError
	if errors.As(err, &schemeErr) {
		return fmt.Errorf("%w: %w", ErrBadScheme, err)
	}

	return fmt.Errorf("%w: %w", ErrBlockedAddress, err)
}
