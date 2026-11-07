package blokagent

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// zoneEnv names the one zone a child run checks.
const zoneEnv = "BLOK_FORMULA_DATES_ZONE"

// formula-dates.json holds Jint's answers to one agent read per host zone.
// goja reads the host zone through time.Local, which runtime timers read
// too, so a test may not set it while other work runs: each zone runs in a
// child process that sets it before anything starts. Not TZ: Go ignores it
// on Windows.
func TestReadsFormulaDatesInTheHostZoneAsJintDoes(t *testing.T) {
	fixture := mustParse(t, readRepoFile(t, "test/unit/server-conformance/fixtures/agent/formula-dates.json"))
	zones := lookup(fixture, "zones")
	if zones == nil || len(zones.Members) < 2 {
		t.Fatal("the fixture needs at least two zones")
	}
	if zone := os.Getenv(zoneEnv); zone != "" {
		for _, m := range zones.Members {
			if key, _ := m.Key(); key.String() == zone {
				location, err := time.LoadLocation(zone)
				if err != nil {
					t.Fatal(err)
				}
				time.Local = location
				document, _ := stringOf(lookup(fixture, "document"))
				batch, _ := stringOf(lookup(fixture, "batch"))
				execution, err := sharedExecutor(t).Execute(context.Background(), document, batch, Actor{ID: "a", Name: "A"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				computed, _ := pointer(mustParse(t, execution.ResultJSON), "/results/0/blocks/0/computed")
				if got, want := stable(t, computed), stable(t, m.Value); got != want {
					t.Fatalf("got  %s\nwant %s", got, want)
				}
				return
			}
		}
		t.Fatalf("no zone %s in the fixture", zone)
	}
	for _, m := range zones.Members {
		key, _ := m.Key()
		zone := key.String()
		t.Run(zone, func(t *testing.T) {
			child := exec.Command(os.Args[0], "-test.run=^TestReadsFormulaDatesInTheHostZoneAsJintDoes$", "-test.count=1", "-test.v")
			child.Env = append(os.Environ(), zoneEnv+"="+zone)
			out, err := child.CombinedOutput()
			if err != nil || !strings.Contains(string(out), "--- PASS: TestReadsFormulaDatesInTheHostZoneAsJintDoes") {
				t.Fatalf("%v\n%s", err, out)
			}
		})
	}
}
