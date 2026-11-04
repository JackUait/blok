package synchttp

import "testing"

const disallowedOrigin = "https://evil.example.net"

func TestTicketModeRequiresAnAllowedOriginOnTheUpgrade(t *testing.T) {
	for _, origin := range []string{disallowedOrigin, ""} {
		h := startEndpoint(t, ticketMode, nil)
		headers := []string{"Sec-WebSocket-Protocol", "blok-sync.v1, " + writeTicket}
		if origin != "" {
			headers = append(headers, "Origin", origin)
		}
		client := h.dial(t, "/sync/doc-42", headers...)
		if client.response.StatusCode != 403 || client.body != "origin not allowed\n" {
			t.Fatalf("origin %q: %d %q", origin, client.response.StatusCode, client.body)
		}
		if h.rooms.joins() != 0 {
			t.Fatalf("origin %q joined a room", origin)
		}
	}
}

func TestNoAuthModeRejectsAPresentDisallowedOrigin(t *testing.T) {
	h := startEndpoint(t, nil, nil)
	refused := h.dial(t, "/sync/doc-42", "Origin", disallowedOrigin)
	if refused.response.StatusCode != 403 || refused.body != "origin not allowed\n" {
		t.Fatalf("refused: %d %q", refused.response.StatusCode, refused.body)
	}
	allowed := h.dial(t, "/sync/doc-42", "Origin", "https://app.example.com")
	if allowed.response.StatusCode != 101 || allowed.response.Header.Get("Sec-WebSocket-Protocol") != "" {
		t.Fatalf("allowed: %d %q", allowed.response.StatusCode, allowed.response.Header.Get("Sec-WebSocket-Protocol"))
	}
}

// SyncHandshake.Admit asks for an allowed origin when Sec-Fetch-Site is
// cross-site, even with no Origin header.
func TestNoAuthModeRejectsACrossSiteUpgradeWithNoOrigin(t *testing.T) {
	h := startEndpoint(t, nil, nil)
	for _, site := range []string{"cross-site", "Cross-Site"} {
		client := h.dial(t, "/sync/doc-42", "Sec-Fetch-Site", site)
		if client.response.StatusCode != 403 || client.body != "origin not allowed\n" {
			t.Fatalf("%s: %d %q", site, client.response.StatusCode, client.body)
		}
	}
	if same := h.dial(t, "/sync/doc-42", "Sec-Fetch-Site", "same-site"); same.response.StatusCode != 101 {
		t.Fatalf("same-site: %d", same.response.StatusCode)
	}
}
