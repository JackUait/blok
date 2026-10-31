package blokserver

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/blob"
	"github.com/JackUait/blok/packages/server/go/internal/mediatype"
)

const (
	maxMultipartSections = 1000
	// MultipartReader's defaults in ASP.NET.
	maxSectionHeaders     = 16
	maxSectionHeaderBytes = 16 << 10
	maxSectionBodyBytes   = 128 << 20
)

var (
	errTooLarge  = errors.New("upload: body over the cap")
	errMalformed = errors.New("upload: malformed multipart body")
)

// upload is UploadEndpoint: the first file part named "file" is spooled to
// a 0600 temporary file, every other part is read and dropped, and the cap
// counts the whole request body, framing included.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	max := s.options.MaxUploadBytes
	if r.ContentLength > max {
		writeText(w, http.StatusRequestEntityTooLarge, "file too large\n")
		return
	}
	boundary, ok := mediatype.Boundary(firstValue(r.Header, "Content-Type"))
	if !ok {
		writeText(w, http.StatusBadRequest, "malformed upload\n")
		return
	}
	body := &cappedReader{r: r.Body, remaining: max}
	spool, fileName, mimeType, err := readUpload(r.Context(), body, boundary)
	if spool != nil {
		defer func() {
			_ = spool.Close()
			_ = os.Remove(spool.Name())
		}()
	}
	switch {
	case errors.Is(err, errTooLarge):
		writeText(w, http.StatusRequestEntityTooLarge, "file too large\n")
		return
	case r.Context().Err() != nil:
		return
	case err != nil:
		writeText(w, http.StatusBadRequest, "malformed upload\n")
		return
	case spool == nil:
		writeText(w, http.StatusBadRequest, "missing file field\n")
		return
	}
	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		writeText(w, http.StatusBadGateway, "upload failed\n")
		return
	}
	counted := &countingReader{r: spool}
	store, err := s.blobStore()
	var url string
	if err == nil {
		url, err = store.Put(r.Context(), blob.NormalizeExtension(blob.Extension(fileName)), mimeType, counted)
	}
	if err != nil {
		if r.Context().Err() == nil {
			writeText(w, http.StatusBadGateway, "upload failed\n")
		}
		return
	}
	uploadResponse(w, url, fileName, counted.max, mimeType)
}

func readUpload(ctx context.Context, body *cappedReader, boundary string) (spool *os.File, fileName, mimeType string, err error) {
	bufferSize := len(boundary) + 8
	if bufferSize < 4096 {
		bufferSize = 4096
	}
	reader := newMultipartReader(body, boundary, bufferSize)
	for sections := 0; ; {
		part, err := reader.next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return spool, "", "", err
		}
		sections++
		if sections > maxMultipartSections {
			return spool, "", "", errMalformed
		}
		content := io.Reader(part)
		if strings.EqualFold(strings.TrimSpace(part.header("Content-Transfer-Encoding")), "quoted-printable") {
			content = newQuotedPrintableReader(part)
		}
		name, mime, isFile := fileMetadata(part)
		if spool != nil || !isFile {
			if _, err := io.Copy(io.Discard, contextReader{ctx, content}); err != nil {
				return spool, "", "", err
			}
			continue
		}
		var random [16]byte
		_, _ = rand.Read(random[:])
		spool, err = os.OpenFile(filepath.Join(os.TempDir(), ".blok-upload-"+hex.EncodeToString(random[:])),
			os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return nil, "", "", err
		}
		fileName, mimeType = name, mime
		if _, err := io.Copy(spool, contextReader{ctx, content}); err != nil {
			return spool, "", "", err
		}
	}
	if _, err := io.Copy(io.Discard, contextReader{ctx, body}); err != nil {
		return spool, "", "", err
	}
	return spool, fileName, mimeType, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c contextReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}

// cappedReader is BoundedReadStream: once the cap is reached it reads one
// more byte, and that byte existing is errTooLarge. The error sticks: bufio's
// Peek can swallow it when the bytes it already has are enough.
type cappedReader struct {
	r         io.Reader
	remaining int64
	tooLarge  bool
}

