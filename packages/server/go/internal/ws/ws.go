// Package ws is the server side of RFC 6455 that the sync endpoint needs,
// shaped like .NET's ManagedWebSocket (System.Net.WebSockets 10.0.11,
// decompiled) so SyncSocketMember ports line for line: no extensions, one
// receive at a time, every frame boundary visible (an empty fragment is one
// receive), exact close codes and reasons.
package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

// MessageType is WebSocketMessageType.
type MessageType uint8

const (
	MessageText MessageType = iota
	MessageBinary
	MessageClose
)

// Close statuses the server sends or checks.
const (
	StatusNormal         uint16 = 1000
	StatusProtocolError  uint16 = 1002
	StatusInvalidPayload uint16 = 1007
)

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xa
)

// Errors a receive or send returns. All of them mean the socket is gone
// for SyncSocketMember (IsSocketGone).
var (
	// ErrProtocol is a frame the peer had no right to send; a 1002 or 1007
	// close went out first.
	ErrProtocol = errors.New("ws: protocol violation")
	// ErrPrematureClose is the stream ending inside a frame.
	ErrPrematureClose = errors.New("ws: connection closed prematurely")
	// ErrInvalidState is a send after our close, or after an abort.
	ErrInvalidState = errors.New("ws: invalid state")
	// ErrKeepAliveTimeout is the abort when a keep-alive ping went unanswered.
	ErrKeepAliveTimeout = errors.New("ws: keep-alive ping timed out")
)

const acceptGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// Options are WebSocketAcceptContext's fields the endpoint sets.
type Options struct {
	SubProtocol string
	// KeepAliveInterval > 0 sends pings; with KeepAliveTimeout > 0 an
	// unanswered ping aborts the socket after the timeout.
	KeepAliveInterval time.Duration
	KeepAliveTimeout  time.Duration
}

// Conn is one accepted WebSocket. Receive must be called from one goroutine
// at a time; sends may come from any goroutine.
type Conn struct {
	raw    net.Conn
	reader *bufio.Reader

	sendMu sync.Mutex
	// stateMu guards the close flags and the keep-alive state.
	stateMu       sync.Mutex
	sentClose     bool
	receivedClose bool
	aborted       bool
	keepAlive     *keepAlive
	// keepAliveSending is an unsolicited pong waiting on sendMu.
	keepAliveSending atomic.Bool
	closeOnce        sync.Once
	done             chan struct{}

	// Receive state, owned by the receiving goroutine.
	last      frameHeader
	utf8State utf8State

	CloseStatus      uint16
	CloseDescription string
}

type frameHeader struct {
	fin       bool
	opcode    byte
	remaining int64
	mask      [4]byte
	maskPos   int
	processed bool
}

// splitCommaSeparated is StringValues.GetCommaSeparatedValues for plain
// tokens: split on commas, trim spaces and tabs, drop empty ones.
func splitCommaSeparated(values []string) []string {
	var out []string
	for _, value := range values {
		for _, token := range strings.Split(value, ",") {
			if token = strings.Trim(token, " \t"); token != "" {
				out = append(out, token)
			}
		}
	}
	return out
}

func hasToken(h http.Header, name, want string) bool {
	for _, token := range splitCommaSeparated(h.Values(name)) {
		if strings.EqualFold(token, want) {
			return true
		}
	}
	return false
}

// IsWebSocketRequest is Kestrel's IsUpgradableRequest (a Connection upgrade
// token, no body, no Transfer-Encoding) and then ASP.NET's
// CheckSupportedWebSocketRequest (GET, version 13, Upgrade websocket,
// Connection Upgrade, a key that is 16 bytes of base64).
func IsWebSocketRequest(r *http.Request) bool {
	if !hasToken(r.Header, "Connection", "upgrade") || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		return false
	}
	return strings.EqualFold(r.Method, http.MethodGet) &&
		hasToken(r.Header, "Sec-WebSocket-Version", "13") &&
		hasToken(r.Header, "Upgrade", "websocket") &&
		keyValid(strings.Join(r.Header.Values("Sec-WebSocket-Key"), ","))
}

// keyValid is IsRequestKeyValid: Convert.TryFromBase64String ignores
// whitespace and must yield exactly 16 bytes.
func keyValid(key string) bool {
	if strings.TrimSpace(key) == "" {
		return false
	}
	compact := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, key)
	decoded, err := base64.StdEncoding.DecodeString(compact)
	return err == nil && len(decoded) == 16
}

