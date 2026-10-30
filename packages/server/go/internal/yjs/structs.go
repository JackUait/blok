// Package yjs is the managed Yjs engine, ported from C# Blok.Server/Yjs:
// the v1 update codec, the struct store, YATA integration, pending updates,
// garbage collection and the Y.Map / Y.Array / Y.Text types collab uses.
//
// Order matters wherever C# enumerates a Dictionary (insertion order), so
// the engine keeps ordered slices there and never ranges over a Go map
// where the order could reach bytes or exports.
package yjs

import "fmt"

// ID names one clock tick of one client.
type ID struct {
	Client uint64
	Clock  uint64
}

func (id ID) String() string { return fmt.Sprintf("%d:%d", id.Client, id.Clock) }

func idPtr(id ID) *ID { return &id }

func sameID(a, b *ID) bool {
	if a == nil {
		return b == nil
	}
	return b != nil && *a == *b
}

// header is what every struct has: its first id and its clock span.
type header struct {
	id     ID
	length int
}

func (h *header) head() *header { return h }

func (h *header) lastID() ID { return ID{h.id.Client, h.id.Clock + uint64(h.length) - 1} }

func (h *header) end() uint64 { return h.id.Clock + uint64(h.length) }

// Struct is an Item, a GC or a Skip.
type Struct interface {
	head() *header
	IsDeleted() bool
	write(w *writer, offset int)
}

// ID of the struct's first tick.
func StructID(s Struct) ID { return s.head().id }

// StructLen is the struct's clock span.
func StructLen(s Struct) int { return s.head().length }

// GC is a collected run: clocks with nothing left in them.
type GC struct{ header }

// IsDeleted is always true.
func (*GC) IsDeleted() bool { return true }

func (g *GC) write(w *writer, offset int) {
	w.WriteUint8(0)
	w.WriteVarUint(uint64(g.length - offset))
}

func (g *GC) integrate(t *Transaction, offset int) {
	if offset > 0 {
		g.id.Clock += uint64(offset)
		g.length -= offset
	}
	t.doc.store.addStruct(g)
}

// Skip is a hole in a client's run that its sender is not filling.
type Skip struct{ header }

// IsDeleted is always true.
func (*Skip) IsDeleted() bool { return true }

func (s *Skip) write(w *writer, offset int) {
	w.WriteUint8(10)
	w.WriteVarUint(uint64(s.length - offset))
}

// EngineError is an engine invariant broken by its caller or by an update
// that slipped past the checks (InvalidOperationException in C#). The engine
// panics with it; Doc.ApplyUpdate turns it into an error.
type EngineError struct{ Reason string }

func (e *EngineError) Error() string { return e.Reason }

func fail(format string, args ...any) {
	panic(&EngineError{Reason: fmt.Sprintf(format, args...)})
}
