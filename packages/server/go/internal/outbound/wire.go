package outbound

import (
	"bufio"
	"io"
	"net/http"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// readResponse reads a response to a GET as .NET's HttpClient does
// (dotnet.ResponseReader): net/http refuses header bytes .NET keeps.
func readResponse(r *bufio.Reader, maxHead int, close func() error) (*http.Response, error) {
	reader := dotnet.NewResponseReader(r, maxHead)
	status, _, header, err := reader.ReadHead()
	if err != nil {
		return nil, err
	}
	body, _ := reader.Body(status, false, header)
	return &http.Response{
		StatusCode:    status,
		Header:        header,
		ContentLength: dotnet.ResponseContentLength(header),
		Body:          &wireBody{source: body, close: close},
	}, nil
}

// wireBody closes the connection with the body.
type wireBody struct {
	source io.Reader
	close  func() error
}

func (b *wireBody) Read(p []byte) (int, error) { return b.source.Read(p) }

func (b *wireBody) Close() error { return b.close() }
