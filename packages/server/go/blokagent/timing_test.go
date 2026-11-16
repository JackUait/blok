package blokagent

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/mcptiming"
)

func TestMCPReadTimingReachesTheRoomAndRuntimeWithoutContent(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	r := newTestRoom(t, false, nil)
	r.docs.hold("private-document", historySeed)
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)
	ctx, finish := mcptiming.Start(context.Background(), "blok_read")
	result, err := r.executor.ExecuteInRoom(ctx, "private-document", `{"commands":[{"name":"doc.read","args":{"limit":1}}]}`, roomAgent, nil)
	finish()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.ResultJSON, `"ok":true`) {
		t.Fatal(result.ResultJSON)
	}
	for _, stage := range []string{"room_execute", "lane_wait", "journal_lookup", "document_export", "export_json", "agent_execute", "pool_wait", "runtime_execute", "runtime_input_json", "runtime_output_json"} {
		if !strings.Contains(logs.String(), `"stage":"`+stage+`"`) {
			t.Errorf("missing stage %s", stage)
		}
	}
	for _, secret := range []string{"private-document", "Hello", "Other", `"commands"`} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("logged private content %q", secret)
		}
	}
}
