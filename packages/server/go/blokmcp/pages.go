package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"strings"
)

// pageIDAlphabet is src/shared/mint-id.ts's, so ids look the same.
const pageIDAlphabet = "57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9"

func mintPageID() string {
	bytes := make([]byte, 10)
	_, _ = rand.Read(bytes)
	for index, b := range bytes {
		bytes[index] = pageIDAlphabet[b&63]
	}
	return string(bytes)
}

// createsPages: page blocks get their own documents under page-map with a
// sync service or a source (Node's createsPages).
func (s *Server) createsPages() bool {
	return s.options.PageTitles == "page-map" && (s.options.Sync != nil || s.source != nil)
}

// createPages makes the page documents a batch will point at, before it
// runs: the bundle cannot wait on the host mid-batch, so agentPagesNeeded
// counts them first. The client's cancel is not checked between pages, as
// Node does not check it inside a batch.
func (s *Server) createPages(ctx context.Context, input map[string]any, who *caller) ([]string, error) {
	var needed struct {
		Count  int `json:"count"`
		Result *struct {
			Error *struct {
				Code    string `json:"code"`
				Details struct {
					Orphaned []struct {
						Prepared struct {
							PageID string `json:"pageId"`
						} `json:"prepared"`
					} `json:"orphaned"`
				} `json:"details"`
			} `json:"error"`
		} `json:"result"`
	}
	if _, err := s.bundle.call(ctx, "agentPagesNeeded", input, &needed); err != nil {
		return nil, err
	}
	count := needed.Count
	// A batch that would be refused, or that waits on a person's answer,
	// makes no page: Node plans the whole batch before it makes one. Only a
	// batch refused after its page was prepared (ORPHANED_SIDE_EFFECT) made
	// those pages in Node, so they are made here too.
	if needed.Result != nil {
		count = 0
		if failure := needed.Result.Error; failure != nil && failure.Code == "ORPHANED_SIDE_EFFECT" {
			for _, orphan := range failure.Details.Orphaned {
				if strings.HasPrefix(orphan.Prepared.PageID, "planned-page-") {
					count++
				}
			}
		}
	}
	created := make([]string, 0, count)
	for range count {
		var pageID string
		var err error
		if s.options.Sync != nil {
			pageID, err = s.createLivePage(ctx, who)
		} else {
			pageID, err = s.createPage(ctx, who.principal)
		}
		if err != nil {
			return nil, err
		}
		created = append(created, pageID)
	}
	return created, nil
}

// createLivePage joins the new page's room once: the sync service seeds it,
// and it must come up empty.
func (s *Server) createLivePage(ctx context.Context, who *caller) (string, error) {
	pageID := mintPageID()
	withPage := func(err error) error {
		failure, ok := asSurface(err)
		if !ok {
			return err
		}
		if failure.Raw == nil {
			details := map[string]any{"pageId": pageID}
			for key, value := range failure.Details {
				details[key] = value
			}
			return &surfaceErr{Code: failure.Code, Message: failure.Message, Details: details, Helper: failure.Helper}
		}
		return failure
	}
	allowed, err := s.allowed(ctx, who.principal, pageID, true)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", withPage(surfaceError("FORBIDDEN", "You may not create a page document here."))
	}
	opened, err := s.openLive(ctx, pageID, true, who)
	if err != nil {
		return "", withPage(err)
	}
	page := opened.(*liveSession)
	defer page.close()
	page.room.mu.Lock()
	document, _, err := page.exportLocked(ctx)
	page.room.mu.Unlock()
	if err != nil {
		return "", err
	}
	var view struct {
		Blocks []json.RawMessage `json:"blocks"`
		Title  *json.RawMessage  `json:"title"`
		Icon   *json.RawMessage  `json:"icon"`
	}
	_ = json.Unmarshal(document, &view)
	if len(view.Blocks) > 0 || view.Title != nil || view.Icon != nil {
		return "", withPage(surfaceError("SOURCE_UNAVAILABLE", "The new page id is taken. Try again."))
	}
	return pageID, nil
}

// createPage is the opener's createPage for stored mode: a new id,
// authorized like a write open, saved as an empty document.
func (s *Server) createPage(ctx context.Context, principal string) (string, error) {
	pageID := mintPageID()
	// Node names the page in the refusal, keeping the error's own flag.
	withPage := func(err error) error {
		failure, ok := asSurface(err)
		if !ok {
			return err
		}
		if failure.Raw == nil {
			details := map[string]any{"pageId": pageID}
			for key, value := range failure.Details {
				details[key] = value
			}
			return &surfaceErr{Code: failure.Code, Message: failure.Message, Details: details, Helper: failure.Helper}
		}
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(failure.Raw, &raw)
		var details map[string]json.RawMessage
		_ = json.Unmarshal(raw["details"], &details)
		if details == nil {
			details = map[string]json.RawMessage{}
		}
		details["pageId"], _ = marshal(pageID)
		raw["details"], _ = marshal(details)
		written, _ := marshal(raw)
		return rawError(written)
	}
	allowed, err := s.allowed(ctx, principal, pageID, true)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", withPage(surfaceError("FORBIDDEN", "You may not create a page document here."))
	}
	loaded, err := s.source.load(ctx, pageID)
	if err != nil {
		return "", withPage(err)
	}
	// The endpoint source saves without a version check, so this is its
	// only guard against an overwrite.
	if !loaded.missing {
		return "", withPage(surfaceError("SOURCE_UNAVAILABLE", "The new page id is taken. Try again."))
	}
	var text struct {
		Text string `json:"text"`
	}
	if _, err := s.bundle.call(ctx, "mcpDocumentText", map[string]any{"document": emptyDocument, "form": s.source.documentForm()}, &text); err != nil {
		return "", err
	}
	if _, err := s.source.save(ctx, pageID, []byte(text.Text), loaded.version); err != nil {
		return "", withPage(err)
	}
	return pageID, nil
}
