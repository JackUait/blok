package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPTraceQueueNeverBlocksCallsWhenStorageIsSlow(t *testing.T) {
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	writer := newMCPTraceWriter(func(ctx context.Context, record pendingMCPTrace) error {
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	defer writer.close()
	writer.enqueue(pendingMCPTrace{})
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("writer did not start")
	}
	finished := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			writer.enqueue(pendingMCPTrace{})
		}
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("MCP call blocked on diagnostics")
	}
	close(release)
}

func TestMCPTraceWriterContinuesAfterStorageFailure(t *testing.T) {
	attempts := make(chan struct{}, 2)
	writer := newMCPTraceWriter(func(context.Context, pendingMCPTrace) error {
		attempts <- struct{}{}
		return errors.New("private storage detail")
	})
	defer writer.close()
	writer.enqueue(pendingMCPTrace{})
	writer.enqueue(pendingMCPTrace{})
	for i := 0; i < 2; i++ {
		select {
		case <-attempts:
		case <-time.After(time.Second):
			t.Fatal("writer stopped after storage failure")
		}
	}
}

func TestMCPTraceWriterCloseCancelsStorageAndCanRepeat(t *testing.T) {
	entered := make(chan struct{})
	cancelled := make(chan struct{})
	writer := newMCPTraceWriter(func(ctx context.Context, _ pendingMCPTrace) error {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		return ctx.Err()
	})
	writer.enqueue(pendingMCPTrace{})
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("writer did not start")
	}
	writer.close()
	writer.close()
	writer.enqueue(pendingMCPTrace{})
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("close did not cancel storage")
	}
}

