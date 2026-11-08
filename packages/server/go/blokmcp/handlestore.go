package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// HandleRecord is one stored-mode handle as a HandleStore keeps it: plain
// JSON, written by Blok. Live handles hold sockets and never go into a
// store. Records are trusted: anyone who can write the store can forge an
// actor, scopes or history, so only Blok's processes may write it.
type HandleRecord struct {
	// V is the record format, 1. Another one answers UNKNOWN_HANDLE.
	V int `json:"v"`
	// ContractRevision is the opening server's tool contract. Another one
	// answers VERSION_SKEW.
	ContractRevision string `json:"contractRevision"`
	// Principal is the opener. A call from another principal answers
	// UNKNOWN_HANDLE.
	Principal  string `json:"principal"`
	ClientName string `json:"clientName"`
	// Scopes: nil is null (no scope checks), and must stay distinct from [].
	Scopes     []string        `json:"scopes"`
	Actor      json.RawMessage `json:"actor"`
	DocumentID string          `json:"documentId"`
	Write      bool            `json:"write"`
	// Version is what the next save sends as ifVersion.
	Version *string `json:"version"`
	// Stale: the last save or reload failed, so the next call reloads.
	Stale bool `json:"stale"`
	// Document is the document as the handle holds it.
	Document json.RawMessage `json:"document"`
	// History is the undo and redo steps, {past, future, lost?, revision},
	// each step a whole document. Not bounded in bytes: the newest step
	// is always kept, so a store must take large values.
	History json.RawMessage `json:"history"`
}

var (
	// ErrHandleUnknown is Acquire's answer for no such handle, or one that
	// expired.
	ErrHandleUnknown = errors.New("blok-mcp: no such handle")
	// ErrHandleBusy is Acquire's answer when the lease is still held at
	// the timeout.
	ErrHandleBusy = errors.New("blok-mcp: the handle is leased")
	// ErrLeaseLost is what a lease's Save or Remove answers once
	// another holder took the lease over.
	ErrLeaseLost = errors.New("blok-mcp: the handle's lease was lost")
)

// HandleLease is one call's hold on a handle. It is time-limited: the store
// renews it while it is held, and a holder that cannot renew (a paused
// process) can lose it to another. Save and Remove check the lease still
// holds and answer ErrLeaseLost, changing nothing, when it does not. So
// exclusivity is best effort: correctness then rests on the source's
// version check.
type HandleLease interface {
	// Record is the record as acquired.
	Record() HandleRecord
	// Save replaces the record. Blok calls it after the source save.
	Save(ctx context.Context, record HandleRecord) error
	// Release ends the lease and restarts the handle's idle time. It does
	// nothing once the lease is gone.
	Release(ctx context.Context) error
	// Remove forgets the handle and ends the lease.
	Remove(ctx context.Context) error
}

// HandleStore is where stored-mode handles live, so any process sharing it
// serves any call (Options.HandleStore). Blok passes only handles it
// minted, or that match ^[A-Za-z0-9_-]{1,128}$. Any error other than the
// Err* answers is logged; the agent sees SOURCE_UNAVAILABLE.
type HandleStore interface {
	// Count is the principal's handles that have not expired.
	Count(ctx context.Context, principal string, idle time.Duration) (int, error)
	// TryAdd counts and adds as one step per principal (a row lock, a
	// Lua script): false, and nothing added, when the principal already
	// holds maxPerPrincipal.
	TryAdd(ctx context.Context, handle string, record HandleRecord, maxPerPrincipal int, idle time.Duration) (bool, error)
	// Acquire waits up to wait for the handle's lease. ErrHandleUnknown:
	// no such handle, or it expired. ErrHandleBusy: still leased at the
	// timeout. A leased handle never expires.
	Acquire(ctx context.Context, handle string, idle, wait time.Duration) (HandleLease, error)
	// Sweep deletes every handle idle longer than idle and not leased.
	// Blok calls it on a timer; a store with its own expiry may do nothing.
	Sweep(ctx context.Context, idle time.Duration) error
}
