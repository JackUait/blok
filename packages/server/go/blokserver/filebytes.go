package blokserver

import (
	"bytes"
	"container/list"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/blob"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
)

// The PDF check: "%PDF-" within a file's first pdfCheckBytes bytes, on every
// request. A final URL that passed is trusted for pdfCheckTTL.
const (
	pdfCheckBytes   = 1024
	pdfCheckEntries = 256
	pdfCheckTTL     = 10 * time.Minute
)

// fileBytesAnswerBytes caps one answer, which is read whole before it is
// written. A larger answer is refused 413: ask for a Range. The editor reads
// in chunks of at most this size.
const fileBytesAnswerBytes = 1 << 20

var pdfMagic = []byte("%PDF-")

// pdfCheckCache holds final URLs (after redirects) that passed the check,
// least recently used first out. Keyed by the final URL, so a redirect
// that later points somewhere else is checked again.
type pdfCheckCache struct {
	mu      sync.Mutex
	now     func() time.Time
	order   *list.List
	entries map[string]*list.Element
}

type pdfCheck struct {
	url string
	at  time.Time
}

func newPDFCheckCache(now func() time.Time) *pdfCheckCache {
	return &pdfCheckCache{now: now, order: list.New(), entries: map[string]*list.Element{}}
}

func (c *pdfCheckCache) has(url string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[url]
	if !ok {
		return false
	}
	if c.now().Sub(element.Value.(*pdfCheck).at) >= pdfCheckTTL {
		c.order.Remove(element)
		delete(c.entries, url)
		return false
	}
	c.order.MoveToFront(element)
	return true
}

func (c *pdfCheckCache) add(url string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if element, ok := c.entries[url]; ok {
		element.Value.(*pdfCheck).at = c.now()
		c.order.MoveToFront(element)
		return
	}
	c.entries[url] = c.order.PushFront(&pdfCheck{url: url, at: c.now()})
	if c.order.Len() > pdfCheckEntries {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.entries, oldest.Value.(*pdfCheck).url)
	}
}

// fileBytes is GET /file-bytes?url=: a PDF's bytes for the editor's
// preview, one Range at a time. The server's own stored files are read
// from the store; anything else is fetched.
func (s *Server) fileBytes(w http.ResponseWriter, r *http.Request) {
	target := dotnet.QueryFirst(r.URL.RawQuery, "url")
	if target == "" {
		writeText(w, http.StatusBadRequest, "expected ?url=...\n")
		return
	}
	byteRange := requestedRange(r.Header)
	// The same match Local.Delete makes: stored URLs are PublicURL + key.
	if s.options.StorageDirectory != "" && s.options.S3Bucket == "" {
		if key, ok := blob.KeyFromPublicURL(s.options.PublicURL, target); ok {
			s.serveStoredPDF(w, key, byteRange)
			return
		}
	}
	s.serveRemotePDF(w, r, target, byteRange)
}

// requestedRange is the one Range forwarded: "bytes=a-b" or "bytes=a-".
// Anything else is ignored and the whole file is served.
func requestedRange(h http.Header) *outbound.ByteRange {
	values := h.Values("Range")
	if len(values) != 1 {
		return nil
	}
	spec, ok := strings.CutPrefix(values[0], "bytes=")
	if !ok {
		return nil
	}
	startText, endText, ok := strings.Cut(spec, "-")
	start, startOK := parseDigits(startText)
	if !ok || !startOK {
		return nil
	}
	if endText == "" {
		return &outbound.ByteRange{Start: start, End: -1}
	}
	end, endOK := parseDigits(endText)
	if !endOK || end < start {
		return nil
	}
	return &outbound.ByteRange{Start: start, End: end}
}

// parseDigits reads ASCII digits only: no sign, no space.
func parseDigits(text string) (int64, bool) {
	if text == "" || strings.Trim(text, "0123456789") != "" {
		return 0, false
	}
	n, err := strconv.ParseInt(text, 10, 64)
	return n, err == nil
}

func (s *Server) serveStoredPDF(w http.ResponseWriter, key string, byteRange *outbound.ByteRange) {
	file, err := os.Open(filepath.Join(s.options.StorageDirectory, key))
	if err != nil {
		writeText(w, http.StatusNotFound, "not found\n")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		writeText(w, http.StatusNotFound, "not found\n")
		return
	}
	size := info.Size()
	if size > s.options.FileBytesMaxBytes {
		writeText(w, http.StatusRequestEntityTooLarge, "file too large\n")
		return
	}
	head := make([]byte, pdfCheckBytes)
	n, _ := file.ReadAt(head, 0)
	if !bytes.Contains(head[:n], pdfMagic) {
		writeText(w, http.StatusUnsupportedMediaType, "not a pdf\n")
		return
	}
	status, start, length := http.StatusOK, int64(0), size
	if byteRange != nil {
		if byteRange.Start >= size {
			w.Header().Set("Content-Range", "bytes */"+strconv.FormatInt(size, 10))
			writeText(w, http.StatusRequestedRangeNotSatisfiable, "range not satisfiable\n")
			return
		}
		end := size - 1
		if byteRange.End >= 0 && byteRange.End < end {
			end = byteRange.End
		}
		status, start, length = http.StatusPartialContent, byteRange.Start, end-byteRange.Start+1
	}
	// The same cap as a fetched answer, so both sources behave alike.
	if length > fileBytesAnswerBytes {
		writeText(w, http.StatusRequestEntityTooLarge, "range too large\n")
		return
	}
	writePDFHead(w, status, start, length, size)
	_, _ = io.Copy(w, io.NewSectionReader(file, start, length))
}