// acceptKey is CreateResponseKey: the key's UTF-8 bytes go into a 60-byte
// buffer and the GUID is written over it from byte 24, so only the first
// 24 bytes of a spaced-out key count. ok is false when the key does not
// fit, where .NET throws.
func acceptKey(key string) (string, bool) {
	buffer := make([]byte, 60)
	if len(key) > len(buffer) {
		return "", false
	}
	copy(buffer, key)
	copy(buffer[24:], acceptGUID)
	sum := sha1.Sum(buffer)
	return base64.StdEncoding.EncodeToString(sum[:]), true
}

// ErrAcceptKey is a valid key too long for CreateResponseKey's buffer.
var ErrAcceptKey = errors.New("ws: the Sec-WebSocket-Key does not fit")

// ErrNotHijacked is a failed hijack: nothing was written, so the caller
// still owns the response.
var ErrNotHijacked = errors.New("ws: the connection was not hijacked")

// Upgrade hijacks the connection and writes the 101. The caller checked
// IsWebSocketRequest. Hijack clears the conn's deadlines (net/http's
// hijackLocked), so the socket outlives the request deadline.
func Upgrade(w http.ResponseWriter, r *http.Request, options Options) (*Conn, error) {
	accept, ok := acceptKey(strings.Join(r.Header.Values("Sec-WebSocket-Key"), ","))
	if !ok {
		return nil, ErrAcceptKey
	}
	raw, buffered, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return nil, errors.Join(ErrNotHijacked, err)
	}
	// Kestrel's order. Server only when the host set one, as Kestrel's
	// default does.
	response := "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nDate: " + time.Now().UTC().Format(http.TimeFormat) + "\r\n"
	if server := w.Header().Get("Server"); server != "" && !strings.ContainsAny(server, "\r\n") {
		response += "Server: " + server + "\r\n"
	}
	response += "Upgrade: websocket\r\nSec-WebSocket-Accept: " + accept + "\r\n"
	if strings.TrimSpace(options.SubProtocol) != "" {
		response += "Sec-WebSocket-Protocol: " + options.SubProtocol + "\r\n"
	}
	if _, err := buffered.Writer.WriteString(response + "\r\n"); err != nil {
		raw.Close()
		return nil, err
	}
	if err := buffered.Writer.Flush(); err != nil {
		raw.Close()
		return nil, err
	}
	return newConn(raw, buffered.Reader, options), nil
}

// NewServerConn wraps a connection that already finished its handshake;
// for tests and fuzzing.
func NewServerConn(raw net.Conn, reader *bufio.Reader, options Options) *Conn {
	if reader == nil {
		reader = bufio.NewReader(raw)
	}
	return newConn(raw, reader, options)
}

func newConn(raw net.Conn, reader *bufio.Reader, options Options) *Conn {
	c := &Conn{
		raw:  raw,
		done: make(chan struct{}),
		last: frameHeader{fin: true, opcode: opText, processed: true},
	}
	c.reader = bufio.NewReader(dataReader{c, reader})
	if options.KeepAliveInterval > 0 {
		c.startKeepAlive(options.KeepAliveInterval, options.KeepAliveTimeout)
	}
	return c
}

// dataReader is where OnDataReceived runs: after every read from the
// stream, header reads included, as EnsureBufferContainsAsync does.
type dataReader struct {
	c *Conn
	r io.Reader
}

func (d dataReader) Read(p []byte) (int, error) {
	n, err := d.r.Read(p)
	if n > 0 {
		d.c.onDataReceived()
	}
	return n, err
}

// dispose closes the stream once; every blocked read and write ends.
func (c *Conn) dispose() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.raw.Close()
	})
}

// Abort is WebSocket.Abort: the stream closes with no close frame.
func (c *Conn) Abort() {
	c.stateMu.Lock()
	c.aborted = true
	c.stateMu.Unlock()
	c.dispose()
}

// Done is closed once the socket is disposed.
func (c *Conn) Done() <-chan struct{} { return c.done }

func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	header := make([]byte, 0, 10+len(payload))
	header = append(header, 0x80|opcode)
	switch n := len(payload); {
	case n <= 125:
		header = append(header, byte(n))
	case n <= 0xffff:
		header = append(header, 126, byte(n>>8), byte(n))
	default:
		header = append(header, 127)
		header = binary.BigEndian.AppendUint64(header, uint64(n))
	}
	_, err := c.raw.Write(append(header, payload...))
	return err
}

// validSendState is Open or CloseReceived, and not aborted.
func (c *Conn) validSendState() bool {
	return !c.sentClose && !c.aborted
}

