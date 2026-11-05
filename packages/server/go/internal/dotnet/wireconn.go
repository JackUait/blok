package dotnet

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
)

// maxResponseHeadersBytes is SocketsHttpHandler's default
// MaxResponseHeadersLength, 64 KiB.
const maxResponseHeadersBytes = 64 << 10

// wireConn sits under net/http on an operator client's connection. It
// reads each response as .NET does (ResponseReader) and hands net/http a
// head it accepts: the status line, the framing (re-chunked when chunked)
// and headKey, an id for the real headers. RoundTrip takes them by that id
// (takeHeader), so each response gets its own head's headers. The body
// framing and the pool stay net/http's. No server header reaches net/http,
// so a server cannot send headKey itself.
type wireConn struct {
	net.Conn
	in *bufio.Reader
	// out is what net/http reads next; body feeds it between heads.
	out     []byte
	body    io.Reader
	framing Framing
	err     error
	// started is set once the next head's first byte is handed out.
	started bool

	mu     sync.Mutex
	method string
	// pending are the ids of heads read and not yet taken.
	pending map[string]bool
}

// headKey names a head's id in what net/http parses.
const headKey = "X-Blok-Dotnet-Head"

type pendingHead struct {
	header http.Header
	conn   *wireConn
}

// heads maps an id to the headers of one head; headSeq makes the ids.
var (
	heads   sync.Map
	headSeq atomic.Uint64
)

// takeHeader is the headers of the head response came from, taken once.
// A response with no known id gets none.
func takeHeader(response *http.Response) http.Header {
	id := response.Header.Get(headKey)
	value, ok := heads.LoadAndDelete(id)
	if !ok {
		return http.Header{}
	}
	head := value.(pendingHead)
	head.conn.mu.Lock()
	delete(head.conn.pending, id)
	head.conn.mu.Unlock()
	return head.header
}

func (c *wireConn) pendingHeads() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.pending)
}

// Close drops the heads no response took.
func (c *wireConn) Close() error {
	c.mu.Lock()
	for id := range c.pending {
		heads.Delete(id)
	}
	c.pending = nil
	c.mu.Unlock()
	return c.Conn.Close()
}

func newWireConn(conn net.Conn) *wireConn {
	return &wireConn{Conn: conn, in: bufio.NewReader(conn)}
}

// NetConn lets the lifetime check find the dialed conn.
func (c *wireConn) NetConn() net.Conn { return c.Conn }

// expect names the method of the request about to go out: a response to
// HEAD has no body.
func (c *wireConn) expect(method string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.method = method
}

func (c *wireConn) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if len(c.out) > 0 {
			n := copy(p, c.out)
			c.out = c.out[n:]
			if len(c.out) == 0 && c.body == nil && c.endsConn() {
				return n, c.err
			}
			return n, nil
		}
		if c.err != nil {
			return 0, c.err
		}
		if c.body == nil && !c.started {
			// net/http retries a request whose first answer byte failed to
			// read (readLoop's Peek). .NET retries only when no byte came,
			// so the head is parsed after its first byte is handed out.
			if _, err := c.in.Peek(1); err != nil {
				c.err = err
				continue
			}
			c.started = true
			p[0] = 'H'
			return 1, nil
		}
		if c.body == nil {
			c.err = c.nextHead()
			// Every status line starts "HTTP/1.", whose H is out already.
			if c.err == nil {
				c.out = c.out[1:]
			}
			c.started = false
			continue
		}
		if c.framing == FramedChunked {
			c.err = c.nextChunk(len(p))
			continue
		}
		n, err := c.body.Read(p)
		if c.framing == FramedLength && (errors.Is(err, io.EOF) || err == nil && c.body.(*lengthReader).remaining == 0) {
			c.body, err = nil, nil
			if c.endsConn() {
				return n, c.err
			}
		}
		if err != nil {
			c.err = err
		}
		if n > 0 || err != nil {
			return n, err
		}
	}
}

// endsConn is CompleteResponse at the end of a response: bytes already
// read past it make .NET drop the conn. The read that ends the response
// then also ends the conn, so net/http never pools it.
func (c *wireConn) endsConn() bool {
	if c.err == nil && c.in.Buffered() > 0 {
		c.err = io.EOF
	}
	return c.err != nil
}

// nextHead reads a response head and queues net/http's view of it. Read
// has seen its first byte; a conn that ends before it ends with io.EOF,
// which net/http reads as a closed idle conn.
func (c *wireConn) nextHead() error {
	c.mu.Lock()
	head := c.method == http.MethodHead
	c.mu.Unlock()
	reader := NewResponseReader(c.in, maxResponseHeadersBytes)
	status, line, header, err := reader.ReadHead()
	if err != nil {
		return err
	}
	body, framing := reader.Body(status, head, header)
	id := strconv.FormatUint(headSeq.Add(1), 10)
	heads.Store(id, pendingHead{header: header, conn: c})
	c.mu.Lock()
	if c.pending == nil {
		c.pending = map[string]bool{}
	}
	c.pending[id] = true
	c.mu.Unlock()
	// .NET keeps an HTTP/1.0 conn as it keeps a 1.1 one, and reads a 1.0
	// chunked body; net/http does neither. So net/http sees 1.1 and the
	// close .NET decides.
	line = append([]byte("HTTP/1.1"), line[8:]...)
	out := append(append([]byte(nil), line...), "\r\n"...)
	out = append(out, headKey+": "+id+"\r\n"...)
	switch framing {
	case FramedLength:
		out = append(out, "Content-Length: "+strconv.FormatInt(ResponseContentLength(header), 10)+"\r\n"...)
	case FramedChunked:
		out = append(out, "Transfer-Encoding: chunked\r\n"...)
	case FramedNone:
		if n := ResponseContentLength(header); n >= 0 {
			out = append(out, "Content-Length: "+strconv.FormatInt(n, 10)+"\r\n"...)
		}
	}
	if framing == FramedClose || headClosesConn(header) {
		out = append(out, "Connection: close\r\n"...)
	}
	c.out = append(out, "\r\n"...)
	c.framing = framing
	if framing != FramedNone {
		c.body = body
	}
	return nil
}

// nextChunk queues the next piece of a chunked body in clean framing; the
// trailers stay with the reader, which checks them.
func (c *wireConn) nextChunk(size int) error {
	buffer := make([]byte, max(size, 512))
	n, err := c.body.Read(buffer)
	if n > 0 {
		c.out = append(c.out, strconv.FormatInt(int64(n), 16)+"\r\n"...)
		c.out = append(append(c.out, buffer[:n]...), "\r\n"...)
	}
	if errors.Is(err, io.EOF) {
		c.out = append(c.out, "0\r\n\r\n"...)
		c.body = nil
		return nil
	}
	return err
}
