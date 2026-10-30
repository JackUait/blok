package blokserver

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/blob"
)

const maxRanges = 16

// contentTypeFor looks the extension up case-insensitively, as ASP.NET's
// provider does, and falls back to application/octet-stream.
func contentTypeFor(name string) string {
	if t, ok := contentTypes[strings.ToLower(blob.Extension(name))]; ok {
		return t
	}
	return "application/octet-stream"
}

type byteRange struct{ start, length int64 }

func (b byteRange) contentRange(size int64) string {
	return "bytes " + strconv.FormatInt(b.start, 10) + "-" + strconv.FormatInt(b.start+b.length-1, 10) + "/" + strconv.FormatInt(size, 10)
}

// serveFile is the C# LocalFileEndpoint's own port of Go's ServeContent
// rules, not ServeContent itself: no sniffing, no ETags, a 16-range cap.
func serveFile(w http.ResponseWriter, r *http.Request, file *os.File, size int64, modified time.Time, contentType string) {
	h := w.Header()
	h.Set("Content-Disposition", "attachment")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Last-Modified", modified.Format(http.TimeFormat))
	if status := preconditions(r, modified); status != 0 {
		w.WriteHeader(status)
		return
	}
	h.Set("Content-Type", contentType)
	rangeHeader := strings.Join(r.Header.Values("Range"), ",")
	if rangeHeader != "" && !ifRangeMatches(r, modified) {
		rangeHeader = ""
	}
	head := strings.EqualFold(r.Method, http.MethodHead)
	whole := func() {
		h.Set("Accept-Ranges", "bytes")
		writeLength(w, size)
		w.WriteHeader(http.StatusOK)
		if !head {
			_, _ = io.Copy(w, file)
		}
	}
	if rangeHeader == "" {
		whole()
		return
	}
	ranges, rangeError := parseRanges(rangeHeader, size)
	if rangeError != "" {
		if size == 0 && rangeError == "invalid range: failed to overlap" {
			whole()
			return
		}
		body := rangeError + "\n"
		h.Del("Accept-Ranges")
		h.Del("Last-Modified")
		h.Set("Content-Type", "text/plain; charset=utf-8")
		writeLength(w, int64(len(body)))
		if rangeError == "invalid range: failed to overlap" {
			h.Set("Content-Range", "bytes */"+strconv.FormatInt(size, 10))
		}
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		if !head {
			_, _ = io.WriteString(w, body)
		}
		return
	}
	var selected int64
	for _, b := range ranges {
		if selected > size-b.length {
			ranges = nil
			break
		}
		selected += b.length
	}
	switch len(ranges) {
	case 0:
		whole()
	case 1:
		h.Set("Accept-Ranges", "bytes")
		h.Set("Content-Range", ranges[0].contentRange(size))
		writeLength(w, ranges[0].length)
		w.WriteHeader(http.StatusPartialContent)
		if !head {
			_, _ = io.Copy(w, io.NewSectionReader(file, ranges[0].start, ranges[0].length))
		}
	default:
		var random [16]byte
		_, _ = rand.Read(random[:])
		boundary := hex.EncodeToString(random[:])
		headers := make([]string, len(ranges))
		var length int64
		for i, b := range ranges {
			headers[i] = "--" + boundary + "\r\nContent-Range: " + b.contentRange(size) + "\r\nContent-Type: " + contentType + "\r\n\r\n"
			length += int64(len(headers[i])) + b.length + 2
		}
		closing := "--" + boundary + "--\r\n"
		length += int64(len(closing))
		h.Set("Content-Type", "multipart/byteranges; boundary="+boundary)
		h.Set("Accept-Ranges", "bytes")
		writeLength(w, length)
		w.WriteHeader(http.StatusPartialContent)
		if head {
			return
		}
		for i, b := range ranges {
			_, _ = io.WriteString(w, headers[i])
			_, _ = io.Copy(w, io.NewSectionReader(file, b.start, b.length))
			_, _ = io.WriteString(w, "\r\n")
		}
		_, _ = io.WriteString(w, closing)
	}
}

// preconditions returns 412 or 304 when the request's validators say so.
func preconditions(r *http.Request, modified time.Time) int {
	if ifMatch := strings.Join(r.Header.Values("If-Match"), ","); ifMatch != "" {
		if !hasWildcardTag(ifMatch) {
			return http.StatusPreconditionFailed
		}
	} else if since, ok := parseHTTPDate(r.Header.Get("If-Unmodified-Since")); ok && modified.After(since) {
		return http.StatusPreconditionFailed
	}
	if ifNoneMatch := strings.Join(r.Header.Values("If-None-Match"), ","); ifNoneMatch != "" {
		if hasWildcardTag(ifNoneMatch) {
			return http.StatusNotModified
		}
		return 0
	}
	if since, ok := parseHTTPDate(r.Header.Get("If-Modified-Since")); ok && !modified.After(since) {
		return http.StatusNotModified
	}
	return 0
}

func hasWildcardTag(value string) bool {
	for _, candidate := range strings.Split(value, ",") {
		if strings.TrimSpace(candidate) == "*" {
			return true
		}
	}
	return false
}

func ifRangeMatches(r *http.Request, modified time.Time) bool {
	value := r.Header.Get("If-Range")
	if value == "" {
		return true
	}
	date, ok := parseHTTPDate(value)
	return ok && date.Equal(modified)
}

// parseHTTPDate stands in for HeaderUtilities.TryParseDate; which formats
// .NET accepts beyond these three is UNVERIFIED.
func parseHTTPDate(value string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	t, err := http.ParseTime(value)
	return t, err == nil
}

func parseRanges(header string, size int64) ([]byteRange, string) {
	if !strings.HasPrefix(header, "bytes=") {
		return nil, "invalid range"
	}
	if strings.Count(header[6:], ",")+1 > maxRanges {
		return nil, "too many ranges"
	}
	var ranges []byteRange
	noOverlap := false
	for _, value := range strings.Split(header[6:], ",") {
		spec := strings.TrimSpace(value)
		if spec == "" {
			continue
		}
		separator := strings.IndexByte(spec, '-')
		if separator < 0 {
			return nil, "invalid range"
		}
		startText, endText := strings.TrimSpace(spec[:separator]), strings.TrimSpace(spec[separator+1:])
		if startText == "" {
			suffix, ok := parseRangeNumber(endText)
			if endText == "" || endText[0] == '-' || !ok {
				return nil, "invalid range"
			}
			if suffix > size {
				suffix = size
			}
			if suffix == 0 {
				noOverlap = true
				continue
			}
			ranges = append(ranges, byteRange{size - suffix, suffix})
			continue
		}
		start, ok := parseRangeNumber(startText)
		if !ok {
			return nil, "invalid range"
		}
		if start >= size {
			noOverlap = true
			continue
		}
		if endText == "" {
			ranges = append(ranges, byteRange{start, size - start})
			continue
		}
		end, ok := parseRangeNumber(endText)
		if !ok || start > end {
			return nil, "invalid range"
		}
		if end > size-1 {
			end = size - 1
		}
		ranges = append(ranges, byteRange{start, end - start + 1})
	}
	if noOverlap && len(ranges) == 0 {
		return nil, "invalid range: failed to overlap"
	}
	return ranges, ""
}

// parseRangeNumber is long.TryParse with a leading sign allowed, then >= 0.
func parseRangeNumber(value string) (int64, bool) {
	n, err := strconv.ParseInt(value, 10, 64)
	return n, err == nil && n >= 0
}
