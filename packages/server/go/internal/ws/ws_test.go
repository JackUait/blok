package ws

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"runtime"
	"testing"
	"time"
)

// pair returns a server Conn and the raw client end over loopback TCP.
func pair(t *testing.T, options Options) (*Conn, net.Conn) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, _ := listener.Accept()
		accepted <- conn
	}()
	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerConn(<-accepted, nil, options)
	// A test that waits on a frame that never comes fails instead of hanging.
	stop := time.AfterFunc(10*time.Second, server.Abort)
	t.Cleanup(func() { stop.Stop(); server.Abort(); client.Close() })
	return server, client
}

var testMask = [4]byte{0x11, 0x22, 0x33, 0x44}

// frame is a masked client frame; first is the byte with FIN, RSV and opcode.
func frame(first byte, payload []byte) []byte {
	b := []byte{first}
	switch n := len(payload); {
	case n <= 125:
		b = append(b, 0x80|byte(n))
	case n <= 0xffff:
		b = append(b, 0x80|126, byte(n>>8), byte(n))
	default:
		b = append(b, 0x80|127)
		b = binary.BigEndian.AppendUint64(b, uint64(n))
	}
	b = append(b, testMask[:]...)
	for i, c := range payload {
		b = append(b, c^testMask[i&3])
	}
	return b
}

func send(t *testing.T, client net.Conn, frames ...[]byte) {
	t.Helper()
	for _, f := range frames {
		if _, err := client.Write(f); err != nil {
			t.Fatal(err)
		}
	}
}

// serverFrame reads one unmasked server frame.
func serverFrame(t *testing.T, client net.Conn) (byte, []byte) {
	t.Helper()
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	head := make([]byte, 2)
	if _, err := io.ReadFull(client, head); err != nil {
		t.Fatalf("no server frame: %v", err)
	}
	length := int(head[1] & 0x7f)
	if length == 126 {
		ext := make([]byte, 2)
		io.ReadFull(client, ext)
		length = int(binary.BigEndian.Uint16(ext))
	}
	payload := make([]byte, length)
	io.ReadFull(client, payload)
	return head[0], payload
}

func closeFrame(status uint16, reason string) []byte {
	return append(binary.BigEndian.AppendUint16(nil, status), reason...)
}

type receipt struct {
	n   int
	typ MessageType
	eom bool
}

func receiveAll(t *testing.T, server *Conn, count int) []receipt {
	t.Helper()
	buf := make([]byte, 16*1024)
	var got []receipt
	for i := 0; i < count; i++ {
		n, typ, eom, err := server.Receive(buf)
		if err != nil {
			t.Fatalf("receive %d: %v", i, err)
		}
		got = append(got, receipt{n, typ, eom})
	}
	return got
}

