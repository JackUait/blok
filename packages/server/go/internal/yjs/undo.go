package yjs

// UndoManager is yjs's Y.UndoManager over a whole document, as Blok's
// StoreApplier configures it: captureTimeout 0 (every captured transaction
// is its own stack item), only transactions run through Capture are
// tracked, and the manager's own replays land on the other stack. The doc
// must keep deleted content (Options.NoGC), so a deletion can be redone.
type UndoManager struct {
	doc       *Doc
	undoStack []*StackItem
	redoStack []*StackItem
	capturing bool
	undoing   bool
	redoing   bool
	stop      func()
}

// StackItem is one captured transaction: what it inserted and deleted.
type StackItem struct {
	insertions *DeleteSet
	deletions  *DeleteSet
}

// NewUndoManager tracks doc's captured transactions.
func NewUndoManager(doc *Doc) *UndoManager {
	u := &UndoManager{doc: doc}
	u.stop = doc.onTransaction(u.afterTransaction)
	return u
}

// Destroy stops tracking.
func (u *UndoManager) Destroy() { u.stop() }

// Capture runs body in one local transaction that the manager records as
// a new undo step, and returns the emitted update.
func (u *UndoManager) Capture(body func(*Transaction)) []byte {
	u.capturing = true
	defer func() { u.capturing = false }()
	return u.doc.Transact(body)
}

// UndoTop is the step Undo would replay, or nil.
func (u *UndoManager) UndoTop() *StackItem { return top(u.undoStack) }

// RedoTop is the step Redo would replay, or nil.
func (u *UndoManager) RedoTop() *StackItem { return top(u.redoStack) }

// DropOldest forgets the oldest undo step, keeping the stack bounded.
func (u *UndoManager) DropOldest(item *StackItem) {
	for i, candidate := range u.undoStack {
		if candidate == item {
			u.undoStack = append(u.undoStack[:i], u.undoStack[i+1:]...)
			return
		}
	}
}

func top(stack []*StackItem) *StackItem {
	if len(stack) == 0 {
		return nil
	}
	return stack[len(stack)-1]
}

// afterTransaction records a captured transaction or a replay.
func (u *UndoManager) afterTransaction(t *Transaction) {
	if !t.local || !(u.capturing || u.undoing || u.redoing) {
		return
	}
	insertions := &DeleteSet{}
	client := u.doc.clientID
	before, after := t.beforeState.Get(client), t.afterState.Get(client)
	if after > before {
		insertions.add(client, before, after-before)
	}
	if insertions.IsEmpty() && t.deleteSet.IsEmpty() {
		return
	}
	// Deleted content must stay for a redo.
	iterateDeletedStructs(t, t.deleteSet, func(s Struct) {
		if item, ok := s.(*Item); ok {
			keepItem(item)
		}
	})
	item := &StackItem{insertions: insertions, deletions: copyDeleteSet(t.deleteSet)}
	switch {
	case u.undoing:
		u.redoStack = append(u.redoStack, item)
	case u.redoing:
		u.undoStack = append(u.undoStack, item)
	default:
		u.undoStack = append(u.undoStack, item)
		u.redoStack = nil
	}
}

func copyDeleteSet(source *DeleteSet) *DeleteSet {
	copied := &DeleteSet{}
	for _, entry := range source.clients {
		for _, r := range entry.ranges {
			copied.add(entry.client, r.Clock, r.Length)
		}
	}
	return copied
}

// Undo replays the top undo step; false when it changed nothing.
func (u *UndoManager) Undo() (bool, error) {
	u.undoing = true
	defer func() { u.undoing = false }()
	return u.pop(&u.undoStack)
}

// Redo replays the top redo step; false when it changed nothing.
func (u *UndoManager) Redo() (bool, error) {
	u.redoing = true
	defer func() { u.redoing = false }()
	return u.pop(&u.redoStack)
}

