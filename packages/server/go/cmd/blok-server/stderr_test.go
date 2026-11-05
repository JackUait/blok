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
// writes nothing to stderr, not even for an exception a handler throws. A
// panic never reaches net/http's ErrorLog (RecoverLikeKestrel answers it);
// a second WriteHeader does.
func TestAPanickingHandlerWritesNothingToStderr(t *testing.T) {
	handlers := map[string]http.HandlerFunc{
		"a panic": func(http.ResponseWriter, *http.Request) { panic("boom") },
		"a second WriteHeader": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.WriteHeader(http.StatusTeapot)
		},
	}
	for name, handler := range handlers {
		t.Run(name, func(t *testing.T) {
			var logged bytes.Buffer
			log.SetOutput(&logged)
			defer log.SetOutput(os.Stderr)
			address := startHost(t, handler, time.Minute)

			if answer := rawAnswer(t, address, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"); answer == "" {
				t.Fatal("no answer")
			}
			if logged.Len() != 0 {
				t.Fatalf("logged %q", logged.String())
			}
		})
	}
}
