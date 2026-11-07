package blokmcp

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"runtime"
	"sync"
	"testing"
	"time"
)

func closingRoom(t *testing.T) (*liveRoom, *fakeWire) {
	t.Helper()
	room := newLiveRoom("ws://127.0.0.1:1/sync", "doc", nil, func(bool) (string, error) { return "", errors.New("no ticket") }, nil)
	wire := &fakeWire{in: bytes.NewReader(nil)}
	room.conn = &wsConn{rw: wire, reader: bufio.NewReader(wire)}
	t.Cleanup(room.close)
	return room, wire
}

func terminalOf(room *liveRoom) string {
	select {
	case err := <-room.opened:
		var terminal *roomTerminalError
		if errors.As(err, &terminal) {
			return terminal.terminal
		}
	default:
	}
	return ""
}

// Node's provider gives up on the second 1009 since a resync answer
// shipped: the frame it must send does not fit.
func TestASecond1009EndsTheRoom(t *testing.T) {
	room, _ := closingRoom(t)
	room.mu.Lock()
	defer room.mu.Unlock()
	room.handleClose(1009)
	if room.phase == phaseTerminal {
		t.Fatal("the first 1009 ended the room")
	}
	room.reconnectTimer = stopTimer(room.reconnectTimer)
	room.handleClose(1009)
	if got := terminalOf(room); got != "oversized-update" {
		t.Fatalf("terminal %q after the second 1009", got)
	}
}

// A resync answer at least as big as a frame the server refused is not
// written: it would draw the same 1009 again.
func TestAResyncAnswerAsBigAsARefusedFrameIsNotSent(t *testing.T) {
	room, wire := closingRoom(t)
	room.mu.Lock()
	defer room.mu.Unlock()
	room.sendBytes(make([]byte, 4))
	room.handleClose(1009)
	room.reconnectTimer = stopTimer(room.reconnectTimer)
	wire.out.Reset()
	room.conn = &wsConn{rw: wire, reader: bufio.NewReader(wire)}
	room.largestSent = 0
	room.answerResync(room.doc.EncodeStateVector())
	// Only the closing frame (opcode 8) may go out, no binary one (2).
	written := wire.out.Bytes()
	if (len(written) > 0 && written[0] != 0x88) || terminalOf(room) != "oversized-update" {
		t.Fatalf("wrote % x; want no binary frame and an oversized-update end", written)
	}
}

// A resync answer that ships clears the 1009 count.
func TestAShippedResyncAnswerClearsThe1009Count(t *testing.T) {
	room, wire := closingRoom(t)
	room.mu.Lock()
	defer room.mu.Unlock()
	room.handleClose(1009)
	room.reconnectTimer = stopTimer(room.reconnectTimer)
	room.conn = &wsConn{rw: wire, reader: bufio.NewReader(wire)}
	room.answerResync(room.doc.EncodeStateVector())
	room.handleClose(1009)
	room.reconnectTimer = stopTimer(room.reconnectTimer)
	if room.phase == phaseTerminal {
		t.Fatal("a 1009 after a shipped answer ended the room")
	}
}

// Node's provider drops a residual answer that lands while an operation is
// in flight: the server's vector predates it, so the diff would send the
// same work again. The round is asked again once the outbox drains.
func TestAResidualAnswerDuringAnOperationIsAskedAgain(t *testing.T) {
	room, _ := closingRoom(t)
	room.mu.Lock()
	defer room.mu.Unlock()
	lineage, operation := "l1", "op-1"
	room.lineage, room.inFlight, room.residual = &lineage, &operation, "requested"
	room.handleResync(room.doc.EncodeStateVector())
	if room.residual != "none" || !room.resyncOwed {
		t.Fatalf("residual %q, owed %v", room.residual, room.resyncOwed)
	}
}

