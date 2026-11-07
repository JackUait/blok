package blokmcp

import (
	"context"
	"errors"
	"io"
	"time"
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
	client := &stdioPeer{}
	server := s.newSDKServer(identity{principal: s.options.principal(), client: client})
	tracker := newCallTracker()
	tracker.lines = s.turns
	// The session outlives ctx, so the calls in flight can answer.
	// Node's own cap replaces the SDK's.
	stdin := &cappedStdin{in: in, tracker: tracker}
	session, err := server.Connect(context.WithoutCancel(ctx), trackedTransport{fixedTransport{lineTransport{in: stdin, out: out}}, tracker, client}, nil)
	if err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- session.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		// Work first, then the transport: closing it first would drop the
		// answers of calls in flight. A write returns once the pipe has it.
		deadline := time.Now().Add(stopDrain)
		s.drain(deadline)
		tracker.waitIdle(deadline)
		// Close waits for the calls still running. One past the deadline is
		// left behind, as Node's process exit leaves it.
		go func() { _ = session.Close() }()
		select {
		case err = <-done:
		case <-time.After(time.Until(deadline)):
		}
	}
	// Calls never answered never run: their places go.
	tracker.dropBooked()
	// Past the cap, stdin's end cut the big message short: that is the end
	// Node sees too.
	if err == nil || errors.Is(err, io.EOF) || ctx.Err() != nil || stdin.over.Load() {
		return nil
	}
	return err
}
