package mcptiming

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"strings"
	"testing"
)

func capture(t *testing.T) *bytes.Buffer {
	t.Helper()
	var b bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&b)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &b
}

func TestDisabledTimingDoesNotLog(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "0")
	b := capture(t)
	ctx, finish := Start(context.Background(), "blok_read")
	Document(ctx, "private-doc")
	Count(ctx, "blocks", 2)
	Span(ctx, "export")()
	finish()
	if b.Len() != 0 {
		t.Fatal(b.String())
	}
}

func TestCorrelatesStagesWithoutLoggingDocumentOrArguments(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	b := capture(t)
	ctx, finish := Start(context.Background(), "blok_read")
	Document(ctx, "secret-document-id")
	// The room keeps its lifetime cancellation semantics while carrying diagnostics.
	caller, cancel := context.WithCancel(ctx)
	cancel()
	roomCtx := Carry(context.Background(), caller)
	if roomCtx.Err() != nil {
		t.Fatal("carried caller cancellation into room")
	}
	stop := Span(roomCtx, "export")
	Count(roomCtx, "blocks", 776)
	stop()
	stop()
	finish()
	if strings.Contains(b.String(), "secret-document-id") {
		t.Fatal("document id leaked")
	}
	var trace string
	ends := 0
	finished := false
	for _, line := range strings.Split(strings.TrimSpace(b.String()), "\n") {
		_, raw, ok := strings.Cut(line, "blok_mcp_timing ")
		if !ok {
			t.Fatal(line)
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(raw), &entry); err != nil {
			t.Fatal(err)
		}
		id, _ := entry["trace"].(string)
		if id == "" {
			t.Fatal("missing trace")
		}
		if trace == "" {
			trace = id
		}
		if trace != id {
			t.Fatal("lost correlation")
		}
		if entry["stage"] == "export" && entry["phase"] == "end" {
			ends++
			if _, ok := entry["ms"].(float64); !ok {
				t.Fatal("missing duration")
			}
		}
		if entry["phase"] == "finish" {
			finished = true
		}
	}
	if ends != 1 || !finished {
		t.Fatalf("ends=%d finished=%v", ends, finished)
	}
}

func TestUnknownToolsCannotPutArbitraryTextInLogs(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	b := capture(t)
	_, finish := Start(context.Background(), "private contents supplied as a tool name")
	finish()
	if b.Len() != 0 {
		t.Fatal(b.String())
	}
}

func TestReportsAreBoundedAndDeliveredOnce(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "1")
	capture(t)
	reports := 0
	var raw json.RawMessage
	ctx := WithSink(context.Background(), func(report json.RawMessage) { reports++; raw = report })
	ctx, finish := Start(ctx, "blok_read")
	_, nestedFinish := Start(ctx, "blok_read")
	nestedFinish()
	for i := 0; i < 1000; i++ {
		Span(ctx, "export")()
	}
	finish()
	finish()
	var report struct {
		Trace     string            `json:"trace"`
		StartedAt string            `json:"started_at"`
		Events    []json.RawMessage `json:"events"`
		Truncated bool              `json:"truncated"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	if reports != 1 || report.Trace == "" || report.StartedAt == "" || len(report.Events) > 256 || !report.Truncated {
		t.Fatalf("invalid report count=%d events=%d truncated=%v", reports, len(report.Events), report.Truncated)
	}
}

func TestDisabledTimingDoesNotDeliverReports(t *testing.T) {
	t.Setenv("BLOK_MCP_TIMING", "0")
	ctx := WithSink(context.Background(), func(json.RawMessage) { t.Error("disabled diagnostics delivered a report") })
	_, finish := Start(ctx, "blok_read")
	finish()
}
