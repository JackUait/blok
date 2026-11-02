package synchttp

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/ws"
)

func newTestMember(maxQueuedBytes int64) *SocketMember {
	return NewSocketMember(MemberOptions{CanWrite: true, AcceptsControlFrames: true, MaxQueuedBytes: maxQueuedBytes})
}

func TestSendNeverBlocksAndAFrameFitsWhenTheBacklogIsWithinBudget(t *testing.T) {
	member := newTestMember(10)
	member.Send(make([]byte, 8))
	member.Send(make([]byte, 8))
	if close := member.RequestedClose(); close != nil {
		t.Fatalf("closed at %+v", *close)
	}
}

func TestABacklogOverBudgetClosesTheSlowConsumer(t *testing.T) {
	member := newTestMember(10)
	member.Send(make([]byte, 8))
	member.Send(make([]byte, 8))
	member.Send(make([]byte, 1))
	if close := member.RequestedClose(); close == nil || *close != CloseSlowConsumer {
		t.Fatalf("got %v, want the slow-consumer close", close)
	}
}

func TestTheFirstNonForbiddenCloseWins(t *testing.T) {
	reset := newTestMember(10)
	reset.Close(collab.CloseReset)
	reset.Close(collab.CloseDraining)
	if got := *reset.RequestedClose(); got != (CloseFrame{4409, "document reset"}) {
		t.Fatalf("got %+v", got)
	}
	forbidden := newTestMember(10)
	forbidden.Close(collab.CloseDraining)
	forbidden.Close(collab.CloseForbidden)
	forbidden.Close(collab.CloseReset)
	if got := *forbidden.RequestedClose(); got != CloseForbidden {
		t.Fatalf("got %+v, want forbidden to overtake", got)
	}
}

// fakeSocket records what the pump sends; Receive answers the peer's close.
type fakeSocket struct {
	mu     sync.Mutex
	sent   [][]byte
	closes []CloseFrame
}

func (s *fakeSocket) Receive([]byte) (int, ws.MessageType, bool, error) {
	return 0, ws.MessageClose, true, nil
}

func (s *fakeSocket) SendBinary(payload []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, append([]byte(nil), payload...))
	return nil
}

func (s *fakeSocket) CloseOutput(status uint16, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closes = append(s.closes, CloseFrame{status, reason})
	return nil
}

func (s *fakeSocket) Abort()                {}
func (s *fakeSocket) Done() <-chan struct{} { return nil }

// RevocationOverridesAQueuedSlowConsumerClose: queued frames are dropped,
// not sent, once the close is forbidden.
func TestRevocationOverridesAQueuedSlowConsumerClose(t *testing.T) {
	member := NewSocketMember(MemberOptions{AcceptsControlFrames: true, MaxQueuedBytes: 1})
	member.Send([]byte{1})
	member.Send([]byte{2})
	member.Send([]byte{3})
	queued := *member.RequestedClose()
	member.Close(collab.CloseForbidden)
	socket := &fakeSocket{}
	member.Run(context.Background(), socket, nil, 1024, nil)
	if len(socket.sent) != 0 {
		t.Fatalf("sent %d frames after a revocation", len(socket.sent))
	}
	if len(socket.closes) != 1 || socket.closes[0] != CloseForbidden {
		t.Fatalf("closes %+v", socket.closes)
	}
	if queued != CloseSlowConsumer {
		t.Fatalf("the queued close was %+v", queued)
	}
}

func TestQueuedFramesGoOutBeforeANonForbiddenClose(t *testing.T) {
	member := newTestMember(100)
	member.Send([]byte{1})
	member.Close(collab.CloseReset)
	member.Send([]byte{2})
	socket := &fakeSocket{}
	member.Run(context.Background(), socket, nil, 1024, nil)
	if len(socket.sent) != 1 || socket.sent[0][0] != 1 {
		t.Fatalf("sent %v", socket.sent)
	}
	if len(socket.closes) != 1 || socket.closes[0] != (CloseFrame{4409, "document reset"}) {
		t.Fatalf("closes %+v", socket.closes)
	}
}

// recordingMembership counts frames and records when Leave ran.
type recordingMembership struct {
	mu     sync.Mutex
	frames [][]byte
	left   chan struct{}
}

func newRecordingMembership() *recordingMembership {
	return &recordingMembership{left: make(chan struct{})}
}

func (m *recordingMembership) Receive(_ context.Context, frame []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.frames = append(m.frames, frame)
	return nil
}

