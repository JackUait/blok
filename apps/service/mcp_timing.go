package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const maxMCPTraceBytes = 128 << 10

type pendingMCPTrace struct {
	userID      string
	traceID     string
	tool        string
	startedAt   time.Time
	durationMS  float64
	documentRef string
	data        json.RawMessage
}

// Diagnostics must never add storage latency or backpressure to an MCP call.
type mcpTraceWriter struct {
	queue   chan pendingMCPTrace
	cancel  context.CancelFunc
	done    chan struct{}
	once    sync.Once
	failed  atomic.Uint64
	dropped atomic.Uint64
}

func newMCPTraceWriter(save func(context.Context, pendingMCPTrace) error) *mcpTraceWriter {
	ctx, cancel := context.WithCancel(context.Background())
	w := &mcpTraceWriter{queue: make(chan pendingMCPTrace, 32), cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(w.done)
		for {
			select {
			case <-ctx.Done():
				return
			case record := <-w.queue:
				if ctx.Err() != nil {
					return
				}
				writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
				if err := save(writeCtx, record); err != nil {
					count := w.failed.Add(1)
					if count == 1 || count%100 == 0 {
						slog.Warn("MCP timing storage failed", "count", count)
					}
				}
				stop()
			}
		}
	}()
	return w
}
func (w *mcpTraceWriter) enqueue(record pendingMCPTrace) {
	if w == nil {
		return
	}
	select {
	case <-w.done:
		w.reportDrop()
		return
	default:
	}
	select {
	case w.queue <- record:
	default:
		w.reportDrop()
	}
}

// reportDrop logs only aggregate counts, never identities, payloads or errors.
func (w *mcpTraceWriter) reportDrop() {
	count := w.dropped.Add(1)
	if count == 1 || count%100 == 0 {
		slog.Warn("MCP timing reports dropped", "count", count)
	}
}

func (w *mcpTraceWriter) close() {
	if w == nil {
		return
	}
	w.once.Do(w.cancel)
	select {
	case <-w.done:
	case <-time.After(2500 * time.Millisecond):
	}
}

func (s *Service) recordMCPTiming(ctx context.Context, raw json.RawMessage) {
	u, ok := ctx.Value(mcpUserKey{}).(identity)
	if !ok || u.ID == "" || s.mcpTraceWriter == nil {
		return
	}
	if len(raw) > maxMCPTraceBytes {
		s.mcpTraceWriter.reportDrop()
		return
	}
	var header struct {
		Trace     string    `json:"trace"`
		Tool      string    `json:"tool"`
		Document  string    `json:"document_ref"`
		StartedAt time.Time `json:"started_at"`
		MS        float64   `json:"ms"`
	}
	if json.Unmarshal(raw, &header) != nil || header.Trace == "" || len(header.Trace) > 128 || header.Tool == "" || len(header.Tool) > 128 || len(header.Document) > 128 || header.StartedAt.IsZero() || header.MS < 0 || math.IsNaN(header.MS) || math.IsInf(header.MS, 0) {
		s.mcpTraceWriter.reportDrop()
		return
	}
	s.mcpTraceWriter.enqueue(pendingMCPTrace{userID: u.ID, traceID: header.Trace, tool: header.Tool, startedAt: header.StartedAt, durationMS: header.MS, documentRef: header.Document, data: append(json.RawMessage(nil), raw...)})
}

