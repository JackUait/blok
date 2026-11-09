package blokserver

import (
	"context"
	"testing"
	"time"
)

type historyHooks struct{ asked []User }

func (h *historyHooks) CanReadDocument(context.Context, User, string) (bool, error) { return true, nil }
func (h *historyHooks) CanWriteDocument(context.Context, User, string) (bool, error) {
	return true, nil
}
func (h *historyHooks) CanReadHistory(_ context.Context, u User, _ string) (bool, error) {
	h.asked = append(h.asked, u)
	return false, nil
}
func (h *historyHooks) HistoryWindow(context.Context, User, string) (*time.Duration, error) {
	return new(time.Hour), nil
}

type documentHooks struct{}

func (documentHooks) CanReadDocument(context.Context, User, string) (bool, error)  { return true, nil }
func (documentHooks) CanWriteDocument(context.Context, User, string) (bool, error) { return true, nil }

// The agent executor asks the host's history hooks, as the user the agent is named by.
func TestTheAgentAsksTheHostsHistoryHooks(t *testing.T) {
	if agentHistoryPolicy(nil) != nil || agentHistoryPolicy(documentHooks{}) != nil {
		t.Fatal("a host with no history hook gets a policy")
	}
	hooks := &historyHooks{}
	access, err := agentHistoryPolicy(hooks)(context.Background(), "person-1", "doc")
	if err != nil {
		t.Fatal(err)
	}
	if access.CanRead || access.Window == nil || *access.Window != time.Hour {
		t.Fatalf("access %+v", access)
	}
	if len(hooks.asked) != 1 || hooks.asked[0] != (User{ID: "person-1", Name: "person-1", Authenticated: true}) {
		t.Fatalf("asked %+v", hooks.asked)
	}
}