// pop is yjs's popStackItem: steps that change nothing are dropped until
// one does.
func (u *UndoManager) pop(stack *[]*StackItem) (changed bool, err error) {
	defer recoverEngine(&err)
	u.doc.Transact(func(t *Transaction) {
		store := u.doc.store
		for len(*stack) > 0 && !changed {
			item := (*stack)[len(*stack)-1]
			*stack = (*stack)[:len(*stack)-1]
			var toRedo []*Item
			seen := map[*Item]bool{}
			var toDelete []*Item
			iterateDeletedStructs(t, item.insertions, func(s Struct) {
				inserted, ok := s.(*Item)
				if !ok {
					return
				}
				if inserted.redone != nil {
					followed, diff := followRedone(store, inserted.id)
					if diff > 0 {
						followed = store.getItemCleanStart(t, ID{followed.id.Client, followed.id.Clock + uint64(diff)})
					}
					inserted = followed
				}
				if !inserted.deleted {
					toDelete = append(toDelete, inserted)
				}
			})
			iterateDeletedStructs(t, item.deletions, func(s Struct) {
				deleted, ok := s.(*Item)
				if ok && !isDeleted(item.insertions, deleted.id) && !seen[deleted] {
					seen[deleted] = true
					toRedo = append(toRedo, deleted)
				}
			})
			for _, deleted := range toRedo {
				if u.redoItem(t, deleted, seen, item.insertions) != nil {
					changed = true
				}
			}
			// Children before parents.
			for i := len(toDelete) - 1; i >= 0; i-- {
				toDelete[i].delete(t)
				changed = true
			}
		}
	})
	return changed, nil
}

// followRedone walks an item's redone chain to its live copy.
func followRedone(store *Store, id ID) (*Item, int) {
	next := &id
	diff := 0
	var item *Item
	for next != nil {
		if diff > 0 {
			next = &ID{next.Client, next.Clock + uint64(diff)}
		}
		found, ok := store.find(*next).(*Item)
		if !ok {
			return item, diff
		}
		item = found
		diff = int(next.Clock - item.id.Clock)
		next = item.redone
	}
	return item, diff
}

func keepItem(item *Item) {
	for item != nil && !item.keep {
		item.keep = true
		parent, ok := item.parent.(AbstractType)
		if !ok {
			return
		}
		item = parent.core().item
	}
}

// isDeleted reports whether ds covers id.
func isDeleted(ds *DeleteSet, id ID) bool {
	for _, r := range ds.Ranges(id.Client) {
		if id.Clock >= r.Clock && id.Clock < r.Clock+r.Length {
			return true
		}
	}
	return false
}

// iterateDeletedStructs visits every struct ds covers, split at its edges.
func iterateDeletedStructs(t *Transaction, ds *DeleteSet, visit func(Struct)) {
	store := t.doc.store
	for _, entry := range ds.clients {
		structs, ok := store.clients[entry.client]
		if !ok || len(structs) == 0 {
			continue
		}
		state := structs[len(structs)-1].head().end()
		for _, r := range entry.ranges {
			if r.Clock >= state || r.Length == 0 {
				continue
			}
			end := min(r.Clock+r.Length, state)
			store.getStructCleanStart(t, ID{entry.client, r.Clock})
			if end < state {
				store.getStructCleanStart(t, ID{entry.client, end})
			}
			structs = store.clients[entry.client]
			for index := store.findIndex(entry.client, r.Clock); index < len(structs); index++ {
				s := structs[index]
				if s.head().id.Clock >= end {
					break
				}
				visit(s)
			}
		}
	}
}

func parentItemOf(item *Item) *Item {
	parent, ok := item.parent.(AbstractType)
	if !ok {
		return nil
	}
	return parent.core().item
}

