package ws

import (
	"io"
	"net"
	"sync"
)

// Kestrel's SocketTransportOptions.MaxReadBufferSize default: the most
// unconsumed bytes its transport buffers, upgraded or not (measured).
const (
	readAheadLimit = 1 << 20
	readAheadChunk = 16 * 1024
)

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
}

func newReadAhead(src io.Reader, done <-chan struct{}) *readAhead {
	r := &readAhead{
		ready: make(chan struct{}, 1),
		space: make(chan struct{}, 1),
		gone:  make(chan struct{}),
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

func (r *readAhead) run(src io.Reader, done <-chan struct{}) {
	chunk := make([]byte, readAheadChunk)
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
		n, err := src.Read(chunk[:min(len(chunk), room)])
		r.mu.Lock()
		r.push(chunk[:n])
		r.mu.Unlock()
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
func (r *readAhead) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
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
		<-r.ready
	}
}
