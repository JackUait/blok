package room

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs/yjstest"
)

// Twin of C# CollabChangeSignalsCaptureTests: windows and their signals, from
// fixtures/collab-history/signals.json.

type signalsFixture struct {
	Cases []struct {
		Name     string `json:"name"`
		WindowMs int64  `json:"windowMs"`
		Records  []struct {
			Lineage     string  `json:"lineage"`
			Sequence    uint64  `json:"sequence"`
			CommittedAt int64   `json:"committedAt"`
			Actor       *string `json:"actor"`
			Note        *struct {
				Kind       string  `json:"kind"`
				OnBehalfOf *string `json:"onBehalfOf"`
			} `json:"note"`
			Blocks     []fixtureBlock      `json:"blocks"`
			Page       []string            `json:"page"`
			Properties []fixtureProperties `json:"properties"`
			Schema     []fixtureSchema     `json:"schema"`
		} `json:"records"`
		Signals []fixtureSignal `json:"signals"`
	} `json:"cases"`
}

type fixtureBlock struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

type fixtureProperties struct {
	RowID string   `json:"rowId"`
	IDs   []string `json:"ids"`
}

type fixtureSchema struct {
	DatabaseID string  `json:"databaseId"`
	ID         string  `json:"id"`
	Name       *string `json:"name"`
	Action     string  `json:"action"`
}

type fixtureSignal struct {
	Doc          string              `json:"doc"`
	Lineage      string              `json:"lineage"`
	FromSequence uint64              `json:"fromSequence"`
	ToSequence   uint64              `json:"toSequence"`
	WindowStart  int64               `json:"windowStart"`
	WindowEnd    int64               `json:"windowEnd"`
	Blocks       []fixtureBlock      `json:"blocks"`
	Page         []string            `json:"page"`
	Properties   []fixtureProperties `json:"properties"`
	Schema       []fixtureSchema     `json:"schema"`
	Authors      []struct {
		ID   string  `json:"id"`
		Kind *string `json:"kind"`
	} `json:"authors"`
}

func TestSignalsFixture(t *testing.T) {
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "test", "unit", "server-conformance", "fixtures", "collab-history", "signals.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture signalsFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) < 5 {
		t.Fatalf("only %d cases", len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			records := make([]SignalRecord, len(c.Records))
			for i, r := range c.Records {
				var note *RecordNote
				if r.Note != nil {
					note = &RecordNote{Kind: r.Note.Kind}
					if r.Note.OnBehalfOf != nil {
						note.OnBehalfOf = *r.Note.OnBehalfOf
					}
				}
				record := SignalRecord{
					Lineage: r.Lineage, Sequence: r.Sequence, CommittedAt: time.UnixMilli(r.CommittedAt).UTC(),
					Actor: r.Actor, Note: note, Page: r.Page,
				}
				for _, b := range r.Blocks {
					record.Blocks = append(record.Blocks, SignalBlock{ID: b.ID, Kind: b.Kind})
				}
				for _, p := range r.Properties {
					record.Properties = append(record.Properties, SignalProperties{RowID: p.RowID, IDs: p.IDs})
				}
				for _, s := range r.Schema {
					record.Schema = append(record.Schema, SignalSchema{DatabaseID: s.DatabaseID, ID: s.ID, Name: s.Name, Action: s.Action})
				}
				records[i] = record
			}

			got := []fixtureSignal{}
			for _, signal := range FoldSignals("doc-1", records, time.Duration(c.WindowMs)*time.Millisecond) {
				got = append(got, signalFixtureOf(signal))
			}
			want := c.Signals
			if want == nil {
				want = []fixtureSignal{}
			}
			if !reflect.DeepEqual(got, want) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(want)
				t.Fatalf("got  %s\nwant %s", gotJSON, wantJSON)
			}
		})
	}
}

func signalFixtureOf(signal ChangeSignal) fixtureSignal {
	out := fixtureSignal{
		Doc: signal.DocID, Lineage: signal.Lineage, FromSequence: signal.FromSequence, ToSequence: signal.ToSequence,
		WindowStart: signal.WindowStart.UnixMilli(), WindowEnd: signal.WindowEnd.UnixMilli(),
		Blocks: []fixtureBlock{}, Page: append([]string{}, signal.Page...), Properties: []fixtureProperties{},
		Schema: []fixtureSchema{},
	}
	for _, b := range signal.Blocks {
		out.Blocks = append(out.Blocks, fixtureBlock{ID: b.ID, Kind: b.Kind})
	}
	for _, p := range signal.Properties {
		out.Properties = append(out.Properties, fixtureProperties{RowID: p.RowID, IDs: p.IDs})
	}
	for _, s := range signal.Schema {
		out.Schema = append(out.Schema, fixtureSchema{DatabaseID: s.DatabaseID, ID: s.ID, Name: s.Name, Action: s.Action})
	}
	out.Authors = make([]struct {
		ID   string  `json:"id"`
		Kind *string `json:"kind"`
	}, len(signal.Authors))
	for i, a := range signal.Authors {
		out.Authors[i].ID, out.Authors[i].Kind = a.ID, a.Kind
	}
	return out
}
