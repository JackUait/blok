package blokmcp

import (
	"bufio"
	"bytes"
	"errors"
	"testing"
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
