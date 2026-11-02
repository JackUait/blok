// Package collabhttp is the collab routes beside the sync door: POST
// /sync/{doc}/edit, GET /sync/{doc}/state, POST /sync/{doc}/reset and the
// history routes. It ports Blok.Server.AspNetCore/Collab/{Edit,State,Reset,
// History}Endpoint.cs. Every route runs behind the server's guard, which has
// already checked origin, ticket and rate limit.
package collabhttp

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/synchttp"
)

// Config is what the routes read from the server.
type Config struct {
	// TicketMode: the guard verified a pass, whose doc claim must match.
	TicketMode    bool
	Authorization auth.Authorization
	// Rooms builds the room manager on first use.
	Rooms           func() (*room.Manager, error)
	MaxMessageBytes int
	// CorruptLog reports an unreadable stored version: C# logs it at Error,
	// event id 3 (CollabHistoryCorrupt).
	CorruptLog func(doc string)
}

// Handlers serves the routes.
type Handlers struct{ config Config }

func New(config Config) *Handlers { return &Handlers{config: config} }

const badDocument = "document ids must be a single path segment\n"

// admit is the door every route shares: the doc id, the ticket's doc claim,
// then the hook. write asks the write gate too.
func (h *Handlers) admit(w http.ResponseWriter, r *http.Request, write bool) (doc string, user auth.User, hasUser bool, ok bool) {
	doc = r.PathValue("doc")
	if !synchttp.IsSingleSegment(doc) {
		synchttp.Refuse(w, http.StatusBadRequest, badDocument)
		return "", auth.User{}, false, false
	}
	user, hasUser = auth.UserFrom(r.Context())
	if h.config.TicketMode && user.Doc != doc {
		synchttp.Refuse(w, http.StatusForbidden, "pass is for another document\n")
		return "", auth.User{}, false, false
	}
	if hook := h.config.Authorization; hook != nil {
		allowed, err := hook.CanReadDocument(r.Context(), user, doc)
		if err == nil && allowed && write {
			allowed, err = hook.CanWriteDocument(r.Context(), user, doc)
		}
		if err != nil {
			internalError(w)
			return "", auth.User{}, false, false
		}
		if !allowed {
			synchttp.Refuse(w, http.StatusForbidden, "forbidden\n")
			return "", auth.User{}, false, false
		}
	}
	return doc, user, hasUser, true
}

func (h *Handlers) manager(w http.ResponseWriter) (*room.Manager, bool) {
	manager, err := h.config.Rooms()
	if err != nil {
		internalError(w)
		return nil, false
	}
	return manager, true
}

// internalError is what the host answers when a handler throws.
func internalError(w http.ResponseWriter) {
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusInternalServerError)
}

// failed answers an error from below: nothing when the caller is gone,
// else the host's empty 500.
func failed(w http.ResponseWriter, ctx context.Context) {
	if ctx.Err() == nil {
		internalError(w)
	}
}

// refuseRetryLater is 503 with Retry-After in whole seconds, rounded up,
// at least 1.
func refuseRetryLater(w http.ResponseWriter, retryAfter time.Duration, body string) {
	seconds := int64(math.Ceil(retryAfter.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	synchttp.Refuse(w, http.StatusServiceUnavailable, body)
}

const (
	lineageHeader  = "Blok-Doc-Lineage"
	sequenceHeader = "Blok-Doc-Sequence"
)

// writeHead sets the head headers and exposes them on a CORS answer.
func writeHead(w http.ResponseWriter, lineage string, sequence uint64) {
	w.Header().Set(lineageHeader, lineage)
	w.Header().Set(sequenceHeader, strconv.FormatUint(sequence, 10))
	expose(w, lineageHeader, sequenceHeader, "ETag")
}

// expose merges names into Access-Control-Expose-Headers, only when the
// answer is a CORS one.
func expose(w http.ResponseWriter, names ...string) {
	if len(w.Header().Values("Access-Control-Allow-Origin")) == 0 {
		return
	}
	var exposed []string
	for _, value := range w.Header().Values("Access-Control-Expose-Headers") {
		for _, name := range strings.Split(value, ",") {
			if name = strings.TrimSpace(name); name != "" {
				exposed = append(exposed, name)
			}
		}
	}
	for _, name := range names {
		found := false
		for _, have := range exposed {
			if strings.EqualFold(have, name) {
				found = true
				break
			}
		}
		if !found {
			exposed = append(exposed, name)
		}
	}
	w.Header().Set("Access-Control-Expose-Headers", strings.Join(exposed, ", "))
}

// entityTag is the strong tag for one journal head.
func entityTag(lineage string, sequence uint64) string {
	return `"` + lineage + ":" + strconv.FormatUint(sequence, 10) + `"`
}
