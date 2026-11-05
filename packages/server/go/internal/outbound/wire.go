package outbound

import (
	"bufio"
	"errors"
	"io"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The response reader is .NET's HttpConnection (System.Net.Http 10.0.11),
// which C#'s HttpClient runs: net/http refuses header bytes .NET keeps.

var (
	errHeadTooLarge = errors.New("outbound: the response head passed its byte limit")
	errMalformed    = errors.New("outbound: a malformed response")
)

// maxChunkLine is .NET's cap on a chunk-size or chunk-end line, LF included.
const maxChunkLine = 16384

// wireReader reads one response. budget is .NET's _allowedReadLineBytes: one
// count for every status line and header block of the response, interim
// heads and trailers included.
type wireReader struct {
	r      *bufio.Reader
	budget int
}

// readLine reads through the next LF and returns the line without it. The
// bytes count against the budget.
func (w *wireReader) readLine() ([]byte, error) {
	var line []byte
	for {
		chunk, err := w.r.ReadSlice('\n')
		if len(chunk) > w.budget {
			return nil, errHeadTooLarge
		}
		w.budget -= len(chunk)
		line = append(line, chunk...)
		switch {
		case err == nil:
			return line[:len(line)-1], nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			return nil, io.ErrUnexpectedEOF
		default:
			return nil, err
		}
	}
}

func trimCR(line []byte) []byte {
	if n := len(line); n > 0 && line[n-1] == '\r' {
		return line[:n-1]
	}
	return line
}

// readResponse reads the final response head and frames its body. 1xx
// answers but 101 are skipped, with no count cap: the budget bounds them.
func readResponse(r *bufio.Reader, maxHead int, close func() error) (*http.Response, error) {
	w := &wireReader{r: r, budget: maxHead}
	for {
		line, err := w.readLine()
		if err != nil {
			return nil, err
		}
		status, err := parseStatusLine(trimCR(line))
		if err != nil {
			return nil, err
		}
		interim := status >= 100 && status <= 199 && status != 101
		header, err := w.readHeaderBlock(!interim)
		if err != nil {
			return nil, err
		}
		if interim {
			continue
		}
		response := &http.Response{
			StatusCode:    status,
			Header:        header,
			ContentLength: contentLength(header),
		}
		response.Body = &wireBody{source: w.framedBody(status, header), close: close}
		return response, nil
	}
}

// parseStatusLine is ParseStatusLineCore.
func parseStatusLine(line []byte) (int, error) {
	if len(line) < 12 || line[8] != ' ' || !strings.HasPrefix(string(line), "HTTP/1.") || !isDigit(line[7]) {
		return 0, errMalformed
	}
	if !isDigit(line[9]) || !isDigit(line[10]) || !isDigit(line[11]) {
		return 0, errMalformed
	}
	status := int(line[9]-'0')*100 + int(line[10]-'0')*10 + int(line[11]-'0')
	if len(line) > 12 {
		// The reason phrase setter refuses CR, LF and NUL.
		if line[12] != ' ' || strings.ContainsAny(string(line[13:]), "\r\x00") {
			return 0, errMalformed
		}
	}
	return status, nil
}

func isDigit(c byte) bool { return '0' <= c && c <= '9' }

// readHeaderBlock is ParseHeadersCore up to the blank line. A field runs
// to the first ':' of its first line; a line that starts with SP or HT
// continues it, its line end becoming spaces (CR too, when it precedes the
// LF). keep is false for an interim head, whose names .NET never checks.
func (w *wireReader) readHeaderBlock(keep bool) (http.Header, error) {
	header := http.Header{}
	for {
		line, err := w.readLine()
		if err != nil {
			return nil, err
		}
		if len(trimCR(line)) == 0 {
			return header, nil
		}
		colon := strings.IndexByte(string(line), ':')
		if colon < 0 {
			return nil, errMalformed
		}
		name, value := line[:colon], append([]byte(nil), line[colon+1:]...)
		for {
			next, err := w.r.Peek(1)
			if err != nil {
				return nil, io.ErrUnexpectedEOF
			}
			if next[0] != ' ' && next[0] != '\t' {
				break
			}
			if n := len(value); n > 0 && value[n-1] == '\r' {
				value[n-1] = ' '
			}
			value = append(value, ' ')
			more, err := w.readLine()
			if err != nil {
				return nil, err
			}
			value = append(value, more...)
		}
		if !keep {
			continue
		}
		key, text, err := responseHeader(name, trimCR(value))
		if err != nil {
			return nil, err
		}
		header[key] = append(header[key], text)
	}
}

// responseHeader is AddResponseHeader: the name loses trailing spaces and
// must be a token; the value loses SP and HT at both ends. The text is
// HeaderDescriptor.GetHeaderValue kept as bytes: a Location that is valid
// UTF-8 stays as it is, anything else turns NUL, CR and LF into spaces.
func responseHeader(name, value []byte) (string, string, error) {
	for len(name) > 0 && name[len(name)-1] == ' ' {
		name = name[:len(name)-1]
	}
	if len(name) == 0 || !isToken(string(name)) {
		return "", "", errMalformed
	}
	text := []byte(strings.Trim(string(value), " \t"))
	if !strings.EqualFold(string(name), "Location") || !utf8.Valid(text) {
		for i, c := range text {
			if c == 0 || c == '\r' || c == '\n' {
				text[i] = ' '
			}
		}
	}
	return textproto.CanonicalMIMEHeaderKey(string(name)), string(text), nil
}

// contentLength is HttpContentHeaders.ContentLength: only the first
// Content-Length line counts, and it must hold one number.
func contentLength(header http.Header) int64 {
	values := header.Values("Content-Length")
	if len(values) == 0 {
		return -1
	}
	digits := strings.Trim(values[0], " \t")
	if digits == "" || strings.Trim(digits, "0123456789") != "" {
		return -1
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return -1
	}
	return n
}

// framedBody picks the body stream as HttpConnection.SendAsync does.
func (w *wireReader) framedBody(status int, header http.Header) io.Reader {
	switch {
	case status == 204 || status == 304:
		return eofReader{}
	case status == 101:
		return w.r
	case transferEncodingChunked(header.Values("Transfer-Encoding")):
		return &chunkedReader{w: w}
	}
	if n := contentLength(header); n >= 0 {
		if n == 0 {
			return eofReader{}
		}
		return &lengthReader{r: w.r, remaining: n}
	}
	return w.r
}

// transferEncodingChunked is HttpGeneralHeaders.GetTransferEncodingChunked:
// one line that is "chunked", or any line that parses as a coding list
// holding a bare "chunked". A line that does not parse counts for nothing.
func transferEncodingChunked(values []string) bool {
	if len(values) == 1 && strings.EqualFold(values[0], "chunked") {
		return true
	}
	for _, value := range values {
		if codings, ok := parseTransferCodings(value); ok && codings["chunked"] {
			return true
		}
	}
	return false
}

// parseTransferCodings parses a TransferCodingHeaderParser list: items split
// by commas, each a token and ";name[=value]" parameters, empty items
// allowed. It returns the lowered names of the items with no parameters.
func parseTransferCodings(s string) (map[string]bool, bool) {
	bare := map[string]bool{}
	i := 0
	skip := func() {
		for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
			i++
		}
	}
	token := func() string {
		start := i
		for i < len(s) && isToken(s[i:i+1]) {
			i++
		}
		return s[start:i]
	}
	for {
		skip()
		for i < len(s) && s[i] == ',' {
			i++
			skip()
		}
		if i == len(s) {
			return bare, true
		}
		name := token()
		if name == "" {
			return nil, false
		}
		skip()
		params := false
		for i < len(s) && s[i] == ';' {
			params = true
			i++
			skip()
			if token() == "" {
				return nil, false
			}
			skip()
			if i < len(s) && s[i] == '=' {
				i++
				skip()
				if i < len(s) && s[i] == '"' {
					if !quotedString(s, &i) {
						return nil, false
					}
				} else if token() == "" {
					return nil, false
				}
				skip()
			}
		}
		if !params {
			bare[strings.ToLower(name)] = true
		}
		if i < len(s) && s[i] != ',' {
			return nil, false
		}
	}
}