// A sync server that takes the TCP connection and never answers the
// upgrade must not keep a goroutine or a connection per closed room.
func TestAClosedRoomEndsItsDialToASilentServer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var held []net.Conn
	t.Cleanup(func() {
		_ = listener.Close()
		mu.Lock()
		defer mu.Unlock()
		for _, conn := range held {
			_ = conn.Close()
		}
	})
	accepted := make(chan struct{}, 16)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			held = append(held, conn)
			mu.Unlock()
			accepted <- struct{}{}
		}
	}()
	tickets := func(bool) (string, error) { return "t", nil }
	before := runtime.NumGoroutine()
	for range 3 {
		room := newLiveRoom("http://"+listener.Addr().String()+"/doc", "doc", nil, tickets, nil)
		if room.open(context.Background(), 300*time.Millisecond) == nil {
			t.Fatal("a silent server opened")
		}
		<-accepted
		room.close()
	}
	deadline := time.Now().Add(3 * time.Second)
	for runtime.NumGoroutine() > before && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if after := runtime.NumGoroutine(); after > before {
		stack := make([]byte, 1<<20)
		t.Fatalf("goroutines %d -> %d:\n%s", before, after, stack[:runtime.Stack(stack, true)])
	}
}

// Node's close waits for the server's answering close frame before the
// process may exit; a slow server must still get the whole handshake.
func TestAClosedRoomWaitsForTheServersCloseFrame(t *testing.T) {
	client, server := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })
	room := newLiveRoom("ws://127.0.0.1:1/sync", "doc", nil, func(bool) (string, error) { return "t", nil }, nil)
	conn := &wsConn{rw: client, reader: bufio.NewReader(client), ended: make(chan struct{})}
	room.mu.Lock()
	room.conn = conn
	generation := room.generation
	room.mu.Unlock()
	go room.readLoop(generation, conn)
	echoed := make(chan struct{})
	go func() {
		reader := bufio.NewReader(server)
		for {
			head := make([]byte, 2)
			if _, err := io.ReadFull(reader, head); err != nil {
				return
			}
			length := int(head[1] & 0x7F)
			if _, err := io.ReadFull(reader, make([]byte, 4+length)); err != nil {
				return
			}
			if head[0]&0x0F == opClose {
				time.Sleep(300 * time.Millisecond)
				close(echoed)
				_, _ = server.Write([]byte{0x88, 0x02, 0x03, 0xE8})
				return
			}
		}
	}()
	room.close()
	select {
	case <-echoed:
	default:
		t.Fatal("close returned before the server answered the close")
	}
	select {
	case <-conn.ended:
	default:
		t.Fatal("close returned before the closing handshake ended")
	}
}

// A server that never answers the close is dropped after closeWait.
func TestAClosedRoomDropsAServerThatNeverAnswersTheClose(t *testing.T) {
	client, server := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })
	go func() { _, _ = io.Copy(io.Discard, server) }()
	room := newLiveRoom("ws://127.0.0.1:1/sync", "doc", nil, func(bool) (string, error) { return "t", nil }, nil)
	conn := &wsConn{rw: client, reader: bufio.NewReader(client), ended: make(chan struct{})}
	room.mu.Lock()
	room.conn = conn
	generation := room.generation
	room.mu.Unlock()
	go room.readLoop(generation, conn)
	started := time.Now()
	room.close()
	if waited := time.Since(started); waited < closeWait-time.Second || waited > closeWait+2*time.Second {
		t.Fatalf("close waited %v", waited)
	}
	select {
	case <-conn.ended:
	case <-time.After(time.Second):
		t.Fatal("the read loop kept running")
	}
}

// When the server closed first, nothing more will come: close must not
// wait for a close answer.
func TestAClosedRoomDoesNotWaitWhenTheServerClosedFirst(t *testing.T) {
	client, server := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })
	room := newLiveRoom("ws://127.0.0.1:1/sync", "doc", nil, func(bool) (string, error) { return "t", nil }, nil)
	conn := &wsConn{rw: client, reader: bufio.NewReader(client), ended: make(chan struct{})}
	room.mu.Lock()
	room.conn = conn
	generation := room.generation
	go room.readLoop(generation, conn)
	echoed := make(chan struct{})
	go func() {
		_, _ = server.Write([]byte{0x88, 0x02, 0x11, 0x39}) // 4409
		head := make([]byte, 2)
		if _, err := io.ReadFull(server, head); err == nil {
			close(echoed)
		}
		_, _ = io.Copy(io.Discard, server)
	}()
	<-echoed
	// The read loop has the server's close and waits for the lock.
	room.mu.Unlock()
	started := time.Now()
	room.close()
	if waited := time.Since(started); waited > time.Second {
		t.Fatalf("close waited %v after the server closed", waited)
	}
}
