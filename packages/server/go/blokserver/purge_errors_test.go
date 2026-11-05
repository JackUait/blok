package blokserver_test

import (
	"context"
	"errors"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/blokserver/collabstore"
)

// openOnly is a host journal that cannot purge.
type openOnly struct{}

func (openOnly) Open(context.Context, string) (collabstore.OpenOutcome, collabstore.OperationSession, error) {
	return 0, nil, errors.New("not opened in this test")
}

// C# hosts catch ArgumentException, UnauthorizedAccessException and
// NotSupportedException from PurgeDocumentAsync; a Go host matches the
// exported sentinels with errors.Is.
func TestAHostCanTellEveryPurgeRefusalApart(t *testing.T) {
	o := blokserver.DefaultOptions()
	o.CollabEnabled = true
	o.CollabDirectory = t.TempDir()
	o.DocEndpoint = "http://127.0.0.1:1/docs"
	s, err := blokserver.New(o)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	allow := func(context.Context) (bool, error) { return true, nil }
	deny := func(context.Context) (bool, error) { return false, nil }

	if _, err := s.PurgeDocument(ctx, "", nil); !errors.Is(err, blokserver.ErrEmptyDocID) {
		t.Fatalf("an empty id: %v", err)
	}
	if _, err := s.RecheckAccess(ctx, ""); !errors.Is(err, blokserver.ErrEmptyDocID) {
		t.Fatalf("recheck of an empty id: %v", err)
	}
	if _, err := s.PurgeDocument(ctx, "a/b", allow); !errors.Is(err, blokserver.ErrNotSingleSegment) {
		t.Fatalf("a two-segment id: %v", err)
	}
	if _, err := s.PurgeDocument(ctx, "doc", deny); !errors.Is(err, blokserver.ErrPurgeNotAuthorized) {
		t.Fatalf("a denied purge: %v", err)
	}

	o.CollabOperationStore = openOnly{}
	o.CollabDirectory = t.TempDir()
	if s, err = blokserver.New(o); err != nil {
		t.Fatal(err)
	}
	_, err = s.PurgeDocument(ctx, "doc", allow)
	if !errors.Is(err, blokserver.ErrPurgeUnsupported) {
		t.Fatalf("a store that cannot purge: %v", err)
	}
	want := "the operation journal cannot purge documents: the registered collabstore.OperationStore (blokserver_test.openOnly) must also implement collabstore.PurgeStore"
	if err.Error() != want {
		t.Fatalf("message = %q\nwant      %q", err.Error(), want)
	}
}