// quotedString steps over a quoted string at s[*i], with backslash escapes.
func quotedString(s string, i *int) bool {
	for j := *i + 1; j < len(s); j++ {
		switch s[j] {
		case '\\':
			j++
		case '"':
			*i = j + 1
			return true
		}
	}
	return false
}

type eofReader struct{}

func (eofReader) Read([]byte) (int, error) { return 0, io.EOF }

// lengthReader is ContentLengthReadStream: a body cut short is an error.
type lengthReader struct {
	r         io.Reader
	remaining int64
}

func (l *lengthReader) Read(p []byte) (int, error) {
	if l.remaining == 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > l.remaining {
		p = p[:l.remaining]
	}
	n, err := l.r.Read(p)
	l.remaining -= int64(n)
	if errors.Is(err, io.EOF) && l.remaining > 0 {
		return n, io.ErrUnexpectedEOF
	}
	if l.remaining == 0 {
		err = nil
	}
	return n, err
}

// chunkedReader is ChunkedEncodingReadStream. The trailers go through the
// header rules and the head's remaining budget.
type chunkedReader struct {
	w         *wireReader
	remaining uint64
	started   bool
	done      bool
}

func (c *chunkedReader) Read(p []byte) (int, error) {
	if c.done {
		return 0, io.EOF
	}
	if c.remaining == 0 {
		if c.started {
			line, err := c.chunkLine()
			if err != nil {
				return 0, err
			}
			if len(line) != 0 {
				return 0, errMalformed
			}
		}
		c.started = true
		line, err := c.chunkLine()
		if err != nil {
			return 0, err
		}
		size, err := chunkSize(line)
		if err != nil {
			return 0, err
		}
		if size == 0 {
			if _, err := c.w.readHeaderBlock(true); err != nil {
				return 0, err
			}
			c.done = true
			return 0, io.EOF
		}
		c.remaining = size
	}
	if uint64(len(p)) > c.remaining {
		p = p[:c.remaining]
	}
	n, err := c.w.r.Read(p)
	c.remaining -= uint64(n)
	if errors.Is(err, io.EOF) {
		return n, io.ErrUnexpectedEOF
	}
	return n, err
}

