package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/JackUait/blok/packages/server/go/v2/blokagent"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// ErrPageRefused is what Options.CreatePage returns to refuse a page: the
// agent's insert fails with FORBIDDEN and nothing is saved.
var ErrPageRefused = errors.New("blok-mcp: the host refused to create the page")

const (
	// hostPageFailed is all the agent sees when the host could not make
	// the first page of a batch.
	hostPageFailed = "The host could not create the page."
	// maxPageID is blok_open's documentId maxLength, which JSON Schema
	// counts in code points.
	maxPageID = 512
	// bodyShown is how much of a refused webhook answer goes to stderr.
	bodyShown = 500
)

// CreatePageWebhook is the --create-page hook. The wire every port sends:
// POST url, header Content-Type: application/json only, 10 s timeout,
// redirects not followed. Body:
// {"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"},
// onBehalfOf null when the actor has none.
//
//	200 {"pageId":"<id>"}  the id (then checked like any CreatePage answer)
//	200 {"pageId":null}    ErrPageRefused
//
// Any other status (3xx and 201 too), a timeout, a network error, a body
// that is not a JSON object, or a pageId that is neither a string nor null
// is an error, never a refusal. The body reads as JSON.parse does: a
// repeated key keeps its last value, and an escaped lone surrogate stays
// one, so it is refused rather than read as U+FFFD.
func CreatePageWebhook(url string) func(ctx context.Context, request blokagent.PageCreateRequest) (string, error) {
	return func(ctx context.Context, request blokagent.PageCreateRequest) (string, error) {
		body, err := marshal(struct {
			ParentDocumentID string    `json:"parentDocumentId"`
			Principal        string    `json:"principal"`
			Actor            wireActor `json:"actor"`
			SuggestedPageID  string    `json:"suggestedPageId"`
		}{request.ParentDocumentID, request.Principal, wireActor{request.Actor.ID, request.Actor.Name, request.Actor.OnBehalfOf}, request.SuggestedPageID})
		if err != nil {
			return "", err
		}
		answer, err := fetch(ctx, webhookTimeout, http.MethodPost, url, http.Header{"Content-Type": {"application/json"}}, body)
		if err != nil {
			return "", err
		}
		text := decodeUTF8(answer.body)
		shown := text
		if runes := []rune(shown); len(runes) > bodyShown {
			shown = string(runes[:bodyShown])
		}
		if answer.status != http.StatusOK {
			return "", fmt.Errorf("--create-page %s answered %d: %s", url, answer.status, shown)
		}
		parsed, err := jsjson.Parse([]byte(text))
		if err != nil {
			return "", fmt.Errorf("--create-page %s answered a body that is not JSON: %s", url, shown)
		}
		object, _ := parsed.(*jsjson.Object)
		var value any = missing{}
		if object != nil {
			if found, ok := object.Get(jsjson.FromString("pageId")); ok {
				value = found
			}
		}
		switch id := value.(type) {
		case nil:
			return "", ErrPageRefused
		case jsjson.Str:
			if hasLoneSurrogate(id) {
				return "", fmt.Errorf("--create-page %s answered no valid page id (a lone surrogate): %s", url, shown)
			}
			if id.String() == "" {
				return "", fmt.Errorf("--create-page %s answered no valid page id (empty): %s", url, shown)
			}
			return id.String(), nil
		}
		return "", fmt.Errorf("--create-page %s answered no \"pageId\" string or null: %s", url, shown)
	}
}

// missing marks an answer with no pageId key.
type missing struct{}

// wireActor is the actor the webhook sends: no other fields.
type wireActor struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	OnBehalfOf *string `json:"onBehalfOf"`
}

func hasLoneSurrogate(units jsjson.Str) bool {
	for index := 0; index < len(units); index++ {
		unit := rune(units[index])
		if utf16.IsSurrogate(unit) {
			if unit < 0xdc00 && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
				index++
				continue
			}
			return true
		}
	}
	return false
}

