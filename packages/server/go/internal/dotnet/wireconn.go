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
)

// maxResponseHeadersBytes is SocketsHttpHandler's default
// MaxResponseHeadersLength, 64 KiB.
const maxResponseHeadersBytes = 64 << 10

// wireConn sits under net/http on an operator client's connection. It
// reads each response as .NET does (ResponseReader) and hands net/http a
// head it accepts: the status line, then only the framing, re-chunked when
// chunked. The real headers wait for RoundTrip to take them, so the body
// framing and the pool stay net/http's.
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
	last   http.Header
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

// header is the last final response's headers, as .NET stores them.
func (c *wireConn) header() http.Header {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.last
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
	c.mu.Lock()
	c.last = header
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
