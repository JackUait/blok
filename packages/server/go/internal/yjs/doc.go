package yjs

import (
	"cmp"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"slices"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Transaction is one local or remote change to a Doc.
type Transaction struct {
	doc          *Doc
	local        bool
	beforeState  *StateVector
	afterState   *StateVector
	deleteSet    *DeleteSet
	mergeStructs []Struct
}

// Doc is the transaction's document.
func (t *Transaction) Doc() *Doc { return t.doc }

// Local is false for a remote apply.
func (t *Transaction) Local() bool { return t.local }

// UpdateEvent is one emitted update.
type UpdateEvent struct {
	Update []byte
	Local  bool
}

// Outcome is whether ApplyUpdate could read the bytes.
type Outcome uint8

// The outcomes.
const (
	Applied Outcome = iota
	Malformed
)

// ApplyResult is what ApplyUpdate reports. Changed is true when the update
// integrated a struct, deleted something new, or grew what is parked; a
// false FALSE would apply an update that is then neither journalled nor
// relayed.
type ApplyResult struct {
	Outcome        Outcome
	PendingRemains bool
	Changed        bool
	Reason         string
}

// Doc is a Yjs document: the struct store, the named roots, and the
// transaction that turns applied bytes or local writes into one update.
type Doc struct {
	clientID uint64
	store    *Store
	share    map[string]AbstractType
	gc       bool
	current  *Transaction
	// listeners run in subscription order after each emitting transaction.
	listeners []*func(UpdateEvent)
	// encoder is replaceable by tests.
	encoder func(*Transaction) []byte
}

// Options configure NewDoc.
type Options struct {
	// ClientID pins the client id; nil mints a random uint32.
	ClientID *uint32
	// NoGC keeps deleted content (yjs gc: false).
	NoGC bool
}

// NewDoc makes an empty document.
func NewDoc(options Options) *Doc {
	doc := &Doc{store: newStore(), share: map[string]AbstractType{}, gc: !options.NoGC, encoder: updateFromTransaction}
	if options.ClientID != nil {
		doc.clientID = uint64(*options.ClientID)
	} else {
		doc.clientID = newClientID()
	}
	return doc
}

func newClientID() uint64 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return uint64(binary.LittleEndian.Uint32(b[:]))
}

// ClientID is the id local writes use.
func (d *Doc) ClientID() uint64 { return d.clientID }

// AdoptClientID writes from now on under id, continuing its clock. Call it
// after the state is applied: a remote update advancing the doc's own id
// mints a new one.
func (d *Doc) AdoptClientID(id uint64) { d.clientID = id }

// HasPending reports parked structs or deletes.
func (d *Doc) HasPending() bool { return d.store.hasPending || d.store.pendingDs != nil }

// OnUpdate subscribes to emitted updates and returns an unsubscribe func.
func (d *Doc) OnUpdate(listener func(UpdateEvent)) func() {
	entry := &listener
	d.listeners = append(d.listeners, entry)
	return func() {
		if at := slices.Index(d.listeners, entry); at >= 0 {
			d.listeners = slices.Delete(slices.Clone(d.listeners), at, at+1)
		}
	}
}

// Get is the root under name, untyped until something asks for a kind.
func (d *Doc) Get(name jsjson.Str) AbstractType {
	k := unitsKey(name)
	if existing, ok := d.share[k]; ok {
		return existing
	}
	placeholder := &untyped{}
	root := append(jsjson.Str{}, name...)
	placeholder.rootName = &root
	placeholder.integrateCore(d, nil)
	d.share[k] = placeholder
	return placeholder
}

// GetMap is the root map under name.
func (d *Doc) GetMap(name jsjson.Str) *Map {
	return getTyped(d, name, func() *Map { return &Map{} })
}

// GetArray is the root array under name.
func (d *Doc) GetArray(name jsjson.Str) *Array {
	return getTyped(d, name, func() *Array { return &Array{} })
}

// GetText is the root text under name.
func (d *Doc) GetText(name jsjson.Str) *Text {
	return getTyped(d, name, func() *Text { return &Text{} })
}

// getTyped upgrades an untyped root, re-pointing the list chain and every
// map chain (walked LEFT from each head) at the new type.
func getTyped[T AbstractType](d *Doc, name jsjson.Str, create func() T) T {
	existing := d.Get(name)
	if already, ok := existing.(T); ok {
		return already
	}
	if _, ok := existing.(*untyped); !ok {
		fail("Type with the name %s has already been defined with a different constructor", name.String())
	}
	upgraded := create()
	core := upgraded.core()
	old := existing.core()
	core.rootName = old.rootName
	for _, entry := range old.entries {
		core.mapSetHead(entry.key, entry.head)
		for item := entry.head; item != nil; item = item.left {
			item.parent = upgraded
		}
	}
	core.start = old.start
	for item := core.start; item != nil; item = item.right {
		item.parent = upgraded
	}
	core.length = old.length
	d.share[unitsKey(name)] = upgraded
	core.integrateCore(d, nil)
	return upgraded
}