func TestAFrameArrivesInReceivesOfTheBufferSize(t *testing.T) {
	server, client := pair(t, Options{})
	send(t, client, frame(0x82, bytes.Repeat([]byte{7}, 40000)))
	got := receiveAll(t, server, 3)
	want := []receipt{{16384, MessageBinary, false}, {16384, MessageBinary, false}, {7232, MessageBinary, true}}
	if !equalReceipts(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func equalReceipts(a, b []receipt) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestEveryEmptyFragmentIsOneReceive(t *testing.T) {
	server, client := pair(t, Options{})
	send(t, client, frame(0x02, nil), frame(0x00, nil), frame(0x00, []byte{1}), frame(0x80, nil))
	got := receiveAll(t, server, 4)
	want := []receipt{{0, MessageBinary, false}, {0, MessageBinary, false}, {1, MessageBinary, false}, {0, MessageBinary, true}}
	if !equalReceipts(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestAPingInsideAFragmentedMessageIsAnsweredAndSkipped(t *testing.T) {
	server, client := pair(t, Options{})
	send(t, client, frame(0x02, []byte{1}), frame(0x89, []byte("hi")), frame(0x80, []byte{2}))
	got := receiveAll(t, server, 2)
	if !equalReceipts(got, []receipt{{1, MessageBinary, false}, {1, MessageBinary, true}}) {
		t.Fatalf("got %v", got)
	}
	if op, payload := serverFrame(t, client); op != 0x8a || string(payload) != "hi" {
		t.Fatalf("pong %x %q", op, payload)
	}
}

func TestProtocolErrorsCloseWith1002AndNoReason(t *testing.T) {
	unmasked := []byte{0x82, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05}
	cases := map[string][][]byte{
		"unmasked":                 {unmasked},
		"rsv1":                     {frame(0xc2, []byte{1})},
		"rsv3":                     {frame(0x92, []byte{1})},
		"unknown opcode":           {frame(0x83, nil)},
		"continuation first":       {frame(0x80, []byte{1})},
		"binary inside a fragment": {frame(0x02, []byte{1}), frame(0x82, []byte{1})},
		"long ping":                {frame(0x89, bytes.Repeat([]byte{1}, 126))},
		"fragmented ping":          {frame(0x09, nil)},
		"one-byte close":           {frame(0x88, []byte{3})},
		"close 1005":               {frame(0x88, closeFrame(1005, ""))},
		"close 1004":               {frame(0x88, closeFrame(1004, ""))},
		"close 999":                {frame(0x88, closeFrame(999, ""))},
		"close 5000":               {frame(0x88, closeFrame(5000, ""))},
		"close bad reason":         {frame(0x88, append(closeFrame(1000, ""), 0xff))},
		"negative length":          {append([]byte{0x82, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0}, testMask[:]...)},
	}
	for name, frames := range cases {
		t.Run(name, func(t *testing.T) {
			server, client := pair(t, Options{})
			send(t, client, frames...)
			buf := make([]byte, 16*1024)
			var err error
			for err == nil {
				_, _, _, err = server.Receive(buf)
			}
			if !errors.Is(err, ErrProtocol) {
				t.Fatalf("got %v, want a protocol error", err)
			}
			if op, payload := serverFrame(t, client); op != 0x88 || !bytes.Equal(payload, closeFrame(1002, "")) {
				t.Fatalf("close %x %x", op, payload)
			}
		})
	}
}

func TestValidCloseStatusesAreAccepted(t *testing.T) {
	for _, status := range []uint16{1000, 1003, 1007, 1014, 3000, 4999} {
		server, client := pair(t, Options{})
		send(t, client, frame(0x88, closeFrame(status, "bye é")))
		got := receiveAll(t, server, 1)
		if got[0].typ != MessageClose || server.CloseStatus != status || server.CloseDescription != "bye é" {
			t.Fatalf("%d: got %v %d %q", status, got, server.CloseStatus, server.CloseDescription)
		}
	}
}

func TestInvalidTextClosesWith1007(t *testing.T) {
	cases := map[string][][]byte{
		"split overlong":      {frame(0x01, []byte{0xc0}), frame(0x80, []byte{0xaf})},
		"surrogate":           {frame(0x81, []byte{0xed, 0xa0, 0x80})},
		"cut at the end":      {frame(0x01, []byte{'a', 0xe2, 0x82}), frame(0x80, nil)},
		"past U+10FFFF split": {frame(0x01, []byte{0xf4}), frame(0x80, []byte{0x90, 0x80, 0x80})},
	}
	for name, frames := range cases {
		t.Run(name, func(t *testing.T) {
			server, client := pair(t, Options{})
			send(t, client, frames...)
			buf := make([]byte, 16*1024)
			var err error
			for err == nil {
				_, _, _, err = server.Receive(buf)
			}
			if op, payload := serverFrame(t, client); op != 0x88 || !bytes.Equal(payload, closeFrame(1007, "")) {
				t.Fatalf("close %x %x (%v)", op, payload, err)
			}
		})
	}
}

func TestTextSplitInsideACharacterIsValid(t *testing.T) {
	server, client := pair(t, Options{})
	euro := []byte("€")
	send(t, client, frame(0x01, euro[:1]), frame(0x80, euro[1:]))
	got := receiveAll(t, server, 2)
	if !equalReceipts(got, []receipt{{1, MessageText, false}, {2, MessageText, true}}) {
		t.Fatalf("got %v", got)
	}
}

func TestClosingAfterThePeersCloseEndsTheStream(t *testing.T) {
	server, client := pair(t, Options{})
	send(t, client, frame(0x88, closeFrame(1001, "")))
	receiveAll(t, server, 1)
	if err := server.CloseOutput(4401, "missing pass"); err != nil {
		t.Fatal(err)
	}
	if op, payload := serverFrame(t, client); op != 0x88 || !bytes.Equal(payload, closeFrame(4401, "missing pass")) {
		t.Fatalf("close %x %q", op, payload)
	}
	if _, err := client.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("want EOF after both closes, got %v", err)
	}
	if err := server.SendBinary([]byte{1}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("send after close: %v", err)
	}
}

func TestAnUnansweredPingAbortsWithNoCloseFrame(t *testing.T) {
	server, client := pair(t, Options{KeepAliveInterval: 40 * time.Millisecond, KeepAliveTimeout: 80 * time.Millisecond})
	started := time.Now()
	op, payload := serverFrame(t, client)
	if op != 0x89 || binary.BigEndian.Uint64(payload) != 1 {
		t.Fatalf("first ping %x %x", op, payload)
	}
	_, _, _, err := server.Receive(make([]byte, 16))
	if !errors.Is(err, ErrKeepAliveTimeout) {
		t.Fatalf("got %v", err)
	}
	if elapsed := time.Since(started); elapsed < 100*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("aborted after %v", elapsed)
	}
	if _, err := client.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("want a bare EOF, got %v", err)
	}
}

func TestAnsweredPingsKeepTheSocketAndCount(t *testing.T) {
	server, client := pair(t, Options{KeepAliveInterval: 30 * time.Millisecond, KeepAliveTimeout: 60 * time.Millisecond})
	go func() { _, _, _, _ = server.Receive(make([]byte, 16)) }()
	for want := uint64(1); want <= 4; want++ {
		op, payload := serverFrame(t, client)
		if op != 0x89 || binary.BigEndian.Uint64(payload) != want {
			t.Fatalf("ping %d: %x %x", want, op, payload)
		}
		send(t, client, frame(0x8a, payload))
	}
	select {
	case <-server.Done():
		t.Fatal("an answered socket was aborted")
	default:
	}
}

func TestAWrongPongDoesNotAnswerThePing(t *testing.T) {
	server, client := pair(t, Options{KeepAliveInterval: 30 * time.Millisecond, KeepAliveTimeout: 60 * time.Millisecond})
	errs := make(chan error, 1)
	go func() {
		_, _, _, err := server.Receive(make([]byte, 16))
		errs <- err
	}()
	_, payload := serverFrame(t, client)
	send(t, client, frame(0x8a, []byte{0, 0, 0, 0, 0, 0, 0, 9}), frame(0x8a, payload[:4]))
	if err := <-errs; !errors.Is(err, ErrKeepAliveTimeout) {
		t.Fatalf("got %v", err)
	}
}

func TestAcceptKeyMatchesRFC6455(t *testing.T) {
	if got, _ := acceptKey("dGhlIHNhbXBsZSBub25jZQ=="); got != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Fatal(got)
	}
}