func (c *cappedReader) Read(p []byte) (int, error) {
	if c.tooLarge {
		return 0, errTooLarge
	}
	if len(p) == 0 {
		return 0, nil
	}
	if c.remaining == 0 {
		var probe [1]byte
		for {
			n, err := c.r.Read(probe[:])
			if n > 0 {
				c.tooLarge = true
				return 0, errTooLarge
			}
			if err != nil {
				return 0, err
			}
		}
	}
	if int64(len(p)) > c.remaining {
		p = p[:c.remaining]
	}
	n, err := c.r.Read(p)
	c.remaining -= int64(n)
	return n, err
}

// countingReader records how far the store read, as CountingReadStream.
type countingReader struct {
	r   io.Reader
	n   int64
	max int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	if c.n > c.max {
		c.max = c.n
	}
	return n, err
}

// fileMetadata is TryGetFileMetadata: a form-data part named "file" with a
// filename (filename* first).
func fileMetadata(part *multipartPart) (fileName, mimeType string, ok bool) {
	fileName, ok = fileNameFromDisposition(part.header("Content-Disposition"))
	if !ok {
		return "", "", false
	}
	return fileName, mediatype.SanitizeWire(part.header("Content-Type")), true
}

// fileNameFromDisposition is UploadEndpoint.TryReadFileName.
func fileNameFromDisposition(disposition string) (string, bool) {
	dispositionType, params, parsed := mediatypeLikeDisposition(disposition)
	if !parsed || !strings.EqualFold(dispositionType, "form-data") {
		return "", false
	}
	var name, plain, star *string
	for i := range params {
		value := params[i].Value
		switch strings.ToLower(params[i].Name) {
		case "name":
			if name == nil {
				name = &value
			}
		case "filename":
			if plain == nil {
				plain = &value
			}
		case "filename*":
			if star == nil {
				star = &value
			}
		}
	}
	if name == nil || removeQuotes(*name) != "file" {
		return "", false
	}
	raw, decoded := "", false
	if star != nil {
		raw, decoded = decodeExtendedValue(*star)
	}
	if !decoded {
		if plain == nil {
			return "", false
		}
		raw = *plain
	}
	return sanitizeFileName(unquoteFileName(raw)), true
}

// mediatypeLikeDisposition reads "type; name=value" with the media-type
// parameter grammar, which ContentDispositionHeaderValue shares.
func mediatypeLikeDisposition(value string) (string, []mediatype.Param, bool) {
	value = strings.TrimSpace(value)
	end := strings.IndexByte(value, ';')
	dispositionType := value
	rest := ""
	if end >= 0 {
		dispositionType, rest = strings.TrimSpace(value[:end]), value[end:]
	}
	if dispositionType == "" || strings.ContainsAny(dispositionType, " \t/") {
		return "", nil, false
	}
	_, params, ok := mediatype.Parse("x/y" + rest)
	return dispositionType, params, ok
}

func removeQuotes(value string) string {
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		return value[1 : len(value)-1]
	}
	return value
}

