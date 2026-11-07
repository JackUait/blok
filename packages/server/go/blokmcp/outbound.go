package blokmcp

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// operatorClient is the one outbound client of the MCP server. It reaches
// only URLs the operator configured: the document endpoint and its list
// route, the authorize webhook, the ticket route, the OAuth JWKS and the
// sync service's upgrade. It follows no redirect: a followed one would
// carry a PUT body or a credential to another route.
var operatorClient = &http.Client{
	Transport: dotnet.NewSocketsTransport(dotnet.SocketsOptions{
		ConnectTimeout:           10 * time.Second,
		PooledConnectionLifetime: 5 * time.Minute,
	}),
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// fetched is one finished exchange: the status, headers and whole body.
// bodyErr is set when the body broke off after the status came.
type fetched struct {
	status  int
	header  http.Header
	body    []byte
	bodyErr error
}

// fetch sends one request and reads the whole answer within timeout.
func fetch(ctx context.Context, timeout time.Duration, method, url string, header http.Header, body []byte) (*fetched, error) {
	answer, err := fetchAnswer(ctx, timeout, method, url, header, body)
	if err != nil {
		return nil, err
	}
	if answer.bodyErr != nil {
		return nil, answer.bodyErr
	}
	return answer, nil
}

// fetchAnswer is Node's fetch: it asks for gzip and deflate and decodes
// them, drops a leading BOM as text() does, and sends header values as
// Latin-1. An error means nothing came back; a body that broke off is
// bodyErr, so a caller can read the status first, as Node does.
func fetchAnswer(ctx context.Context, timeout time.Duration, method, url string, header http.Header, body []byte) (*fetched, error) {
	// 0 is no timeout, as the history routes have none.
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	var reader io.Reader
	if body != nil {
		reader = bytesReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	for name, values := range header {
		sent := make([]string, len(values))
		for i, value := range values {
			if sent[i], err = latin1(value); err != nil {
				return nil, err
			}
		}
		request.Header[name] = sent
	}
	if request.Header.Get("Accept-Encoding") == "" {
		request.Header.Set("Accept-Encoding", "gzip, deflate")
	}
	response, err := operatorClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	answer := &fetched{status: response.StatusCode, header: response.Header}
	read, err := io.ReadAll(response.Body)
	if err == nil {
		read, err = decoded(response.Header.Get("Content-Encoding"), read)
	}
	if err != nil {
		answer.bodyErr = err
		return answer, nil
	}
	answer.body = bytes.TrimPrefix(read, []byte("\xef\xbb\xbf"))
	return answer, nil
}

// latin1 is undici's header value check: CR, LF, NUL or a character past
// U+00FF is refused; the rest goes out one byte per character.
func latin1(value string) (string, error) {
	out := make([]byte, 0, len(value))
	for _, r := range value {
		if r == '\r' || r == '\n' || r == 0 || r > 0xFF {
			return "", errors.New("blok-mcp: a header value is not Latin-1")
		}
		out = append(out, byte(r))
	}
	return string(out), nil
}

// decoded undoes a gzip or deflate Content-Encoding. deflate is zlib, or
// raw deflate from hosts that send it so, as undici takes both.
func decoded(coding string, body []byte) ([]byte, error) {
	switch strings.ToLower(strings.TrimSpace(coding)) {
	case "gzip", "x-gzip":
		reader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		return io.ReadAll(reader)
	case "deflate":
		if reader, err := zlib.NewReader(bytes.NewReader(body)); err == nil {
			return io.ReadAll(reader)
		}
		return io.ReadAll(flate.NewReader(bytes.NewReader(body)))
	}
	return body, nil
}

// upgradeTransport carries the sync WebSocket upgrade. The sockets
// transport's wrapped connections hand back no writable body on a 101, so
// the upgrade runs on net/http's own, with the environment proxy.
// The TLS and answer timeouts end an upgrade the server never answers; a
// dial is ended by the room's teardown, which cancels its context. No
// net.Dialer here: the outbound law allows this file none.
var upgradeTransport = &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DisableCompression:    true,
	TLSHandshakeTimeout:   handshakeTimeout,
	ResponseHeaderTimeout: handshakeTimeout,
}
