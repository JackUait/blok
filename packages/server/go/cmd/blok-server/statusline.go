package main

import (
	"bytes"
	"net/http"
)

// answerKind says how the next status line net/http writes on a connection
// is rewritten into Kestrel's.
type answerKind int

const (
	// noAnswer: write as sent. Between requests and after a hijack.
	noAnswer answerKind = iota
	answerHTTP11
	answerHTTP10
)

func answerFor(r *http.Request) answerKind {
	if r.ProtoMajor == 1 && r.ProtoMinor == 0 {
		return answerHTTP10
	}
	return answerHTTP11
}

// Kestrel's reason phrases where net/http's differ, measured on the C# host.
var kestrelPhrases = map[string]string{
	"413": "Payload Too Large",
	"416": "Range Not Satisfiable",
}

func (c *headerConn) setAnswer(kind answerKind) {
	c.mu.Lock()
	c.answer = kind
	c.mu.Unlock()
}

// Write rewrites the first status line net/http writes for a request:
// Kestrel's reason phrase, and for HTTP/1.0 an HTTP/1.1 line plus
// Connection: close when net/http will close (it says keep-alive when it
// will not). net/http writes a head from the start of one buffer, so the
// line is at the start of a Write. A 1xx head leaves the next one to
// rewrite. Kestrel's own answers and sendfile go around Write.
func (c *headerConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	kind := c.answer
	c.mu.Unlock()
	lineEnd := bytes.Index(p, []byte("\r\n"))
	if kind == noAnswer || !bytes.HasPrefix(p, []byte("HTTP/1.")) || lineEnd < len("HTTP/1.x 200") {
		return c.Conn.Write(p)
	}
	code := string(p[9:12])
	if code[0] == '1' {
		return c.Conn.Write(p)
	}
	c.setAnswer(noAnswer)
	line := p[:lineEnd]
	if phrase, ok := kestrelPhrases[code]; ok {
		line = []byte("HTTP/1.x " + code + " " + phrase)
		copy(line, p[:8])
	}
	var connection []byte
	if kind == answerHTTP10 {
		line = append([]byte("HTTP/1.1"), line[8:]...)
		// Without the head's end in this buffer, leave the head as it is.
		if head, _, ok := bytes.Cut(p, []byte("\r\n\r\n")); ok && !hasConnectionLine(head) {
			connection = []byte("\r\nConnection: close")
		}
	}
	rewritten := make([]byte, 0, len(p)+len(line)+len(connection))
	rewritten = append(append(append(rewritten, line...), connection...), p[lineEnd:]...)
	if _, err := c.Conn.Write(rewritten); err != nil {
		return 0, err
	}
	return len(p), nil
}

func hasConnectionLine(head []byte) bool {
	for _, line := range bytes.Split(head, []byte("\r\n"))[1:] {
		if name, _, ok := bytes.Cut(line, []byte(":")); ok && bytes.EqualFold(name, []byte("Connection")) {
			return true
		}
	}
	return false
}