func (s *Service) saveMCPTiming(ctx context.Context, record pendingMCPTrace) error {
	// A transaction advisory lock also bounds retention when several replicas record traces.
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(774839104)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mcp_debug_traces(trace_id,user_id,tool,started_at,duration_ms,document_ref,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(trace_id) DO NOTHING`, record.traceID, record.userID, record.tool, record.startedAt, record.durationMS, record.documentRef, record.data); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM mcp_debug_traces WHERE started_at<now()-interval '24 hours' OR trace_id IN (SELECT trace_id FROM mcp_debug_traces ORDER BY started_at DESC,trace_id DESC OFFSET 1000)`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) registerMCPDebugTraces(server *mcp.Server) {
	if !s.mcpTimingEnabled {
		return
	}
	server.AddTool(&mcp.Tool{Name: "blok_debug_traces", Description: "Read your own temporary MCP timing traces. Without traceId returns summaries; with traceId returns one detailed trace. Traces expire after 24 hours and storage is bounded globally. Available only while server MCP timing diagnostics are enabled.", InputSchema: json.RawMessage(`{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":50},"minDurationMs":{"type":"number","minimum":0},"traceId":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":false}`), Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpDebugTraces)
}

type mcpTraceQuery struct {
	Limit         *int     `json:"limit"`
	MinDurationMS *float64 `json:"minDurationMs"`
	TraceID       *string  `json:"traceId"`
}

func parseMCPTraceQuery(raw []byte) (mcpTraceQuery, error) {
	var in mcpTraceQuery
	if len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return in, errors.New("Expected an argument object")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, errors.New("Invalid trace arguments")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return in, errors.New("Invalid trace arguments")
	}
	if in.Limit != nil && (*in.Limit < 1 || *in.Limit > 50) {
		return in, errors.New("limit must be between 1 and 50")
	}
	if in.MinDurationMS != nil && (*in.MinDurationMS < 0 || math.IsInf(*in.MinDurationMS, 0) || math.IsNaN(*in.MinDurationMS)) {
		return in, errors.New("minDurationMs must be nonnegative")
	}
	if in.TraceID != nil && (len(*in.TraceID) == 0 || len(*in.TraceID) > 128) {
		return in, errors.New("Invalid traceId")
	}
	return in, nil
}
func (s *Service) mcpDebugTraces(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	u, ok := ctx.Value(mcpUserKey{}).(identity)
	if !ok || u.ID == "" {
		return managementFailure(401, "MCP identity required"), nil
	}
	if !s.mcpTimingEnabled {
		return managementFailure(404, "MCP timing diagnostics disabled"), nil
	}
	in, err := parseMCPTraceQuery(req.Params.Arguments)
	if err != nil {
		return managementFailure(400, err.Error()), nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if in.TraceID != nil {
		var data json.RawMessage
		err = s.DB.QueryRow(ctx, `SELECT data FROM mcp_debug_traces WHERE user_id=$1 AND trace_id=$2 AND started_at>=now()-interval '24 hours'`, u.ID, *in.TraceID).Scan(&data)
		if errors.Is(err, pgx.ErrNoRows) {
			return managementFailure(404, "Trace not found"), nil
		}
		if err != nil {
			return managementFailure(503, "Traces unavailable"), nil
		}
		return mcpText(map[string]any{"trace": data}), nil
	}
	limit := 10
	if in.Limit != nil {
		limit = *in.Limit
	}
	minimum := float64(0)
	if in.MinDurationMS != nil {
		minimum = *in.MinDurationMS
	}
	rows, err := s.DB.Query(ctx, `SELECT trace_id,tool,started_at,duration_ms,document_ref FROM mcp_debug_traces WHERE user_id=$1 AND started_at>=now()-interval '24 hours' AND duration_ms>=$2 ORDER BY started_at DESC,trace_id DESC LIMIT $3`, u.ID, minimum, limit)
	if err != nil {
		return managementFailure(503, "Traces unavailable"), nil
	}
	defer rows.Close()
	traces := []map[string]any{}
	for rows.Next() {
		var id, tool, document string
		var started time.Time
		var duration float64
		if rows.Scan(&id, &tool, &started, &duration, &document) != nil {
			return managementFailure(503, "Traces unavailable"), nil
		}
		traces = append(traces, map[string]any{"traceId": id, "tool": tool, "startedAt": started, "durationMs": duration, "documentRef": document})
	}
	if rows.Err() != nil {
		return managementFailure(503, "Traces unavailable"), nil
	}
	return mcpText(map[string]any{"traces": traces}), nil
}

func mcpTimingFlag() bool { return os.Getenv("BLOK_MCP_TIMING") == "1" }
