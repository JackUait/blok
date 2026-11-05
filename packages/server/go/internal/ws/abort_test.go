package ws

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

// Kestrel's WebSocket receives nothing once it is aborted, though its
// transport still holds the frames it read ahead (WebSocketAbortTests.cs).
func TestNoFrameReadAheadIsReceivedAfterAnAbort(t *testing.T) {
	for _, how := range []string{"abort", "keep-alive", "none"} {
		t.Run(how, func(t *testing.T) {
			options := Options{}
			if how == "keep-alive" {
				options = Options{KeepAliveInterval: 100 * time.Millisecond, KeepAliveTimeout: 200 * time.Millisecond}
			}
			server, client := pair(t, options)
			const frames = 200
			send(t, client, bytes.Repeat(frame(0x82, make([]byte, 100)), frames))
			// Long enough for every frame to be read ahead.
			time.Sleep(300 * time.Millisecond)
			switch how {
			case "abort":
				server.Abort()
			case "keep-alive":
				select {
				case <-server.Done():
				case <-time.After(5 * time.Second):
					t.Fatal("the keep-alive never timed out")
				}
			}
			got := 0
			var err error
			for got < frames {
				if _, _, _, err = server.Receive(make([]byte, 256)); err != nil {
					break
				}
				got++
			}
			if how == "none" {
				if got != frames {
					t.Fatalf("got %d frames without an abort: %v", got, err)
				}
				return
			}
			if got != 0 {
				t.Fatalf("got %d frames after the abort", got)
			}
			if how == "keep-alive" && !errors.Is(err, ErrKeepAliveTimeout) {
				t.Fatalf("after the keep-alive timeout: %v", err)
			}
		})
	}
}
