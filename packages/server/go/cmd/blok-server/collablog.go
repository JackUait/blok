package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"unicode/utf8"

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
	return writeLogLine(h.out, kind, record.Message)
}

// writeLogLine writes "<kind>: <message>" and a newline with the message on one line.
// Messages carry doc ids from the URL, so a raw newline could forge a record.
// \n, \r and \t become those two-character escapes; every other C0 control,
// DEL, C1 control (U+0080-U+009F), U+2028 and U+2029 becomes \uXXXX in upper
// hex. Backslashes stay as they are. HostCollab.cs follows the same rule
// (fixture host-log-lines.json).
func writeLogLine(out io.Writer, kind, message string) error {
	var line strings.Builder
	line.WriteString(kind)
	line.WriteString(": ")
	for i := 0; i < len(message); {
		r, size := utf8.DecodeRuneInString(message[i:])
		switch {
		case r == '\n':
			line.WriteString(`\n`)
		case r == '\r':
			line.WriteString(`\r`)
		case r == '\t':
			line.WriteString(`\t`)
		case r < 0x20 || (r >= 0x7f && r <= 0x9f) || r == 0x2028 || r == 0x2029:
			fmt.Fprintf(&line, `\u%04X`, r)
		default:
			// Raw bytes, so an invalid byte is not turned into U+FFFD.
			line.WriteString(message[i : i+size])
		}
		i += size
	}
	line.WriteString(newline)
	_, err := io.WriteString(out, line.String())
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