func TestMCPTraceQueriesValidateBeforeStorage(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"limit":0}`, `{"limit":51}`, `{"limit":1.5}`, `{"minDurationMs":-1}`, `{"traceId":""}`, `{"userId":"other"}`, `{} {}`} {
		if _, err := parseMCPTraceQuery([]byte(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, raw := range []string{`{}`, `{"limit":50,"minDurationMs":0}`, `{"traceId":"opaque"}`} {
		if _, err := parseMCPTraceQuery([]byte(raw)); err != nil {
			t.Errorf("refused %s: %v", raw, err)
		}
	}
	s := &Service{mcpTimingEnabled: true}
	req := &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{Arguments: json.RawMessage(`{"limit":0}`)}}
	result, err := s.mcpDebugTraces(context.Background(), req)
	if err != nil || !result.IsError {
		t.Fatal("anonymous call reached storage")
	}
	ctx := context.WithValue(context.Background(), mcpUserKey{}, identity{User: User{ID: "alice"}})
	result, err = s.mcpDebugTraces(ctx, req)
	if err != nil || !result.IsError {
		t.Fatal("invalid query reached storage")
	}
	s.mcpTimingEnabled = false
	req.Params.Arguments = json.RawMessage(`{}`)
	result, err = s.mcpDebugTraces(ctx, req)
	if err != nil || !result.IsError {
		t.Fatal("disabled diagnostics reached storage")
	}
}

func TestMCPTraceRecordingRequiresIdentityAndCapsPayload(t *testing.T) {
	saved := make(chan pendingMCPTrace, 2)
	s := &Service{mcpTraceWriter: newMCPTraceWriter(func(_ context.Context, r pendingMCPTrace) error { saved <- r; return nil })}
	defer s.mcpTraceWriter.close()
	raw := json.RawMessage(`{"trace":"id","tool":"blok_read","started_at":"2026-11-16T12:00:00Z","ms":12,"events":[]}`)
	s.recordMCPTiming(context.Background(), raw)
	ctx := context.WithValue(context.Background(), mcpUserKey{}, identity{User: User{ID: "alice"}})
	s.recordMCPTiming(ctx, bytes.Repeat([]byte(" "), maxMCPTraceBytes+1))
	s.recordMCPTiming(ctx, raw)
	raw[0] = ' '
	select {
	case r := <-saved:
		if r.userID != "alice" || r.traceID != "id" || r.data[0] != '{' {
			t.Fatal("trace identity or copied payload incorrect")
		}
	case <-time.After(time.Second):
		t.Fatal("trace missing")
	}
	select {
	case <-saved:
		t.Fatal("saved anonymous or oversized trace")
	default:
	}
}

func TestMCPDebugTracesArePrivateAndSummariesOmitEvents(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	w := newReadsWorld(t)
	for _, user := range []string{"alice", "bob"} {
		raw := json.RawMessage(`{"trace":"` + user + `-trace","events":[{"phase":"count","name":"blocks","value":7}]}`)
		if err := w.service.saveMCPTiming(w.ctx, pendingMCPTrace{userID: user, traceID: user + "-trace", tool: "blok_read", startedAt: time.Now(), durationMS: 20, documentRef: "opaque", data: raw}); err != nil {
			t.Fatal(err)
		}
	}
	list := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{}, false)
	traces, ok := list["traces"].([]any)
	if !ok || len(traces) != 1 {
		t.Fatal(list)
	}
	summary := traces[0].(map[string]any)
	if summary["traceId"] != "alice-trace" || summary["events"] != nil || summary["data"] != nil {
		t.Fatal(summary)
	}
	detail := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{"traceId": "alice-trace"}, false)
	if detail["trace"].(map[string]any)["events"] == nil {
		t.Fatal(detail)
	}
	denied := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{"traceId": "bob-trace"}, true)
	if denied["status"] != float64(404) {
		t.Fatal(denied)
	}
	filtered := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{"minDurationMs": 21}, false)
	if len(filtered["traces"].([]any)) != 0 {
		t.Fatal(filtered)
	}
}

func TestMCPDebugTraceRetentionAndLimit(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	w := newReadsWorld(t)
	if _, err := w.service.DB.Exec(w.ctx, `INSERT INTO mcp_debug_traces(trace_id,user_id,tool,started_at,duration_ms,document_ref,data) SELECT 'bulk-'||g,'alice','blok_read',now()-interval '1 hour'+g*interval '1 millisecond',1,'','{}'::jsonb FROM generate_series(1,1001) g; INSERT INTO mcp_debug_traces(trace_id,user_id,tool,started_at,duration_ms,document_ref,data) VALUES('expired','bob','blok_read',now()-interval '25 hours',1,'','{}'::jsonb)`); err != nil {
		t.Fatal(err)
	}
	if err := w.service.saveMCPTiming(w.ctx, pendingMCPTrace{userID: "bob", traceID: "latest", tool: "blok_read", startedAt: time.Now(), durationMS: 2, data: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	var count, expired int
	if err := w.service.DB.QueryRow(w.ctx, `SELECT count(*),count(*) FILTER(WHERE started_at<now()-interval '24 hours') FROM mcp_debug_traces`).Scan(&count, &expired); err != nil {
		t.Fatal(err)
	}
	if count != 1000 || expired != 0 {
		t.Fatalf("retained=%d expired=%d", count, expired)
	}
	list := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{"limit": 1}, false)
	traces := list["traces"].([]any)
	if len(traces) != 1 || traces[0].(map[string]any)["traceId"] != "bulk-1001" {
		t.Fatal(list)
	}
}

func TestMCPReadTraceCanBeRetrievedThroughMCP(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	w := newReadsWorld(t)
	opened := managementCall(t, w, "alice", "blok_open", map[string]any{"documentId": "public", "view": map[string]any{"limit": 1}}, false)
	handle, ok := opened["handle"].(string)
	if !ok {
		t.Fatal(opened)
	}
	defer managementCall(t, w, "alice", "blok_close", map[string]any{"handle": handle}, false)
	managementCall(t, w, "alice", "blok_read", map[string]any{"handle": handle, "limit": 1}, false)
	var traceID string
	deadline := time.Now().Add(3 * time.Second)
	for {
		err := w.service.DB.QueryRow(w.ctx, `SELECT trace_id FROM mcp_debug_traces WHERE user_id='alice' AND tool='blok_read' ORDER BY started_at DESC LIMIT 1`).Scan(&traceID)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("read diagnostic was not persisted: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	detail := managementCall(t, w, "alice", "blok_debug_traces", map[string]any{"traceId": traceID}, false)
	report := detail["trace"].(map[string]any)
	stages := map[string]bool{}
	for _, raw := range report["events"].([]any) {
		event := raw.(map[string]any)
		if event["phase"] == "end" {
			if stage, ok := event["stage"].(string); ok {
				stages[stage] = true
			}
		}
	}
	for _, stage := range []string{"handle_wait", "authorize", "lane_wait", "document_export", "runtime_execute"} {
		if !stages[stage] {
			t.Errorf("missing stage %s", stage)
		}
	}
}
