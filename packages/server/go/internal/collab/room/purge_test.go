package room

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// emptyObjects is an S3 bucket that records every key it is asked for.
type emptyObjects struct {
	mu   sync.Mutex
	keys []string
}

func (o *emptyObjects) touch(key string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.keys = append(o.keys, key)
}
func (o *emptyObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	o.touch(key)
	return nil, nil
}
func (o *emptyObjects) PutObject(_ context.Context, key string, _ []byte) error {
	o.touch(key)
	return nil
}
func (o *emptyObjects) DeleteObject(_ context.Context, key string) error {
	o.touch(key)
	return nil
}

// emptyIDPurger is a host purge store that records the ids it is handed.
type emptyIDPurger struct {
	LocalJournal
	purged []string
}

func (p *emptyIDPurger) Purge(ctx context.Context, docID string) (journal.PurgeOutcome, error) {
	p.purged = append(p.purged, docID)
	return journal.Purged, nil
}

// C# CollabRoomManager.PurgeDocumentAsync and RecheckAccessAsync throw
// ArgumentException on an empty id before anything else runs.
func TestAnEmptyDocIDIsRefusedBeforeAuthorizeOnEveryStore(t *testing.T) {
	bucket := &emptyObjects{}
	s3, err := workingset.NewS3Store(bucket, "collab", nil)
	if err != nil {
		t.Fatal(err)
	}
	existing := t.TempDir()
	host := &emptyIDPurger{}
	cases := []struct {
		name       string
		store      WorkingSetStore
		operations func(t *testing.T) OperationStore
	}{
		{"local store, directory exists", workingset.NewLocalStore(existing, nil), nil},
		{"local store, no directory yet", workingset.NewLocalStore(filepath.Join(t.TempDir(), "missing"), nil), nil},
		{"S3 store", s3, nil},
		{"built-in journal", workingset.NewLocalStore(existing, nil), openJournal},
		{"host purge store", workingset.NewLocalStore(existing, nil), func(*testing.T) OperationStore { return host }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var operations OperationStore
			if c.operations != nil {
				operations = c.operations(t)
			}
			manager := NewManager(ManagerOptions{Store: c.store, Operations: operations})
			var replaced []string
			manager.OnDocumentReplaced(func(doc string) { replaced = append(replaced, doc) })
			authorized := false
			_, err := manager.Purge(context.Background(), "", func(context.Context) (bool, error) {
				authorized = true
				return true, nil
			})
			if !errors.Is(err, ErrEmptyDocID) {
				t.Fatalf("purge err = %v, want ErrEmptyDocID", err)
			}
			if err.Error() != "The value cannot be an empty string. (Parameter 'documentId')" {
				t.Fatalf("message = %q", err.Error())
			}
			if authorized || len(replaced) != 0 {
				t.Fatalf("authorize ran = %v, DocumentReplaced = %q", authorized, replaced)
			}
			if expelled, err := manager.RecheckAccess(context.Background(), ""); !errors.Is(err, ErrEmptyDocID) || expelled != 0 {
				t.Fatalf("recheck = %d, %v", expelled, err)
			}
		})
	}
	if len(bucket.keys) != 0 || len(host.purged) != 0 {
		t.Fatalf("a store saw the empty id: S3 keys %q, host purges %q", bucket.keys, host.purged)
	}
}

// C# refuses an empty doc id (ArgumentException) at every manager door,
// and an empty operation id at the edit doors, before any room exists.
func TestEveryDoorRefusesAnEmptyDocIDBeforeAnyRoomExists(t *testing.T) {
	manager, _, endpoint := newTestManager(t, DefaultOptions(), nil)
	ctx := context.Background()
	noPlan := func(context.Context, *yjs.Doc) ([]convert.EditOp, error) { return nil, nil }
	doors := map[string]func() error{
		"join":  func() error { _, err := manager.Join(ctx, "", &fakeMember{}); return err },
		"reset": func() error { _, err := manager.Reset(ctx, ""); return err },
		"edit": func() error {
			_, err := manager.Edit(ctx, "", nil, "op", nil, "", nil)
			return err
		},
		"agent edit": func() error {
			_, err := manager.AgentEdit(ctx, "", noPlan, "op", nil, "", nil, nil, nil)
			return err
		},
		"state":      func() error { _, err := manager.State(ctx, ""); return err },
		"checkpoint": func() error { _, err := manager.Checkpoint(ctx, ""); return err },
	}
	for name, door := range doors {
		if err := door(); !errors.Is(err, ErrEmptyDocIDArgument) || err.Error() != "The value cannot be an empty string. (Parameter 'docId')" {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := manager.Edit(ctx, "doc", nil, "", nil, "", nil); !errors.Is(err, ErrEmptyOperationID) ||
		err.Error() != "The value cannot be an empty string. (Parameter 'operationId')" {
		t.Errorf("edit: %v", err)
	}
	if _, err := manager.AgentEdit(ctx, "doc", noPlan, "", nil, "", nil, nil, nil); !errors.Is(err, ErrEmptyOperationID) {
		t.Errorf("agent edit: %v", err)
	}
	if manager.LiveRoomCount() != 0 || endpoint.loaded() != 0 {
		t.Fatalf("rooms %d, loads %d", manager.LiveRoomCount(), endpoint.loaded())
	}
}