// SendBinary sends one whole binary message.
func (c *Conn) SendBinary(payload []byte) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	c.stateMu.Lock()
	valid := c.validSendState()
	c.stateMu.Unlock()
	if !valid {
		return ErrInvalidState
	}
	return c.writeFrame(opBinary, payload)
}

// CloseOutput is CloseOutputAsync: send our close and, if the peer's close
// already came, dispose the stream.
func (c *Conn) CloseOutput(status uint16, reason string) error {
	c.stateMu.Lock()
	valid := c.validSendState()
	c.stateMu.Unlock()
	if !valid {
		return ErrInvalidState
	}
	if err := c.sendClose(status, reason); err != nil {
		return err
	}
	c.stateMu.Lock()
	received := c.receivedClose
	c.stateMu.Unlock()
	if received {
		c.dispose()
	}
	return nil
}

func (c *Conn) sendClose(status uint16, reason string) error {
	payload := binary.BigEndian.AppendUint16(nil, status)
	payload = append(payload, reason...)
	c.sendMu.Lock()
	err := c.writeFrame(opClose, payload)
	c.sendMu.Unlock()
	if err != nil {
		return err
	}
	c.stateMu.Lock()
	c.sentClose = true
	c.stateMu.Unlock()
	return nil
}

// failReceive is CloseWithReceiveErrorAndThrowAsync.
func (c *Conn) failReceive(status uint16, err error) error {
	c.stateMu.Lock()
	sent := c.sentClose
	c.stateMu.Unlock()
	if !sent {
		_ = c.CloseOutput(status, "")
	}
	return err
}

func (c *Conn) readFull(b []byte) error {
	if _, err := io.ReadFull(c.reader, b); err != nil {
		if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
			return ErrPrematureClose
		}
		return err
	}
	return nil
}

// readHeader reads 2 bytes, then the mask and extended length a server
// always waits for (2 + 4 + 0/2/8, even when the mask bit is clear), then
// checks the frame like TryParseMessageHeaderFromReceiveBuffer.
func (c *Conn) readHeader() (frameHeader, error) {
	var buffer [14]byte
	if err := c.readFull(buffer[:2]); err != nil {
		return frameHeader{}, err
	}
	length := int64(buffer[1] & 0x7f)
	extended := 0
	switch length {
	case 126:
		extended = 2
	case 127:
		extended = 8
	}
	if err := c.readFull(buffer[2 : 2+4+extended]); err != nil {
		return frameHeader{}, err
	}
	header := frameHeader{fin: buffer[0]&0x80 != 0, opcode: buffer[0] & 0x0f}
	reserved := buffer[0]&0x70 != 0
	masked := buffer[1]&0x80 != 0
	rest := buffer[2:]
	switch extended {
	case 2:
		length = int64(binary.BigEndian.Uint16(rest))
		rest = rest[2:]
	case 8:
		length = int64(binary.BigEndian.Uint64(rest))
		rest = rest[8:]
	}
	header.remaining = length
	copy(header.mask[:], rest[:4])
	switch {
	case reserved, length < 0, !masked:
		return frameHeader{}, ErrProtocol
	}
	switch header.opcode {
	case opContinuation:
		if c.last.fin {
			return frameHeader{}, ErrProtocol
		}
	case opText, opBinary:
		if !c.last.fin {
			return frameHeader{}, ErrProtocol
		}
	case opClose, opPing, opPong:
		if length > 125 || !header.fin {
			return frameHeader{}, ErrProtocol
		}
	default:
		return frameHeader{}, ErrProtocol
	}
	header.processed = length == 0
	return header, nil
}

func (h *frameHeader) unmask(b []byte) {
	for i := range b {
		b[i] ^= h.mask[(h.maskPos+i)&3]
	}
	h.maskPos = (h.maskPos + len(b)) & 3
}

