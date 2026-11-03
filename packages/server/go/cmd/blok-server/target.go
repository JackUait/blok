package main

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/JackUait/blok/packages/server/go/internal/route"
)

// Kestrel routes a target that Go's url parser refuses: a bad escape in the
// path, or a raw control byte other than LF. net/http answers those with its
// own 400 before any handler runs. So targetStream sits between the socket
// and net/http: on each request line it swaps those bytes for '_', keeps the
// target as sent in a queue, and restoreTarget hands it back to the router.
//
// The swap keeps the length, so net/http's head limit sees the same bytes.
// Only the request line changes, never a header or a body. To know where the
// next request line starts it reads each head with http.ReadRequest, the
// parser net/http uses. Whatever it cannot follow exactly (a chunked body, an
// upgrade, CONNECT, HTTP/2, a head net/http refuses or one over its limit)
// ends the rewriting for the rest of the connection.

// maxRequestHead is net/http's read limit for a head: DefaultMaxHeaderBytes,
// since newHTTPServer sets no MaxHeaderBytes, plus its 4096 bytes of slack.
const maxRequestHead = http.DefaultMaxHeaderBytes + 4096

const (
	streamLine = iota
	streamHead
	streamBody
	streamPass
)

type queuedTarget struct{ sent, original string }

type targetStream struct {
	src   io.Reader
	in    []byte // read, not yet handed on
	out   []byte // ready for net/http
	err   error  // from src, returned once out is empty
	state int
	head  []byte // the current head, as handed on
	body  int64  // Content-Length bytes left
	// afterPost: net/http drops up to four leading CR or LF from the request
	// after a POST (conn.readRequest).
	afterPost bool

	mu     sync.Mutex
	queued []queuedTarget
}

func (s *targetStream) Read(p []byte) (int, error) {
	for len(s.out) == 0 {
		if s.state == streamPass && len(s.in) == 0 && s.err == nil {
			return s.src.Read(p)
		}
		if s.step() {
			continue
		}
		if s.err != nil {
			err := s.err
			s.err = nil
			if !isTimeout(err) {
				// The stream ends: hand on a partial line as it came.
				s.state = streamPass
				if len(s.in) > 0 {
					s.out, s.in = s.in, nil
					s.err = err
					break
				}
			}
			return 0, err
		}
		buffer := make([]byte, 4096)
		n, err := s.src.Read(buffer)
		s.in = append(s.in, buffer[:n]...)
		s.err = err
	}
	n := copy(p, s.out)
	if s.out = s.out[n:]; len(s.out) == 0 {
		s.out = nil
	}
	return n, nil
}

// take hands on the first n bytes of in. An emptied in is dropped: even an
// empty tail would keep the whole array a big head grew.
func (s *targetStream) take(n int) {
	if s.out, s.in = s.in[:n], s.in[n:]; len(s.in) == 0 {
		s.in = nil
	}
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

// step moves what it can from in to out. It reports whether it did anything.
func (s *targetStream) step() bool {
	switch s.state {
	case streamPass:
		if len(s.in) == 0 {
			return false
		}
		s.out, s.in = s.in, nil
		return true
	case streamBody:
		if len(s.in) == 0 {
			return false
		}
		n := int64(len(s.in))
		if n > s.body {
			n = s.body
		}
		s.take(int(n))
		if s.body -= n; s.body == 0 {
			s.state = streamLine
		}
		return true
	}
	if s.state == streamLine && s.afterPost {
		// A timeout is net/http's aborted background read, not the end:
		// the CR/LF to skip may still come.
		if len(s.in) < 4 && (s.err == nil || isTimeout(s.err)) {
			return false
		}
		s.afterPost = false
		skip := 0
		for skip < len(s.in) && skip < 4 && (s.in[skip] == '\r' || s.in[skip] == '\n') {
			skip++
		}
		if skip > 0 {
			s.take(skip)
			return true
		}
	}
	end := bytes.IndexByte(s.in, '\n')
	if end < 0 || len(s.head)+end+1 > maxRequestHead {
		if len(s.head)+len(s.in) > maxRequestHead {
			s.state, s.head = streamPass, nil
			return true
		}
		return false
	}
	line := s.in[:end+1]
	s.take(end + 1)
	if s.state == streamLine {
		s.push(swapRequestLine(line))
		s.state = streamHead
	}
	s.head = append(s.head, line...)
	if len(line) == 1 || (len(line) == 2 && line[0] == '\r') {
		s.endHead()
	}
	return true
}

// endHead reads the head the way net/http will and sets where the next
// request line starts.
func (s *targetStream) endHead() {
	request, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(s.head)))
	s.head = s.head[:0]
	if cap(s.head) > 4096 {
		s.head = nil
	}
	s.state = streamPass
	if err != nil || request.Method == "CONNECT" || request.Method == "PRI" ||
		len(request.TransferEncoding) > 0 || request.Header.Get("Upgrade") != "" ||
		strings.Contains(strings.ToLower(strings.Join(request.Header.Values("Connection"), ",")), "upgrade") {
		return
	}
	s.afterPost = request.Method == "POST"
	s.body = request.ContentLength
	s.state = streamLine
	if s.body > 0 {
		s.state = streamBody
	}
}

