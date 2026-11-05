package blokagent

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// The stored Go runner over test/fixtures/agent-commands, as C#
// JintAgentParityTests runs it: one session per case, and the "jint"
// expectation, because Go sends the bundle the same input bytes C# does
// (host.json pins them) and so takes the same runtime path.

const corpusRoot = "test/fixtures/agent-commands"

type parityCase struct {
	name          string
	seed          *jsjson.Node
	batches       []*jsjson.Node
	expect        *jsjson.Node
	expectRunners *jsjson.Node
}

func loadCorpus(t *testing.T) []parityCase {
	t.Helper()
	var list []parityCase
	read := func(dir string) []string {
		entries, err := os.ReadDir(filepath.Join(repoRoot, corpusRoot, dir))
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".json") {
				names = append(names, entry.Name())
			}
		}
		slices.Sort(names)
		return names
	}
	for _, file := range read("cases") {
		item := mustParse(t, readRepoFile(t, filepath.Join(corpusRoot, "cases", file)))
		// The C# and Go runtimes get service names but no host bridge, so
		// a case with fixed services has a twin without them.
		if lookup(item, "services") != nil {
			continue
		}
		name, _ := stringOf(lookup(item, "name"))
		list = append(list, parityCase{name, lookup(item, "seed"), lookup(item, "batches").Items, lookup(item, "expect"), lookup(item, "expectByRunner")})
	}
	for _, file := range read("evals") {
		item := mustParse(t, readRepoFile(t, filepath.Join(corpusRoot, "evals", file)))
		if lookup(item, "parityExcluded") != nil {
			continue
		}
		id, _ := stringOf(lookup(item, "id"))
		list = append(list, parityCase{"eval:" + id, lookup(item, "seed"), lookup(item, "reference").Items, nil, lookup(item, "referenceExpectByRunner")})
	}
	return list
}

// expectedError is C# AgentParityCorpus.ExpectedError; "" means ok.
func expectedError(c parityCase, runner string) string {
	expectation := lookup(c.expectRunners, runner)
	if expectation == nil || expectation.Kind != jsjson.KindObject {
		expectation = c.expect
	}
	code, _ := stringOf(lookup(expectation, "errorCode"))
	return code
}

func callerChosenIDs(c parityCase) map[string]bool {
	ids := map[string]bool{}
	for _, block := range records(lookup(c.seed, "blocks")) {
		if id, ok := idOf(block); ok {
			ids[id] = true
		}
	}
	var collect func(node *jsjson.Node)
	collect = func(node *jsjson.Node) {
		switch {
		case node == nil:
		case node.Kind == jsjson.KindArray:
			for _, item := range node.Items {
				collect(item)
			}
		case node.Kind == jsjson.KindObject:
			if id, ok := idOf(node); ok {
				ids[id] = true
			}
			collect(lookup(node, "children"))
		}
	}
	for _, batch := range c.batches {
		for _, command := range records(lookup(batch, "commands")) {
			if name, _ := stringOf(lookup(command, "name")); name == "block.insert" {
				collect(lookup(command, "args"))
			}
		}
	}
	return ids
}

