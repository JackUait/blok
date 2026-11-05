package main

import (
	"bytes"
	"log"
	"net/http"
	"os"
	"testing"
	"time"
)

// The C# host clears every logging provider but its collab one, so Kestrel
// writes nothing to stderr, not even for an exception a handler throws.
func TestAPanickingHandlerWritesNothingToStderr(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	defer log.SetOutput(os.Stderr)
	address := startHost(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}), time.Minute)

	_ = rawAnswer(t, address, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")
	if logged.Len() != 0 {
		t.Fatalf("logged %q", logged.String())
	}
}
