package ws

import (
	"bufio"
	"net"
	"sync"
)

// Kestrel's SocketTransportOptions.MaxReadBufferSize default: the most
// unconsumed bytes its transport buffers, upgraded or not (measured).
const readAheadLimit = 1 << 20

// readAhead reads the socket in the background, as Kestrel's transport
// does, so the peer's end is seen while nothing is being received.
type readAhead struct {
	mu  sync.Mutex
	buf []byte
	err error
	// ready and space are wake-ups with room for one.
	ready chan struct{}
	space chan struct{}
	gone  chan struct{}
	done  <-chan struct{}
}

func newReadAhead(src *bufio.Reader, done <-chan struct{}) *readAhead {
	r := &readAhead{
		ready: make(chan struct{}, 1),
		space: make(chan struct{}, 1),
		gone:  make(chan struct{}),
		done:  done,
	}
	go r.run(src, done)
	return r
}

func wake(c chan struct{}) {
	select {
	case c <- struct{}{}:
	default:
	}
}

// run waits in src's own buffer (Peek), so an idle socket holds no read
// buffer here; it copies only the bytes that came.
func (r *readAhead) run(src *bufio.Reader, done <-chan struct{}) {
	for {
		r.mu.Lock()
		full := len(r.buf) >= readAheadLimit
		r.mu.Unlock()
		if full {
			select {
			case <-r.space:
				continue
			case <-done:
				r.fail(net.ErrClosed)
				return
			}
		}
		r.mu.Lock()
		room := readAheadLimit - len(r.buf)
		r.mu.Unlock()
		_, err := src.Peek(1)
		if err == nil {
			b, _ := src.Peek(min(src.Buffered(), room))
			r.mu.Lock()
			r.push(b)
			r.mu.Unlock()
			_, _ = src.Discard(len(b))
		}
		if err != nil {
			select {
			case <-done:
			default:
				close(r.gone)
			}
			r.fail(err)
			return
		}
		wake(r.ready)
	}
}

// push keeps the buffer's capacity within the limit too.
func (r *readAhead) push(b []byte) {
	if len(r.buf)+len(b) > cap(r.buf) {
		grown := make([]byte, len(r.buf), max(len(r.buf)+len(b), min(readAheadLimit, 2*cap(r.buf))))
		copy(grown, r.buf)
		r.buf = grown
	}
	r.buf = append(r.buf, b...)
}

func (r *readAhead) fail(err error) {
	r.mu.Lock()
	r.err = err
	r.mu.Unlock()
	wake(r.ready)
}

// Read serves buffered bytes first, then the error that ended the socket.
// Once the socket is disposed it serves nothing, as Kestrel's aborted
// WebSocket does.
func (r *readAhead) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		select {
		case <-r.done:
			return 0, net.ErrClosed
		default:
		}
		r.mu.Lock()
		if len(r.buf) > 0 {
			n := copy(p, r.buf)
			r.buf = r.buf[n:]
			if len(r.buf) == 0 {
				r.buf = nil
			}
			r.mu.Unlock()
			wake(r.space)
			return n, nil
		}
		if err := r.err; err != nil {
			r.mu.Unlock()
			wake(r.ready)
			return 0, err
		}
		r.mu.Unlock()
		select {
		case <-r.ready:
		case <-r.done:
		}
	}
}
