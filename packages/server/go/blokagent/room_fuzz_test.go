package blokagent

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Seeds are the expectRevision texts of the room-expect-* scenarios.
func FuzzParseHead(f *testing.F) {
	for _, seed := range []string{"a:L:0", "L:00", "L:0\x00", ":1", "", "h123", "L:-1", "L: 1", "L:7", "L:18446744073709551616", "é:1"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, head string) {
		got := parseHeadText(head)
		colon := strings.LastIndexByte(head, ':')
		if colon <= 0 {
			if got != nil {
				t.Fatalf("%q parsed without a lineage", head)
			}
			return
		}
		sequence, ok := dotnet.ParseUInt64None(head[colon+1:])
		if !ok {
			if got != nil {
				t.Fatalf("%q parsed a bad sequence", head)
			}
			return
		}
		if got == nil || got.Lineage != head[:colon] || got.Sequence != sequence {
			t.Fatalf("%q parsed as %+v", head, got)
		}
		again := parseHeadText(headOf(got))
		if again == nil || *again != *got {
			t.Fatalf("%q does not round trip: %+v", head, again)
		}
	})
}

// The batch readers must never panic on hostile JSON, and history and
// version commands never overlap.
func FuzzBatchCommands(f *testing.F) {
	for _, seed := range []string{
		`{"commands":[{"name":"history.undo","args":{}}]}`,
		`{"commands":[{"name":"history.redo","args":{},"ref":"r"}]}`,
		`{"commands":[{"name":"history.undo","args":{"x":1}}]}`,
		`{"commands":[{"name":"block.insert","args":{}},{"name":"history.versions","args":{}}]}`,
		`{"commands":[{"name":"history.restore","args":{"version":"v:1"}}]}`,
		`{"commands":[{"name":"history.read","args":null}]}`,
		`{"commands":[{"name":"\ud800"}]}`,
		`{"commands":[null,1,"x",{"name":5}]}`,
		`{"commands":{}}`,
		`[]`,
		`null`,
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		batch, err := parse(text)
		if err != nil || batch == nil {
			return
		}
		history, _ := historyCommand(batch)
		if history != "" && history != "history.undo" && history != "history.redo" {
			t.Fatalf("history command %q", history)
		}
		version, args, _ := versionCommand(batch)
		switch version {
		case "":
		case "history.versions", "history.read", "history.changes", "history.restore":
			if args == nil || args.Kind != jsjson.KindObject {
				t.Fatalf("%s args %v", version, args)
			}
		default:
			t.Fatalf("version command %q", version)
		}
		if history != "" && version != "" {
			t.Fatalf("%q is both %s and %s", text, history, version)
		}
		_, _ = hasCommand(batch, "block.insert")
		_, _ = hasCommand(batch, "page.rename", "page.setIcon")
	})
}
