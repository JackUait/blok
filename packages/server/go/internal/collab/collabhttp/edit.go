package collabhttp

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/synchttp"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
)

// IdempotencyKeyHeader names the edit's operation.
const IdempotencyKeyHeader = "Blok-Idempotency-Key"

// Edit is POST /sync/{doc}/edit. Order: doc id, doc claim, hooks, key,
// If-Match, body cap, parse.
func (h *Handlers) Edit(w http.ResponseWriter, r *http.Request) {
	doc, user, hasUser, ok := h.admit(w, r, true)
	if !ok {
		return
	}
	keys := r.Header.Values(IdempotencyKeyHeader)
	var operationID string
	if len(keys) == 1 {
		operationID, ok = convert.NormalizeIdempotencyKey(keys[0])
	} else {
		ok = false
	}
	if !ok {
		synchttp.Refuse(w, http.StatusBadRequest, "a valid "+IdempotencyKeyHeader+" header is required\n")
		return
	}
	var expect *room.Precondition
	if values, present := r.Header["If-Match"]; present {
		if expect, ok = parseEntityTag(values); !ok {
			synchttp.Refuse(w, http.StatusBadRequest, "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n")
			return
		}
	}
	body, err := readBody(r.Body, h.config.MaxMessageBytes)
	if err != nil {
		if errors.Is(err, errTooLarge) {
			synchttp.Refuse(w, http.StatusRequestEntityTooLarge,
				"an edit request is at most "+strconv.Itoa(h.config.MaxMessageBytes)+" bytes\n")
			return
		}
		failed(w, r.Context())
		return
	}
	ops, err := convert.ParseEditOps(body)
	if err != nil {
		var refusal *convert.EditError
		if errors.As(err, &refusal) {
			synchttp.Refuse(w, http.StatusUnprocessableEntity, refusal.Message+"\n")
			return
		}
		failed(w, r.Context())
		return
	}
	digest, err := convert.CanonicalBodyDigest(ops)
	if err != nil {
		failed(w, r.Context())
		return
	}
	manager, ok := h.manager(w)
	if !ok {
		return
	}
	ticketUser := ""
	if h.config.TicketMode {
		ticketUser = user.ID
	}
	actor := synchttp.DeriveActor(ticketUser, user, hasUser)
	result, err := manager.Edit(r.Context(), doc, ops, operationID, digest, actor, expect)
	if err != nil {
		failed(w, r.Context())
		return
	}
	WriteEditResult(w, result, manager.RetryAfter())
}

// WriteEditResult answers one edit's outcome; a restore answers the same way.
func WriteEditResult(w http.ResponseWriter, result room.EditResult, retryAfter time.Duration) {
	message := func(fallback string) string {
		if result.Err != nil {
			return result.Err.Error()
		}
		return fallback
	}
	switch result.Status {
	case room.EditApplied:
		if receipt := result.Receipt; receipt != nil {
			writeHead(w, receipt.Tag.Lineage, receipt.ServerSequence)
		}
		w.WriteHeader(http.StatusNoContent)
	case room.EditPreconditionFailed:
		if head := result.Receipt; head != nil {
			writeHead(w, head.Tag.Lineage, head.ServerSequence)
		}
		synchttp.Refuse(w, http.StatusPreconditionFailed, "the document is no longer at the If-Match head\n")
	case room.EditPreconditionRequired:
		synchttp.Refuse(w, http.StatusPreconditionRequired, "If-Match needs the operation journal, and this server keeps none\n")
	case room.EditConflict:
		synchttp.Refuse(w, http.StatusConflict, "the idempotency key was already used for a different edit\n")
	case room.EditInvalid:
		synchttp.Refuse(w, http.StatusUnprocessableEntity, message("collab: the edit was refused.")+"\n")
	case room.EditOverloaded:
		refuseRetryLater(w, retryAfter, "the server ran past its limits reading this edit's rich text, retry\n")
	case room.EditTooLarge:
		synchttp.Refuse(w, http.StatusRequestEntityTooLarge, message("collab: the edit's rich text is too large to read.")+"\n")
	case room.EditPurged:
		synchttp.Refuse(w, http.StatusForbidden, "forbidden\n")
	case room.EditUnavailable:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document is unavailable, retry\n")
	default:
		synchttp.Refuse(w, http.StatusServiceUnavailable, "the document could not be loaded\n")
	}
}

// parseEntityTag reads exactly one strong "<lineage>:<sequence>" tag with a
// canonical decimal; a list, * or a weak tag is refused.
func parseEntityTag(values []string) (*room.Precondition, bool) {
	if len(values) != 1 || len(values[0]) < 2 {
		return nil, false
	}
	value := values[0]
	// C# indexes UTF-16 units; a quote is one unit and one byte alike.
	if value[0] != '"' || value[len(value)-1] != '"' {
		return nil, false
	}
	inner := value[1 : len(value)-1]
	colon := strings.IndexByte(inner, ':')
	if colon < 0 || strings.IndexByte(inner[colon+1:], ':') >= 0 {
		return nil, false
	}
	lineage, digits := inner[:colon], inner[colon+1:]
	if !workingset.IsLineage(lineage) || !isDigits(digits) {
		return nil, false
	}
	sequence, err := strconv.ParseUint(digits, 10, 64)
	if err != nil || strconv.FormatUint(sequence, 10) != digits {
		return nil, false
	}
	return &room.Precondition{Lineage: lineage, Sequence: sequence}, true
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

var errTooLarge = errors.New("collabhttp: the body is over the cap")

// readBody counts while it reads, in 8 KiB chunks; Content-Length is not
// trusted.
func readBody(body io.Reader, maxBytes int) ([]byte, error) {
	var buffer []byte
	chunk := make([]byte, 8192)
	for {
		n, err := body.Read(chunk)
		if n > 0 {
			if len(buffer)+n > maxBytes {
				return nil, errTooLarge
			}
			buffer = append(buffer, chunk[:n]...)
		}
		if err == io.EOF {
			return buffer, nil
		}
		if err != nil {
			return nil, err
		}
	}
}
