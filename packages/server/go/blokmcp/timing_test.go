package blokmcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPDispatchDeliversPrivateTimingReportsOnlyWhenEnabled(t *testing.T) {
	for _, enabled := range []string{"0", "1"} {
		t.Run(enabled, func(t *testing.T) {
			t.Setenv("BLOK_MCP_TIMING", enabled)
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "private-document.json"), []byte(`{"blocks":[{"id":"p","type":"paragraph","data":{"text":"private page contents"}}]}`), 0600); err != nil {
				t.Fatal(err)
			}
			type ownerKey struct{}
			var reports []json.RawMessage
			server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: dir}, OnTiming: func(ctx context.Context, raw json.RawMessage) {
				if ctx.Value(ownerKey{}) != "owner" {
					t.Error("observer lost caller identity context")
				}
				reports = append(reports, raw)
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer server.Close()
			ctx := context.WithValue(context.Background(), ownerKey{}, "owner")
			who, err := server.actorFor(ctx, "alice", nil)
			if err != nil {
				t.Fatal(err)
			}
			opened, err := server.dispatch(ctx, &toolCall{name: "blok_open", arguments: json.RawMessage(`{"documentId":"private-document","view":{}}`), caller: who})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(opened.answer), "private page contents") {
				t.Fatal("read content changed")
			}
			if strings.Contains(string(opened.answer), "document_ref") {
				t.Fatal("diagnostics changed MCP answer")
			}
			handle, ok := structured(t, opened.answer)["handle"].(string)
			if !ok || handle == "" {
				t.Fatal("open did not return a handle")
			}
			arguments, err := json.Marshal(map[string]any{"handle": handle})
			if err != nil {
				t.Fatal(err)
			}
			read, err := server.dispatch(ctx, &toolCall{name: "blok_read", arguments: arguments, caller: who})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(read.answer), "private page contents") {
				t.Fatal("read content changed")
			}
			if strings.Contains(string(read.answer), "document_ref") {
				t.Fatal("diagnostics changed MCP read answer")
			}
			if enabled == "0" {
				if len(reports) != 0 {
					t.Fatal("unexpected report")
				}
				return
			}
			if len(reports) != 2 {
				t.Fatalf("reports=%d", len(reports))
			}
			for i, raw := range reports {
				for _, private := range []string{"private-document", "private page contents", "alice"} {
					if strings.Contains(string(raw), private) {
						t.Fatalf("report leaked %q", private)
					}
				}
				var report struct {
					Trace       string `json:"trace"`
					DocumentRef string `json:"document_ref"`
					Tool        string `json:"tool"`
				}
				if err := json.Unmarshal(raw, &report); err != nil {
					t.Fatal(err)
				}
				if report.Trace == "" || report.DocumentRef == "" || report.Tool != []string{"blok_open", "blok_read"}[i] {
					t.Fatal(string(raw))
				}
			}
		})
	}
}
