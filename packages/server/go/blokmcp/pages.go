package blokmcp

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
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
// runs, and puts them in input as createdPages: the bundle cannot wait on
// the host mid-batch, so agentPagesNeeded counts them first. A refused page
// stops there and goes in as createPageFailure, so the bundle fails its
// insert as Node's port does. The client's cancel is not checked between
// pages, as Node does not check it inside a batch.
func (s *Server) createPages(ctx context.Context, input map[string]any, who *caller) error {
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
		return err
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
			failure, ok := asSurface(err)
			if !ok {
				return err
			}
			input["createPageFailure"] = map[string]any{"helper": failure.Helper, "error": failure.errorJSON()}
			break
		}
		created = append(created, pageID)
	}
	input["createdPages"] = created
	return nil
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

// pageMap: page blocks point at their own documents (--page-titles page-map).
func (s *Server) pageMap() bool { return s.options.PageTitles == "page-map" }

// hasPageAction says whether a batch holds page.rename or page.setIcon. The
// envelope check refuses one that is not alone, as Node's does.
func hasPageAction(batch json.RawMessage) bool {
	commands, _ := batchCommands(batch)
	for _, command := range commands {
		if command.name == "page.rename" || command.name == "page.setIcon" {
			return true
		}
	}
	return false
}

// pageWrite is how a page action ended: written, and whether its room had
// not acknowledged the write yet.
type pageWrite struct {
	wrote   bool
	pending bool
}

// runPageAction is Node's page-map pageBackend: the bundle checks the batch
// on the open document (agentPlanHost), then a doc.setTitle or doc.setIcon
// batch runs on the page's own document, opened as blok_open opens one.
// It answers the agent result and how the page write ended.
func (s *Server) runPageAction(ctx context.Context, call *callContext, input map[string]any, isOpen func(pageID string) bool) (json.RawMessage, pageWrite, error) {
	var planned struct {
		Result json.RawMessage `json:"result"`
		Plan   json.RawMessage `json:"plan"`
		Batch  struct {
			Commands []struct {
				Name string                     `json:"name"`
				Args map[string]json.RawMessage `json:"args"`
			} `json:"commands"`
		} `json:"batch"`
		View struct {
			Blocks []struct {
				Data map[string]json.RawMessage `json:"data"`
			} `json:"blocks"`
		} `json:"view"`
	}
	if _, err := s.bundle.call(ctx, "agentPlanHost", input, &planned); err != nil {
		return nil, pageWrite{}, err
	}
	if len(planned.Plan) == 0 || len(planned.Batch.Commands) == 0 {
		return planned.Result, pageWrite{}, nil
	}
	var source map[string]json.RawMessage
	if err := json.Unmarshal(planned.Result, &source); err != nil {
		return nil, pageWrite{}, err
	}
	// The executor's prepare step fails at the action's index.
	fail := func(agentError map[string]any) (json.RawMessage, pageWrite, error) {
		if _, ok := agentError["commandIndex"]; !ok {
			agentError["commandIndex"] = 0
		}
		result, err := marshal(map[string]any{"ok": false, "revision": source["revision"], "error": agentError, "warnings": source["warnings"]})
		return result, pageWrite{}, err
	}
	withPage := func(agentError map[string]any, pageID string) map[string]any {
		details, _ := agentError["details"].(map[string]any)
		if details == nil {
			details = map[string]any{}
		}
		details["pageId"] = pageID
		agentError["details"] = details
		return agentError
	}
	command := planned.Batch.Commands[0]
	var blockID string
	_ = json.Unmarshal(command.Args["id"], &blockID)
	var pageID string
	if len(planned.View.Blocks) > 0 {
		_ = json.Unmarshal(planned.View.Blocks[0].Data["pageId"], &pageID)
	}
	if pageID == "" {
		return fail(map[string]any{
			"code": "INVALID_ARGS", "message": fmt.Sprintf("Block %q is not a page block with a pageId.", blockID),
			"retryable": false, "details": map[string]any{"blockId": blockID},
		})
	}
	// A second save of the open document would make this handle's version stale.
	if isOpen(pageID) {
		return fail(map[string]any{
			"code": "INVALID_ARGS", "message": "This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead.",
			"retryable": false, "details": map[string]any{"pageId": pageID},
		})
	}
	target, err := s.open(ctx, pageID, "auto", true, call.who)
	if err != nil {
		agentError, err := s.agentErrorOf(ctx, err)
		if err != nil {
			return nil, pageWrite{}, err
		}
		return fail(withPage(agentError, pageID))
	}
	defer target.close()
	field, name := "icon", "doc.setIcon"
	if command.Name == "page.rename" {
		field, name = "title", "doc.setTitle"
	}
	value := command.Args[field]
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	inner, err := marshal(map[string]any{"commands": []any{map[string]any{"name": name, "args": map[string]any{field: value}}}})
	if err != nil {
		return nil, pageWrite{}, err
	}
	// The target batch runs with no approval, as Node's pageBackend calls it.
	done, err := target.execute(ctx, &callContext{who: call.who, principal: call.principal, actor: call.actor}, inner)
	if err != nil {
		return nil, pageWrite{}, err
	}
	if done.answer == nil {
		return nil, pageWrite{}, fmt.Errorf("blok-mcp: the page write asked a question")
	}
	var answer struct {
		StructuredContent struct {
			OK       bool           `json:"ok"`
			Error    map[string]any `json:"error"`
			Delivery struct {
				Pending bool `json:"pending"`
			} `json:"delivery"`
		} `json:"structuredContent"`
	}
	if err := json.Unmarshal(done.answer, &answer); err != nil {
		return nil, pageWrite{}, err
	}
	written := answer.StructuredContent
	if !written.OK {
		if written.Error == nil {
			return nil, pageWrite{}, fmt.Errorf("blok-mcp: the page write failed with no error")
		}
		return fail(withPage(written.Error, pageID))
	}
	source["results"], _ = marshal([]any{map[string]any{"pageId": pageID, "applied": true}})
	result, err := marshal(source)
	// An unacknowledged page write still went out: the batch is not durable.
	return result, pageWrite{wrote: true, pending: written.Delivery.Pending}, err
}

