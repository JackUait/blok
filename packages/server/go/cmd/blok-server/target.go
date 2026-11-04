package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/textproto"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"golang.org/x/net/http/httpguts"

	"github.com/JackUait/blok/packages/server/go/internal/route"
)

// targetStream sits between the socket and net/http and makes each request
// head read the way Kestrel reads it. net/http's own parser refuses some
// heads Kestrel routes, accepts some Kestrel refuses, and has none of
// Kestrel's size limits. So the stream holds each head until its blank line
// and then:
//
//   - refuses it the way Kestrel would (414, 431, an empty 400, or a GOAWAY
//     for the HTTP/2 preface): net/http gets a stand-in request whose queue
//     entry says to write Kestrel's answer and close;
//   - or swaps the bytes net/http would refuse but Kestrel takes for '_'
//     (in the target, and in header names and values), keeps the originals
//     in the queue, and restoreTarget hands them back before routing.
//
// The swap keeps the length. CR and LF before a request line are dropped, as
// Kestrel skips them. Only heads change, never a body. To know where the next
// head starts it reads each head with http.ReadRequest, the parser net/http
// uses. Whatever it cannot follow exactly (a chunked body, an upgrade,
// CONNECT, a transfer coding net/http refuses) ends the rewriting for the
// rest of the connection; MaxHeaderBytes then caps heads instead.

// Kestrel's defaults (KestrelServerLimits; Program.cs sets none), measured
// on the C# host: the request line counts its line end, the header block
// counts every byte after the request line, blank line included.
const (
	maxRequestLine = 8 << 10
	maxHeaderBlock = 32<<10 + 2
	maxHeaderCount = 100
)

// Queue entries for refusals that are not a bare status.
const (
	// rejectGoAway: the HTTP/2 preface.
	rejectGoAway = -1
	// rejectNeedsConnect, rejectNeedsOptions: Kestrel's 405 with an Allow
	// header, for an authority target off CONNECT and "*" off OPTIONS.
	rejectNeedsConnect = -2
	rejectNeedsOptions = -3
)

// standIn is what net/http reads in place of a refused head.
const standIn = "GET / HTTP/1.1\r\nHost: x\r\n\r\n"

const (
	streamLine = iota
	streamHead
	streamBody
	streamPass
	// streamDone: a head was refused; nothing after it is read as HTTP.
	streamDone
)

type queuedTarget struct{ sent, original string }

// headerSwap is one header line the stream changed.
type headerSwap struct {
	line        int // among the head's header lines
	sentName    string
	name, value string // as sent, without the line end
	// drop: the line goes, as net/http drops the codings line it reads.
	drop bool
}

type queuedRequest struct {
	queuedTarget
	reject int
	swaps  []headerSwap
}

type targetStream struct {
	src   io.Reader
	in    []byte // read, not yet handed on
	out   []byte // ready for net/http
	err   error  // from src, returned once out is empty
	state int
	head  []byte // the current head, held until its blank line
	body  int64  // Content-Length bytes left
	buf   []byte // one read buffer for the stream's life
	// scanned is how much of in has no LF, so a slow line is scanned once.
	scanned int

	entry       queuedRequest // for the current head
	headerBytes int
	headerLines int
	hostLines   int
	host        string
	lengthLines int
	codings     []codingLine
	// dropped counts the CR and LF bytes skipped before request lines.
	dropped int

	mu     sync.Mutex
	queued []queuedRequest
	// held is set when Read returns with bytes of a request still in in,
	// head or out.
	held atomic.Bool
}

func (s *targetStream) Read(p []byte) (int, error) {
	defer func() { s.held.Store(len(s.out) > 0 || len(s.in) > 0 || len(s.head) > 0) }()
	for len(s.out) == 0 {
		if s.state == streamDone {
			return 0, io.EOF
		}
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
				// The stream ends: hand on a partial head as it came.
				s.state = streamPass
				if partial := append(s.head, s.in...); len(partial) > 0 {
					s.out, s.in, s.head = partial, nil, nil
					s.err = err
					break
				}
			}
			return 0, err
		}
		if s.buf == nil {
			s.buf = make([]byte, 4096)
		}
		n, err := s.src.Read(s.buf)
		s.in = append(s.in, s.buf[:n]...)
		s.err = err
	}
	n := copy(p, s.out)
	if s.out = s.out[n:]; len(s.out) == 0 {
		s.out = nil
	}
	return n, nil
}