// EncodeStateVector is the integrated state only.
func (d *Doc) EncodeStateVector() []byte { return d.store.getStateVector().Encode() }

// EncodeStateAsUpdate is everything target has not seen: integrated and
// parked structs plus the whole delete history and parked deletes. An empty
// target means "seen nothing". An engine invariant failure comes back as an
// *EngineError, as C# throws one a caller frame can catch.
func (d *Doc) EncodeStateAsUpdate(target []byte) (update []byte, err error) {
	defer recoverEngine(&err)
	vector := &StateVector{}
	if len(target) > 0 {
		decoded, err := DecodeStateVector(target)
		if err != nil {
			return nil, err
		}
		vector = decoded
	}
	w := &writer{}
	writeRuns(w, buildRuns(d.store, vector, true))
	d.deletedSoFar().write(w)
	return w.Bytes(), nil
}

// recoverEngine turns an *EngineError panic into err. Any other panic is a
// bug and keeps going up.
func recoverEngine(err *error) {
	if recovered := recover(); recovered != nil {
		engine, ok := recovered.(*EngineError)
		if !ok {
			panic(recovered)
		}
		*err = engine
	}
}

// ApplyUpdate decodes and applies. Malformed bytes leave the doc untouched.
// An engine error mid-apply is returned; the doc may be half-changed, as in
// C#, where the room catches it.
func (d *Doc) ApplyUpdate(update []byte) (ApplyResult, error) {
	decoded, err := Decode(update)
	if err != nil {
		return ApplyResult{Outcome: Malformed, PendingRemains: d.HasPending(), Reason: err.Error()}, nil
	}
	return d.ApplyDecoded(decoded)
}

// ApplyDecoded applies an already decoded update in one remote transaction.
func (d *Doc) ApplyDecoded(update *DecodedUpdate) (result ApplyResult, err error) {
	defer recoverEngine(&err)
	parkedBefore := d.parkedCoverage()
	_, moved := d.transact(func(t *Transaction) {
		t.local = false
		d.applyDecoded(t, toRuntimeStructs(update), update.DeleteSet)
	}, false)
	return ApplyResult{
		Outcome:        Applied,
		PendingRemains: d.HasPending(),
		Changed:        moved || d.parkedCoverage() != parkedBefore,
	}, nil
}

// Transact runs body in a local transaction and returns the update it
// emitted, or nil when nothing changed. A nested call joins the open one
// and returns nil: only the outermost emits. An engine invariant failure
// panics with *EngineError; a caller that must survive it recovers.
func (d *Doc) Transact(body func(*Transaction)) []byte {
	update, _ := d.transact(body, true)
	return update
}

func (d *Doc) transact(body func(*Transaction), local bool) ([]byte, bool) {
	if d.current != nil {
		body(d.current)
		return nil, false
	}
	t := &Transaction{doc: d, local: local, beforeState: d.store.getStateVector(), deleteSet: &DeleteSet{}}
	d.current = t
	func() {
		defer func() { d.current = nil }()
		body(t)
	}()
	update := d.cleanup(t)
	return update, moved(t)
}

// moved must agree with updateFromTransaction's "nothing to emit" test.
func moved(t *Transaction) bool {
	if t.deleteSet.Len() != 0 {
		return true
	}
	after := t.afterState
	if after == nil {
		after = t.doc.store.getStateVector()
	}
	return advanced(t.beforeState, after)
}

// parkedCoverage is two unions, ADDED: clocks covered by parked structs plus
// clocks covered by parked deletes. A sum of lengths or an identity test
// gives false FALSEs.
func (d *Doc) parkedCoverage() uint64 {
	structs := &DeleteSet{}
	for _, waiting := range d.store.pendingStructs {
		h := waiting.head()
		structs.add(h.id.Client, h.id.Clock, uint64(h.length))
	}
	deletions := &DeleteSet{}
	if d.store.pendingDs != nil {
		copyRanges(d.store.pendingDs, deletions)
	}
	return unionLength(structs) + unionLength(deletions)
}

// unionLength mutates its argument; pass only a scratch set.
func unionLength(ranges *DeleteSet) uint64 {
	ranges.sortAndMerge()
	var length uint64
	for _, entry := range ranges.clients {
		for _, r := range entry.ranges {
			length += r.Length
		}
	}
	return length
}

func (d *Doc) deletedSoFar() *DeleteSet {
	deletions := &DeleteSet{}
	for _, client := range d.store.order {
		for _, s := range d.store.clients[client] {
			if s.IsDeleted() {
				h := s.head()
				deletions.add(client, h.id.Clock, uint64(h.length))
			}
		}
	}
	if d.store.pendingDs != nil {
		copyRanges(d.store.pendingDs, deletions)
	}
	deletions.sortAndMerge()
	return deletions
}

