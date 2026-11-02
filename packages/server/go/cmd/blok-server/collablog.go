package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// collabStderr is CollabStandardErrorLoggerProvider: only the room
// category, Warning and above, one "warning: ..." or "error: ..." line each.
// Every other category stays silent, as the C# host clears its providers.
type collabStderr struct {
	mu  *sync.Mutex
	out io.Writer
	// category is set when a logger was built With it.
	category string
}

func newCollabLogger(out io.Writer) *slog.Logger {
	return slog.New(collabStderr{mu: &sync.Mutex{}, out: out})
}

func (h collabStderr) Enabled(_ context.Context, level slog.Level) bool {
	return level >= slog.LevelWarn
}

func (h collabStderr) Handle(_ context.Context, record slog.Record) error {
	category := h.category
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key == "category" {
			category = attr.Value.String()
			return false
		}
		return true
	})
	if category != blokserver.CollabLogCategory || record.Level < slog.LevelWarn {
		return nil
	}
	kind := "warning"
	if record.Level >= slog.LevelError {
		kind = "error"
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := fmt.Fprintf(h.out, "%s: %s\n", kind, record.Message)
	return err
}

func (h collabStderr) WithAttrs(attrs []slog.Attr) slog.Handler {
	for _, attr := range attrs {
		if attr.Key == "category" {
			h.category = attr.Value.String()
		}
	}
	return h
}

func (h collabStderr) WithGroup(string) slog.Handler { return h }
