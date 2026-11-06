package blokmcp

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// stopDrain is Node's STOP_DRAIN_MS: above the slowest bounded open (10 s
// authorize webhook + 30 s endpoint load), so a stop waits that long for
// work in flight, then gives up.
const stopDrain = 45 * time.Second

// ServeStdio serves one client over newline-delimited JSON on in and out
// until in closes or ctx ends. Nothing else may write to out. When ctx
// ends, the calls still running finish and are answered first.
func (s *Server) ServeStdio(ctx context.Context, in io.ReadCloser, out io.WriteCloser) error {
	if s.options.Auth.Kind == "oauth" {
		return &ConfigError{Message: "OAuth authentication needs the HTTP transport (--http)"}
	}
	server := s.newSDKServer(identity{principal: s.options.principal()})
	tracker := newCallTracker()
	// The session outlives ctx, so the calls in flight can answer.
	session, err := server.Connect(context.WithoutCancel(ctx), trackedTransport{fixedTransport{&mcp.IOTransport{Reader: in, Writer: out}}, tracker}, nil)
	if err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- session.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		tracker.waitIdle(time.Now().Add(stopDrain))
		_ = session.Close()
		err = <-done
	}
	if err == nil || errors.Is(err, io.EOF) || ctx.Err() != nil {
		return nil
	}
	return err
}
