package workingset

import (
	"context"
	"errors"
	"fmt"
)

// Set is CollabWorkingSet: the frame section and its tag.
type Set struct {
	Updates []byte
	Tag     Tag
}

// StoreError is CollabWorkingSetStoreException.
type StoreError struct {
	DocID string
	What  string
	Err   error
}

func (e *StoreError) Error() string {
	return fmt.Sprintf("collab: the working-set %s for \"%s\" failed: %v", e.What, e.DocID, e.Err)
}

func (e *StoreError) Unwrap() error { return e.Err }

// Guard is GuardAsync: a store timeout looks like a cancellation, and the room
// would take it for its own shutdown and skip its failure handling. So a
// cancellation the caller did not ask for becomes a StoreError.
func Guard(ctx context.Context, docID, what string, operation func() error) error {
	err := operation()
	if err != nil && ctx.Err() == nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
		return &StoreError{DocID: docID, What: what, Err: err}
	}
	return err
}

// DecodeOrAbsent reads a stored blob; an unreadable one is logged and treated as absent.
func DecodeOrAbsent(docID string, document []byte, log func(string)) *Set {
	tag, section, message, ok := DecodeDocument(document)
	if ok {
		return &Set{Updates: section, Tag: tag}
	}
	if log != nil {
		log(fmt.Sprintf("collab: the working set for \"%s\" is unreadable (%s); treating it as absent", docID, message))
	}
	return nil
}

// EnsureWriteDoesNotLowerEpoch refuses a write below the stored epoch.
func EnsureWriteDoesNotLowerEpoch(docID string, stored *Set, next Tag) error {
	if stored != nil && next.Epoch < stored.Tag.Epoch {
		return fmt.Errorf("collab: refusing to lower the working-set epoch for \"%s\" from %d to %d.", docID, stored.Tag.Epoch, next.Epoch)
	}
	return nil
}

// EnsureResetRaisesEpoch refuses a reset that does not raise the epoch strictly.
func EnsureResetRaisesEpoch(docID string, stored *Set, next Tag) error {
	if stored != nil && next.Epoch <= stored.Tag.Epoch {
		return fmt.Errorf("collab: a reset must raise the working-set epoch for \"%s\" above %d (got %d).", docID, stored.Tag.Epoch, next.Epoch)
	}
	return nil
}