// validPageID is the rule for every page id a host answers: 1-512 code
// points of valid UTF-8 (Go's lone surrogate), no Unicode Cc character
// (U+0000-U+001F, U+007F-U+009F), and not "." or "..", which name a
// directory in every source.
func validPageID(id string) bool {
	if id == "" || id == "." || id == ".." || !utf8.ValidString(id) || utf8.RuneCountInString(id) > maxPageID {
		return false
	}
	for _, r := range id {
		if r <= 0x1f || (r >= 0x7f && r <= 0x9f) {
			return false
		}
	}
	return true
}

// pageCreateRequest is what the host learns about a page: the parent and
// the handle's opener, whoever sends the call.
func pageCreateRequest(parent string, who *caller) blokagent.PageCreateRequest {
	var actor struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		OnBehalfOf *string `json:"onBehalfOf"`
	}
	_ = json.Unmarshal(who.actor, &actor)
	return blokagent.PageCreateRequest{
		Actor:            blokagent.Actor{ID: actor.ID, Name: actor.Name, OnBehalfOf: actor.OnBehalfOf},
		ParentDocumentID: parent,
		Principal:        who.principal,
		SuggestedPageID:  mintPageID(),
	}
}

// pageStop is how creating pages stopped: the createPageFailure the bundle
// fails the next insert with, and whether a cancel stopped it.
type pageStop struct {
	failure   map[string]any
	cancelled bool
}

func stopWith(failure *surfaceErr) *pageStop {
	return &pageStop{failure: map[string]any{"helper": failure.Helper, "error": failure.errorJSON()}}
}

func stopAsIs(failure agentError) *pageStop {
	return &pageStop{failure: map[string]any{"helper": "as-is", "error": failure}}
}

// batchCancelled is the cause of a batch a cancel stopped after it made
// pages: Blok.Server's wording.
var batchCancelled = agentError{Code: "CANCELLED", Message: "The batch was cancelled. Nothing was written.", Retryable: false}

// hostPage asks the host's CreatePage for one page. made is how many pages
// this batch has already. Nothing here authorizes, loads or saves the new
// id: the host owns it.
func (s *Server) hostPage(ctx context.Context, parent string, who *caller, made int) (string, *pageStop) {
	if ctx.Err() != nil {
		return "", &pageStop{failure: map[string]any{"helper": "as-is", "error": batchCancelled}, cancelled: true}
	}
	id, err := s.options.CreatePage(ctx, pageCreateRequest(parent, who))
	switch {
	case errors.Is(err, ErrPageRefused):
		return "", stopWith(surfaceError("FORBIDDEN", "You may not create a page document here."))
	case err != nil && ctx.Err() != nil:
		return "", &pageStop{failure: map[string]any{"helper": "as-is", "error": batchCancelled}, cancelled: true}
	case err != nil:
		logf("the host could not create a page: %v", err)
	case !validPageID(id):
		logf("the host page creator answered no valid page id (1-512 code points, well-formed, no control characters, not \".\" or \"..\"): %q", id)
	default:
		return id, nil
	}
	if made > 0 {
		return "", stopAsIs(serverStop)
	}
	return "", stopWith(surfaceError("SOURCE_UNAVAILABLE", hostPageFailed))
}

// linkedPageIDs are the page ids parent links: data.pageId of each
// type "page" block. Blocks are one flat list (children name their
// parent), so nested pages are in it too. Text elsewhere never counts.
func linkedPageIDs(parent json.RawMessage) map[string]bool {
	var document struct {
		Blocks []struct {
			Type string `json:"type"`
			Data struct {
				PageID any `json:"pageId"`
			} `json:"data"`
		} `json:"blocks"`
	}
	_ = json.Unmarshal(parent, &document)
	linked := map[string]bool{}
	for _, block := range document.Blocks {
		if id, ok := block.Data.PageID.(string); ok && block.Type == "page" {
			linked[id] = true
		}
	}
	return linked
}

