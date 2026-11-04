package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// limitRequestHeaders is Kestrel's RequestHeadersTimeout: from the first
// byte of a request until its handler runs. On a miss Kestrel writes a bare
// 408 and closes; net/http's ReadHeaderTimeout would close without a word,
// and its StateActive fires only after the headers are read, so the clock
// lives on the connection. Before a connection's first byte Kestrel waits
// KeepAliveTimeout (Http1Connection.BeginRequestProcessing) and closes with
// no answer; net/http sets no deadline there, so idle covers that wait.
// It returns the listener wrapper to serve on. Earlier hooks still run.
func limitRequestHeaders(server *http.Server, timeout, idle time.Duration) func(net.Listener) net.Listener {
	next := server.Handler
	earlierContext, earlierState := server.ConnContext, server.ConnState
	server.ConnContext = func(ctx context.Context, c net.Conn) context.Context {
		if earlierContext != nil {
			ctx = earlierContext(ctx, c)
		}
		if conn, ok := c.(*headerConn); ok {
			return context.WithValue(ctx, headerConnKey{}, conn)
		}
		return ctx
	}
	server.ConnState = func(c net.Conn, state http.ConnState) {
		if earlierState != nil {
			earlierState(c, state)
		}
		conn, ok := c.(*headerConn)
		if !ok {
			return
		}
		switch state {
		case http.StateIdle:
			if conn.targets != nil {
				conn.targets.resume()
			}
			conn.arm()
		case http.StateHijacked, http.StateClosed:
			if conn.targets != nil && state == http.StateHijacked {
				conn.targets.pass()
			}
			if state == http.StateHijacked {
				conn.hijacked.Store(true)
			}
			conn.stop()
			// A hijacker writes its own bytes.
			conn.setAnswer(noAnswer)
		}
	}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if conn, ok := r.Context().Value(headerConnKey{}).(*headerConn); ok {
			conn.stop()
			conn.setAnswer(answerFor(r))
		}
		next.ServeHTTP(w, r)
	})
	return func(l net.Listener) net.Listener { return headerListener{l, timeout, idle} }
}

type headerConnKey struct{}

type headerListener struct {
	net.Listener
	timeout, idle time.Duration
}

func (l headerListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	conn := &headerConn{Conn: c, timeout: l.timeout, armed: true}
	conn.targets = &targetStream{src: rawConn{conn}}
	conn.timer = time.AfterFunc(l.idle, func() { _ = c.Close() })
	return conn, nil
}

type headerConn struct {
	net.Conn
	timeout time.Duration
	mu      sync.Mutex
	armed   bool
	// idle is set at StateIdle; idleDeadlines counts SetReadDeadline calls since.
	idle          bool
	idleDeadlines int
	timer         *time.Timer
	targets       *targetStream
	// answer is how the next status line net/http writes is rewritten.
	answer answerKind
	// ended: the client ended its side. Kestrel then writes nothing more.
	ended atomic.Bool
	// hijacked: a hijacker owns the socket and writes as it likes.
	hijacked atomic.Bool
}

func (c *headerConn) Read(p []byte) (int, error) {
	if c.targets != nil {
		return c.targets.Read(p)
	}
	return c.readRaw(p)
}

// rawConn is the socket under targetStream. The header clock arms on its
// bytes, so a request line held back for its end still times out.
type rawConn struct{ c *headerConn }

func (r rawConn) Read(p []byte) (int, error) { return r.c.readRaw(p) }

func (c *headerConn) readRaw(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n == 0 && err == io.EOF {
		c.ended.Store(true)
	}
	if n > 0 {
		c.mu.Lock()
		c.startLocked()
		c.mu.Unlock()
	}
	return n, err
}

func (c *headerConn) startLocked() {
	if c.armed {
		c.armed = false
		if c.timer != nil {
			c.timer.Stop()
		}
		c.timer = time.AfterFunc(c.timeout, c.expire)
	}
}

// SetReadDeadline starts the clock on net/http's second call after
// StateIdle, the one after its Peek(4), if no socket byte started it: the
// next head was then read before idle and sits in a buffer (the stream's,
// or net/http's own), so no socket read will come for it. This relies on
// net/http's serve loop setting a deadline just before and just after
// that Peek; TestAHeadReadBeforeIdleStillGets408 fails if that changes.
func (c *headerConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	if c.idle && c.armed {
		if c.idleDeadlines++; c.idleDeadlines == 2 {
			c.idle = false
			c.startLocked()
		}
	}
	c.mu.Unlock()
	return c.Conn.SetReadDeadline(t)
}

// CloseWrite and ReadFrom keep what net/http asserts on the raw conn: the
// half close before closing on an unread body, and sendfile.
func (c *headerConn) CloseWrite() error {
	if w, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return w.CloseWrite()
	}
	return nil
}

// dropped is Kestrel aborting its output once the client ended its side.
// A hijacked socket is its owner's.
func (c *headerConn) dropped() bool {
	if c.ended.Load() && !c.hijacked.Load() {
		_ = c.Conn.Close()
		return true
	}
	return false
}

func (c *headerConn) ReadFrom(r io.Reader) (int64, error) {
	if c.dropped() {
		return 0, net.ErrClosed
	}
	if w, ok := c.Conn.(io.ReaderFrom); ok {
		return w.ReadFrom(r)
	}
	return io.Copy(struct{ io.Writer }{c.Conn}, r)
}

func (c *headerConn) expire() {
	_, _ = io.WriteString(c.Conn, kestrelAnswer(http.StatusRequestTimeout))
	_ = c.Conn.Close()
}

// arm runs at StateIdle. Bytes the stream holds came in while the clock was
// off, and the stream may block on the socket for the rest of their line.
func (c *headerConn) arm() {
	c.mu.Lock()
	c.armed = true
	c.idle, c.idleDeadlines = true, 0
	if c.targets != nil && c.targets.held.Load() {
		c.startLocked()
	}
	c.mu.Unlock()
}

func (c *headerConn) stop() {
	c.mu.Lock()
	c.armed = false
	c.idle = false
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.mu.Unlock()
}