func (s *Server) serveRemotePDF(w http.ResponseWriter, r *http.Request, target string, byteRange *outbound.ByteRange) {
	failed := func() {
		if r.Context().Err() == nil {
			writeText(w, http.StatusBadGateway, "the URL could not be fetched\n")
		}
	}
	response, err := s.fetcher.Get(r.Context(), target, outbound.Limits{
		Timeout: 2 * time.Minute, MaxBytes: fileBytesAnswerBytes, MaxRedirects: 5, Hop: s.hopBudget(r),
		Caller: s.fetchCaller(r), Upload: true, Range: byteRange,
	})
	if outbound.IsFailure(err, outbound.TooLarge) {
		writeText(w, http.StatusRequestEntityTooLarge, "range too large\n")
		return
	}
	if err != nil {
		failed()
		return
	}
	// Read whole first and freed before any write: a client that stops
	// reading must never hold a shared fetch slot.
	response.Release()
	start, total, ok := upstreamExtent(response)
	if !ok || response.StatusCode < 200 || response.StatusCode > 299 || encoded(response.Header) {
		failed()
		return
	}
	if total > s.options.FileBytesMaxBytes {
		writeText(w, http.StatusRequestEntityTooLarge, "file too large\n")
		return
	}
	if !s.pdfChecks.has(response.FinalURL) {
		if start != 0 || !bytes.Contains(response.Body[:min(len(response.Body), pdfCheckBytes)], pdfMagic) {
			// A second fetch, charged like a redirect hop.
			if !s.hopBudget(r)() {
				writeText(w, http.StatusTooManyRequests, "rate limit exceeded\n")
				return
			}
			pdf, err := s.probePDF(r, response.FinalURL)
			if err != nil {
				failed()
				return
			}
			if !pdf {
				writeText(w, http.StatusUnsupportedMediaType, "not a pdf\n")
				return
			}
		}
		s.pdfChecks.add(response.FinalURL)
	}
	status := http.StatusOK
	if response.StatusCode == http.StatusPartialContent {
		status = http.StatusPartialContent
	}
	writePDFHead(w, status, start, int64(len(response.Body)), total)
	_, _ = w.Write(response.Body)
}

// probePDF reads the first pdfCheckBytes of url.
func (s *Server) probePDF(r *http.Request, url string) (bool, error) {
	probe, err := s.fetcher.Get(r.Context(), url, outbound.Limits{
		Timeout: 10 * time.Second, MaxBytes: pdfCheckBytes, Truncate: true, MaxRedirects: 5,
		Hop: s.hopBudget(r), Caller: s.fetchCaller(r), Range: &outbound.ByteRange{Start: 0, End: pdfCheckBytes - 1},
	})
	if err != nil {
		return false, err
	}
	defer probe.Release()
	if probe.StatusCode < 200 || probe.StatusCode > 299 || encoded(probe.Header) {
		return false, errProbeFailed
	}
	return bytes.Contains(probe.Body, pdfMagic), nil
}

var errProbeFailed = errors.New("the PDF check fetch failed")

// encoded is any Content-Encoding but identity: decoding would move every
// byte offset a Range names.
func encoded(h http.Header) bool {
	for _, line := range h.Values("Content-Encoding") {
		for _, token := range strings.Split(line, ",") {
			if token = strings.TrimSpace(token); token != "" && !strings.EqualFold(token, "identity") {
				return true
			}
		}
	}
	return false
}

// upstreamExtent reads where the body sits in the file: a 206's
// Content-Range, which must match the body, else the whole file. total -1
// is unknown.
func upstreamExtent(response *outbound.Response) (start, total int64, ok bool) {
	length := int64(len(response.Body))
	if response.StatusCode != http.StatusPartialContent {
		return 0, length, true
	}
	spec, found := strings.CutPrefix(response.Header.Get("Content-Range"), "bytes ")
	span, totalText, slash := strings.Cut(spec, "/")
	startText, endText, dash := strings.Cut(span, "-")
	start, startOK := parseDigits(startText)
	end, endOK := parseDigits(endText)
	if !found || !slash || !dash || !startOK || !endOK || end < start || end-start+1 != length {
		return 0, 0, false
	}
	total = -1
	if totalText != "*" {
		parsed, totalOK := parseDigits(totalText)
		if !totalOK || end >= parsed {
			return 0, 0, false
		}
		total = parsed
	}
	return start, total, true
}

// writePDFHead writes the headers every PDF answer carries. total -1 is
// an unknown size.
func writePDFHead(w http.ResponseWriter, status int, start, length, total int64) {
	h := w.Header()
	h.Set("Content-Type", "application/pdf")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox")
	h.Set("Accept-Ranges", "bytes")
	h.Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range")
	// Set, not Add: one line over the guard's "Vary: Origin".
	h.Set("Vary", "Origin, Authorization")
	h.Set("Cache-Control", "private, max-age=300")
	writeLength(w, length)
	if status == http.StatusPartialContent {
		size := "*"
		if total >= 0 {
			size = strconv.FormatInt(total, 10)
		}
		h.Set("Content-Range", "bytes "+strconv.FormatInt(start, 10)+"-"+strconv.FormatInt(start+length-1, 10)+"/"+size)
	}
	w.WriteHeader(status)
}

// filesCORS lets an allowed origin read a stored file, when FilesCORS is on.
func (s *Server) filesCORS(w http.ResponseWriter, r *http.Request) {
	if !s.options.FilesCORS {
		return
	}
	h := w.Header()
	h.Add("Vary", "Origin")
	if origin := requestOrigin(r); s.originAllowed(origin) {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range")
	}
}
