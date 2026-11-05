package blokserver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokagent"
	"github.com/JackUait/blok/packages/server/go/blokdocs"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// C# AddBlokServer registers one IBlokRuntime that the converter, the agent
// executor and the rooms share; a host sizes it by calling AddBlokDocuments
// first (BlokDocumentsServiceCollectionExtensions.cs, BlokDocumentsRegistrationTests).

func countBuilds(t *testing.T, gate <-chan struct{}) (*int, *[]jsruntime.Options) {
	builds := 0
	var seen []jsruntime.Options
	previous := newCollabRuntime
	newCollabRuntime = func(o jsruntime.Options) (*jsruntime.Pool, error) {
		if gate != nil {
			<-gate
		}
		builds++
		seen = append(seen, o)
		return previous(o)
	}
	t.Cleanup(func() { newCollabRuntime = previous })
	return &builds, &seen
}

func documentsOptions() Options {
	o := DefaultOptions()
	o.Auth = new("none")
	o.StorageDirectory = ""
	return o
}

// Twin of RegistersOneConverterAcrossRepeatedAndMixedRegistration and
// TakesTheTimeoutTheCallerAsksFor.
func TestTheDocumentConverterSharesTheAgentsEnginePoolAndTakesItsSize(t *testing.T) {
	builds, seen := countBuilds(t, nil)
	o := documentsOptions()
	// An agent call needs 65 to 80 MiB in C# (measured).
	o.Documents = blokdocs.Options{PoolSize: new(1), Timeout: 2 * time.Minute, MemoryBudget: 128 << 20}
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	converter := s.DocumentConverter()
	if again := s.DocumentConverter(); again != converter {
		t.Fatal("a second call built another converter")
	}
	converted, err := converter.ToMarkdown(context.Background(), `{"blocks":[{"type":"paragraph","data":{"text":"Hi"}}]}`)
	if err != nil || converted.Markdown != "Hi" {
		t.Fatalf("%+v, %v", converted, err)
	}
	executor, err := s.AgentExecutor()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := executor.Execute(context.Background(), `{"blocks":[]}`,
		`{"commands":[{"name":"doc.setTitle","args":{"title":"T"}}]}`, blokagent.Actor{ID: "a", Name: "A"}, nil); err != nil {
		t.Fatal(err)
	}
	if *builds != 1 {
		t.Fatalf("%d engine pools built, want 1", *builds)
	}
	got := (*seen)[0]
	if got.PoolSize == nil || *got.PoolSize != 1 || got.Timeout != 2*time.Minute || got.MemoryBudget != 128<<20 {
		t.Fatalf("pool built with %+v, want size 1, 2m, 128 MiB", got)
	}
}

// AddBlokDocuments validates its constraints in the call, not at the first
// conversion.
func TestNewRefusesDocumentLimitsBelowTheirFloor(t *testing.T) {
	for name, documents := range map[string]blokdocs.Options{
		"timeout":        {Timeout: time.Millisecond},
		"memory budget":  {MemoryBudget: 1},
		"pool size":      {PoolSize: new(-1)},
		"zero pool size": {PoolSize: new(0)},
	} {
		o := documentsOptions()
		o.Documents = documents
		_, err := New(o)
		var constraint *blokdocs.ConstraintError
		if !errors.As(err, &constraint) {
			t.Errorf("%s: %v, want a ConstraintError", name, err)
		}
	}
}

// Twin of SkipsTheWarmUpWhenItIsNotWanted: AddBlokServer registers no warm-up.
func TestNewBuildsNoEnginePoolWithoutWarmUp(t *testing.T) {
	builds, _ := countBuilds(t, nil)
	s, err := New(documentsOptions())
	if err != nil {
		t.Fatal(err)
	}
	_ = s.DocumentConverter()
	if *builds != 0 {
		t.Fatalf("%d engine pools built before any call", *builds)
	}
}

// Twin of BuildsTheConverterOffTheStartupPath and
// ConvertsSomethingAtStartupRatherThanOnlyBuildingThePool.
func TestWarmUpBuildsTheSharedPoolInTheBackground(t *testing.T) {
	gate := make(chan struct{})
	builds, _ := countBuilds(t, gate)
	o := documentsOptions()
	o.Documents.WarmUp = true
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	if *builds != 0 {
		t.Fatal("the pool was built while New ran")
	}
	close(gate)
	select {
	case <-s.warmed:
	case <-time.After(60 * time.Second):
		t.Fatal("the warm-up never finished")
	}
	if *builds != 1 {
		t.Fatalf("%d engine pools built, want 1", *builds)
	}
	if _, err := s.DocumentConverter().ToPlainText(context.Background(), `{"blocks":[]}`, false); err != nil {
		t.Fatal(err)
	}
	if *builds != 1 {
		t.Fatalf("the converter built a second pool (%d)", *builds)
	}
}