// unquoteFileName drops the quotes and every backslash escape.
func unquoteFileName(value string) string {
	quoted := len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"'
	unquoted := removeQuotes(value)
	if !quoted || !strings.Contains(unquoted, `\`) {
		return unquoted
	}
	var b strings.Builder
	for i := 0; i < len(unquoted); i++ {
		if unquoted[i] == '\\' && i+1 < len(unquoted) {
			i++
		}
		b.WriteByte(unquoted[i])
	}
	return b.String()
}

// sanitizeFileName is UploadWire.SanitizeFileName.
func sanitizeFileName(name string) string {
	if separator := strings.LastIndexAny(name, `/\`); separator >= 0 {
		name = name[separator+1:]
	}
	if name == "." || name == ".." || len(name) > 255 {
		return ""
	}
	return name
}

// multipartReader is ASP.NET's MultipartReader: an optional preamble, then
// parts split on "--boundary", each with up to 16 header lines.
type multipartReader struct {
	r         *bufio.Reader
	dashed    []byte
	delimiter []byte
	started   bool
	done      bool
	current   *multipartPart
}

type multipartPart struct {
	headers map[string][]string
	reader  *multipartReader
	ended   bool
	read    int64
}

func newMultipartReader(r io.Reader, boundary string, bufferSize int) *multipartReader {
	return &multipartReader{
		r:         bufio.NewReaderSize(r, bufferSize),
		dashed:    []byte("--" + boundary),
		delimiter: []byte("\r\n--" + boundary),
	}
}

func (m *multipartReader) next() (*multipartPart, error) {
	if m.done {
		return nil, io.EOF
	}
	if m.current != nil {
		if _, err := io.Copy(io.Discard, m.current); err != nil {
			return nil, err
		}
	} else if !m.started {
		if err := m.skipPreamble(); err != nil {
			return nil, err
		}
	}
	m.started = true
	// After a boundary: "--" ends the body, else optional space then CRLF.
	if peek, _ := m.r.Peek(2); bytes.Equal(peek, []byte("--")) {
		_, _ = m.r.Discard(2)
		m.done = true
		return nil, io.EOF
	}
	line, err := m.readLine(maxSectionHeaderBytes)
	if err != nil {
		return nil, err
	}
	if strings.Trim(line, " \t") != "" {
		return nil, errMalformed
	}
	part := &multipartPart{headers: map[string][]string{}, reader: m}
	total := 0
	for count := 0; ; count++ {
		line, err := m.readLine(maxSectionHeaderBytes - total)
		if err != nil {
			return nil, err
		}
		total += len(line) + 2
		if line == "" {
			break
		}
		if count >= maxSectionHeaders {
			return nil, errMalformed
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, errMalformed
		}
		key := http.CanonicalHeaderKey(strings.TrimSpace(name))
		part.headers[key] = append(part.headers[key], strings.TrimSpace(value))
	}
	m.current = part
	return part, nil
}

// skipPreamble reads to the first "--boundary"; it needs no CRLF before it.
func (m *multipartReader) skipPreamble() error {
	for {
		peek, err := m.r.Peek(len(m.dashed))
		if bytes.Equal(peek, m.dashed) {
			_, _ = m.r.Discard(len(m.dashed))
			return nil
		}
		buffered, _ := m.r.Peek(m.r.Buffered())
		if i := bytes.Index(buffered, m.delimiter); i >= 0 {
			_, _ = m.r.Discard(i + len(m.delimiter))
			return nil
		}
		if err != nil {
			return errMalformed
		}
		keep := len(m.delimiter) - 1
		if len(buffered) > keep {
			_, _ = m.r.Discard(len(buffered) - keep)
		} else if _, err := m.r.Peek(len(buffered) + 1); err != nil {
			return errMalformed
		}
	}
}

func (m *multipartReader) readLine(limit int) (string, error) {
	var line []byte
	for {
		c, err := m.r.ReadByte()
		if err != nil {
			if errors.Is(err, errTooLarge) {
				return "", err
			}
			return "", errMalformed
		}
		if c == '\n' && len(line) > 0 && line[len(line)-1] == '\r' {
			return string(line[:len(line)-1]), nil
		}
		line = append(line, c)
		if len(line) > limit {
			return "", errMalformed
		}
	}
}

func (p *multipartPart) header(name string) string {
	if values := p.headers[http.CanonicalHeaderKey(name)]; len(values) > 0 {
		return values[0]
	}
	return ""
}

// Read returns body bytes up to the next "\r\n--boundary".
func (p *multipartPart) Read(b []byte) (int, error) {
	if p.ended {
		return 0, io.EOF
	}
	m := p.reader
	peek, err := m.r.Peek(m.r.Size())
	if i := bytes.Index(peek, m.delimiter); i >= 0 {
		if i == 0 {
			_, _ = m.r.Discard(len(m.delimiter))
			p.ended = true
			return 0, io.EOF
		}
		return p.take(b, i)
	}
	if err != nil && len(peek) < m.r.Size() {
		if errors.Is(err, errTooLarge) {
			return 0, err
		}
		if len(peek) == 0 || err != io.EOF {
			return 0, errMalformed
		}
		// The body ended without a closing boundary.
		safe := len(peek) - (len(m.delimiter) - 1)
		if safe <= 0 {
			return 0, errMalformed
		}
		return p.take(b, safe)
	}
	safe := len(peek) - (len(m.delimiter) - 1)
	return p.take(b, safe)
}

func (p *multipartPart) take(b []byte, available int) (int, error) {
	if available > len(b) {
		available = len(b)
	}
	n, _ := p.reader.r.Read(b[:available])
	p.read += int64(n)
	if p.read > maxSectionBodyBytes {
		return n, errMalformed
	}
	return n, nil
}

func isHexDigitByte(c byte) (byte, bool) {
	switch {
	case '0' <= c && c <= '9':
		return c - '0', true
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10, true
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}

// quotedPrintableReader is the C# strict decoder: lines of at most 4096
// bytes, "=XX" in either case, soft breaks only before a line end, and no
// unescaped control bytes.
type quotedPrintableReader struct {
	r       *bufio.Reader
	decoded []byte
	err     error
	eof     bool
}

const maxQuotedPrintableLine = 4096

func newQuotedPrintableReader(r io.Reader) *quotedPrintableReader {
	return &quotedPrintableReader{r: bufio.NewReaderSize(r, maxQuotedPrintableLine)}
}

func (q *quotedPrintableReader) Read(p []byte) (int, error) {
	for len(q.decoded) == 0 {
		if q.err != nil {
			return 0, q.err
		}
		if q.eof {
			return 0, io.EOF
		}
		q.fill()
	}
	n := copy(p, q.decoded)
	q.decoded = q.decoded[n:]
	return n, nil
}

func (q *quotedPrintableReader) fill() {
	var line []byte
	for {
		c, err := q.r.ReadByte()
		if err != nil {
			if err != io.EOF {
				q.err = err
				return
			}
			q.eof = true
			break
		}
		line = append(line, c)
		if c == '\n' {
			break
		}
		if len(line) == maxQuotedPrintableLine {
			q.err = errMalformed
			break
		}
	}
	if len(line) == 0 {
		return
	}
	hasLineFeed := line[len(line)-1] == '\n'
	hasCarriageReturn := hasLineFeed && len(line) >= 2 && line[len(line)-2] == '\r'
	content := len(line)
	for content > 0 && strings.IndexByte("\n\r \t", line[content-1]) >= 0 {
		content--
	}
	appendLineEnding := hasLineFeed
	if content > 0 && line[content-1] == '=' {
		suffix := content
		for suffix < len(line) && (line[suffix] == ' ' || line[suffix] == '\t') {
			suffix++
		}
		content--
		appendLineEnding = false
		startsLineEnding := suffix < len(line) &&
			(line[suffix] == '\n' || line[suffix] == '\r' && suffix+1 < len(line) && line[suffix+1] == '\n')
		if !startsLineEnding && q.err == nil {
			q.err = errMalformed
		}
	}
	for i := 0; i < content; i++ {
		c := line[i]
		if c == '=' && i+2 < content {
			if hi, ok := isHexDigitByte(line[i+1]); ok {
				if lo, ok := isHexDigitByte(line[i+2]); ok {
					q.decoded = append(q.decoded, hi<<4|lo)
					i += 2
					continue
				}
			}
		}
		if c == '=' || c != '\t' && c != '\r' && c != '\n' && c < 0x80 && (c < ' ' || c > '~') {
			if q.err == nil {
				q.err = errMalformed
			}
			break
		}
		q.decoded = append(q.decoded, c)
	}
	if appendLineEnding {
		if hasCarriageReturn {
			q.decoded = append(q.decoded, '\r')
		}
		q.decoded = append(q.decoded, '\n')
	}
}
