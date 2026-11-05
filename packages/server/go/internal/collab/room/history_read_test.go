package room

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

type oneParagraphEndpoint struct{}

func (oneParagraphEndpoint) Load(context.Context, string) (*docendpoint.Loaded, error) {
	data, err := jsjson.ParseNode([]byte(`{"blocks":[{"id":"a","type":"paragraph","data":{"text":"one"}}]}`), jsjson.Options{MaxDepth: 64})
	return &docendpoint.Loaded{Data: data}, err
}

func (oneParagraphEndpoint) Save(context.Context, string, any, *string, *docendpoint.Projection) (*string, error) {
	return nil, nil
}

// C# HistoryEndpointTests.AReadLeavesOutAPageMapValueHoldingAPeerBigint, on
// the real journal and converter: the read runs on the request goroutine,
// where a panic dropped the connection.
func TestAReadLeavesOutAPageMapValueHoldingAPeerBigint(t *testing.T) {
	dir := t.TempDir()
	store, err := journal.NewStore(dir, journal.StoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := jsruntime.NewPool(jsruntime.Options{PoolSize: new(1)})
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(ManagerOptions{
		Store: workingset.NewLocalStore(dir, nil), Endpoint: oneParagraphEndpoint{},
		Converter:  &convert.DocConverter{Now: time.Now, HTML: convert.RuntimeHTMLReader{Runtime: pool}},
		Operations: LocalJournal{Store: store}, Room: OptionsWith(func(ro *Options) { ro.MaxUpdateBytes = store.MaxUpdateBytes() }),
		Log: func(string) {},
	})
	ctx := context.Background()
	member := v2Member()
	membership := joinSynced(t, manager, "doc", member)
	client := newClient()
	if _, err := client.ApplyUpdate(probeStep2(t, manager, "doc", client.EncodeStateVector())); err != nil {
		t.Fatal(err)
	}
	big := &jsjson.Object{}
	big.Set(jsjson.FromString("n"), lib0.BigInt(1))
	update := client.Transact(func(tx *yjs.Transaction) {
		values := client.GetMap(jsjson.FromString("values"))
		values.Set(tx, jsjson.FromString("x"), big)
		values.Set(tx, jsjson.FromString("kept"), jsjson.FromString("plain"))
	})
	sendOperation(t, membership, member, opOne, update)
	membership.Leave()
	if err := manager.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	list, err := manager.History(ctx, "doc", 0)
	if err != nil || len(list.Versions) == 0 {
		t.Fatalf("history = %+v, %v", list, err)
	}
	newest := list.Versions[0]

	read, err := manager.ReadVersion(ctx, "doc", newest.Lineage, newest.Sequence)

	if err != nil || read.Status != HistoryReady {
		t.Fatalf("read = %v, %v", read.Status, err)
	}
	if !bytes.HasSuffix(read.JSON, []byte(`,"values":{"kept":"plain"}}`)) {
		t.Fatalf("read = %s", read.JSON)
	}
}
