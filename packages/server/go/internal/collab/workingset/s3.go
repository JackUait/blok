package workingset

import (
	"context"
	"errors"
	"strings"
)

// ObjectStore is the raw-key half of the S3 blob store (blob.S3).
// GetObject answers nil, nil for a missing key; DeleteObject treats one as deleted.
type ObjectStore interface {
	GetObject(ctx context.Context, key string) ([]byte, error)
	PutObject(ctx context.Context, key string, content []byte) error
	DeleteObject(ctx context.Context, key string) error
}

// S3Store keeps one object per document at {prefix}/{doc key} (C# S3CollabStore).
// A write does not read first: the room owns the epoch law, and a guard GET
// would double an edit's traffic.
type S3Store struct {
	store  ObjectStore
	prefix string
	log    func(string)
}

// NewS3Store trims slashes around prefix and refuses an empty one.
func NewS3Store(store ObjectStore, prefix string, log func(string)) (*S3Store, error) {
	trimmed := strings.Trim(prefix, "/")
	if trimmed == "" {
		return nil, errors.New("collab: the S3 prefix must not be empty. (Parameter 'prefix')")
	}
	return &S3Store{store: store, prefix: trimmed, log: log}, nil
}

func (s *S3Store) keyFor(docID string) string { return s.prefix + "/" + DocKey(docID) }

func (s *S3Store) Read(ctx context.Context, docID string) (*Set, error) {
	var stored *Set
	err := Guard(ctx, docID, "read", func() error {
		document, err := s.store.GetObject(ctx, s.keyFor(docID))
		if err != nil || document == nil {
			return err
		}
		stored = DecodeOrAbsent(docID, document, s.log)
		return nil
	})
	return stored, err
}

func (s *S3Store) Write(ctx context.Context, docID string, updates []byte, tag Tag) error {
	return Guard(ctx, docID, "write", func() error {
		document, err := EncodeDocument(tag, updates)
		if err != nil {
			return err
		}
		return s.store.PutObject(ctx, s.keyFor(docID), document)
	})
}

func (s *S3Store) Reset(ctx context.Context, docID string, tag Tag) error {
	return Guard(ctx, docID, "reset", func() error {
		document, err := EncodeDocument(tag, nil)
		if err != nil {
			return err
		}
		stored, err := s.Read(ctx, docID)
		if err != nil {
			return err
		}
		if err := EnsureResetRaisesEpoch(docID, stored, tag); err != nil {
			return err
		}
		return s.store.PutObject(ctx, s.keyFor(docID), document)
	})
}

// Retire deletes a readable object; a corrupt one is the only copy left to repair.
func (s *S3Store) Retire(ctx context.Context, docID string) error {
	return Guard(ctx, docID, "retire", func() error {
		document, err := s.store.GetObject(ctx, s.keyFor(docID))
		if err != nil {
			return err
		}
		if document != nil && DecodeOrAbsent(docID, document, s.log) != nil {
			return s.store.DeleteObject(ctx, s.keyFor(docID))
		}
		return nil
	})
}

func (s *S3Store) Delete(ctx context.Context, docID string) error {
	return Guard(ctx, docID, "delete", func() error { return s.store.DeleteObject(ctx, s.keyFor(docID)) })
}
