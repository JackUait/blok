package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/json"
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
// source (Node's createsPages without a sync service).
func (s *Server) createsPages() bool {
	return s.options.PageTitles == "page-map" && s.source != nil && !s.options.live()
}

// createPages makes the page documents a batch will point at, before it
// runs: the bundle cannot wait on the host mid-batch, so agentPagesNeeded
// counts them first.
func (s *Server) createPages(ctx context.Context, input map[string]any, who string) ([]string, error) {
	var needed struct {
		Count int `json:"count"`
	}
	if _, err := s.bundle.call(ctx, "agentPagesNeeded", input, &needed); err != nil {
		return nil, err
	}
	created := make([]string, 0, needed.Count)
	for range needed.Count {
		pageID, err := s.createPage(ctx, who)
		if err != nil {
			return nil, err
		}
		created = append(created, pageID)
	}
	return created, nil
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
