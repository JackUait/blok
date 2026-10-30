//go:build conformance

package blokserver

import "github.com/JackUait/blok/packages/server/go/internal/outbound"

// UseConformanceOrigin swaps the outbound policy for one that reaches only
// origin, so the conformance suite can unfurl from a loopback fixture. It
// exists only in a binary built with -tags conformance.
func (s *Server) UseConformanceOrigin(origin string, port int) {
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin, Port: port})
}