// consume drops the first n bytes of in. An emptied in is dropped: even an
// empty tail would keep the whole array a big head grew.
func (s *targetStream) consume(n int) {
	s.scanned = 0
	if s.in = s.in[n:]; len(s.in) == 0 {
		s.in = nil
	}
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

// step moves what it can from in to head or out. It reports whether it did
// anything.
func (s *targetStream) step() bool {
	switch s.state {
	case streamDone:
		return false
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
		s.scanned = 0
		if s.out, s.in = s.in[:n], s.in[n:]; len(s.in) == 0 {
			s.in = nil
		}
		if s.body -= n; s.body == 0 {
			s.state = streamLine
		}
		return true
	}
	if s.state == streamLine {
		skip := 0
		for skip < len(s.in) && (s.in[skip] == '\r' || s.in[skip] == '\n') {
			skip++
		}
		if skip > 0 {
			s.dropped += skip
			s.consume(skip)
			return true
		}
	}
	end := bytes.IndexByte(s.in[s.scanned:], '\n')
	if end < 0 {
		s.scanned = len(s.in)
	} else {
		end += s.scanned
	}
	// A line with no end yet is over the limit once it fills it: its LF
	// would be one byte more.
	if s.state == streamLine {
		if end < 0 && len(s.in) >= maxRequestLine || end >= maxRequestLine {
			s.refuse(http.StatusRequestURITooLong)
			return true
		}
	} else if end < 0 && s.headerBytes+len(s.in) >= maxHeaderBlock || end >= 0 && s.headerBytes+end+1 > maxHeaderBlock {
		s.refuse(http.StatusRequestHeaderFieldsTooLarge)
		return true
	}
	if end < 0 {
		return false
	}
	start := len(s.head)
	s.head = append(s.head, s.in[:end+1]...)
	s.consume(end + 1)
	line := s.head[start:]
	if s.state == streamLine {
		if status := lineRefusal(line); status != 0 {
			s.refuse(status)
			return true
		}
		s.entry = queuedRequest{queuedTarget: swapRequestLine(line)}
		s.state = streamHead
		return true
	}
	s.headerBytes += len(line)
	if len(line) == 1 || (len(line) == 2 && line[0] == '\r') {
		s.endHead()
		return true
	}
	if s.headerLines++; s.headerLines > maxHeaderCount {
		s.refuse(http.StatusRequestHeaderFieldsTooLarge)
		return true
	}
	if !s.swapHeaderLine(line) {
		s.refuse(http.StatusBadRequest)
	}
	return true
}

// lineRefusal is what Kestrel refuses on the request line, before any header
// is read. The version is everything after the target's space, up to the
// LF: 8 bytes, or 9 ending in CR, or the line is a 400. Of those, all but
// HTTP/1.0 and HTTP/1.1 get 505, unless the method is bad (400). Then the
// target's form (targetRefusal). A line with no version is left to
// http.ReadRequest; so is the HTTP/2 preface, which gets its GOAWAY after
// its blank line.
func lineRefusal(line []byte) int {
	line = bytes.TrimSuffix(line, []byte("\n"))
	method, rest, ok := bytes.Cut(line, []byte(" "))
	if !ok {
		return 0
	}
	target, version, ok := bytes.Cut(rest, []byte(" "))
	if !ok {
		return 0
	}
	if string(method) == "PRI" && string(target) == "*" && string(bytes.TrimSuffix(version, []byte("\r"))) == "HTTP/2.0" {
		return 0
	}
	if len(version) != 8 && (len(version) != 9 || version[8] != '\r') {
		return http.StatusBadRequest
	}
	known := string(version[:8]) == "HTTP/1.0" || string(version[:8]) == "HTTP/1.1"
	if !known && (len(method) == 0 || bytes.ContainsFunc(method, func(r rune) bool { return !httpguts.IsTokenRune(r) })) {
		return http.StatusBadRequest
	}
	if !known {
		return http.StatusHTTPVersionNotSupported
	}
	return targetRefusal(method, target)
}

// targetRefusal is Kestrel's check of the target's form, measured on the C#
// host. An absolute target (http:// or https://, in lower case) must parse;
// endHead checks its authority against Host. "*" is only for OPTIONS. Any
// other target is authority-form: off CONNECT a 405, or a 400 for a byte
// that is not a letter, a digit or one of "-.:@[]".
func targetRefusal(method, target []byte) int {
	switch {
	case len(target) == 0 || target[0] == '/':
		return 0
	case target[0] == '*':
		if len(target) > 1 {
			return http.StatusBadRequest
		}
		if string(method) != "OPTIONS" {
			return rejectNeedsOptions
		}
		return 0
	case bytes.HasPrefix(target, []byte("http://")) || bytes.HasPrefix(target, []byte("https://")):
		if _, _, ok := absoluteAuthority(string(target)); !ok {
			return http.StatusBadRequest
		}
		return 0
	case string(method) == "CONNECT":
		return 0
	}
	for _, b := range target {
		if !('a' <= b && b <= 'z' || 'A' <= b && b <= 'Z' || '0' <= b && b <= '9' || bytes.IndexByte([]byte("-.:@[]"), b) >= 0) {
			return http.StatusBadRequest
		}
	}
	return rejectNeedsConnect
}

// absoluteAuthority is the authority of an absolute target as System.Uri
// prints it: no userinfo, the host in lower case, and the port only when it
// is not the scheme's default. defaultPort is that port, or "" when the
// target names another. ok is false where Kestrel's parse fails: no host, a
// '%' in it, or a port that is not a number up to 65535.
func absoluteAuthority(target string) (authority, defaultPort string, ok bool) {
	scheme, rest, found := strings.Cut(target, "://")
	if !found || scheme != "http" && scheme != "https" {
		return "", "", false
	}
	defaultPort = "80"
	if scheme == "https" {
		defaultPort = "443"
	}
	if end := strings.IndexAny(rest, "/?#"); end >= 0 {
		rest = rest[:end]
	}
	if at := strings.LastIndexByte(rest, '@'); at >= 0 {
		rest = rest[at+1:]
	}
	host, port := rest, ""
	if strings.HasPrefix(rest, "[") {
		end := strings.IndexByte(rest, ']')
		if end < 0 {
			return "", "", false
		}
		host, port = rest[:end+1], rest[end+1:]
		if port != "" && port[0] != ':' {
			return "", "", false
		}
		port = strings.TrimPrefix(port, ":")
	} else if colon := strings.IndexByte(rest, ':'); colon >= 0 {
		host, port = rest[:colon], rest[colon+1:]
	}
	if host == "" || strings.Contains(host, "%") {
		return "", "", false
	}
	authority = strings.ToLower(host)
	if port == "" {
		return authority, defaultPort, true
	}
	number := 0
	for _, c := range port {
		if c < '0' || c > '9' {
			return "", "", false
		}
		if number = number*10 + int(c-'0'); number > 65535 {
			return "", "", false
		}
	}
	if strconv.Itoa(number) == defaultPort {
		return authority, defaultPort, true
	}
	return authority + ":" + strconv.Itoa(number), "", true
}

// swapHeaderLine applies Kestrel's header grammar to one line, in place. It
// reports false for a line Kestrel refuses and net/http would take. A line
// both refuse is left for http.ReadRequest to refuse.
func (s *targetStream) swapHeaderLine(line []byte) bool {
	content := bytes.TrimSuffix(bytes.TrimSuffix(line, []byte("\n")), []byte("\r"))
	if len(content) > 0 && (content[0] == ' ' || content[0] == '\t') {
		// obs-fold, or a head that starts with whitespace.
		return false
	}
	name, value, ok := bytes.Cut(content, []byte(":"))
	if !ok {
		return true
	}
	if !utf8.Valid(value) {
		return false
	}
	// Kestrel reads Host itself; a Host line keeps net/http's check.
	if bytes.EqualFold(name, []byte("Host")) {
		s.hostLines++
		s.host = string(bytes.Trim(value, " \t"))
		return true
	}
	if bytes.EqualFold(name, []byte("Content-Length")) {
		s.lengthLines++
	}
	// endHead reads and rewrites the codings; their bytes stay as sent. The
	// rewrite blanks the value, so first refuse what Kestrel refuses in any
	// value and http.ReadRequest would otherwise never see.
	if bytes.EqualFold(name, []byte("Transfer-Encoding")) {
		if bytes.ContainsAny(value, "\x00\r") {
			return false
		}
		s.codings = append(s.codings, codingLine{
			line: s.headerLines - 1, at: len(s.head) - len(line), nameLength: len(name), valueLength: len(value),
		})
		return true
	}
	original := swap{name: string(name), value: string(value)}
	changed := swapBytes(name, kestrelOnlyNameByte)
	changed = swapBytes(value, kestrelOnlyValueByte) || changed
	if changed {
		s.entry.swaps = append(s.entry.swaps, headerSwap{
			line: s.headerLines - 1, sentName: string(name), name: original.name, value: original.value,
		})
	}
	return true
}

type swap struct{ name, value string }

func swapBytes(b []byte, swapped func(byte) bool) bool {
	changed := false
	for i, c := range b {
		if swapped(c) {
			b[i] = '_'
			changed = true
		}
	}
	return changed
}

// kestrelOnlyNameByte: Kestrel takes any name byte but NUL, HT, LF, CR, SP
// and bytes over 0x7F; net/http takes only token bytes.
func kestrelOnlyNameByte(c byte) bool {
	return c != 0 && c != '\t' && c != '\n' && c != '\r' && c != ' ' && c < 0x80 && !httpguts.IsTokenRune(rune(c))
}

// kestrelOnlyValueByte: Kestrel refuses only NUL and CR in a value (and
// invalid UTF-8); net/http refuses every control byte but HT, and DEL.
func kestrelOnlyValueByte(c byte) bool {
	return c != 0 && c != '\t' && c != '\r' && (c < 0x20 || c == 0x7f)
}

// refuse hands net/http a stand-in request whose entry carries Kestrel's
// answer. The stream reads nothing more.
func (s *targetStream) refuse(status int) {
	s.push(queuedRequest{queuedTarget: queuedTarget{sent: "/", original: "/"}, reject: status})
	s.out = []byte(standIn)
	s.in, s.head, s.state = nil, nil, streamDone
}

// codingLine is where a Transfer-Encoding line sits in the head.
type codingLine struct {
	line, at, nameLength, valueLength int
}

// droppedCodings is what a Transfer-Encoding line net/http must not see is
// renamed to. Same length as the name, so the head keeps its length.
const droppedCodings = "X-Blok-Dropped-Te"

// takeCodings is Kestrel's check of the transfer codings: the last one, of
// every line split on commas and trimmed of spaces (not tabs), must be
// chunked. It reports false for Kestrel's 400. net/http takes only one line
// whose whole value is chunked, so for any other spelling Kestrel takes, the
// line with the last coding becomes "chunked" padded with spaces and every
// other line is renamed, blanked, and dropped before routing. net/http
// drops Transfer-Encoding from the header map, so nothing is restored.
func (s *targetStream) takeCodings() bool {
	last, final := -1, ""
	for i, c := range s.codings {
		value := s.head[c.at+c.nameLength+1 : c.at+c.nameLength+1+c.valueLength]
		for _, coding := range bytes.Split(bytes.Trim(value, " \t"), []byte(",")) {
			if coding = bytes.Trim(coding, " "); len(coding) > 0 {
				last, final = i, string(coding)
			}
		}
	}
	if last < 0 || !strings.EqualFold(final, "chunked") {
		return false
	}
	if len(s.codings) == 1 {
		value := s.head[s.codings[0].at+s.codings[0].nameLength+1:][:s.codings[0].valueLength]
		if strings.EqualFold(string(bytes.Trim(value, " \t")), "chunked") {
			return true
		}
	}
	for i, c := range s.codings {
		value := s.head[c.at+c.nameLength+1:][:c.valueLength]
		for j := range value {
			value[j] = ' '
		}
		if i == last {
			copy(value, "chunked")
			continue
		}
		copy(s.head[c.at:], droppedCodings)
		s.entry.swaps = append(s.entry.swaps, headerSwap{line: c.line, drop: true})
	}
	slices.SortStableFunc(s.entry.swaps, func(a, b headerSwap) int { return a.line - b.line })
	return true
}

// endHead reads the head the way net/http will and sets where the next
// request line starts.
func (s *targetStream) endHead() {
	s.headerBytes, s.headerLines = 0, 0
	defer func() { s.hostLines, s.host, s.lengthLines, s.codings = 0, "", 0, nil }()
	// net/http takes equal Content-Length lines as one; Kestrel refuses any
	// second line.
	if s.lengthLines > 1 || len(s.codings) > 0 && !s.takeCodings() {
		s.refuse(http.StatusBadRequest)
		return
	}
	request, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(s.head)))
	switch {
	case err != nil:
		s.refuse(http.StatusBadRequest)
		return
	case request.Method == "PRI" && request.RequestURI == "*" && request.Proto == "HTTP/2.0":
		s.refuse(rejectGoAway)
		return
	}
	// ReadRequest drops Host from the header map; net/http's server checks
	// the lines it had.
	if request.ProtoAtLeast(1, 1) && s.hostLines == 0 && request.Method != "CONNECT" ||
		s.hostLines == 1 && !httpguts.ValidHostHeader(s.host) {
		s.refuse(http.StatusBadRequest)
		return
	}
	// Kestrel checks an absolute target's authority against Host, when there
	// is one (HTTP/1.0 may send none).
	if authority, defaultPort, ok := absoluteAuthority(s.entry.original); ok && s.hostLines == 1 &&
		s.host != authority && (defaultPort == "" || s.host != authority+":"+defaultPort) {
		s.refuse(http.StatusBadRequest)
		return
	}
	// What net/http's server checks after ReadRequest. The bytes Kestrel
	// takes are swapped by now, so what is left Kestrel refuses too.
	for name, values := range request.Header {
		if !httpguts.ValidHeaderFieldName(name) {
			s.refuse(http.StatusBadRequest)
			return
		}
		for _, value := range values {
			if !httpguts.ValidHeaderFieldValue(value) {
				s.refuse(http.StatusBadRequest)
				return
			}
		}
	}
	if len(s.entry.swaps) > 0 {
		s.entry.swaps = placeSwaps(s.head, s.entry.swaps)
	}
	if request.Method == "CONNECT" || len(request.TransferEncoding) > 0 || request.Header.Get("Upgrade") != "" ||
		strings.Contains(strings.ToLower(strings.Join(request.Header.Values("Connection"), ",")), "upgrade") {
		s.handOn(streamPass)
		return
	}
	s.body = request.ContentLength
	if s.body > 0 {
		s.handOn(streamBody)
	} else {
		s.handOn(streamLine)
	}
}