// applyDecoded is yjs's readUpdateV2 body. The retry runs inside the SAME
// transaction, so an update closing a gap lands with what it unblocks.
func (d *Doc) applyDecoded(t *Transaction, structs *clientStructMap, deleteSet *DeleteSet) {
	store := d.store
	retry := false
	rest := integrateStructs(t, store, structs)
	if store.hasPending {
		// A map, not the vector: "no entry" and "waiting for 0" differ.
		missing := map[uint64]uint64{}
		for _, client := range store.pendingMissing.Clients() {
			missing[client] = store.pendingMissing.Get(client)
		}
		for _, client := range store.pendingMissing.Clients() {
			if missing[client] < store.getState(client) {
				retry = true
				break
			}
		}
		if rest != nil {
			for client, clock := range rest.missing {
				if known, ok := missing[client]; !ok || known > clock {
					missing[client] = clock
				}
			}
			store.pendingMissing = vectorOf(missing)
			store.pendingStructs = mergeParked(store.pendingStructs, rest.structs)
		}
	} else if rest != nil {
		store.pendingStructs = flatten(rest.structs)
		store.hasPending = true
		store.pendingMissing = vectorOf(rest.missing)
	}
	unappliedNow := deleteSet.apply(t, store)
	if store.pendingDs != nil {
		store.pendingDs = mergeDeleteSets(unappliedNow, store.pendingDs.apply(t, store))
	} else {
		store.pendingDs = unappliedNow
	}
	if !retry {
		return
	}
	parked := store.pendingStructs
	store.pendingStructs = nil
	store.hasPending = false
	store.pendingMissing = nil
	d.applyDecoded(t, group(parked), &DeleteSet{})
}

// vectorOf sorts the clients so the order is fixed; a StateVector only
// encodes and enumerates sorted anyway.
func vectorOf(clocks map[uint64]uint64) *StateVector {
	clients := make([]uint64, 0, len(clocks))
	for client := range clocks {
		clients = append(clients, client)
	}
	slices.Sort(clients)
	vector := &StateVector{}
	for _, client := range clients {
		vector.Set(client, clocks[client])
	}
	return vector
}

// mergeParked unions per client by clock, dropping a struct only when one
// kept before it covers it fully.
func mergeParked(parked []Struct, arriving *clientStructMap) []Struct {
	byClient := group(parked)
	for _, client := range arriving.order {
		structs := arriving.runs[client]
		known, ok := byClient.runs[client]
		if !ok {
			byClient.set(client, slices.Clone(structs))
			continue
		}
		known = append(slices.Clone(known), structs...)
		slices.SortStableFunc(known, func(a, b Struct) int { return cmp.Compare(a.head().id.Clock, b.head().id.Clock) })
		var kept []Struct
		var covered uint64
		for _, candidate := range known {
			end := candidate.head().end()
			if len(kept) > 0 && end <= covered {
				continue
			}
			kept = append(kept, candidate)
			covered = max(covered, end)
		}
		byClient.set(client, kept)
	}
	return flatten(byClient)
}

func group(structs []Struct) *clientStructMap {
	byClient := newClientStructMap()
	for _, s := range structs {
		client := s.head().id.Client
		byClient.set(client, append(byClient.runs[client], s))
	}
	return byClient
}

func flatten(byClient *clientStructMap) []Struct {
	clients := slices.Clone(byClient.order)
	slices.Sort(clients)
	flat := []Struct{}
	for _, client := range clients {
		flat = append(flat, byClient.runs[client]...)
	}
	return flat
}

// cleanup is yjs's cleanupTransactions minus observers and merging.
func (d *Doc) cleanup(t *Transaction) []byte {
	t.deleteSet.sortAndMerge()
	t.afterState = d.store.getStateVector()
	if d.gc {
		d.collectDeleted(t.deleteSet)
	}
	if !t.local && t.afterState.Get(d.clientID) != t.beforeState.Get(d.clientID) {
		d.clientID = newClientID()
	}
	var update []byte
	if d.encoder != nil {
		update = d.encoder(t)
	}
	if update != nil {
		for _, listener := range d.listeners {
			(*listener)(UpdateEvent{Update: update, Local: t.local})
		}
	}
	return update
}

// collectDeleted is yjs's tryGcDeleteSet. The struct at an index is re-read
// every step because collecting replaces entries in the same run.
func (d *Doc) collectDeleted(deleted *DeleteSet) {
	for _, entry := range deleted.clients {
		if _, ok := d.store.clients[entry.client]; !ok {
			continue
		}
		for r := len(entry.ranges) - 1; r >= 0; r-- {
			end := entry.ranges[r].Clock + entry.ranges[r].Length
			for index := d.store.findIndex(entry.client, entry.ranges[r].Clock); index < len(d.store.clients[entry.client]) && d.store.clients[entry.client][index].head().id.Clock < end; index++ {
				if item, ok := d.store.clients[entry.client][index].(*Item); ok && item.deleted && !item.keep {
					item.gc(d.store, false)
				}
			}
		}
	}
}

func (d *Doc) String() string { return fmt.Sprintf("yjs.Doc(client %d)", d.clientID) }
