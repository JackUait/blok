package blokmcp

import (
	"context"
	"errors"
	"io"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServeStdio serves one client over newline-delimited JSON on in and out
// until in closes or ctx ends. Nothing else may write to out.
func (s *Server) ServeStdio(ctx context.Context, in io.ReadCloser, out io.WriteCloser) error {
	if s.options.Auth.Kind == "oauth" {
		return &ConfigError{Message: "OAuth authentication needs the HTTP transport (--http)"}
	}
	server := s.newSDKServer(identity{principal: s.options.principal()})
	session, err := server.Connect(ctx, fixedTransport{&mcp.IOTransport{Reader: in, Writer: out}}, nil)
	if err != nil {
		return err
	}
	err = session.Wait()
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}