// finishPages makes a batch result report every page it left behind:
// pages a stop left unused (stranded), the pages a cancel stopped after
// (the bundle keeps a cancel's own code), and none the parent links.
// parent nil reports none: the host must never be told to delete a page
// the parent may use.
func finishPages(result json.RawMessage, made *madePages, parent json.RawMessage) json.RawMessage {
	var members map[string]json.RawMessage
	if json.Unmarshal(result, &members) != nil {
		return result
	}
	var failure map[string]any
	if json.Unmarshal(members["error"], &failure) != nil || failure == nil {
		return result
	}
	code, _ := failure["code"].(string)
	extra := []string{}
	if made != nil {
		if made.cancelled && code == "CANCELLED" {
			extra = append(extra, made.created...)
		}
		extra = append(extra, made.stranded...)
	}
	if code != "ORPHANED_SIDE_EFFECT" && len(extra) > 0 {
		cause := maps.Clone(failure)
		if code == "CANCELLED" {
			// Blok.Server's cancel cause has no index; the outer error keeps it.
			delete(cause, "commandIndex")
		}
		wrapped := map[string]any{
			"code": "ORPHANED_SIDE_EFFECT", "message": orphanedMessage(cause), "retryable": false,
			"details": map[string]any{"orphaned": []any{}, "cause": cause},
		}
		if index, ok := failure["commandIndex"]; ok {
			wrapped["commandIndex"] = index
		}
		failure, code = wrapped, "ORPHANED_SIDE_EFFECT"
	}
	if code != "ORPHANED_SIDE_EFFECT" {
		return result
	}
	details, _ := failure["details"].(map[string]any)
	if details == nil {
		return result
	}
	listed, _ := details["orphaned"].([]any)
	for _, page := range extra {
		listed = append(listed, map[string]any{"command": "block.insert", "type": "page", "prepared": map[string]any{"pageId": page}})
	}
	linked := map[string]bool{}
	if parent != nil {
		linked = linkedPageIDs(parent)
	}
	kept := []any{}
	for _, receipt := range listed {
		if id, ok := receiptPageID(receipt); ok && (parent == nil || linked[id]) {
			continue
		}
		kept = append(kept, receipt)
	}
	cause, _ := details["cause"].(map[string]any)
	switch {
	case len(kept) == 0 && cause != nil:
		failure = cause
	case len(kept) == 0:
		return result
	default:
		details["orphaned"] = kept
	}
	written, err := marshal(failure)
	if err != nil {
		return result
	}
	members["error"] = written
	out, err := marshalOrdered(result, members)
	if err != nil {
		return result
	}
	return out
}

func orphanedMessage(cause map[string]any) string {
	message, _ := cause["message"].(string)
	return "The batch failed after the host did work for it (" + message + "). Clean up the listed items."
}

// receiptPageID is a page receipt's pageId.
func receiptPageID(receipt any) (string, bool) {
	entry, _ := receipt.(map[string]any)
	prepared, _ := entry["prepared"].(map[string]any)
	if entry["type"] != "page" || prepared == nil {
		return "", false
	}
	id, ok := prepared["pageId"].(string)
	return id, ok
}

// marshalOrdered writes members in the key order of original, then any
// new keys.
func marshalOrdered(original json.RawMessage, members map[string]json.RawMessage) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytesReader(original))
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	out := []byte{'{'}
	seen := map[string]bool{}
	write := func(key string) {
		if len(out) > 1 {
			out = append(out, ',')
		}
		name, _ := marshal(key)
		out = append(out, name...)
		out = append(out, ':')
		out = append(out, members[key]...)
		seen[key] = true
	}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, _ := token.(string)
		var skip json.RawMessage
		if err := decoder.Decode(&skip); err != nil {
			return nil, err
		}
		if _, ok := members[key]; ok && !seen[key] {
			write(key)
		}
	}
	for key := range members {
		if !seen[key] {
			write(key)
		}
	}
	return append(out, '}'), nil
}