func (s *targetStream) handOn(next int) {
	s.push(s.entry)
	s.entry = queuedRequest{}
	s.out, s.head = s.head, nil
	s.state = next
}

// placeSwaps turns each swap's line number into its index among the values
// net/http keeps under the same key, which is how restoreHeaders finds it.
func placeSwaps(head []byte, swaps []headerSwap) []headerSwap {
	lines := bytes.Split(head, []byte("\n"))[1:]
	seen := map[string]int{}
	placed := swaps[:0]
	next := 0
	for i, line := range lines {
		name, _, ok := bytes.Cut(line, []byte(":"))
		if !ok {
			continue
		}
		key := textproto.CanonicalMIMEHeaderKey(string(name))
		if next < len(swaps) && swaps[next].line == i {
			swaps[next].line = seen[key]
			swaps[next].sentName = key
			placed = append(placed, swaps[next])
			next++
		}
		seen[key]++
	}
	return placed
}

func (s *targetStream) push(entry queuedRequest) {
	s.mu.Lock()
	s.queued = append(s.queued, entry)
	s.mu.Unlock()
}

func (s *targetStream) pop() (queuedRequest, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queued) == 0 {
		return queuedRequest{}, false
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

// restoreTargets puts each target and header back as sent before the router
// reads it, and answers a refused head.
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

// restoreTarget takes the request's queue entry. An entry for another target,
// or swapped headers it cannot find, means the queue lost step; the request
// gets an empty 400 and the connection closes rather than route with someone
// else's bytes.
func restoreTarget(w http.ResponseWriter, r *http.Request, stream *targetStream) bool {
	entry, ok := stream.pop()
	if ok && entry.reject != 0 {
		answerAndClose(w, entry.reject)
		return false
	}
	if !ok || entry.sent == entry.original && entry.sent == r.RequestURI && len(entry.swaps) == 0 {
		return true
	}
	if entry.sent != r.RequestURI || !restoreHeaders(r.Header, entry.swaps) {
		answerAndClose(w, http.StatusBadRequest)
		return false
	}
	if entry.sent != entry.original {
		route.SetRawTarget(r, entry.original)
	}
	return true
}

// restoreHeaders puts each swapped line's name and value back, trimmed the
// way textproto trims them, and takes out each dropped line. Last first, so a moved value does not shift the
// index of an earlier one.
func restoreHeaders(header http.Header, swaps []headerSwap) bool {
	for i := len(swaps) - 1; i >= 0; i-- {
		swap := swaps[i]
		values := header[swap.sentName]
		if swap.line >= len(values) {
			return false
		}
		value := strings.Trim(swap.value, " \t")
		if !swap.drop && textproto.CanonicalMIMEHeaderKey(swap.name) == swap.sentName {
			values[swap.line] = value
			continue
		}
		if values = append(values[:swap.line], values[swap.line+1:]...); len(values) == 0 {
			delete(header, swap.sentName)
		} else {
			header[swap.sentName] = values
		}
		if !swap.drop {
			header[swap.name] = append([]string{value}, header[swap.name]...)
		}
	}
	return true
}

// Kestrel's reason phrases, which net/http's StatusText does not all share.
var kestrelReasons = map[int]string{
	http.StatusBadRequest:                  "Bad Request",
	http.StatusMethodNotAllowed:            "Method Not Allowed",
	http.StatusRequestTimeout:              "Request Timeout",
	http.StatusRequestEntityTooLarge:       "Payload Too Large",
	http.StatusRequestURITooLong:           "URI Too Long",
	http.StatusRequestHeaderFieldsTooLarge: "Request Header Fields Too Large",
	http.StatusHTTPVersionNotSupported:     "HTTP Version Not Supported",
}

// kestrelAnswer is the bare answer Kestrel writes when it refuses a request.
func kestrelAnswer(status int) string {
	if status == rejectGoAway {
		// An HTTP/2 GOAWAY frame: stream 0, last stream 0, HTTP_1_1_REQUIRED.
		return "\x00\x00\x08\x07\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x0d"
	}
	status, allow := refusalStatus(status)
	if allow != "" {
		allow = "Allow: " + allow + "\r\n"
	}
	return fmt.Sprintf("HTTP/1.1 %d %s\r\nContent-Length: 0\r\nConnection: close\r\n%sDate: %s\r\n\r\n",
		status, kestrelReasons[status], allow, time.Now().UTC().Format(http.TimeFormat))
}

// refusalStatus is the status and Allow value a queue entry's refusal gets.
func refusalStatus(reject int) (int, string) {
	switch reject {
	case rejectNeedsConnect:
		return http.StatusMethodNotAllowed, "CONNECT"
	case rejectNeedsOptions:
		return http.StatusMethodNotAllowed, "OPTIONS"
	case rejectGoAway:
		return http.StatusBadRequest, ""
	}
	return reject, ""
}

// rstAvoidance is how long a refused connection keeps reading before it
// closes. Closing with unread bytes sends a reset, which can make the client
// drop the answer; net/http waits the same 500 ms for its own refusals.
const rstAvoidance = 500 * time.Millisecond

// answerAndClose writes Kestrel's bare answer straight to the socket and
// closes it. Through w the status line would carry net/http's reason phrase.
func answerAndClose(w http.ResponseWriter, status int) {
	conn, _, err := http.NewResponseController(w).Hijack()
	if err != nil {
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Length", "0")
		status, allow := refusalStatus(status)
		if allow != "" {
			w.Header().Set("Allow", allow)
		}
		w.WriteHeader(status)
		return
	}
	if header, ok := conn.(*headerConn); ok {
		// Its stream is done; the socket under it still has to drain.
		conn = header.Conn
	}
	_, _ = io.WriteString(conn, kestrelAnswer(status))
	go func() {
		if half, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = half.CloseWrite()
		}
		_ = conn.SetReadDeadline(time.Now().Add(rstAvoidance))
		_, _ = io.Copy(io.Discard, conn)
		_ = conn.Close()
	}()
}
