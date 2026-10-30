package yjs

import "github.com/JackUait/blok/packages/server/go/internal/jsjson"

const (
	originBit      = 0x80
	rightOriginBit = 0x40
	parentSubBit   = 0x20
	contentRefMask = 0x1f
)

// Item is one YATA insertion. origin and rightOrigin are the ids the author
// saw around it; left and right are the live neighbours.
type Item struct {
	header
	origin      *ID
	rightOrigin *ID
	left        *Item
	right       *Item
	// parent is an AbstractType once resolved; before that, the root name
	// (jsjson.Str) or the parent item's ID as the wire spelled it, or nil.
	parent any
	// parentSub is the map key, nil for list content.
	parentSub *jsjson.Str
	// wireParentSubBit keeps the info byte's parentSub bit: an origin
	// suppresses the parentSub bytes but yjs still sets the bit.
	wireParentSubBit bool
	content          Content
	deleted          bool
	keep             bool
}

// IsDeleted reports a deleted item.
func (i *Item) IsDeleted() bool { return i.deleted }

// Content is the item's payload.
func (i *Item) Content() Content { return i.content }

// ParentSub is the map key, or nil.
func (i *Item) ParentSub() *jsjson.Str { return i.parentSub }

func (i *Item) countable() bool { return i.content.Countable() }

func writeID(w *writer, id ID) {
	w.WriteVarUint(id.Client)
	w.WriteVarUint(id.Clock)
}

// write is yjs's Item.write. An offset re-origins the item onto the tick
// before it. Parent and parentSub are written only when neither origin is.
func (i *Item) write(w *writer, offset int) {
	origin := i.origin
	if offset > 0 {
		origin = &ID{i.id.Client, i.id.Clock + uint64(offset) - 1}
	}
	info := i.content.Ref() & contentRefMask
	if origin != nil {
		info |= originBit
	}
	if i.rightOrigin != nil {
		info |= rightOriginBit
	}
	if i.parentSub != nil || i.wireParentSubBit {
		info |= parentSubBit
	}
	w.WriteUint8(info)
	if origin != nil {
		writeID(w, *origin)
	}
	if i.rightOrigin != nil {
		writeID(w, *i.rightOrigin)
	}
	if origin == nil && i.rightOrigin == nil {
		i.writeParent(w)
		if i.parentSub != nil {
			w.WriteVarString(*i.parentSub)
		}
	}
	i.content.write(w, offset)
}

func (i *Item) writeParent(w *writer) {
	switch parent := i.parent.(type) {
	case AbstractType:
		core := parent.core()
		if core.item == nil {
			if core.rootName == nil {
				fail("yjs: %v has a root parent with no name.", i.id)
			}
			w.WriteVarUint(1)
			w.WriteVarString(*core.rootName)
			return
		}
		w.WriteVarUint(0)
		writeID(w, core.item.id)
	case jsjson.Str:
		w.WriteVarUint(1)
		w.WriteVarString(parent)
	case ID:
		w.WriteVarUint(0)
		writeID(w, parent)
	default:
		fail("yjs: %v has no parent to write.", i.id)
	}
}

// getMissing returns the client whose structs must arrive first, or ok=false
// once every dependency is in the store; then it resolves the neighbours.
// Nothing is mutated before all three checks pass, and the same client is
// checked too (stricter than yjs), so dishonest bytes park instead of
// failing mid-integration.
func (i *Item) getMissing(t *Transaction, store *Store) (uint64, bool) {
	if i.origin != nil && i.origin.Clock >= store.getState(i.origin.Client) {
		return i.origin.Client, true
	}
	if i.rightOrigin != nil && i.rightOrigin.Clock >= store.getState(i.rightOrigin.Client) {
		return i.rightOrigin.Client, true
	}
	if parentID, ok := i.parent.(ID); ok && parentID.Clock >= store.getState(parentID.Client) {
		return parentID.Client, true
	}
	var left, right Struct
	if i.origin != nil {
		left = store.getItemCleanEnd(t, *i.origin)
		i.origin = idPtr(left.head().lastID())
	}
	if i.rightOrigin != nil {
		right = store.getStructCleanStart(t, *i.rightOrigin)
		i.rightOrigin = idPtr(right.head().id)
	}
	i.left, _ = left.(*Item)
	i.right, _ = right.(*Item)
	_, leftGC := left.(*GC)
	_, rightGC := right.(*GC)
	switch parent := i.parent.(type) {
	case nil:
		if leftGC || rightGC {
			break
		}
		if i.left != nil {
			i.parent, i.parentSub = i.left.parent, i.left.parentSub
		} else if i.right != nil {
			i.parent, i.parentSub = i.right.parent, i.right.parentSub
		}
	case ID:
		if leftGC || rightGC {
			i.parent = nil
			break
		}
		i.parent = nil
		if found, ok := store.find(parent).(*Item); ok {
			if nested, ok := found.content.(*ContentType); ok {
				i.parent = nested.Type
			}
		}
	case jsjson.Str:
		if leftGC || rightGC {
			i.parent = nil
			break
		}
		i.parent = t.doc.Get(parent)
	default:
		if leftGC || rightGC {
			i.parent = nil
		}
	}
	return 0, false
}