func (m *recordingMembership) Leave() { close(m.left) }

func (m *recordingMembership) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.frames)
}

// wsPair is a served ws.Conn and the raw client end over loopback.
func wsPair(t *testing.T) (*ws.Conn, net.Conn) {
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
	server := ws.NewServerConn(<-accepted, nil, ws.Options{})
	t.Cleanup(func() { server.Abort(); client.Close() })
	return server, client
}

func clientFrame(first byte, payload []byte) []byte {
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
	b = append(b, 0, 0, 0, 0)
	return append(b, payload...)
}

type serverFrame struct {
	opcode  byte
	payload []byte
}

func readServerFrame(t *testing.T, r *bufio.Reader) serverFrame {
	t.Helper()
	var head [2]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		t.Fatalf("reading a frame: %v", err)
	}
	length := uint64(head[1] & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		_, _ = io.ReadFull(r, ext[:])
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		_, _ = io.ReadFull(r, ext[:])
		length = binary.BigEndian.Uint64(ext[:])
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		t.Fatal(err)
	}
	return serverFrame{head[0] & 0x0f, payload}
}

func readClose(t *testing.T, r *bufio.Reader) CloseFrame {
	t.Helper()
	for {
		frame := readServerFrame(t, r)
		if frame.opcode == 0x8 {
			return CloseFrame{binary.BigEndian.Uint16(frame.payload), string(frame.payload[2:])}
		}
	}
}

func runMember(t *testing.T, member *SocketMember, server *ws.Conn, membership collab.Membership, lease *Lease) chan struct{} {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		member.Run(context.Background(), server, membership, 1<<20, lease)
	}()
	return done
}

// Leave before answering: the lease is free and the room left before the
// peer sees our close.
func TestTheRoomIsLeftAndTheLeaseFreedBeforeThePeerCloseIsAnswered(t *testing.T) {
	server, client := wsPair(t)
	table := NewConnectionTable(0, 1)
	lease := table.TryReserve("doc", "user:a")
	membership := newRecordingMembership()
	member := newTestMember(1 << 20)
	done := runMember(t, member, server, membership, lease)

	if _, err := client.Write(clientFrame(0x88, []byte{3, 232})); err != nil {
		t.Fatal(err)
	}
	if got := readClose(t, bufio.NewReader(client)); got != CloseNormal {
		t.Fatalf("answered %+v", got)
	}
	select {
	case <-membership.left:
	default:
		t.Fatal("the close was answered before the room was left")
	}
	if table.TryReserve("doc", "user:a") == nil {
		t.Fatal("the close was answered before the lease was freed")
	}
	<-done
}

func TestAWholeBinaryMessageReachesTheRoomOnce(t *testing.T) {
	server, client := wsPair(t)
	membership := newRecordingMembership()
	done := runMember(t, newTestMember(1<<20), server, membership, nil)
	message := append(clientFrame(0x02, []byte{105}), clientFrame(0x00, nil)...)
	message = append(message, clientFrame(0x80, []byte{1, 2})...)
	message = append(message, clientFrame(0x88, []byte{3, 232})...)
	if _, err := client.Write(message); err != nil {
		t.Fatal(err)
	}
	readClose(t, bufio.NewReader(client))
	<-done
	if membership.count() != 1 || string(membership.frames[0]) != string([]byte{105, 1, 2}) {
		t.Fatalf("the room got %v", membership.frames)
	}
}

func TestAPeerThatNeverAnswersOurCloseIsAbortedAfterTheGrace(t *testing.T) {
	server, client := wsPair(t)
	member := NewSocketMember(MemberOptions{MaxQueuedBytes: 1, CloseGrace: 100 * time.Millisecond})
	member.RequestClose(CloseMissingPass)
	started := time.Now()
	done := runMember(t, member, server, nil, nil)
	reader := bufio.NewReader(client)
	if got := readClose(t, reader); got != CloseMissingPass {
		t.Fatalf("closed %+v", got)
	}
	if _, err := reader.ReadByte(); !errors.Is(err, io.EOF) {
		t.Fatalf("after the close: %v", err)
	}
	<-done
	if elapsed := time.Since(started); elapsed < 90*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("ended after %s", elapsed)
	}
}

// RecheckAccess answers true with no closure, like the C# default.
func TestRecheckWithNoHookAllows(t *testing.T) {
	ok, err := newTestMember(1).RecheckAccess(context.Background())
	if !ok || err != nil {
		t.Fatalf("got %v, %v", ok, err)
	}
}