// agentErrorOf is the agent error a host refusal makes, retryable set by its
// helper as Node's surfaceError sets it. Anything else is passed on.
func (s *Server) agentErrorOf(ctx context.Context, err error) (map[string]any, error) {
	failure, ok := asSurface(err)
	if !ok {
		return nil, err
	}
	answer, err := s.errorAnswer(ctx, "blok_execute", failure)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		StructuredContent struct {
			Error map[string]any `json:"error"`
		} `json:"structuredContent"`
	}
	if err := json.Unmarshal(answer, &parsed); err != nil {
		return nil, err
	}
	if parsed.StructuredContent.Error == nil {
		return nil, fmt.Errorf("blok-mcp: mcpErrorAnswer gave no error")
	}
	return parsed.StructuredContent.Error, nil
}

// withOtherStep marks a batch that wrote only another document in carried
// history, so history.undo refuses it as Node's executor does. revision is
// the document's content revision, which a fresh history lacks.
func withOtherStep(history json.RawMessage, revision json.RawMessage) json.RawMessage {
	var members map[string]json.RawMessage
	if json.Unmarshal(history, &members) != nil || members == nil {
		members = map[string]json.RawMessage{}
	}
	var past []json.RawMessage
	_ = json.Unmarshal(members["past"], &past)
	past = append(past, quoted("other"))
	members["past"], _ = marshal(past)
	if _, ok := members["future"]; !ok {
		members["future"] = json.RawMessage("[]")
	}
	if _, ok := members["revision"]; !ok {
		members["revision"] = revision
	}
	written, err := marshal(members)
	if err != nil {
		return history
	}
	return written
}