// redoItem is yjs's redoItem: a copy of a deleted item put back where it
// was, its parent redone first. nil when it cannot come back.
func (u *UndoManager) redoItem(t *Transaction, item *Item, toRedo map[*Item]bool, insertions *DeleteSet) *Item {
	store := u.doc.store
	if item.redone != nil {
		return store.getItemCleanStart(t, *item.redone)
	}
	parentItem := parentItemOf(item)
	if parentItem != nil && parentItem.deleted {
		if parentItem.redone == nil && (!toRedo[parentItem] || u.redoItem(t, parentItem, toRedo, insertions) == nil) {
			return nil
		}
		for parentItem.redone != nil {
			parentItem = store.getItemCleanStart(t, *parentItem.redone)
		}
	}
	var parentType AbstractType
	if parentItem == nil {
		parentType, _ = item.parent.(AbstractType)
	} else if nested, ok := parentItem.content.(*ContentType); ok {
		parentType = nested.Type
	}
	if parentType == nil {
		return nil
	}
	var left, right *Item
	if item.parentSub == nil {
		left, right = item.left, item
		for left != nil {
			trace := left
			for trace != nil && parentItemOf(trace) != parentItem {
				if trace.redone == nil {
					trace = nil
				} else {
					trace = store.getItemCleanStart(t, *trace.redone)
				}
			}
			if trace != nil && parentItemOf(trace) == parentItem {
				left = trace
				break
			}
			left = left.left
		}
		for right != nil {
			trace := right
			for trace != nil && parentItemOf(trace) != parentItem {
				if trace.redone == nil {
					trace = nil
				} else {
					trace = store.getItemCleanStart(t, *trace.redone)
				}
			}
			if trace != nil && parentItemOf(trace) == parentItem {
				right = trace
				break
			}
			right = right.right
		}
	} else {
		if item.right != nil {
			left = item
			for left != nil && left.right != nil && (left.right.redone != nil || isDeleted(insertions, left.right.id) || u.inStacks(left.right.id)) {
				left = left.right
				for left.redone != nil {
					left = store.getItemCleanStart(t, *left.redone)
				}
			}
			// Another client wrote the key since: it keeps it.
			if left != nil && left.right != nil {
				return nil
			}
		} else {
			left = parentType.core().mapGet(*item.parentSub)
		}
		// A cross-parent left would give the copy a misleading origin.
		if left != nil && parentItemOf(left) != parentItem {
			left = parentType.core().mapGet(*item.parentSub)
		}
	}
	clock := store.getState(u.doc.clientID)
	id := ID{u.doc.clientID, clock}
	redone := &Item{
		header:    header{id: id, length: item.length},
		left:      left,
		right:     right,
		parent:    parentType,
		parentSub: item.parentSub,
		content:   item.content.copy(),
	}
	if left != nil {
		redone.origin = idPtr(left.lastID())
	}
	if right != nil {
		redone.rightOrigin = idPtr(right.id)
	}
	item.redone = &id
	keepItem(redone)
	redone.integrate(t, 0)
	return redone
}

// inStacks is yjs's isDeletedByUndoStack over both stacks.
func (u *UndoManager) inStacks(id ID) bool {
	for _, stack := range [][]*StackItem{u.undoStack, u.redoStack} {
		for _, item := range stack {
			if isDeleted(item.deletions, id) {
				return true
			}
		}
	}
	return false
}

// Preview replays the step Undo (or Redo) would replay on a copy of the
// doc, and returns the copy; the doc itself is untouched.
func (u *UndoManager) Preview(undo bool) (*Doc, error) {
	state, err := u.doc.EncodeStateAsUpdate(nil)
	if err != nil {
		return nil, err
	}
	clientID := uint32(u.doc.clientID)
	copied := NewDoc(Options{ClientID: &clientID, NoGC: true})
	if _, err := copied.ApplyUpdate(state); err != nil {
		return nil, err
	}
	// Applying its own state minted the copy a new client: the replay
	// writes under the real one, so its links name the same clocks.
	copied.AdoptClientID(u.doc.clientID)
	// The update carries no redone links, and the replay follows them.
	if err := carryRedone(u.doc, copied); err != nil {
		return nil, err
	}
	stack := u.undoStack
	if !undo {
		stack = u.redoStack
	}
	if len(stack) == 0 {
		return copied, nil
	}
	preview := &UndoManager{doc: copied}
	steps := []*StackItem{stack[len(stack)-1]}
	if _, err := preview.pop(&steps); err != nil {
		return nil, err
	}
	return copied, nil
}

// carryRedone sets every redone link of from's items on the same clocks of
// to, splitting to's items where from's are shorter.
func carryRedone(from, to *Doc) (err error) {
	defer recoverEngine(&err)
	for client, structs := range from.store.clients {
		for _, s := range structs {
			item, ok := s.(*Item)
			if !ok || item.redone == nil {
				continue
			}
			if _, known := to.store.clients[client]; !known {
				fail("yjs: the copy has no client %d", client)
			}
			target := to.store.getItemCleanStart(nil, item.id)
			if target.length > item.length {
				to.store.getItemCleanEnd(nil, item.lastID())
			}
			if target.length != item.length {
				fail("yjs: the copy splits %v differently", item.id)
			}
			redone := *item.redone
			target.redone = &redone
		}
	}
	return nil
}
