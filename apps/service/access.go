package cloud

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// Only explicitly trusted network peers can supply forwarded client IPs.
// Walk from the closest hop towards the client, stopping at the first
// untrusted address, so a caller cannot choose their own rate-limit key.
func (s *Service) clientIP(r *http.Request) string {
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		host = r.RemoteAddr
	}
	peer, e := netip.ParseAddr(host)
	if e != nil {
		return host
	}
	trusted := func(ip netip.Addr) bool {
		for _, raw := range s.Config.TrustedProxyCIDRs {
			p, e := netip.ParsePrefix(strings.TrimSpace(raw))
			if e == nil && p.Contains(ip.Unmap()) {
				return true
			}
		}
		return false
	}
	if !trusted(peer) {
		return peer.String()
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		ip, e := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if e != nil {
			return peer.String()
		}
		peer = ip
		if !trusted(ip) {
			return ip.String()
		}
	}
	return peer.String()
}
func (s *Service) startAccessSweep() {
	ctx, cancel := context.WithCancel(context.Background())
	s.accessCancel = cancel
	s.accessDone = make(chan struct{})
	go func() {
		defer close(s.accessDone)
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				s.recheckObserved(ctx)
			}
		}
	}()
}
func (s *Service) stopAccessSweep() {
	if s.accessCancel != nil {
		s.accessCancel()
		<-s.accessDone
	}
}
func (s *Service) observeDocument(doc string) func() {
	s.observedMu.Lock()
	s.observed[doc]++
	s.observedMu.Unlock()
	return func() {
		s.observedMu.Lock()
		s.observed[doc]--
		if s.observed[doc] <= 0 {
			delete(s.observed, doc)
		}
		s.observedMu.Unlock()
	}
}
func (s *Service) isObserved(doc string) bool {
	s.observedMu.Lock()
	defer s.observedMu.Unlock()
	return s.observed[doc] > 0
}
func (s *Service) recheckObserved(ctx context.Context) {
	s.observedMu.Lock()
	docs := make([]string, 0, len(s.observed))
	for doc := range s.observed {
		docs = append(docs, doc)
	}
	s.observedMu.Unlock()
	for _, doc := range docs {
		if ctx.Err() != nil {
			return
		}
		s.recheckDocument(ctx, doc)
	}
}
func (s *Service) recheckDocument(ctx context.Context, doc string) {
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, e := s.Blok.RecheckAccess(bounded, doc); e != nil && ctx.Err() == nil {
		slog.Error("collaboration access recheck failed", "document", doc, "error", e)
	}
}
func (s *Service) recheckWorkspace(ctx context.Context, workspace string) {
	rows, e := s.DB.Query(ctx, "SELECT id FROM pages WHERE workspace_id=$1", workspace)
	if e != nil {
		slog.Error("access recheck query failed", "error", e)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		if s.isObserved(id) {
			s.recheckDocument(ctx, id)
		}
	}
}
