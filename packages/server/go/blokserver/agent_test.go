package blokserver

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/blokagent"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// C# registers one agent executor beside the documents runtime, with the
// rooms only when collaboration is on (BlokDocumentsServiceCollectionExtensions.cs:79-86),
// and its HTML reader takes that same runtime (BlokServerServiceCollectionExtensions.cs:164).

func TestTheAgentExecutorEditsTheServersOwnRoomsOnOneEnginePool(t *testing.T) {
	builds := 0
	previous := newCollabRuntime
	newCollabRuntime = func(o jsruntime.Options) (*jsruntime.Pool, error) {
		builds++
		return previous(o)
	}
	t.Cleanup(func() { newCollabRuntime = previous })
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}`)
		}
	}))
	defer endpoint.Close()
	o := collabOptions(t)
	o.Auth = "none"
	o.StorageDirectory = ""
	o.DocEndpoint = endpoint.URL + "/docs"
	o.CollabJournal = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Drain(context.Background()) })
	host := httptest.NewServer(s.Handler(""))
	defer host.Close()

	executor, err := s.AgentExecutor()
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.AgentExecutor()
	if err != nil || again != executor {
		t.Fatalf("a second call built another executor (%v)", err)
	}
	execution, err := executor.ExecuteInRoom(context.Background(), "doc",
		`{"commands":[{"name":"doc.setTitle","args":{"title":"From the agent"}}]}`, blokagent.Actor{ID: "agent", Name: "Agent"}, nil)
	if err != nil || !strings.Contains(execution.ResultJSON, `"ok":true`) || execution.Revision == "" {
		t.Fatalf("%+v, %v", execution, err)
	}
	response, err := http.Get(host.URL + "/sync/doc/state")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !strings.Contains(string(body), `"title":"From the agent"`) {
		t.Fatalf("state %s", body)
	}
	if builds != 1 {
		t.Fatalf("%d engine pools built, want 1", builds)
	}
}

func TestTheAgentExecutorWithoutCollaborationHasNoRooms(t *testing.T) {
	o := DefaultOptions()
	o.Auth = "none"
	o.StorageDirectory = ""
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	executor, err := s.AgentExecutor()
	if err != nil {
		t.Fatal(err)
	}
	execution, err := executor.ExecuteInRoom(context.Background(), "doc", `{"commands":[]}`, blokagent.Actor{ID: "a", Name: "A"}, nil)
	if err != nil || !strings.Contains(execution.ResultJSON, `"code":"COMMAND_UNAVAILABLE"`) {
		t.Fatalf("%+v, %v", execution, err)
	}
	stored, err := executor.Execute(context.Background(), `{"blocks":[]}`,
		`{"commands":[{"name":"doc.setTitle","args":{"title":"T"}}]}`, blokagent.Actor{ID: "a", Name: "A"}, nil)
	if err != nil || stored.DocumentJSON == nil {
		t.Fatalf("%+v, %v", stored, err)
	}
}
