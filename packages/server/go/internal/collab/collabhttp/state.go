package collabhttp

import (
	"net/http"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/synchttp"
	"github.com/JackUait/blok/packages/server/go/v2/internal/route"
)

// State is GET /sync/{doc}/state: the live document as the consumer export.
// With a journal it also names the head, as headers and an ETag an edit
// accepts as If-Match. Only the read gate is consulted.
func (h *Handlers) State(w http.ResponseWriter, r *http.Request) {
	doc, _, _, ok := h.admit(w, r, false)
	if !ok {
		return
	}
	manager, ok := h.manager(w)
	if !ok {
		return
	}
	result, err := manager.State(r.Context(), doc)
	if err != nil {
		failed(w, r.Context())
		return
	}
	switch result.Status {
	case room.StateReady:
		if head := result.Head; head != nil {
			writeHead(w, head.Tag.Lineage, head.ServerSequence)
			w.Header().Set("ETag", entityTag(head.Tag.Lineage, head.ServerSequence))
		}
		// Document content behind an access check: no shared cache keeps it.
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		route.StartStream(w, http.StatusOK)
		_, _ = w.Write(result.JSON)
	case room.StatePurged:
		synchttp.Refuse(w, http.StatusForbidden, "forbidden\n")
	case room.StateUnavailable:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document is unavailable, retry\n")
	case room.StateOverloaded:
		refuseRetryLater(w, manager.RetryAfter(), "the server ran past its limits exporting this document, retry\n")
	case room.StateExportFailed:
		synchttp.Refuse(w, http.StatusInternalServerError, "the document could not be exported\n")
	default:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document could not be loaded\n")
	}
}

// Reset is POST /sync/{doc}/reset: read and write gates.
func (h *Handlers) Reset(w http.ResponseWriter, r *http.Request) {
	doc, _, _, ok := h.admit(w, r, true)
	if !ok {
		return
	}
	manager, ok := h.manager(w)
	if !ok {
		return
	}
	result, err := manager.Reset(r.Context(), doc)
	if err != nil {
		failed(w, r.Context())
		return
	}
	switch result.Status {
	case room.ResetDone:
		w.WriteHeader(http.StatusNoContent)
	case room.ResetPurged:
		synchttp.Refuse(w, http.StatusForbidden, "forbidden\n")
	case room.ResetUnavailable:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document is unavailable, retry\n")
	default:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document could not be loaded\n")
	}
}
