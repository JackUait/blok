package blokagent

import (
	"context"
	"strings"
	"sync"
	"testing"
)

// requestCreator answers CreateFor and records each request. Create must
// not be called when CreateFor exists.
type requestCreator struct {
	mu       sync.Mutex
	requests []PageCreateRequest
	plain    int
}

func (c *requestCreator) Resolve(context.Context, string, Actor) (PageLocation, error) { return nil, nil }

func (c *requestCreator) Create(context.Context, Actor) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.plain++
	return "plain", nil
}

func (c *requestCreator) CreateFor(_ context.Context, request PageCreateRequest) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.requests = append(c.requests, request)
	return "host-page", nil
}

// A creator that also implements PageCreatorFor gets the room's document
// as the parent and a suggested id, and Create is not called.
func TestARoomPageCreateGivesThePageCreatorForTheParent(t *testing.T) {
	r := newTestRoom(t, false, nil)
	r.docs.hold("d", `{"blocks":[]}`)
	pages := &requestCreator{}
	execution, err := r.executor.ExecuteInRoom(context.Background(), "d", insertPageBatch, roomAgent, &Options{PageTitles: true, PageTarget: pages})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(execution.ResultJSON, `"ok":true`) || !strings.Contains(execution.ResultJSON, "host-page") {
		t.Fatalf("%s", execution.ResultJSON)
	}
	if pages.plain != 0 || len(pages.requests) != 1 {
		t.Fatalf("plain %d, requests %+v", pages.plain, pages.requests)
	}
	request := pages.requests[0]
	if request.ParentDocumentID != "d" || request.Actor.ID != roomAgent.ID || len(request.SuggestedPageID) != 10 || request.Principal != "" {
		t.Fatalf("request %+v", request)
	}
}

// Outside a room the parent is not known, so it is empty.
func TestAStoredPageCreateGivesThePageCreatorForNoParent(t *testing.T) {
	pages := &requestCreator{}
	execution := paRun(t, sharedExecutor(t), `{"blocks":[]}`, insertPageBatch, &Options{PageTitles: true, PageTarget: pages})
	if !strings.Contains(execution.ResultJSON, "host-page") || pages.plain != 0 || len(pages.requests) != 1 || pages.requests[0].ParentDocumentID != "" {
		t.Fatalf("%s, %+v", execution.ResultJSON, pages.requests)
	}
}