// integrate is YATA. offset trims the clocks the store already has.
func (i *Item) integrate(t *Transaction, offset int) {
	store := t.doc.store
	if offset > 0 {
		i.id.Clock += uint64(offset)
		trimmed := store.getItemCleanEnd(t, ID{i.id.Client, i.id.Clock - 1})
		i.left, _ = trimmed.(*Item)
		i.origin = idPtr(trimmed.head().lastID())
		i.content = i.content.splice(offset)
		i.length -= offset
		if _, ok := trimmed.(*Item); !ok {
			// Our own prefix was collected; yjs walks into the GC and crashes.
			i.parent = nil
		}
	}
	if i.parent == nil {
		(&GC{header{id: i.id, length: i.length}}).integrate(t, 0)
		return
	}
	parentType, ok := i.parent.(AbstractType)
	if !ok {
		fail("yjs: %v was integrated with an unresolved parent (%v); getMissing resolves it first.", i.id, i.parent)
	}
	parent := parentType.core()
	if (i.left == nil && (i.right == nil || i.right.left != nil)) || (i.left != nil && i.left.right != i.right) {
		i.scanForConflicts(store, parent)
	}
	if i.left != nil {
		i.right = i.left.right
		i.left.right = i
	} else {
		i.right = firstAt(parent, i.parentSub)
		if i.parentSub == nil {
			parent.start = i
		}
	}
	if i.right != nil {
		i.right.left = i
	} else if i.parentSub != nil {
		// Last one written for the key wins; the value it replaces dies here.
		parent.mapSetHead(*i.parentSub, i)
		if i.left != nil {
			i.left.delete(t)
		}
	}
	if i.parentSub == nil && i.countable() && !i.deleted {
		parent.length += i.length
	}
	store.addStruct(i)
	i.content.integrate(t, i)
	if (parent.item != nil && parent.item.deleted) || (i.parentSub != nil && i.right != nil) {
		i.delete(t)
	}
}

// delete marks the item deleted and cascades into a nested type.
func (i *Item) delete(t *Transaction) {
	if i.deleteHere(t) {
		i.content.delete(t)
	}
}

// deleteHere is the delete without the cascade; false when already deleted.
// The parent's length is adjusted before the mark, which stops the count.
func (i *Item) deleteHere(t *Transaction) bool {
	if i.deleted {
		return false
	}
	parent, ok := i.parent.(AbstractType)
	if !ok {
		fail("yjs: %v was deleted before its parent was resolved.", i.id)
	}
	if i.countable() && i.parentSub == nil {
		parent.core().length -= i.length
	}
	i.deleted = true
	t.deleteSet.add(i.id.Client, i.id.Clock, uint64(i.length))
	return true
}

// gc drops a deleted item's payload. Inside a collected parent the struct
// becomes a GC; on its own its content becomes a tombstone.
func (i *Item) gc(store *Store, parentCollected bool) {
	i.requireDeleted()
	i.content.gc(store)
	i.collectHere(store, parentCollected)
}

func (i *Item) collectHere(store *Store, parentCollected bool) {
	i.requireDeleted()
	if parentCollected {
		store.replaceStruct(i, &GC{header{id: i.id, length: i.length}})
	} else {
		i.content = &ContentDeleted{ticks: i.length}
	}
}

func (i *Item) requireDeleted() {
	if !i.deleted {
		fail("yjs: %v is still live and cannot be collected.", i.id)
	}
}

// scanForConflicts is yjs's conflict scan. Case 1 is a tie at the same
// origin, broken by lower client id; case 2 is an item whose own origin
// sits before ours.
func (i *Item) scanForConflicts(store *Store, parent *typeCore) {
	left := i.left
	var current *Item
	if left != nil {
		current = left.right
	} else {
		current = firstAt(parent, i.parentSub)
	}
	conflicting := map[*Item]struct{}{}
	beforeOrigin := map[*Item]struct{}{}
	for current != nil && current != i.right {
		beforeOrigin[current] = struct{}{}
		conflicting[current] = struct{}{}
		if sameID(i.origin, current.origin) {
			if current.id.Client < i.id.Client {
				left = current
				clear(conflicting)
			} else if sameID(i.rightOrigin, current.rightOrigin) {
				break
			}
		} else if origin := originItem(store, current); origin != nil && contains(beforeOrigin, origin) {
			if !contains(conflicting, origin) {
				left = current
				clear(conflicting)
			}
		} else {
			break
		}
		current = current.right
	}
	i.left = left
}

func originItem(store *Store, current *Item) *Item {
	if current.origin == nil {
		return nil
	}
	found, _ := store.find(*current.origin).(*Item)
	return found
}

func contains(set map[*Item]struct{}, item *Item) bool {
	_, ok := set[item]
	return ok
}

// firstAt is the head of the chain a new item with no left neighbour joins.
func firstAt(parent *typeCore, parentSub *jsjson.Str) *Item {
	if parentSub == nil {
		return parent.start
	}
	head := parent.mapGet(*parentSub)
	for head != nil && head.left != nil {
		head = head.left
	}
	return head
}

// splitAt cuts the item at diff clocks and returns the right half. The map
// head moves to the right half when it becomes the key's last value.
func (i *Item) splitAt(diff int) *Item {
	if diff <= 0 || diff >= i.length {
		fail("yjs: cannot split a %d-clock item at %d.", i.length, diff)
	}
	clock := i.id.Clock + uint64(diff)
	oldRight := i.right
	right := &Item{
		header:      header{id: ID{i.id.Client, clock}, length: i.length - diff},
		left:        i,
		origin:      &ID{i.id.Client, clock - 1},
		right:       oldRight,
		rightOrigin: i.rightOrigin,
		parent:      i.parent,
		parentSub:   i.parentSub,
		content:     i.content.splice(diff),
		deleted:     i.deleted,
		keep:        i.keep,
	}
	i.right = right
	i.length = diff
	if oldRight != nil {
		oldRight.left = right
	}
	if right.parentSub != nil && oldRight == nil {
		parent, ok := right.parent.(AbstractType)
		if !ok {
			fail("yjs: the map head for '%s' has an unresolved parent (%v); resolve it before splitting.", right.parentSub.String(), right.parent)
		}
		parent.core().mapSetHead(*right.parentSub, right)
	}
	return right
}
