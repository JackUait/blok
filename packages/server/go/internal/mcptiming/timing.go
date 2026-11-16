// Package mcptiming records opt-in MCP diagnostics using internal metadata only.
package mcptiming

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"
)

type contextKey struct{}
type sinkKey struct{}

const (
	maxEvents     = 256
	maxEventBytes = 60 << 10
)

type trace struct {
	mu                 sync.Mutex
	id, tool, document string
	started            time.Time
	sink               func(json.RawMessage)
	events             []json.RawMessage
	eventBytes         int
	truncated          bool
	finished           bool
}

type report struct {
	Trace     string            `json:"trace"`
	Tool      string            `json:"tool"`
	Document  string            `json:"document_ref,omitempty"`
	StartedAt string            `json:"started_at"`
	MS        float64           `json:"ms"`
	Events    []json.RawMessage `json:"events"`
	Truncated bool              `json:"truncated"`
}

type event struct {
	Trace    string   `json:"trace"`
	Tool     string   `json:"tool"`
	Document string   `json:"document_ref,omitempty"`
	Phase    string   `json:"phase"`
	Stage    string   `json:"stage,omitempty"`
	MS       *float64 `json:"ms,omitempty"`
	Name     string   `json:"name,omitempty"`
	Value    *int     `json:"value,omitempty"`
}

func noop() {}

func from(ctx context.Context) *trace {
	t, _ := ctx.Value(contextKey{}).(*trace)
	return t
}

// WithSink attaches an optional receiver for the completed diagnostic report.
// No report is collected or delivered when diagnostics are disabled.
func WithSink(ctx context.Context, sink func(json.RawMessage)) context.Context {
	return context.WithValue(ctx, sinkKey{}, sink)
}

// Start starts one native tool call. Nested callers share its trace.
func Start(ctx context.Context, tool string) (context.Context, func()) {
	if from(ctx) != nil {
		return ctx, noop
	}
	if os.Getenv("BLOK_MCP_TIMING") != "1" {
		return ctx, noop
	}
	switch tool {
	case "blok_list_documents", "blok_open", "blok_close", "blok_read", "blok_describe", "blok_execute", "blok_upload_image":
	default:
		return ctx, noop
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return ctx, noop
	}
	started := time.Now()
	sink, _ := ctx.Value(sinkKey{}).(func(json.RawMessage))
	t := &trace{id: hex.EncodeToString(id[:]), tool: tool, started: started, sink: sink}
	ctx = context.WithValue(ctx, contextKey{}, t)
	t.emit(event{Phase: "start"})
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			ms := milliseconds(started)
			t.emit(event{Phase: "finish", MS: &ms})
			t.deliver(ms)
		})
	}
}

func milliseconds(start time.Time) float64 {
	return float64(time.Since(start)) / float64(time.Millisecond)
}

// Span times an internal stage; stopping it more than once has no effect.
// Stage names must be constants from the implementation, never user content.
func Span(ctx context.Context, stage string) func() {
	t := from(ctx)
	if t == nil {
		return noop
	}
	started := time.Now()
	t.emit(event{Phase: "begin", Stage: stage})
	var once sync.Once
	return func() {
		once.Do(func() {
			ms := milliseconds(started)
			t.emit(event{Phase: "end", Stage: stage, MS: &ms})
		})
	}
}

// Count records a numeric size under a constant internal metric name.
func Count(ctx context.Context, name string, value int) {
	if t := from(ctx); t != nil {
		t.emit(event{Phase: "count", Name: name, Value: &value})
	}
}

// Document attaches a stable opaque reference without recording the document ID.
func Document(ctx context.Context, id string) {
	if t := from(ctx); t != nil {
		digest := sha256.Sum256([]byte(id))
		t.mu.Lock()
		t.document = hex.EncodeToString(digest[:8])
		t.mu.Unlock()
	}
}

// Carry preserves base's cancellation and values, adding only source's trace.
func Carry(base, source context.Context) context.Context {
	if t := from(source); t != nil {
		return context.WithValue(base, contextKey{}, t)
	}
	return base
}

func (t *trace) emit(e event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.finished {
		return
	}
	e.Trace, e.Tool, e.Document = t.id, t.tool, t.document
	if data, err := json.Marshal(e); err == nil {
		log.Printf("blok_mcp_timing %s", data)
		if t.sink != nil {
			if len(t.events) < maxEvents && t.eventBytes+len(data) <= maxEventBytes {
				t.events = append(t.events, json.RawMessage(data))
				t.eventBytes += len(data)
			} else {
				t.truncated = true
			}
		}
	}
}

func (t *trace) deliver(ms float64) {
	t.mu.Lock()
	t.finished = true
	sink := t.sink
	r := report{
		Trace: t.id, Tool: t.tool, Document: t.document,
		StartedAt: t.started.UTC().Format(time.RFC3339Nano), MS: ms,
		Events: t.events, Truncated: t.truncated,
	}
	t.events = nil
	t.sink = nil
	t.mu.Unlock()
	if sink == nil {
		return
	}
	data, err := json.Marshal(r)
	if err != nil {
		return
	}
	defer func() {
		if recover() != nil {
			log.Print("blok_mcp_timing observer panicked")
		}
	}()
	sink(json.RawMessage(data))
}
