package dotnet

import (
	"bufio"
	"net"
	"net/http"
	"sync"
	"time"
)

// RecoverLikeKestrel answers a handler panic as Kestrel answers an
// unhandled exception: before the answer started, an empty 500 on a
// connection that stays open; after it, the connection is cut. net/http
// alone would close without a word.
//
// WriteHeader counts as the start: net/http cannot take a status back,
// and the host's deadline reads it the same way.
func RecoverLikeKestrel(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		watched := &startWriter{ResponseWriter: w}
		defer func() {
			if failure := recover(); failure == nil || watched.refuse() {
				return
			}
			// What the handler wrote still goes out before the cut, as
			// Kestrel's pipe sends it.
			_ = http.NewResponseController(w).Flush()
			panic(http.ErrAbortHandler)
		}()
		next.ServeHTTP(watched, r)
	})
}

type startWriter struct {
	http.ResponseWriter
	mu       sync.Mutex
	started  bool
	hijacked bool
}

func (s *startWriter) begin() {
	s.mu.Lock()
	s.started = true
	s.mu.Unlock()
}

// refuse writes Kestrel's empty 500 unless the answer started; it reports
// whether the request is done. Server stays: Kestrel adds it outside the
// response headers, so its 500 carries it.
func (s *startWriter) refuse() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hijacked {
		return true
	}
	if s.started {
		return false
	}
	s.started = true
	live := s.ResponseWriter.Header()
	server := live.Values("Server")
	for name := range live {
		delete(live, name)
	}
	if len(server) > 0 {
		live["Server"] = server
	}
	live.Set("Content-Length", "0")
	// Set here so it sorts before Server, in Kestrel's order.
	live.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	s.ResponseWriter.WriteHeader(http.StatusInternalServerError)
	return true
}

func (s *startWriter) WriteHeader(status int) {
	if status >= 200 {
		s.begin()
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *startWriter) Write(b []byte) (int, error) {
	s.begin()
	return s.ResponseWriter.Write(b)
}

func (s *startWriter) FlushError() error {
	s.begin()
	return http.NewResponseController(s.ResponseWriter).Flush()
}

func (s *startWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, buffered, err := http.NewResponseController(s.ResponseWriter).Hijack()
	if err == nil {
		s.mu.Lock()
		s.hijacked = true
		s.mu.Unlock()
	}
	return conn, buffered, err
}

// Unwrap lets http.ResponseController reach the deadlines and full duplex.
func (s *startWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }
