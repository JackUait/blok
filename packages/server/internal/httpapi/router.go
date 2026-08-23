package httpapi

import "net/http"

// Options carries everything the HTTP layer needs. Later tasks add fields;
// they are all optional so tests can construct a server with only what they use.
type Options struct {
	Version string
}

type server struct {
	opts Options
	mux  *http.ServeMux
}

func New(opts Options) http.Handler {
	s := &server{opts: opts, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /health", s.handleHealth)

	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}
