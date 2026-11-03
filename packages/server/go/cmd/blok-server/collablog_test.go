package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"testing"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// H37: only the room category, Warning and up, one line each.
func TestTheHostPrintsOnlyRoomWarningsAndErrors(t *testing.T) {
	var out bytes.Buffer
	logger := newCollabLogger(&out)
	room := slog.String("category", blokserver.CollabLogCategory)
	logger.Info("an info line", room)
	logger.Warn("collab: a warning", room)
	logger.Error("collab: an error", room)
	logger.Warn("open routes", slog.String("category", "Blok.Server.AspNetCore"))
	logger.Warn("no category")
	if got, want := out.String(), "warning: collab: a warning\nerror: collab: an error\n"; got != want {
		t.Fatalf("stderr = %q, want %q", got, want)
	}
}

// host-log-lines.json is shared with HostCollabLogTests in C#.
func TestTheHostEscapesControlCharactersInRoomLines(t *testing.T) {
	raw, err := os.ReadFile("../../../../../test/unit/server-conformance/fixtures/host-log-lines.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Name, Level, Message, Line string }
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	room := slog.String("category", blokserver.CollabLogCategory)
	for _, c := range cases {
		var out bytes.Buffer
		logger := newCollabLogger(&out)
		if c.Level == "error" {
			logger.Error(c.Message, room)
		} else {
			logger.Warn(c.Message, room)
		}
		if got := out.String(); got != c.Line {
			t.Errorf("%s: stderr = %q, want %q", c.Name, got, c.Line)
		}
	}
}

// Go only: a C# string cannot hold an invalid UTF-8 byte.
func TestTheHostKeepsInvalidUTF8BytesInRoomLines(t *testing.T) {
	var out bytes.Buffer
	newCollabLogger(&out).Warn("a\xffb\n", slog.String("category", blokserver.CollabLogCategory))
	if got, want := out.String(), "warning: a\xffb\\n\n"; got != want {
		t.Fatalf("stderr = %q, want %q", got, want)
	}
}
