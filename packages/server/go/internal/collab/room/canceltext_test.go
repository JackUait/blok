package room

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestACancelReadsAsDotNetsCancelText(t *testing.T) {
	done, cancel := context.WithCancel(context.Background())
	cancel()
	wrapped := fmt.Errorf("put: %w", context.Canceled)
	cases := []struct {
		err    error
		ctx    context.Context
		before bool
		want   string
	}{
		{wrapped, done, true, "A task was canceled."},
		{wrapped, done, false, "The operation was canceled."},
		{context.DeadlineExceeded, nil, false, "The operation was canceled."},
		// With no ctx, a store that wraps a cancel keeps its own text.
		{wrapped, nil, false, "put: context canceled"},
		// A store's own timeout while our context is live keeps its text.
		{context.DeadlineExceeded, context.Background(), false, "context deadline exceeded"},
		{errors.New("s3 down"), done, true, "s3 down"},
	}
	for _, c := range cases {
		if got := errorText(c.err, c.ctx, c.before); got != c.want {
			t.Errorf("errorText(%v, before %v) = %q, want %q", c.err, c.before, got, c.want)
		}
	}
}