// chunkLine is TryReadNextChunkedLine: at most maxChunkLine bytes, LF
// included, outside the head budget.
func (c *chunkedReader) chunkLine() ([]byte, error) {
	var line []byte
	for {
		chunk, err := c.w.r.ReadSlice('\n')
		line = append(line, chunk...)
		if len(line) > maxChunkLine {
			return nil, errMalformed
		}
		switch {
		case err == nil:
			return trimCR(line[:len(line)-1]), nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			return nil, io.ErrUnexpectedEOF
		default:
			return nil, err
		}
	}
}

// chunkSize is Utf8Parser's hex parse, then ValidateChunkExtension: after
// the digits only SP and HT, up to a ';'.
func chunkSize(line []byte) (uint64, error) {
	end := 0
	for end < len(line) && isHex(line[end]) {
		end++
	}
	if end == 0 {
		return 0, errMalformed
	}
	size, err := strconv.ParseUint(string(line[:end]), 16, 64)
	if err != nil {
		return 0, errMalformed
	}
	for _, c := range line[end:] {
		if c == ';' {
			break
		}
		if c != ' ' && c != '\t' {
			return 0, errMalformed
		}
	}
	return size, nil
}

func isHex(c byte) bool {
	return isDigit(c) || 'a' <= c && c <= 'f' || 'A' <= c && c <= 'F'
}

// wireBody closes the connection with the body.
type wireBody struct {
	source io.Reader
	close  func() error
}

func (b *wireBody) Read(p []byte) (int, error) { return b.source.Read(p) }

func (b *wireBody) Close() error { return b.close() }
