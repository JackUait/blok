package synchttp

import (
	"bytes"
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/ws"
)

const (
	receiveBufferSize = 16 * 1024
	// receiveSlack plus one receive per minBytesPerReceive bytes is what one
	// message may take; an empty-fragment flood closes at the 17th receive.
	receiveSlack       = 16
	minBytesPerReceive = 64
	defaultCloseGrace  = 5 * time.Second
)

// Socket is the part of ws.Conn the member drives.
type Socket interface {
	Receive(buf []byte) (int, ws.MessageType, bool, error)
	SendBinary(payload []byte) error
	CloseOutput(status uint16, reason string) error
	Abort()
}

// peerWatcher is a socket that sees the peer's FIN or RST while nobody
// receives (ws.Conn).
type peerWatcher interface {
	PeerGone() <-chan struct{}
}

// MemberOptions are SyncSocketMember's constructor arguments.
type MemberOptions struct {
	CanWrite             bool
	AcceptsControlFrames bool
	MaxQueuedBytes       int64
	// Inbound nil means no budget (a rejected handshake).
	Inbound *InboundBudget
	// CloseGrace 0 means 5 s.
	CloseGrace     time.Duration
	ActorID        string
	ProtocolSource collab.OperationSource
	// Recheck nil always allows.
	Recheck func(ctx context.Context) (bool, error)
}

// SocketMember is one WebSocket as the room sees it: SyncSocketMember. Send
// and Close only enqueue; one pump goroutine owns every write, and the
// receive loop never sends.
type SocketMember struct {
	options MemberOptions

	queuedBytes    atomic.Int64
	requestedClose atomic.Pointer[CloseFrame]

	mu        sync.Mutex
	queue     []outbound
	completed bool
	signal    chan struct{}
}

type outbound struct {
	frame []byte
	close *CloseFrame
}

// NewSocketMember builds a member; ProtocolSource defaults to ClientV2's 0,
// so callers set it.
func NewSocketMember(o MemberOptions) *SocketMember {
	if o.CloseGrace == 0 {
		o.CloseGrace = defaultCloseGrace
	}
	return &SocketMember{options: o, signal: make(chan struct{}, 1)}
}

func (m *SocketMember) CanWrite() bool                         { return m.options.CanWrite }
func (m *SocketMember) AcceptsControlFrames() bool             { return m.options.AcceptsControlFrames }
func (m *SocketMember) ActorID() string                        { return m.options.ActorID }
func (m *SocketMember) ProtocolSource() collab.OperationSource { return m.options.ProtocolSource }

func (m *SocketMember) RecheckAccess(ctx context.Context) (bool, error) {
	if m.options.Recheck == nil {
		return true, nil
	}
	return m.options.Recheck(ctx)
}

// RequestedClose is the close that won, nil before one was requested.
func (m *SocketMember) RequestedClose() *CloseFrame { return m.requestedClose.Load() }

// enqueue is false once the writer completed.
func (m *SocketMember) enqueue(item outbound, complete bool) bool {
	m.mu.Lock()
	if m.completed {
		m.mu.Unlock()
		return false
	}
	m.queue = append(m.queue, item)
	m.completed = complete
	m.mu.Unlock()
	select {
	case m.signal <- struct{}{}:
	default:
	}
	return true
}

// Send admits a frame while the backlog queued BEFORE it is within budget,
// so one large frame always fits.
func (m *SocketMember) Send(frame []byte) {
	if m.RequestedClose() != nil {
		return
	}
	backlog := m.queuedBytes.Add(int64(len(frame))) - int64(len(frame))
	if backlog > m.options.MaxQueuedBytes {
		m.RequestClose(CloseSlowConsumer)
		return
	}
	m.enqueue(outbound{frame: frame}, false)
}

func (m *SocketMember) Close(reason collab.CloseReason) { m.RequestClose(closeFor(reason)) }

// RequestClose queues a close. Forbidden overtakes an earlier close, so a
// revoked member cannot drain its queued frames.
func (m *SocketMember) RequestClose(close CloseFrame) {
	box := &close
	var previous *CloseFrame
	if close == CloseForbidden {
		previous = m.requestedClose.Swap(box)
	} else if !m.requestedClose.CompareAndSwap(nil, box) {
		previous = m.requestedClose.Load()
	}
	if previous != nil {
		return
	}
	m.enqueue(outbound{close: box}, true)
}

// next blocks until an item is queued, or returns ok false once the writer
// completed and drained, or the socket ended.
func (m *SocketMember) next(gone <-chan struct{}) (outbound, bool) {
	for {
		m.mu.Lock()
		if len(m.queue) > 0 {
			item := m.queue[0]
			m.queue[0] = outbound{}
			m.queue = m.queue[1:]
			m.mu.Unlock()
			return item, true
		}
		completed := m.completed
		m.mu.Unlock()
		if completed {
			return outbound{}, false
		}
		select {
		case <-m.signal:
		case <-gone:
			return outbound{}, false
		}
	}
}