var unsafeNameChars = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func golden(t *testing.T, name string) *jsjson.Node {
	t.Helper()
	path := filepath.Join(repoRoot, corpusRoot, "goldens", unsafeNameChars.ReplaceAllString(name, "__")+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return lookup(mustParse(t, string(raw)), "document")
}

var (
	bundleOnce     sync.Once
	bundleExecutor *Executor
	bundleErr      error
)

// sharedExecutor is one pool for the package's real-bundle tests: each
// engine parses the bundle.
func sharedExecutor(t *testing.T) *Executor {
	t.Helper()
	bundleOnce.Do(func() { bundleExecutor, bundleErr = New(FactoryOptions{PoolSize: new(1)}) })
	if bundleErr != nil {
		t.Fatal(bundleErr)
	}
	return bundleExecutor
}

func TestMatchesTheAgentCommandCorpus(t *testing.T) {
	loadRichFields(t)
	executor := sharedExecutor(t)
	corpus := loadCorpus(t)
	// 39 cases and 13 evals, as the C# reader counts them.
	if len(corpus) != 52 {
		t.Fatalf("corpus has %d runnable cases, want 52", len(corpus))
	}
	onBehalfOf := "human-1"
	for _, c := range corpus {
		t.Run(c.name, func(t *testing.T) {
			ctx := context.Background()
			document, err := write(c.seed)
			if err != nil {
				t.Fatal(err)
			}
			session := executor.OpenSession(Actor{ID: "agent-test", Name: "Parity", OnBehalfOf: &onBehalfOf}, nil)
			code := ""
			for _, batch := range c.batches {
				batchJSON, err := write(batch)
				if err != nil {
					t.Fatal(err)
				}
				execution, err := session.Execute(ctx, document, batchJSON)
				if err != nil {
					t.Fatalf("execute: %v", err)
				}
				result := mustParse(t, execution.ResultJSON)
				if ok, _ := isTrue(result, "ok"); !ok {
					code, _ = stringOf(lookup(lookup(result, "error"), "code"))
					break
				}
				document = *execution.DocumentJSON
			}
			if want := expectedError(c, "jint"); code != want {
				t.Fatalf("error %q, want %q", code, want)
			}
			if code != "" || expectedError(c, "json") != "" {
				return
			}
			want := golden(t, c.name)
			if want == nil {
				t.Fatal("no golden")
			}
			got := normalizeDocument(mustParse(t, document), callerChosenIDs(c))
			if stable(t, got) != stable(t, want) {
				t.Fatalf("document\n got %s\nwant %s", stable(t, got), stable(t, want))
			}
		})
	}
}

// The live-room Go runner over the same corpus, as C# RoomAgentParityTests:
// a real room on the real converter and journal, the "room" expectation,
// and the stored golden when the case succeeds everywhere.
func TestMatchesTheAgentCommandCorpusInARoom(t *testing.T) {
	loadRichFields(t)
	corpus := loadCorpus(t)
	if len(corpus) != 52 {
		t.Fatalf("corpus has %d runnable cases, want 52", len(corpus))
	}
	onBehalfOf := "human-1"
	actor := Actor{ID: "agent-test", Name: "Parity", OnBehalfOf: &onBehalfOf}
	for _, c := range corpus {
		t.Run(c.name, func(t *testing.T) {
			ctx := context.Background()
			rooms := newTestRoom(t, false, nil)
			seed, err := write(c.seed)
			if err != nil {
				t.Fatal(err)
			}
			doc := "parity-" + newGUID()
			rooms.docs.hold(doc, seed)
			code := ""
			for _, batch := range c.batches {
				batchJSON, err := write(batch)
				if err != nil {
					t.Fatal(err)
				}
				execution, err := rooms.executor.ExecuteInRoom(ctx, doc, batchJSON, actor, nil)
				if err != nil {
					t.Fatalf("execute: %v", err)
				}
				result := mustParse(t, execution.ResultJSON)
				if ok, _ := isTrue(result, "ok"); !ok {
					code, _ = stringOf(lookup(lookup(result, "error"), "code"))
					break
				}
			}
			if want := expectedError(c, "room"); code != want {
				t.Fatalf("error %q, want %q", code, want)
			}
			// Same gate as the stored runner: content only.
			if code != "" || expectedError(c, "json") != "" {
				return
			}
			want := golden(t, c.name)
			if want == nil {
				t.Fatal("no golden")
			}
			got := normalizeDocument(rooms.export(t, doc), callerChosenIDs(c))
			if stable(t, got) != stable(t, want) {
				t.Fatalf("document\n got %s\nwant %s", stable(t, got), stable(t, want))
			}
		})
	}
}
