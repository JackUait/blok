package dotnet

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
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
	for {
		if len(c.out) > 0 {
			n := copy(p, c.out)
			c.out = c.out[n:]
			return n, nil
		}
		if c.err != nil {
			return 0, c.err
		}
		if c.body == nil {
			c.err = c.nextHead()
			continue
		}
		if c.framing == FramedChunked {
			c.err = c.nextChunk(len(p))
			continue
		}
		n, err := c.body.Read(p)
		if errors.Is(err, io.EOF) && c.framing == FramedLength {
			c.body, err = nil, nil
		}
		if err != nil {
			c.err = err
		}
		if n > 0 || err != nil {
			return n, err
		}
	}
}

// nextHead reads a response head and queues net/http's view of it. A conn
// that ends before any byte of it ends with io.EOF, which net/http reads
// as a closed idle conn.
func (c *wireConn) nextHead() error {
	if _, err := c.in.Peek(1); err != nil {
		return err
	}
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
	tokens := connectionTokens(header)
	if framing == FramedChunked && strings.HasPrefix(string(line), "HTTP/1.0 ") {
		// .NET chunks an HTTP/1.0 body too; net/http would not. The conn
		// still closes after it unless the server asked to keep it.
		line = append([]byte("HTTP/1.1"), line[8:]...)
		if !strings.Contains(strings.ToLower(tokens), "keep-alive") {
			tokens = strings.TrimPrefix(tokens+", close", ", ")
		}
	}
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
	case FramedClose:
		out = append(out, "Connection: close\r\n"...)
	}
	if framing != FramedClose && tokens != "" {
		out = append(out, "Connection: "+tokens+"\r\n"...)
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

// connectionTokens is the Connection header's tokens, or "" when any is
// not a token net/http would take.
func connectionTokens(header http.Header) string {
	var tokens []string
	for _, value := range header.Values("Connection") {
		for _, token := range strings.Split(value, ",") {
			token = strings.Trim(token, " \t")
			if token == "" {
				continue
			}
			if !isToken(token) {
				return ""
			}
			tokens = append(tokens, token)
		}
	}
	return strings.Join(tokens, ", ")
}
