package httpapi

import (
	"net/http"

	"github.com/JackUait/blok/packages/server/internal/unfurl"
)

// The wire shape is fixed by src/tools/link/metadata-fetcher.ts, which reads
// `meta.image?.url` — image is an OBJECT, not a string. Consumers who already
// wrote their own backend against that parser point at this service with no
// client change, so renaming or flattening any of these fields breaks them.
type unfurlImage struct {
	URL string `json:"url,omitempty"`
}

type unfurlMeta struct {
	Title       string      `json:"title,omitempty"`
	Description string      `json:"description,omitempty"`
	Image       unfurlImage `json:"image"`
	Favicon     string      `json:"favicon,omitempty"`
	Domain      string      `json:"domain,omitempty"`
}

type unfurlResponse struct {
	Success int         `json:"success"`
	Link    string      `json:"link,omitempty"`
	Meta    *unfurlMeta `json:"meta,omitempty"`
}

func (s *server) handleUnfurl(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		writeJSON(w, http.StatusBadRequest, unfurlResponse{Success: 0})

		return
	}

	resp, err := s.opts.Fetcher.Get(r.Context(), target)
	if err != nil {
		// Deliberately opaque: the caller learns nothing about why an address
		// was refused, which would otherwise make this a network scanner.
		writeJSON(w, http.StatusOK, unfurlResponse{Success: 0})

		return
	}

	// A 404 or a 502 is a SUCCESSFUL fetch — nothing about the transport failed
	// — so it arrives here as a *Response carrying the error page. Parsing it
	// would build a card titled "Page not found" out of that page's own <title>
	// and og: tags and present it as the target. Report it the way a refused
	// fetch is reported instead.
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		writeJSON(w, http.StatusOK, unfurlResponse{Success: 0})

		return
	}

	m := unfurl.Parse(resp.Body, resp.FinalURL)

	writeJSON(w, http.StatusOK, unfurlResponse{
		Success: 1,
		Link:    resp.FinalURL,
		Meta: &unfurlMeta{
			Title:       m.Title,
			Description: m.Description,
			Image:       unfurlImage{URL: m.Image},
			Favicon:     m.Favicon,
			Domain:      m.Domain,
		},
	})
}