func TestWebSocketRequestCheck(t *testing.T) {
	base := func() *http.Request {
		r, _ := http.NewRequest("GET", "http://x/sync/a", nil)
		r.Header.Set("Connection", "keep-alive, Upgrade")
		r.Header.Set("Upgrade", "WebSocket")
		r.Header.Set("Sec-WebSocket-Version", "8, 13")
		r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		return r
	}
	if !IsWebSocketRequest(base()) {
		t.Fatal("a valid request was refused")
	}
	edits := map[string]func(*http.Request){
		"post":          func(r *http.Request) { r.Method = "POST" },
		"no connection": func(r *http.Request) { r.Header.Del("Connection") },
		"version 12":    func(r *http.Request) { r.Header.Set("Sec-WebSocket-Version", "12") },
		"no upgrade":    func(r *http.Request) { r.Header.Set("Upgrade", "h2c") },
		"short key":     func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "AAAA") },
		"long key":      func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAA") },
		"blank key":     func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "  ") },
		"body":          func(r *http.Request) { r.ContentLength = 3 },
		"chunked":       func(r *http.Request) { r.TransferEncoding = []string{"chunked"} },
		"unpadded key":  func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ") },
	}
	for name, edit := range edits {
		r := base()
		edit(r)
		if IsWebSocketRequest(r) {
			t.Errorf("%s: accepted", name)
		}
	}
	spaced := base()
	spaced.Header.Set("Sec-WebSocket-Key", "dGhl IHNh bXBs ZSBu b25j ZQ==")
	if !IsWebSocketRequest(spaced) {
		t.Fatal("base64 with spaces is a valid .NET key")
	}
}

