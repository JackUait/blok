package workingset

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/blob"
)

// The real store is blob.S3, which signs, reads 404 as absent and deletes idempotently.
var _ ObjectStore = (*blob.S3)(nil)

// memoryBucket is the raw-key surface of the S3 store; signing is
// blob.S3's and is tested there.
type memoryBucket struct {
	objects  map[string][]byte
	requests []string
	fail     error
}

func (b *memoryBucket) GetObject(_ context.Context, key string) ([]byte, error) {
	b.requests = append(b.requests, "GET "+key)
	if b.fail != nil {
		return nil, b.fail
	}
	return b.objects[key], nil
}

func (b *memoryBucket) PutObject(_ context.Context, key string, content []byte) error {
	b.requests = append(b.requests, "PUT "+key)
	if b.fail != nil {
		return b.fail
	}
	b.objects[key] = slices.Clone(content)
	return nil
}

func (b *memoryBucket) DeleteObject(_ context.Context, key string) error {
	b.requests = append(b.requests, "DELETE "+key)
	if b.fail != nil {
		return b.fail
	}
	delete(b.objects, key)
	return nil
}

var s3Key = "collab/" + docKeyHex

func s3Store(t *testing.T, bucket *memoryBucket, prefix string) (*S3Store, *[]string) {
	logs := &[]string{}
	store, err := NewS3Store(bucket, prefix, func(m string) { *logs = append(*logs, m) })
	must(t, err)
	return store, logs
}

func bucket() *memoryBucket { return &memoryBucket{objects: map[string][]byte{}} }

// Twins of S3CollabStoreTests at the object-store seam.
func TestS3ReadsAbsentAsNull(t *testing.T) {
	b := bucket()
	s, logs := s3Store(t, b, "collab")
	if stored, err := s.Read(ctx, docID); stored != nil || err != nil || !slices.Equal(b.requests, []string{"GET " + s3Key}) || len(*logs) != 0 {
		t.Fatal(stored, err, b.requests)
	}
}

func TestS3WritesThenReadsBackWithOnePut(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "collab")
	updates := sectionOf(t, []byte{1, 2}, []byte{3})
	must(t, s.Write(ctx, docID, updates, storeTag))
	if !slices.Equal(b.requests, []string{"PUT " + s3Key}) {
		t.Fatal(b.requests)
	}
	want, _ := EncodeDocument(storeTag, updates)
	if !bytes.Equal(b.objects[s3Key], want) {
		t.Fatal("bytes")
	}
	stored, err := s.Read(ctx, docID)
	if err != nil || !bytes.Equal(stored.Updates, updates) || stored.Tag != storeTag {
		t.Fatal(stored, err)
	}
}

func TestS3WriteDoesNotReadTheObjectToGuardTheEpoch(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "collab")
	b.objects[s3Key], _ = EncodeDocument(storeTag, nil)
	lower := storeTag
	lower.Epoch--
	must(t, s.Write(ctx, docID, nil, lower))
	if !slices.Equal(b.requests, []string{"PUT " + s3Key}) {
		t.Fatal(b.requests)
	}
}

func TestS3ResetRewritesToAnEmptyLogAndRequiresAHigherEpoch(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "collab")
	must(t, s.Write(ctx, docID, sectionOf(t, []byte{1}), storeTag))
	if err := s.Reset(ctx, docID, storeTag); err == nil || !strings.Contains(err.Error(), "must raise") {
		t.Fatal(err)
	}
	bumped := storeTag
	bumped.Epoch++
	must(t, s.Reset(ctx, docID, bumped))
	if want, _ := EncodeDocument(bumped, nil); !bytes.Equal(b.objects[s3Key], want) {
		t.Fatal("reset bytes")
	}
}

func TestS3TreatsACorruptObjectAsAbsentAndLogsIt(t *testing.T) {
	b := bucket()
	s, logs := s3Store(t, b, "collab")
	b.objects[s3Key] = []byte("not a working set")
	if stored, err := s.Read(ctx, docID); stored != nil || err != nil || !slices.ContainsFunc(*logs, func(l string) bool { return strings.Contains(l, docID) }) {
		t.Fatal(stored, err, *logs)
	}
}

func TestS3TrimsSlashesAroundThePrefixAndRefusesAnEmptyOne(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "/collab/")
	_, _ = s.Read(ctx, docID)
	if !slices.Equal(b.requests, []string{"GET " + s3Key}) {
		t.Fatal(b.requests)
	}
	for _, prefix := range []string{"", "///"} {
		if _, err := NewS3Store(bucket(), prefix, nil); err == nil {
			t.Fatalf("%q accepted", prefix)
		}
	}
}

func TestS3DeleteTargetsOnlyTheExactObjectAndMayBeRepeated(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "collab")
	other := "collab/" + DocKey("doc-2")
	b.objects[s3Key], b.objects[other] = []byte{1}, []byte{2}
	must(t, s.Delete(ctx, docID))
	must(t, s.Delete(ctx, docID))
	if _, ok := b.objects[s3Key]; ok || b.objects[other] == nil || !slices.Equal(b.requests, []string{"DELETE " + s3Key, "DELETE " + s3Key}) {
		t.Fatal(b.requests)
	}
}

func TestS3RetireDeletesAReadableObjectAndKeepsACorruptOne(t *testing.T) {
	b := bucket()
	s, _ := s3Store(t, b, "collab")
	corrupt := "collab/" + DocKey("doc-2")
	b.objects[s3Key], _ = EncodeDocument(storeTag, nil)
	b.objects[corrupt] = []byte("not a working set")
	must(t, s.Retire(ctx, docID))
	must(t, s.Retire(ctx, "doc-2"))
	must(t, s.Retire(ctx, docID))
	if _, ok := b.objects[s3Key]; ok || string(b.objects[corrupt]) != "not a working set" {
		t.Fatal(b.objects)
	}
}

func TestS3DeletePropagatesAFailure(t *testing.T) {
	failure := errors.New("500")
	b := bucket()
	b.fail = failure
	s, _ := s3Store(t, b, "collab")
	if err := s.Delete(ctx, docID); !errors.Is(err, failure) {
		t.Fatal(err)
	}
}
