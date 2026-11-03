package framecheck

import "github.com/JackUait/blok/packages/server/go/internal/dotnet"

// Request is what Embedder reads from a frame-check request.
type Request struct {
	// Origin is the Origin header; HasOrigin says whether one was sent.
	Origin    string
	HasOrigin bool
	// SecFetchSite is the Sec-Fetch-Site header, or "".
	SecFetchSite string
	// Embedder is the embedder query value, or "".
	Embedder string
	// Self is scheme://Host of the request, or "" with no Host.
	Self string
}

// Embedder is C#'s FrameCheckEmbedder.Choose: the origin to rate a page for,
// or "" for none. A sent Origin decides alone. Without one, the embedder
// query value counts when the browser says the request is same-origin and
// the value is this server's own origin, or when it is an allowed origin.
// Never trust the value alone: any page could then learn framing policies
// for any site. frame-check-embedders.json pins both servers.
func Embedder(r Request, allowed func(string) bool) string {
	if r.HasOrigin {
		if allowed(r.Origin) {
			return r.Origin
		}
		return ""
	}
	// Pages cannot set Sec-Fetch-Site, so a browser page reaches this only
	// from the server's own origin.
	if r.Self != "" && dotnet.EqualsOrdinalIgnoreCase(r.SecFetchSite, "same-origin") &&
		dotnet.EqualsOrdinalIgnoreCase(r.Embedder, r.Self) {
		return r.Embedder
	}
	if allowed(r.Embedder) {
		return r.Embedder
	}
	return ""
}