func (s *targetStream) push(entry queuedTarget) {
	s.mu.Lock()
	s.queued = append(s.queued, entry)
	s.mu.Unlock()
}

func (s *targetStream) pop() (queuedTarget, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queued) == 0 {
		return queuedTarget{}, false
	}
	entry := s.queued[0]
	s.queued = s.queued[1:]
	return entry, true
}

// swapRequestLine swaps the target's refused bytes in place. It finds the
// target as parseRequestLine does: between the first two spaces of the line
// without its line end.
func swapRequestLine(line []byte) queuedTarget {
	content := bytes.TrimSuffix(bytes.TrimSuffix(line, []byte("\n")), []byte("\r"))
	_, rest, ok := bytes.Cut(content, []byte(" "))
	if !ok {
		return queuedTarget{}
	}
	target, _, ok := bytes.Cut(rest, []byte(" "))
	if !ok {
		return queuedTarget{}
	}
	original := string(target)
	swapUnparsedTargetBytes(target)
	return queuedTarget{sent: string(target), original: original}
}

// swapUnparsedTargetBytes is url.ParseRequestURI's refusals for an
// origin-form target: any control byte, and in the path (before the first
// '?') a '%' without two hex digits after it.
func swapUnparsedTargetBytes(target []byte) {
	if len(target) == 0 || target[0] != '/' {
		return
	}
	query := false
	for i, b := range target {
		switch {
		case b < 0x20 || b == 0x7f:
			target[i] = '_'
		case b == '?':
			query = true
		case b == '%' && !query && (i+2 >= len(target) || !isHex(target[i+1]) || !isHex(target[i+2])):
			target[i] = '_'
		}
	}
}

func isHex(b byte) bool {
	return '0' <= b && b <= '9' || 'a' <= b && b <= 'f' || 'A' <= b && b <= 'F'
}

// restoreTargets puts each target back as sent before the router reads it.
func restoreTargets(server *http.Server) {
	next := server.Handler
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if conn, ok := r.Context().Value(headerConnKey{}).(*headerConn); ok && conn.targets != nil {
			if !restoreTarget(w, r, conn.targets) {
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// restoreTarget takes the request's queue entry. An entry for another target
// means the queue lost step; the request gets an empty 400 and the
// connection closes rather than route with someone else's target.
func restoreTarget(w http.ResponseWriter, r *http.Request, stream *targetStream) bool {
	entry, ok := stream.pop()
	if !ok || entry.sent == entry.original && entry.sent == r.RequestURI {
		return true
	}
	if entry.sent != r.RequestURI {
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusBadRequest)
		return false
	}
	route.SetRawTarget(r, entry.original)
	return true
}