// Run pumps outbound frames and reads inbound ones until the peer closes,
// the socket ends, or a requested close goes unanswered for the grace. It
// leaves the room and frees the lease BEFORE answering the peer's close, so
// a reconnecting client never races its own slot.
func (m *SocketMember) Run(ctx context.Context, socket Socket, membership collab.Membership, maxMessageBytes int, lease *Lease) {
	// C#'s receive token: cancelling it also drops a frame still waiting
	// for the room lane.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	receiving := newCanceller(socket, cancel)
	// C# links the receive token to RequestAborted for the whole run.
	if watched, ok := socket.(peerWatcher); ok {
		runDone := make(chan struct{})
		defer close(runDone)
		go func() {
			select {
			case <-watched.PeerGone():
				receiving.after(0)
			case <-runDone:
			}
		}()
	}
	pumpDone := make(chan struct{})
	go func() {
		defer close(pumpDone)
		m.pump(socket, receiving)
	}()

	m.receiveLoop(ctx, socket, membership, maxMessageBytes)

	if membership != nil {
		membership.Leave()
	}
	lease.Release()
	m.RequestClose(CloseNormal)

	timer := time.NewTimer(m.options.CloseGrace)
	defer timer.Stop()
	select {
	case <-pumpDone:
	case <-timer.C:
		socket.Abort()
		<-pumpDone
	}
	receiving.stop()
}

// canceller aborts the socket and cancels the receive's context, which is
// what cancelling a .NET receive token does.
type canceller struct {
	socket Socket
	cancel context.CancelFunc
	mu     sync.Mutex
	timer  *time.Timer
	done   chan struct{}
}

func newCanceller(socket Socket, cancel context.CancelFunc) *canceller {
	return &canceller{socket: socket, cancel: cancel, done: make(chan struct{})}
}

// after is CancelAfter: the latest call sets the time.
func (c *canceller) after(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timer != nil {
		c.timer.Stop()
	}
	c.timer = time.AfterFunc(d, func() {
		c.cancel()
		c.socket.Abort()
		c.mu.Lock()
		defer c.mu.Unlock()
		select {
		case <-c.done:
		default:
			close(c.done)
		}
	})
}

func (c *canceller) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timer != nil {
		c.timer.Stop()
	}
}

func (m *SocketMember) pump(socket Socket, receiving *canceller) {
	for {
		item, ok := m.next(receiving.done)
		if !ok {
			return
		}
		if item.frame != nil {
			if m.RequestedClose() == nil || *m.RequestedClose() != CloseForbidden {
				if err := socket.SendBinary(item.frame); err != nil {
					receiving.after(0)
					return
				}
			}
			m.queuedBytes.Add(-int64(len(item.frame)))
			continue
		}
		close := *item.close
		if requested := m.RequestedClose(); requested != nil {
			close = *requested
		}
		if err := socket.CloseOutput(close.Status, close.Reason); err != nil {
			receiving.after(0)
			return
		}
		// The peer now owes us its close; do not wait for it forever.
		receiving.after(m.options.CloseGrace)
		return
	}
}

func (m *SocketMember) receiveLoop(ctx context.Context, socket Socket, membership collab.Membership, maxMessageBytes int) {
	buffer := make([]byte, receiveBufferSize)
	var message bytes.Buffer
	// With no membership, or once a close was requested, frames are read
	// only to reach the peer's close.
	discarding := false
	receives := 0
	for {
		n, kind, endOfMessage, err := socket.Receive(buffer)
		if err != nil || kind == ws.MessageClose {
			return
		}
		if membership == nil || discarding || m.RequestedClose() != nil {
			discarding = true
			continue
		}
		if kind == ws.MessageText {
			m.RequestClose(CloseTextFrame)
			discarding = true
			continue
		}
		received := message.Len() + n
		receives++
		if receives > receiveSlack+received/minBytesPerReceive {
			m.RequestClose(CloseInboundRateExceeded)
			discarding = true
			continue
		}
		if received > maxMessageBytes {
			m.RequestClose(CloseTooBig)
			discarding = true
			continue
		}
		message.Write(buffer[:n])
		if !endOfMessage {
			continue
		}
		frame := bytes.Clone(message.Bytes())
		message.Reset()
		receives = 0
		if m.options.Inbound != nil && !m.options.Inbound.Allows(frame) {
			m.RequestClose(CloseInboundRateExceeded)
			discarding = true
			continue
		}
		if err := membership.Receive(ctx, frame); err != nil {
			return
		}
	}
}
