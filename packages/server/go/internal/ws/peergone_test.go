package ws

import (
	"net"
	"testing"
	"time"
)

// Kestrel's transport keeps reading under an upgraded socket, so a FIN or RST
// aborts the request even while nobody calls Receive.
func TestPeerGoneFiresWhenThePeerEndsTheConnectionWhileNothingReceives(t *testing.T) {
	for _, drop := range []string{"fin", "rst"} {
		t.Run(drop, func(t *testing.T) {
			server, client := pair(t, Options{})
			tcp := client.(*net.TCPConn)
			if drop == "rst" {
				_ = tcp.SetLinger(0)
				_ = tcp.Close()
			} else {
				_ = tcp.CloseWrite()
			}
			select {
			case <-server.PeerGone():
			case <-time.After(3 * time.Second):
				t.Fatal("the peer's end was not seen")
			}
		})
	}
}

// Bytes read ahead are still served before the peer's end, and a FIN still
// reads as a premature close.
func TestFramesReadAheadAreStillReceivedBeforeThePeersEnd(t *testing.T) {
	server, client := pair(t, Options{})
	send(t, client, frame(0x82, []byte{1, 2, 3}))
	_ = client.(*net.TCPConn).CloseWrite()
	select {
	case <-server.PeerGone():
	case <-time.After(3 * time.Second):
		t.Fatal("the peer's end was not seen")
	}
	got := receiveAll(t, server, 1)
	if got[0] != (receipt{3, MessageBinary, true}) {
		t.Fatalf("got %+v", got)
	}
	if _, _, _, err := server.Receive(make([]byte, 16)); err != ErrPrematureClose {
		t.Fatalf("after the end: %v", err)
	}
}

func TestPeerGoneStaysOpenWhileThePeerStaysOrWeAbort(t *testing.T) {
	server, _ := pair(t, Options{})
	select {
	case <-server.PeerGone():
		t.Fatal("fired with the peer still there")
	case <-time.After(200 * time.Millisecond):
	}
	server.Abort()
	select {
	case <-server.PeerGone():
		t.Fatal("fired on our own abort")
	case <-time.After(200 * time.Millisecond):
	}
}

// Kestrel's socket transport buffers at most MaxReadBufferSize (1 MiB by
// default) unconsumed bytes per connection. A peer flooding tiny frames
// while the member waits on a busy room (nothing receives) must not grow
// the read-ahead past that, and its writes must then stall.
func TestAFloodOfTinyFramesWhileNothingReceivesStaysWithinTheReadAheadCap(t *testing.T) {
	server, client := pair(t, Options{})
	tiny := frame(0x82, []byte{7})
	sent := 0
	for sent < 64<<20 {
		_ = client.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
		n, err := client.Write(tiny)
		sent += n
		if err != nil {
			break
		}
	}
	if sent >= 64<<20 {
		t.Fatal("the flood never stalled")
	}
	server.ahead.mu.Lock()
	buffered, capacity := len(server.ahead.buf), cap(server.ahead.buf)
	server.ahead.mu.Unlock()
	if buffered > readAheadLimit || capacity > readAheadLimit || buffered <= readAheadLimit/2 {
		t.Fatalf("%d bytes read ahead in a %d-byte buffer", buffered, capacity)
	}
}
