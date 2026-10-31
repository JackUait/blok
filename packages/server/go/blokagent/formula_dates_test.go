package blokagent

import (
	"context"
	"testing"
	"time"
)

// formula-dates.json holds Jint's answers to one agent read per host zone.
// goja reads the host zone through time.Local, so each zone is set in turn.
func TestReadsFormulaDatesInTheHostZoneAsJintDoes(t *testing.T) {
	executor := sharedExecutor(t)
	fixture := mustParse(t, readRepoFile(t, "test/unit/server-conformance/fixtures/agent/formula-dates.json"))
	document, _ := stringOf(lookup(fixture, "document"))
	batch, _ := stringOf(lookup(fixture, "batch"))
	zones := lookup(fixture, "zones")
	if zones == nil || len(zones.Members) < 2 {
		t.Fatal("the fixture needs at least two zones")
	}
	saved := time.Local
	defer func() { time.Local = saved }()
	for _, m := range zones.Members {
		key, _ := m.Key()
		zone := key.String()
		t.Run(zone, func(t *testing.T) {
			location, err := time.LoadLocation(zone)
			if err != nil {
				t.Fatal(err)
			}
			time.Local = location
			execution, err := executor.Execute(context.Background(), document, batch, Actor{ID: "a", Name: "A"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			computed, _ := pointer(mustParse(t, execution.ResultJSON), "/results/0/blocks/0/computed")
			if got, want := stable(t, computed), stable(t, m.Value); got != want {
				t.Fatalf("got  %s\nwant %s", got, want)
			}
		})
	}
}