func TestSendersNeverInterleaveFrames(t *testing.T) {
	server, client := pair(t, Options{})
	big := bytes.Repeat([]byte{5}, 70000)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 20; i++ {
			_ = server.SendBinary(big)
		}
		close(done)
	}()
	reader := bufio.NewReader(client)
	for i := 0; i < 20; i++ {
		head := make([]byte, 10)
		io.ReadFull(reader, head)
		if head[0] != 0x82 || head[1] != 127 || binary.BigEndian.Uint64(head[2:]) != 70000 {
			t.Fatalf("frame %d header %x", i, head)
		}
		io.ReadFull(reader, make([]byte, 70000))
	}
	<-done
}

// OnDataReceived runs after every stream read, header reads included
// (EnsureBufferContainsAsync), so a peer sending only empty frames still
// pushes the next ping back.
func TestEmptyFramesPushTheNextPingBack(t *testing.T) {
	server, client := pair(t, Options{KeepAliveInterval: 150 * time.Millisecond, KeepAliveTimeout: time.Second})
	go func() {
		buf := make([]byte, 16)
		for {
			if _, _, _, err := server.Receive(buf); err != nil {
				return
			}
		}
	}()
	pings := make(chan struct{}, 1)
	go func() {
		head := make([]byte, 2)
		if _, err := io.ReadFull(client, head); err == nil && head[0] == 0x89 {
			pings <- struct{}{}
		}
	}()
	for range 12 {
		send(t, client, frame(0x82, nil))
		time.Sleep(50 * time.Millisecond)
	}
	select {
	case <-pings:
		t.Fatal("pinged a peer that kept sending")
	default:
	}
}

// A peer that stops reading but keeps the connection open must not pin the
// socket: the keep-alive still times out and aborts it, which also ends the
// stuck send (ManagedWebSocket fires the ping outside the send lock).
func TestAStuckSendStillTimesOutTheKeepAlive(t *testing.T) {
	raw, client := net.Pipe()
	defer client.Close()
	before := runtime.NumGoroutine()
	server := NewServerConn(raw, nil, Options{KeepAliveInterval: 20 * time.Millisecond, KeepAliveTimeout: 20 * time.Millisecond})
	stop := time.AfterFunc(10*time.Second, server.Abort)
	defer stop.Stop()
	sent := make(chan error, 1)
	go func() { sent <- server.SendBinary(make([]byte, 64*1024)) }()
	select {
	case <-server.Done():
	case <-time.After(time.Second):
		t.Fatal("socket still open 1s later")
	}
	select {
	case err := <-sent:
		if err == nil {
			t.Fatal("the stuck send reported success")
		}
	case <-time.After(time.Second):
		t.Fatal("the stuck send never returned")
	}
	settled := time.Now().Add(time.Second)
	for runtime.NumGoroutine() > before && time.Now().Before(settled) {
		time.Sleep(5 * time.Millisecond)
	}
	if n := runtime.NumGoroutine(); n > before {
		t.Fatalf("%d goroutines left, %d before", n, before)
	}
}

