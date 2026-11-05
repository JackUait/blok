package synchttp

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/JackUait/blok/packages/server/go/v2/internal/ws"
)

// ErrUpgradeLimit is Kestrel's refusal past MaxConcurrentUpgradedConnections.
var ErrUpgradeLimit = errors.New("synchttp: the server has already opened the maximum number of upgraded connections")

// LimitUpgrades is Kestrel's MaxConcurrentUpgradedConnections: every
// hijacked socket takes a slot until it closes, the ones the sync door
// accepts only to close too. Past max the hijack fails, so the upgrade is
// an empty 500.
func LimitUpgrades(next http.Handler, max int64) http.Handler {
	var open atomic.Int64
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ws.IsWebSocketRequest(r) {
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(&limitedWriter{ResponseWriter: w, open: &open, max: max}, r)
	})
}

type limitedWriter struct {
	http.ResponseWriter
	open *atomic.Int64
	max  int64
}

func (w *limitedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *limitedWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if w.open.Add(1) > w.max {
		w.open.Add(-1)
		return nil, nil, ErrUpgradeLimit
	}
	conn, buffered, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err != nil {
		w.open.Add(-1)
		return nil, nil, err
	}
	return &slotConn{Conn: conn, release: func() { w.open.Add(-1) }}, buffered, nil
}

// slotConn frees its slot on the first Close.
type slotConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *slotConn) Close() error {
	err := c.Conn.Close()
	c.once.Do(c.release)
	return err
}
