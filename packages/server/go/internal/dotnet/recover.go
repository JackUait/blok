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
// As in Kestrel, a status is held until the first write or flush, or the
// handler's return: a panic before then is still a 500, and the host's
// deadline still answers 504.
func RecoverLikeKestrel(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		watched := &startWriter{ResponseWriter: w}
		defer func() {
			if failure := recover(); failure == nil {
				watched.commit()
				return
			}
			if watched.refuse() {
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
	// held is the status WriteHeader set and nothing has sent yet.
	held int
}

// commit sends a held status and marks the answer started.
func (s *startWriter) commit() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.commitLocked()
}

func (s *startWriter) commitLocked() {
	if s.started || s.hijacked {
		return
	}
	s.started = true
	if s.held != 0 {
		s.ResponseWriter.WriteHeader(s.held)
	}
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

// WriteHeader holds a final status; the first one wins, as in net/http.
// An informational one goes out at once.
func (s *startWriter) WriteHeader(status int) {
	if status < 200 {
		s.ResponseWriter.WriteHeader(status)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started || s.hijacked {
		s.ResponseWriter.WriteHeader(status)
		return
	}
	if s.held == 0 {
		s.held = status
	}
}

func (s *startWriter) Write(b []byte) (int, error) {
	s.commit()
	return s.ResponseWriter.Write(b)
}

func (s *startWriter) FlushError() error {
	s.commit()
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
