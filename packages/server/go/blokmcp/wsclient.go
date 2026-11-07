package blokmcp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// wsConn is the client role of RFC 6455 over an upgraded HTTP connection:
// every write masked, reads unmasked, pings answered with pongs.
type wsConn struct {
	rw       io.ReadWriteCloser
	reader   *bufio.Reader
	protocol string
	writeMu  sync.Mutex
	closed   bool
	// ended closes when the room's read loop for this connection returns,
	// the closing handshake included. Nil: no read loop runs.
	ended   chan struct{}
	endOnce sync.Once
	// serverClosed: the server's close frame came; no other will.
	serverClosed atomic.Bool
}

func (c *wsConn) markEnded() {
	if c.ended != nil {
		c.endOnce.Do(func() { close(c.ended) })
	}
}

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
	// maxMessageBytes is ws's default maxPayload (100 MiB).
	maxMessageBytes = 100 << 20
)

// errUpgradeRefused is a pre-upgrade answer other than 101.
type errUpgradeRefused struct{ status int }

func (e *errUpgradeRefused) Error() string {
	return fmt.Sprintf("the upgrade was refused with %d", e.status)
}

const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// dialWebSocket upgrades url (http or https) through the operator client.
// The server must select one of the offered version tokens, as ws demands.
func dialWebSocket(ctx context.Context, url string, header http.Header, protocols []string) (*wsConn, error) {
	key := make([]byte, 16)
	_, _ = rand.Read(key)
	encodedKey := base64.StdEncoding.EncodeToString(key)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for name, values := range header {
		request.Header[name] = values
	}
	request.Header["Connection"] = []string{"Upgrade"}
	request.Header["Upgrade"] = []string{"websocket"}
	request.Header["Sec-Websocket-Version"] = []string{"13"}
	request.Header["Sec-Websocket-Key"] = []string{encodedKey}
	request.Header["Sec-Websocket-Protocol"] = []string{strings.Join(protocols, ",")}
	response, err := upgradeTransport.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		_ = response.Body.Close()
		return nil, &errUpgradeRefused{status: response.StatusCode}
	}
	rw, ok := response.Body.(io.ReadWriteCloser)
	if !ok {
		_ = response.Body.Close()
		return nil, errors.New("the upgraded connection is not writable")
	}
	sum := sha1.Sum([]byte(encodedKey + websocketGUID))
	if response.Header.Get("Sec-Websocket-Accept") != base64.StdEncoding.EncodeToString(sum[:]) {
		_ = rw.Close()
		return nil, errors.New("the server sent a wrong Sec-WebSocket-Accept")
	}
	selected := response.Header.Get("Sec-Websocket-Protocol")
	offered := false
	for _, protocol := range protocols {
		offered = offered || protocol == selected
	}
	// ws aborts when the server selects nothing or something not offered.
	if selected == "" || !offered {
		_ = rw.Close()
		return nil, errors.New("the server selected no offered subprotocol")
	}
	return &wsConn{rw: rw, reader: bufio.NewReader(rw), protocol: selected, ended: make(chan struct{})}, nil
}

func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closed {
		return errors.New("websocket closed")
	}
	frame := make([]byte, 0, len(payload)+14)
	frame = append(frame, 0x80|opcode)
	switch {
	case len(payload) < 126:
		frame = append(frame, 0x80|byte(len(payload)))
	case len(payload) <= 0xFFFF:
		frame = append(frame, 0x80|126, byte(len(payload)>>8), byte(len(payload)))
	default:
		frame = append(frame, 0x80|127)
		frame = binary.BigEndian.AppendUint64(frame, uint64(len(payload)))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	frame = append(frame, mask...)
	for i, b := range payload {
		frame = append(frame, b^mask[i%4])
	}
	_, err := c.rw.Write(frame)
	return err
}

// sendBinary writes one binary message.
func (c *wsConn) sendBinary(payload []byte) error { return c.writeFrame(opBinary, payload) }

// sendClose starts the closing handshake with code, then stops writing.
func (c *wsConn) sendClose(code uint16) {
	_ = c.writeFrame(opClose, binary.BigEndian.AppendUint16(nil, code))
	c.writeMu.Lock()
	c.closed = true
	c.writeMu.Unlock()
}

// abort drops the connection without a closing handshake.
func (c *wsConn) abort() { _ = c.rw.Close() }

// errProtocol is a frame ws refuses; the connection closes with 1002.
var errProtocol = errors.New("the server broke the WebSocket framing")

// refuse closes with code, as ws does on a receiver error, and ends the
// connection.
func (c *wsConn) refuse(code int, err error) ([]byte, int, error) {
	c.writeMu.Lock()
	wasClosed := c.closed
	c.writeMu.Unlock()
	if !wasClosed {
		c.sendClose(uint16(code))
	}
	_ = c.rw.Close()
	return nil, code, err
}

// readMessage returns the next data message, or the close code (1005 for
// none, 1006 for a dropped connection, 1002 or 1009 for a frame ws
// refuses) once the connection ends.
func (c *wsConn) readMessage() ([]byte, int, error) {
	var message []byte
	fragmented := false
	for {
		head := make([]byte, 2)
		if _, err := io.ReadFull(c.reader, head); err != nil {
			return nil, 1006, err
		}
		fin, opcode := head[0]&0x80 != 0, head[0]&0x0F
		if head[0]&0x70 != 0 {
			// No extension is negotiated, so every RSV bit must be clear.
			return c.refuse(1002, errProtocol)
		}
		if head[1]&0x80 != 0 {
			return c.refuse(1002, errors.New("a server frame was masked"))
		}
		length := uint64(head[1] & 0x7F)
		switch {
		case opcode == opContinuation:
			if !fragmented {
				return c.refuse(1002, errProtocol)
			}
		case opcode == opText || opcode == opBinary:
			if fragmented {
				return c.refuse(1002, errProtocol)
			}
		case opcode >= opClose && opcode <= opPong:
			// RFC 6455 §5.5: control frames are whole and short.
			if !fin || length > 125 || (opcode == opClose && length == 1) {
				return c.refuse(1002, errProtocol)
			}
		default:
			return c.refuse(1002, errProtocol)
		}
		switch length {
		case 126:
			extended := make([]byte, 2)
			if _, err := io.ReadFull(c.reader, extended); err != nil {
				return nil, 1006, err
			}
			length = uint64(binary.BigEndian.Uint16(extended))
		case 127:
			extended := make([]byte, 8)
			if _, err := io.ReadFull(c.reader, extended); err != nil {
				return nil, 1006, err
			}
			length = binary.BigEndian.Uint64(extended)
		}
		// ws counts the whole message against maxPayload, fragments included.
		// The length is checked alone first: a 64-bit one (top bit set
		// too) must not wrap the sum.
		if opcode < opClose && (length > maxMessageBytes || uint64(len(message))+length > maxMessageBytes) {
			return c.refuse(1009, errors.New("a message is too big"))
		}
		// Read as the bytes come: a header may claim 100 MiB and send none.
		var read bytes.Buffer
		if _, err := io.CopyN(&read, c.reader, int64(length)); err != nil {
			if errors.Is(err, io.EOF) && read.Len() > 0 {
				err = io.ErrUnexpectedEOF
			}
			return nil, 1006, err
		}
		payload := read.Bytes()
		switch opcode {
		case opPing:
			_ = c.writeFrame(opPong, payload)
			continue
		case opPong:
			continue
		case opClose:
			code := 1005
			if len(payload) >= 2 {
				code = int(binary.BigEndian.Uint16(payload))
			}
			// Echo the close, then the server ends the TCP connection.
			c.serverClosed.Store(true)
			c.writeMu.Lock()
			wasClosed := c.closed
			c.writeMu.Unlock()
			if !wasClosed && code == 1005 {
				_ = c.writeFrame(opClose, nil)
			} else if !wasClosed {
				c.sendClose(uint16(code))
			}
			_ = c.rw.Close()
			return nil, code, io.EOF
		}
		message = append(message, payload...)
		fragmented = !fin
		if fin {
			return message, 0, nil
		}
	}
}

// closeWait is how long a closed socket waits for the server's close
// before dropping the connection, as ws does after close().
const closeWait = 5 * time.Second

// finishClosing reads, and drops, frames until the server's close arrives
// or closeWait passes, so the server can answer the close.
func (c *wsConn) finishClosing(ended bool) {
	if ended {
		c.abort()
		return
	}
	timer := time.AfterFunc(closeWait, c.abort)
	defer timer.Stop()
	for {
		if _, _, err := c.readMessage(); err != nil {
			c.abort()
			return
		}
	}
}
