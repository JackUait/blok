package yjs

import (
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// AbstractType is a shared type: *Map, *Array, *Text, *XmlText,
// *XmlElement, *XmlFragment, *XmlHook, or an untyped root placeholder.
type AbstractType interface {
	core() *typeCore
	integratePrelim(t *Transaction)
}

type mapEntry struct {
	key  jsjson.Str
	head *Item
}

// typeCore is what every shared type has: the item holding it (nil for a
// root), the map heads for keyed values in insertion order, and the head of
// the list chain.
type typeCore struct {
	item     *Item
	doc      *Doc
	rootName *jsjson.Str
	entries  []mapEntry
	index    map[string]int
	start    *Item
	length   int
}

func (c *typeCore) core() *typeCore { return c }

func (*typeCore) integratePrelim(*Transaction) {}

// unitsKey is an exact map key for a JS string, lone surrogates included.
func unitsKey(s jsjson.Str) string {
	b := make([]byte, 0, 2*len(s))
	for _, unit := range s {
		b = append(b, byte(unit>>8), byte(unit))
	}
	return string(b)
}

func (c *typeCore) mapGet(key jsjson.Str) *Item {
	if at, ok := c.index[unitsKey(key)]; ok {
		return c.entries[at].head
	}
	return nil
}

// mapSetHead replaces a key's head in place, or adds the key at the end,
// as a .NET Dictionary that is never removed from does.
func (c *typeCore) mapSetHead(key jsjson.Str, head *Item) {
	k := unitsKey(key)
	if at, ok := c.index[k]; ok {
		c.entries[at].head = head
		return
	}
	if c.index == nil {
		c.index = map[string]int{}
	}
	c.index[k] = len(c.entries)
	c.entries = append(c.entries, mapEntry{key: key, head: head})
}

func (c *typeCore) mapClear() {
	c.entries = nil
	c.index = nil
}

func (c *typeCore) integrateCore(doc *Doc, item *Item) {
	c.doc = doc
	c.item = item
}

// Item is the item that holds this type, nil for a root.
func (c *typeCore) Item() *Item { return c.item }

// Doc is the document the type belongs to, nil while prelim.
func (c *typeCore) Doc() *Doc { return c.doc }

func (c *typeCore) requireAttached() {
	if c.doc == nil {
		fail("yjs: this type is not in a document; seed a prelim type at construction instead.")
	}
}

// newItem is yjs's new Item(createID(own client, state), left, left.lastId,
// right, right.id, parent, parentSub, content).
func newItem(t *Transaction, parent AbstractType, left, right *Item, parentSub *jsjson.Str, content Content) *Item {
	doc := t.doc
	item := &Item{
		header:           header{id: ID{doc.clientID, doc.store.getState(doc.clientID)}, length: content.Len()},
		left:             left,
		right:            right,
		parent:           parent,
		parentSub:        parentSub,
		wireParentSubBit: parentSub != nil,
		content:          content,
	}
	if left != nil {
		item.origin = idPtr(left.lastID())
	}
	if right != nil {
		item.rightOrigin = idPtr(right.id)
	}
	return item
}

// mapSet is yjs's typeMapSet: the new value's left is the key's current
// head, deleted or not.
func mapSet(t *Transaction, self AbstractType, key jsjson.Str, value any) {
	left := self.core().mapGet(key)
	sub := append(jsjson.Str{}, key...)
	newItem(t, self, left, nil, &sub, mapContent(value)).integrate(t, 0)
}

func mapDelete(t *Transaction, self AbstractType, key jsjson.Str) {
	if head := self.core().mapGet(key); head != nil {
		head.delete(t)
	}
}

// mapContent is typeMapSet's content switch. A map value is always one
// tick; undefined is allowed because yjs tests value == null loosely.
func mapContent(value any) Content {
	switch value := value.(type) {
	case nil, bool, float64, jsjson.Str, *jsjson.Object, []any, jsjson.Undefined:
		return &ContentAny{Items: []any{value}}
	case []byte:
		return &ContentBinary{unsplittable: unsplittable{3}, Bytes: value}
	case AbstractType:
		return newContentTypeFor(value)
	}
	fail("yjs: %T is not a value a map can hold.", value)
	return nil
}

// listInsertGenerics is yjs's typeListInsertGenerics.
func listInsertGenerics(t *Transaction, self AbstractType, index int, values []any) {
	c := self.core()
	if index < 0 || index > c.length {
		fail("yjs: index %d is outside 0..%d.", index, c.length)
	}
	if index == 0 {
		listInsertGenericsAfter(t, self, nil, values)
		return
	}
	current := c.start
	for ; current != nil; current = current.right {
		if current.deleted || !current.countable() {
			continue
		}
		if index <= current.length {
			if index < current.length {
				t.doc.store.getItemCleanStart(t, ID{current.id.Client, current.id.Clock + uint64(index)})
			}
			break
		}
		index -= current.length
	}
	listInsertGenericsAfter(t, self, current, values)
}

// listInsertGenericsAfter packs a run of Any values into one item; a byte
// array or a shared type flushes the run and takes an item of its own.
func listInsertGenericsAfter(t *Transaction, self AbstractType, reference *Item, values []any) {
	left := reference
	// Every item of this insert shares one right neighbour, as yjs does.
	right := self.core().start
	if reference != nil {
		right = reference.right
	}
	var packed []any
	place := func(content Content) {
		left = newItem(t, self, left, right, nil, content)
		left.integrate(t, 0)
	}
	flush := func() {
		if len(packed) > 0 {
			place(&ContentAny{Items: packed})
			packed = nil
		}
	}
	for _, value := range values {
		switch value := value.(type) {
		case nil, bool, float64, jsjson.Str, *jsjson.Object, []any:
			packed = append(packed, value)
		case []byte:
			flush()
			place(&ContentBinary{unsplittable: unsplittable{3}, Bytes: value})
		case AbstractType:
			flush()
			place(newContentTypeFor(value))
		default:
			fail("yjs: %T is not a value a list can hold.", value)
		}
	}
	flush()
}

// listDelete is yjs's typeListDelete.
func listDelete(t *Transaction, self AbstractType, index, length int) {
	if index < 0 || length < 0 {
		fail("yjs: negative index or length.")
	}
	if length == 0 {
		return
	}
	store := t.doc.store
	current := self.core().start
	for ; current != nil && index > 0; current = current.right {
		if current.deleted || !current.countable() {
			continue
		}
		if index < current.length {
			store.getItemCleanStart(t, ID{current.id.Client, current.id.Clock + uint64(index)})
		}
		index -= current.length
	}
	for length > 0 && current != nil {
		if !current.deleted {
			if length < current.length {
				store.getItemCleanStart(t, ID{current.id.Client, current.id.Clock + uint64(length)})
			}
			length -= current.length
			current.delete(t)
		}
		current = current.right
	}
	if length > 0 {
		fail("yjs: the delete runs past the end of the list.")
	}
}

// untyped is a root nothing has typed yet; GetMap/GetArray/GetText upgrade it.
type untyped struct{ typeCore }

// MapEntry is one prelim map entry.
type MapEntry struct {
	Key   jsjson.Str
	Value any
}

// Map is a Y.Map. A key's value is the last element of its head item.
type Map struct {
	typeCore
	prelim []MapEntry
}

// NewMap is a prelim map written when its item integrates. A repeated key
// overwrites in place, as a JS Map does.
func NewMap(entries ...MapEntry) *Map {
	m := &Map{}
	for _, entry := range entries {
		replaced := false
		for i := range m.prelim {
			if jsjson.Compare(m.prelim[i].Key, entry.Key) == 0 {
				m.prelim[i] = entry
				replaced = true
				break
			}
		}
		if !replaced {
			m.prelim = append(m.prelim, entry)
		}
	}
	return m
}

// Keys are the live keys in the order they were first set.
func (m *Map) Keys() []jsjson.Str {
	var keys []jsjson.Str
	for _, entry := range m.entries {
		if !entry.head.deleted {
			keys = append(keys, entry.key)
		}
	}
	return keys
}

// Len counts live keys.
func (m *Map) Len() int { return len(m.Keys()) }

// Get reads the last value of the key's head. A slot with no value reads
// as undefined, as JS answers there.
func (m *Map) Get(key jsjson.Str) (any, bool) {
	head := m.mapGet(key)
	if head == nil || head.deleted {
		return nil, false
	}
	values := head.content.Values()
	last := head.length - 1
	if last >= 0 && last < len(values) {
		return values[last], true
	}
	return jsjson.Undefined{}, true
}

// Set writes one value under key.
func (m *Map) Set(t *Transaction, key jsjson.Str, value any) {
	m.requireAttached()
	mapSet(t, m, key, value)
}

// Delete removes key. An absent or deleted key is a no-op.
func (m *Map) Delete(t *Transaction, key jsjson.Str) {
	m.requireAttached()
	mapDelete(t, m, key)
}

// Clear removes every live key.
func (m *Map) Clear(t *Transaction) {
	m.requireAttached()
	for _, key := range m.Keys() {
		mapDelete(t, m, key)
	}
}

func (m *Map) integratePrelim(t *Transaction) {
	entries := m.prelim
	m.prelim = nil
	for _, entry := range entries {
		mapSet(t, m, entry.Key, entry.Value)
	}
}

// Array is a Y.Array.
type Array struct {
	typeCore
	prelim []any
}

// NewArray is a prelim array written when its item integrates.
func NewArray(values ...any) *Array { return &Array{prelim: append([]any{}, values...)} }

// Values are the live entries, one per tick.
func (a *Array) Values() []any {
	var values []any
	for item := a.start; item != nil; item = item.right {
		if item.deleted || !item.countable() {
			continue
		}
		values = append(values, item.content.Values()...)
	}
	return values
}

// Len walks the chain rather than reading the integration counter.
func (a *Array) Len() int { return len(a.Values()) }

// Get reads one entry, or nil past the end.
func (a *Array) Get(index int) any {
	if index < 0 {
		return nil
	}
	remaining := index
	for item := a.start; item != nil; item = item.right {
		if item.deleted || !item.countable() {
			continue
		}
		if remaining < item.length {
			return item.content.Values()[remaining]
		}
		remaining -= item.length
	}
	return nil
}

// Insert is YArray.insert: consecutive Any values share one item.
func (a *Array) Insert(t *Transaction, index int, values []any) {
	a.requireAttached()
	listInsertGenerics(t, a, index, values)
}

// Delete removes count entries from index.
func (a *Array) Delete(t *Transaction, index, count int) {
	a.requireAttached()
	listDelete(t, a, index, count)
}

func (a *Array) integratePrelim(t *Transaction) {
	values := a.prelim
	a.prelim = nil
	listInsertGenerics(t, a, 0, values)
}

// XmlElement is a placeholder: it integrates and re-encodes.
type XmlElement struct {
	typeCore
	NodeName *jsjson.Str
}

// XmlFragment is a placeholder.
type XmlFragment struct{ typeCore }

// XmlHook is a placeholder.
type XmlHook struct {
	typeCore
	HookName *jsjson.Str
}

// Type refs on the wire.
const (
	arrayRef       = 0
	mapRef         = 1
	textRef        = 2
	xmlElementRef  = 3
	xmlFragmentRef = 4
	xmlHookRef     = 5
	xmlTextRef     = 6
	maxTypeRef     = 6
)

func createType(ref int, name *jsjson.Str) AbstractType {
	switch ref {
	case arrayRef:
		return &Array{}
	case mapRef:
		return &Map{}
	case textRef:
		return &Text{}
	case xmlElementRef:
		return &XmlElement{NodeName: name}
	case xmlFragmentRef:
		return &XmlFragment{}
	case xmlHookRef:
		return &XmlHook{HookName: name}
	case xmlTextRef:
		return &XmlText{}
	}
	fail("yjs: %d is not a shared type ref.", ref)
	return nil
}

// ContentType (7) is a nested shared type.
type ContentType struct {
	unsplittable
	TypeRef int
	Name    *jsjson.Str
	Type    AbstractType
}

func newContentType(ref int, name *jsjson.Str) *ContentType {
	return &ContentType{unsplittable: unsplittable{7}, TypeRef: ref, Name: name, Type: createType(ref, name)}
}

// newContentTypeFor is the write side: the caller's own prelim instance.
// It must not already be in a document, or yjs would fork its children.
func newContentTypeFor(t AbstractType) *ContentType {
	if t.core().doc != nil {
		fail("yjs: this shared type already belongs to a document.")
	}
	var ref int
	var name *jsjson.Str
	switch t := t.(type) {
	case *Array:
		ref = arrayRef
	case *Map:
		ref = mapRef
	case *Text:
		ref = textRef
	case *XmlElement:
		ref, name = xmlElementRef, t.NodeName
	case *XmlFragment:
		ref = xmlFragmentRef
	case *XmlHook:
		ref, name = xmlHookRef, t.HookName
	case *XmlText:
		ref = xmlTextRef
	default:
		fail("yjs: %T has no shared type ref.", t)
	}
	return &ContentType{unsplittable: unsplittable{7}, TypeRef: ref, Name: name, Type: t}
}

func (*ContentType) Ref() byte       { return 7 }
func (*ContentType) Len() int        { return 1 }
func (*ContentType) Countable() bool { return true }
func (c *ContentType) Values() []any { return []any{c.Type} }
func (c *ContentType) copy() Content { return newContentType(c.TypeRef, c.Name) }

func (c *ContentType) write(w *writer, _ int) {
	w.WriteVarUint(uint64(c.TypeRef))
	if c.Name != nil {
		w.WriteVarString(*c.Name)
	}
}

// integrate is top-down inside the transaction: a prelim type's content is
// written only once its owner holds a clock.
func (c *ContentType) integrate(t *Transaction, item *Item) {
	c.Type.core().integrateCore(t.doc, item)
	c.Type.integratePrelim(t)
}

// delete cascades into the whole subtree with an explicit stack. An
// already-deleted child older than this transaction is only queued for
// merging.
func (c *ContentType) delete(t *Transaction) {
	pending := []AbstractType{c.Type}
	for len(pending) > 0 {
		core := pending[len(pending)-1].core()
		pending = pending[:len(pending)-1]
		for item := core.start; item != nil; item = item.right {
			pending = cascade(t, item, pending)
		}
		for _, entry := range core.entries {
			pending = cascade(t, entry.head, pending)
		}
	}
}

func cascade(t *Transaction, item *Item, pending []AbstractType) []AbstractType {
	if item.deleted {
		if item.id.Clock < t.beforeState.Get(item.id.Client) {
			t.mergeStructs = append(t.mergeStructs, item)
		}
		return pending
	}
	if nested, ok := item.content.(*ContentType); ok {
		item.deleteHere(t)
		return append(pending, nested.Type)
	}
	item.delete(t)
	return pending
}

// gc turns the subtree into GC structs. Map chains are walked LEFT from
// each head: the older values under a key are the rest of that chain.
func (c *ContentType) gc(store *Store) {
	pending := []AbstractType{c.Type}
	for len(pending) > 0 {
		core := pending[len(pending)-1].core()
		pending = pending[:len(pending)-1]
		for item := core.start; item != nil; item = item.right {
			pending = collect(item, store, pending)
		}
		core.start = nil
		for _, entry := range core.entries {
			for item := entry.head; item != nil; item = item.left {
				pending = collect(item, store, pending)
			}
		}
		core.mapClear()
	}
}

func collect(item *Item, store *Store, pending []AbstractType) []AbstractType {
	if nested, ok := item.content.(*ContentType); ok {
		item.collectHere(store, true)
		return append(pending, nested.Type)
	}
	item.gc(store, true)
	return pending
}

func readContentType(r *lib0.Reader) *ContentType {
	ref := must(r.ReadVarUint())
	if ref > maxTypeRef {
		panic(lib0.Errorf("yjs: %d at %d is not a shared type ref.", ref, r.Pos()))
	}
	var name *jsjson.Str
	if ref == xmlElementRef || ref == xmlHookRef {
		text := must(r.ReadVarString())
		name = &text
	}
	return newContentType(int(ref), name)
}
