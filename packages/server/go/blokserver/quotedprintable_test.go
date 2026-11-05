package blokserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

// uploadQuotedPrintable posts one quoted-printable file part and returns the
// status, the body, and the stored bytes when the upload succeeded.
func uploadQuotedPrintable(t *testing.T, encoded string) (int, string, []byte) {
	t.Helper()
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	body := "--" + testBoundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"encoded.bin\"\r\n" +
		"Content-Transfer-Encoding: quoted-printable\r\n\r\n" + encoded + "\r\n--" + testBoundary + "--\r\n"
	request := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader(body))
	request.Header.Set("Content-Type", "multipart/form-data; boundary="+testBoundary)
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		return recorder.Code, recorder.Body.String(), nil
	}
	var answer struct{ URL string }
	if err := json.Unmarshal(recorder.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(filepath.Join(o.StorageDirectory, path.Base(answer.URL)))
	if err != nil {
		t.Fatal(err)
	}
	return recorder.Code, recorder.Body.String(), stored
}

// Expectations follow QuotedPrintableReadStream in UploadEndpoint.cs.
func TestUploadDecodesQuotedPrintableLikeCSharp(t *testing.T) {
	for _, c := range []struct{ name, encoded, stored string }{
		{"escapes in either case", "=00=ff=FF=0a", "\x00\xff\xff\n"},
		{"soft break", "ab=\r\ncd", "abcd"},
		{"soft break on a bare line feed", "ab=\ncd", "abcd"},
		{"spaces after a soft break", "ab= \t\r\ncd", "abcd"},
		{"hard break keeps CRLF", "ab\r\ncd", "ab\r\ncd"},
		{"hard break keeps a bare line feed", "ab\ncd", "ab\ncd"},
		{"trailing spaces are dropped", "ab \t\r\ncd", "ab\r\ncd"},
		{"bytes over 0x7f pass through", "caf\xc3\xa9", "caf\xc3\xa9"},
		{"tab inside a line", "a\tb", "a\tb"},
		{"longest line", strings.Repeat("a", 4095) + "\n" + "b", strings.Repeat("a", 4095) + "\nb"},
	} {
		status, body, stored := uploadQuotedPrintable(t, c.encoded)
		if status != http.StatusOK || !bytes.Equal(stored, []byte(c.stored)) {
			t.Errorf("%s: got %d %q, stored %q, want %q", c.name, status, body, stored, c.stored)
		}
	}
}

func TestUploadRefusesMalformedQuotedPrintable(t *testing.T) {
	for _, c := range []struct{ name, encoded string }{
		{"a lone equals sign", "="},
		{"a soft break at the end", "a="},
		{"one hex digit", "=A"},
		{"not hex", "=GG"},
		{"bytes after a soft break", "a= x\r\nb"},
		{"a control byte", "a\x01b"},
		{"DEL", "a\x7fb"},
		{"a line over 4096 bytes", strings.Repeat("a", 4096)},
	} {
		status, body, _ := uploadQuotedPrintable(t, c.encoded)
		if status != http.StatusBadRequest || body != "malformed upload\n" {
			t.Errorf("%s: got %d %q", c.name, status, body)
		}
	}
}
