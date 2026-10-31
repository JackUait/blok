package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"sync"
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
			conn.arm()
		case http.StateHijacked, http.StateClosed:
			conn.stop()
		}
	}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if conn, ok := r.Context().Value(headerConnKey{}).(*headerConn); ok {
			conn.stop()
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
	conn.timer = time.AfterFunc(l.idle, func() { _ = c.Close() })
	return conn, nil
}

type headerConn struct {
	net.Conn
	timeout time.Duration
	mu      sync.Mutex
	armed   bool
	timer   *time.Timer
}

func (c *headerConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.mu.Lock()
		if c.armed {
			c.armed = false
			if c.timer != nil {
				c.timer.Stop()
			}
			c.timer = time.AfterFunc(c.timeout, c.expire)
		}
		c.mu.Unlock()
	}
	return n, err
}

// CloseWrite and ReadFrom keep what net/http asserts on the raw conn: the
// half close before closing on an unread body, and sendfile.
func (c *headerConn) CloseWrite() error {
	if w, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return w.CloseWrite()
	}
	return nil
}

func (c *headerConn) ReadFrom(r io.Reader) (int64, error) {
	if w, ok := c.Conn.(io.ReaderFrom); ok {
		return w.ReadFrom(r)
	}
	return io.Copy(struct{ io.Writer }{c.Conn}, r)
}

func (c *headerConn) expire() {
	_, _ = io.WriteString(c.Conn, "HTTP/1.1 408 Request Timeout\r\nContent-Length: 0\r\nConnection: close\r\nDate: "+
		time.Now().UTC().Format(http.TimeFormat)+"\r\n\r\n")
	_ = c.Conn.Close()
}

func (c *headerConn) arm() {
	c.mu.Lock()
	c.armed = true
	c.mu.Unlock()
}

func (c *headerConn) stop() {
	c.mu.Lock()
	c.armed = false
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.mu.Unlock()
}