// With no timeout the heartbeat sends unsolicited pongs; a stuck send must
// not pile up one waiting pong per tick.
func TestAStuckSendDoesNotPileUpPongs(t *testing.T) {
	raw, client := net.Pipe()
	defer client.Close()
	server := NewServerConn(raw, nil, Options{KeepAliveInterval: time.Millisecond})
	defer server.Abort()
	go func() { _ = server.SendBinary(make([]byte, 64*1024)) }()
	time.Sleep(20 * time.Millisecond)
	before := runtime.NumGoroutine()
	time.Sleep(100 * time.Millisecond)
	if n := runtime.NumGoroutine(); n > before+1 {
		t.Fatalf("%d goroutines after 100 ticks, %d before", n, before)
	}
}

// A peer that stops reading and sends pongs for guessed counters must not
// answer a ping that was never written: the stuck socket still times out,
// and no ping goroutine piles up behind the stuck send.
func TestGuessedPongsDoNotAnswerAnUnwrittenPing(t *testing.T) {
	raw, client := net.Pipe()
	defer client.Close()
	server := NewServerConn(raw, nil, Options{KeepAliveInterval: 10 * time.Millisecond, KeepAliveTimeout: 400 * time.Millisecond})
	stop := time.AfterFunc(10*time.Second, server.Abort)
	defer stop.Stop()
	errs := make(chan error, 1)
	go func() {
		buf := make([]byte, 16)
		for {
			if _, _, _, err := server.Receive(buf); err != nil {
				errs <- err
				return
			}
		}
	}()
	go func() { _ = server.SendBinary(make([]byte, 64*1024)) }()
	// Any frame pushes the next ping back, so the peer goes quiet for more
	// than the interval, then answers the ping it guesses was sent.
	go func() {
		for v := uint64(1); ; v++ {
			time.Sleep(25 * time.Millisecond)
			if _, err := client.Write(frame(0x8a, binary.BigEndian.AppendUint64(nil, v))); err != nil {
				return
			}
		}
	}()
	started := time.Now()
	time.Sleep(50 * time.Millisecond)
	before := runtime.NumGoroutine()
	time.Sleep(250 * time.Millisecond)
	if n := runtime.NumGoroutine(); n > before+2 {
		t.Errorf("%d goroutines after 10 guessed pongs, %d before", n, before)
	}
	select {
	case err := <-errs:
		if !errors.Is(err, ErrKeepAliveTimeout) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("socket still open 2s later")
	}
	if elapsed := time.Since(started); elapsed < 350*time.Millisecond {
		t.Fatalf("aborted after %v, before the timeout", elapsed)
	}
}

// gatedPingConn holds each ping's Write open after the bytes went out until
// the gate opens, so the peer's pong lands before the write returns.
type gatedPingConn struct {
	net.Conn
	gate chan struct{}
}

func (c gatedPingConn) Write(b []byte) (int, error) {
	n, err := c.Conn.Write(b)
	if len(b) > 0 && b[0] == 0x89 {
		<-c.gate
	}
	return n, err
}

// An honest pong can beat the ping's write back: it still answers the ping.
func TestAPongThatBeatsThePingWriteStillAnswersIt(t *testing.T) {
	raw, client := net.Pipe()
	defer client.Close()
	gate := make(chan struct{})
	server := NewServerConn(gatedPingConn{raw, gate}, nil, Options{KeepAliveInterval: 20 * time.Millisecond, KeepAliveTimeout: 150 * time.Millisecond})
	defer server.Abort()
	go func() {
		buf := make([]byte, 16)
		for {
			if _, _, _, err := server.Receive(buf); err != nil {
				return
			}
		}
	}()
	_, payload := serverFrame(t, client)
	send(t, client, frame(0x8a, payload))
	// Let Receive handle the pong before the ping's write returns.
	time.Sleep(30 * time.Millisecond)
	close(gate)
	go func() {
		for {
			head := make([]byte, 2)
			if _, err := io.ReadFull(client, head); err != nil {
				return
			}
			body := make([]byte, head[1]&0x7f)
			if _, err := io.ReadFull(client, body); err != nil {
				return
			}
			if head[0] == 0x89 {
				if _, err := client.Write(frame(0x8a, body)); err != nil {
					return
				}
			}
		}
	}()
	select {
	case <-server.Done():
		t.Fatal("an answered ping timed out")
	case <-time.After(400 * time.Millisecond):
	}
}
