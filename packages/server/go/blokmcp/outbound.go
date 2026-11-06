package blokmcp

import (
	"context"
	"io"
	"net/http"
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
type fetched struct {
	status int
	header http.Header
	body   []byte
}

// fetch sends one request and reads the whole answer within timeout.
func fetch(ctx context.Context, timeout time.Duration, method, url string, header http.Header, body []byte) (*fetched, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytesReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	for name, values := range header {
		request.Header[name] = values
	}
	response, err := operatorClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	read, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	return &fetched{status: response.StatusCode, header: response.Header, body: read}, nil
}

// upgrade sends a WebSocket upgrade and reports the status. A 101 is
// closed at once: the live room client is not ported yet.
func upgrade(ctx context.Context, url string, header http.Header) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	for name, values := range header {
		request.Header[name] = values
	}
	response, err := operatorClient.Do(request)
	if err != nil {
		return 0, err
	}
	_ = response.Body.Close()
	return response.StatusCode, nil
}
