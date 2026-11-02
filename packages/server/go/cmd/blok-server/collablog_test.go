package main

import (
	"bytes"
	"log/slog"
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