// Receive is ReceiveAsync: at most len(buf) bytes of the current data frame,
// never across a frame. It blocks until it has min(len(buf), bytes left in
// the frame); an empty frame is one receive of 0. Pings, pongs and the
// peer's close are handled inside.
func (c *Conn) Receive(buf []byte) (n int, messageType MessageType, endOfMessage bool, err error) {
	for {
		header := c.last
		if header.processed {
			if header, err = c.readHeader(); err != nil {
				if errors.Is(err, ErrProtocol) {
					return 0, 0, false, c.failReceive(StatusProtocolError, err)
				}
				return 0, 0, false, c.gone(err)
			}
			switch header.opcode {
			case opPing, opPong:
				if err := c.handlePingPong(header); err != nil {
					return 0, 0, false, c.gone(err)
				}
				continue
			case opClose:
				if err := c.handleClose(header); err != nil {
					return 0, 0, false, err
				}
				return 0, MessageClose, true, nil
			case opContinuation:
				header.opcode = c.last.opcode
			}
		}
		messageType = MessageBinary
		if header.opcode == opText {
			messageType = MessageText
		}
		if !header.processed && len(buf) > 0 {
			want := int(min(int64(len(buf)), header.remaining))
			if err := c.readFull(buf[:want]); err != nil {
				return 0, 0, false, c.gone(err)
			}
			header.unmask(buf[:want])
			header.remaining -= int64(want)
			header.processed = header.remaining == 0
			n = want
		}
		endOfMessage = header.fin && header.processed
		c.last = header
		if messageType == MessageText && !c.utf8State.valid(buf[:n], endOfMessage) {
			return 0, 0, false, c.failReceive(StatusInvalidPayload, ErrProtocol)
		}
		return n, messageType, endOfMessage, nil
	}
}

// gone turns a read error after an abort or keep-alive fault into the
// error that names it.
func (c *Conn) gone(err error) error {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.keepAlive != nil && c.keepAlive.fault != nil {
		return c.keepAlive.fault
	}
	return err
}

func (c *Conn) handlePingPong(header frameHeader) error {
	payload := make([]byte, header.remaining)
	if err := c.readFull(payload); err != nil {
		return err
	}
	header.unmask(payload)
	if header.opcode == opPing {
		c.sendMu.Lock()
		defer c.sendMu.Unlock()
		return c.writeFrame(opPong, payload)
	}
	if len(payload) == 8 {
		c.onPong(int64(binary.BigEndian.Uint64(payload)))
	}
	return nil
}

// validCloseStatus is IsValidCloseStatus: 1000-1003, 1007-1014, 3000-4999.
func validCloseStatus(status uint16) bool {
	switch {
	case status < 1000 || status >= 5000:
		return false
	case status >= 3000:
		return true
	}
	return status <= 1003 || status >= 1007 && status <= 1014
}

func (c *Conn) handleClose(header frameHeader) error {
	c.stateMu.Lock()
	c.receivedClose = true
	c.stateMu.Unlock()
	c.CloseStatus, c.CloseDescription = StatusNormal, ""
	switch {
	case header.remaining == 1:
		return c.failReceive(StatusProtocolError, ErrProtocol)
	case header.remaining >= 2:
		payload := make([]byte, header.remaining)
		if err := c.readFull(payload); err != nil {
			return c.gone(err)
		}
		header.unmask(payload)
		status := binary.BigEndian.Uint16(payload)
		if !validCloseStatus(status) {
			return c.failReceive(StatusProtocolError, ErrProtocol)
		}
		if !utf8.Valid(payload[2:]) {
			return c.failReceive(StatusProtocolError, ErrProtocol)
		}
		c.CloseStatus, c.CloseDescription = status, string(payload[2:])
	}
	return nil
}

// utf8State is Utf8MessageState: text is checked across receives.
type utf8State struct {
	inProgress bool
	expected   int
	bits       int
	minimum    int
}

// valid is TryValidateUtf8, ported as is.
func (s *utf8State) valid(span []byte, endOfMessage bool) bool {
	if endOfMessage && !s.inProgress {
		return utf8.Valid(span)
	}
	i := 0
	for i < len(span) {
		if !s.inProgress {
			for i < len(span) && span[i] < 0x80 {
				i++
			}
			if i == len(span) {
				break
			}
			s.inProgress = true
			b := span[i]
			i++
			switch {
			case b&0xc0 == 0x80:
				return false
			case b&0xe0 == 0xc0:
				s.expected, s.bits, s.minimum = 1, int(b&0x1f), 0x80
			case b&0xf0 == 0xe0:
				s.expected, s.bits, s.minimum = 2, int(b&0x0f), 0x800
			case b&0xf8 == 0xf0:
				s.expected, s.bits, s.minimum = 3, int(b&0x07), 0x10000
			default:
				return false
			}
		}
		for s.expected > 0 && i < len(span) {
			b := span[i]
			if b&0xc0 != 0x80 {
				return false
			}
			i++
			s.expected--
			s.bits = s.bits<<6 | int(b&0x3f)
			if s.expected == 1 && s.bits >= 864 && s.bits <= 895 {
				return false
			}
			if s.expected == 2 && s.bits >= 272 {
				return false
			}
		}
		if s.expected == 0 {
			s.inProgress = false
			if s.bits < s.minimum {
				return false
			}
		}
	}
	if endOfMessage {
		return !s.inProgress
	}
	return true
}
