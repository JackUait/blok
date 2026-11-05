package convert

import (
	"errors"
	"fmt"
	"math"
	"slices"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// ErrEditFailedMidWrite is C#'s InvalidOperationException from ApplyOps: a
// step failed inside the transaction. Nothing was emitted, but what the
// step wrote stays in the doc, so it is a server error, not a refusal.
var ErrEditFailedMidWrite = errors.New("collab: an edit failed while it was being written, and the document may hold part of it. Reload the document from the record.")

// ApplyOps applies block-level edit ops in request order; a later op sees
// what the earlier ones did. Everything that can refuse runs before the
// transaction opens, so a refused request (*EditError) writes nothing and an
// applied one emits one update.
func ApplyOps(doc *yjs.Doc, ops []EditOp, input *RichTextInput) error {
	_, err := applyOps(doc, ops, input)
	return err
}

// CollectOpsHTML is the HTML the rich fields of ops carry, each once. It
// plans the request as ApplyOps does, writes nothing, and fails where
// ApplyOps would.
func CollectOpsHTML(doc *yjs.Doc, ops []EditOp, fields *RichTextFields) ([]RichTextHTML, error) {
	input := Collecting(fields)
	if _, err := newPlanner(doc, input).plan(ops); err != nil {
		return nil, err
	}
	return input.Found(), nil
}

// applyOps also reports how many blocks the removal walks visited.
func applyOps(doc *yjs.Doc, ops []EditOp, input *RichTextInput) (int, error) {
	if len(ops) == 0 {
		return 0, nil
	}
	p := newPlanner(doc, input)
	steps, err := p.plan(ops)
	if err != nil {
		return 0, err
	}
	return p.visited, runSteps(doc, steps)
}

// runSteps writes every step in one transaction.
func runSteps(doc *yjs.Doc, steps []step) (err error) {
	blockMap := doc.GetMap(str(blocksRoot))
	rootOrder := doc.GetArray(str(orderRoot))
	defer func() {
		// The panic leaves Transact before its cleanup, so nothing is emitted.
		if failure := recover(); failure != nil {
			err = fmt.Errorf("%w (%v)", ErrEditFailedMidWrite, failure)
		}
	}()
	doc.Transact(func(t *yjs.Transaction) {
		for _, s := range steps {
			s(t, blockMap, rootOrder)
		}
	})
	return nil
}

// step is one write, already validated and built. It never refuses.
type step func(t *yjs.Transaction, blockMap *yjs.Map, rootOrder *yjs.Array)

// list is a shared, mutable id list: the planner hands the same one to
// several indexes, as C# shares its List<string>.
type list struct{ ids []string }

func (l *list) indexOf(id string) int { return slices.Index(l.ids, id) }

func (l *list) remove(id string) {
	if i := l.indexOf(id); i >= 0 {
		l.ids = slices.Delete(l.ids, i, i+1)
	}
}

func (l *list) insert(at int, id string) { l.ids = slices.Insert(l.ids, at, id) }

// planner keeps a picture of the doc (ids are unit keys) and mutates it as
// it plans, so a later op sees an earlier one. parentId is the membership
// arbiter, as on export.
type planner struct {
	doc       *yjs.Doc
	blockMap  *yjs.Map
	rootOrder *yjs.Array
	input     *RichTextInput

	parents   map[string]*string
	notBlocks map[string]bool
	children  map[string]*list
	// The root order as stored: nil is a slot that is not an id but still counts.
	order    []*string
	listedBy map[string]*list
	// nil is a block with no contentIds array at all.
	contents map[string]*list
	types    map[string]*string
	visited  int
}

func newPlanner(doc *yjs.Doc, input *RichTextInput) *planner {
	return &planner{
		doc:       doc,
		blockMap:  doc.GetMap(str(blocksRoot)),
		rootOrder: doc.GetArray(str(orderRoot)),
		input:     input,
		parents:   map[string]*string{},
		notBlocks: map[string]bool{},
		children:  map[string]*list{},
		listedBy:  map[string]*list{},
		contents:  map[string]*list{},
		types:     map[string]*string{},
	}
}

func where(index int, message string) error {
	return &EditError{Message: fmt.Sprintf("collab: op %d: %s", index, message)}
}

func (p *planner) plan(ops []EditOp) ([]step, error) {
	p.readDoc()
	var steps []step
	for index, op := range ops {
		planned, err := p.planOne(op, index)
		if err != nil {
			// The converter's own guards speak about a document; the caller
			// still has to learn which op was refused.
			var data *DataError
			if errors.As(err, &data) {
				return nil, where(index, data.Message)
			}
			return nil, err
		}
		steps = append(steps, planned...)
	}
	return steps, nil
}

func keyPtr(s jsjson.Str, ok bool) *string {
	if !ok {
		return nil
	}
	k := unitKey(s)
	return &k
}

func (p *planner) readDoc() {
	for _, key := range p.blockMap.Keys() {
		id := unitKey(key)
		block, ok := mapValue(p.blockMap, key).(*yjs.Map)
		if !ok {
			p.notBlocks[id] = true
			p.parents[id] = nil
			continue
		}
		parentID := keyPtr(strValue(block, "parentId"))
		p.parents[id] = parentID
		p.types[id] = keyPtr(strValue(block, "type"))
		p.index(id, parentID)
		listed := readContentIDs(block)
		p.contents[id] = listed
		if listed != nil {
			for _, child := range listed.ids {
				p.listedByOf(child).ids = append(p.listedByOf(child).ids, id)
			}
		}
	}
	// Every slot: the shadow's indices are applied to the real array.
	for _, entry := range p.rootOrder.Values() {
		if s, ok := entry.(jsjson.Str); ok {
			k := unitKey(s)
			p.order = append(p.order, &k)
		} else {
			p.order = append(p.order, nil)
		}
	}
}

func (p *planner) listedByOf(child string) *list {
	holders, ok := p.listedBy[child]
	if !ok {
		holders = &list{}
		p.listedBy[child] = holders
	}
	return holders
}

func readContentIDs(block *yjs.Map) *list {
	contentIDs, ok := value(block, "contentIds").(*yjs.Array)
	if !ok {
		return nil
	}
	ids := &list{}
	for _, entry := range contentIDs.Values() {
		if s, ok := entry.(jsjson.Str); ok {
			ids.ids = append(ids.ids, unitKey(s))
		}
	}
	return ids
}

func (p *planner) index(id string, parentID *string) {
	if parentID == nil {
		return
	}
	bucket, ok := p.children[*parentID]
	if !ok {
		bucket = &list{}
		p.children[*parentID] = bucket
	}
	bucket.ids = append(bucket.ids, id)
}

func sameID(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func indexOfSlot(order []*string, id string) int {
	return slices.IndexFunc(order, func(slot *string) bool { return slot != nil && *slot == id })
}

func lastIndexOfSlot(order []*string, id string) int {
	for i := len(order) - 1; i >= 0; i-- {
		if order[i] != nil && *order[i] == id {
			return i
		}
	}
	return -1
}

// screened is NoNul over an id the request carries, as a unit key.
func screened(id string, what string) (string, error) {
	s, err := noNul(str(id), what)
	if err != nil {
		return "", err
	}
	return unitKey(s), nil
}

func screenedPtr(id *string, what string) (*string, error) {
	if id == nil {
		return nil, nil
	}
	k, err := screened(*id, what)
	return &k, err
}

func (p *planner) planOne(op EditOp, index int) ([]step, error) {
	switch op := op.(type) {
	case Insert:
		return p.planInsert(op, index)
	case Update:
		return p.planUpdate(op, index)
	case Remove:
		return p.planRemove(op, index)
	case PatchMaps:
		return p.planPatchMaps(op, index)
	case SetPageField:
		return p.planSetPageField(op, index)
	case Move:
		return p.planMove(op, index)
	case Lift:
		return p.planLift(op, index)
	case Retype:
		return p.planRetype(op, index)
	case SetTunes:
		return p.planSetTunes(op, index)
	case SetMetadata:
		return p.planSetMetadata(op, index)
	}
	return nil, where(index, "the op is not one this server knows.")
}

func childOf(parent *string) string {
	if parent == nil {
		return "the document root"
	}
	return "\"" + *parent + "\""
}

func (p *planner) planInsert(op Insert, index int) ([]step, error) {
	id := unitKey(str(op.ID))
	if _, ok := p.parents[id]; ok {
		return nil, where(index, fmt.Sprintf("the document already has a block \"%s\".", op.ID))
	}
	parent, err := screenedPtr(op.Parent, "a parent id")
	if err != nil {
		return nil, err
	}
	if parent != nil {
		if _, ok := p.parents[*parent]; !ok {
			return nil, where(index, fmt.Sprintf("there is no block \"%s\" to insert under.", *op.Parent))
		}
	}
	after, err := screenedPtr(op.After, "a block id")
	if err != nil {
		return nil, err
	}
	if after != nil {
		afterParent, ok := p.parents[*after]
		if !ok {
			return nil, where(index, fmt.Sprintf("there is no block \"%s\" to insert after.", *op.After))
		}
		if !sameID(afterParent, parent) {
			return nil, where(index, fmt.Sprintf("block \"%s\" is not a child of %s.", *op.After, childOf(op.Parent)))
		}
	}
	var siblings *list
	if parent != nil {
		if err := p.refuseUnlessBlockMap(*parent, *op.Parent, index); err != nil {
			return nil, err
		}
		siblings = p.contents[*parent]
		if siblings == nil {
			return nil, where(index, fmt.Sprintf("block \"%s\" has no children list, so nothing can be placed under it.", *op.Parent))
		}
		if after != nil && siblings.indexOf(*after) < 0 {
			return nil, where(index, fmt.Sprintf("block \"%s\" is not in the document order, so nothing can be placed after it.", *op.After))
		}
	}
	// Built now: composing runs the NUL and depth guards before any write.
	v, err := strictValue(op.Block)
	if err != nil {
		return nil, err
	}
	block := v.(*jsjson.Object)
	if op.Parent != nil {
		put(block, "parent", str(*op.Parent))
	}
	blockID, err := noNul(str(op.ID), "a block id")
	if err != nil {
		return nil, err
	}
	composed, err := blockMap(blockID, block, p.input)
	if err != nil {
		return nil, err
	}
	p.parents[id] = parent
	kind, ok := getString(block, "type")
	p.types[id] = keyPtr(kind, ok)
	p.index(id, parent)
	p.contents[id] = &list{}
	if parent != nil {
		p.listedByOf(id).ids = append(p.listedByOf(id).ids, *parent)
	}
	steps := []step{putBlock(blockID, composed)}
	if parent == nil {
		found := -1
		if after != nil {
			found = indexOfSlot(p.order, *after)
			// A root block by its parentId that the root order does not list.
			if found < 0 {
				return nil, where(index, fmt.Sprintf("block \"%s\" is not in the document order, so nothing can be placed after it.", *op.After))
			}
		}
		at := found + 1
		p.order = slices.Insert(p.order, at, &id)
		steps = append(steps, insertRootOrder(at, blockID))
	} else {
		at := 0
		if after != nil {
			at = siblings.indexOf(*after) + 1
		}
		siblings.insert(at, id)
		steps = append(steps, linkChild(*parent, id, after))
	}
	return steps, nil
}

func (p *planner) kindOf(id string) *jsjson.Str {
	k := p.types[id]
	if k == nil {
		return nil
	}
	s := fromUnitKey(*k)
	return &s
}

// dataEntries is BlockDataEntries over NormalizeBlockData, then the Screen
// the update path needs because its values are written later.
func (p *planner) dataEntries(kind *jsjson.Str, data *jsjson.Node) ([]entry, error) {
	v, err := editValue(data)
	if err != nil {
		return nil, err
	}
	var name jsjson.Str
	if kind != nil {
		name = *kind
	}
	entries, err := blockDataEntries(kind, normalizeBlockData(name, v.(*jsjson.Object)), p.input)
	if err != nil {
		return nil, err
	}
	if err := screen(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (p *planner) planUpdate(op Update, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	if _, ok := p.parents[id]; !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to update.", op.ID))
	}
	if err := p.refuseUnlessBlockMap(id, op.ID, index); err != nil {
		return nil, err
	}
	entries, err := p.dataEntries(p.kindOf(id), op.Data)
	if err != nil {
		return nil, err
	}
	return []step{replaceData(fromUnitKey(id), entries)}, nil
}

// planRemove follows parentId, not contentIds, to find the subtree.
func (p *planner) planRemove(op Remove, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	if _, ok := p.parents[id]; !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to remove.", op.ID))
	}
	doomed := []string{id}
	isDoomed := map[string]bool{id: true}
	// Iterative and linear in the subtree: a document may nest thousands deep.
	for next := 0; next < len(doomed); next++ {
		p.visited++
		bucket, ok := p.children[doomed[next]]
		if !ok {
			continue
		}
		for _, child := range bucket.ids {
			if !isDoomed[child] {
				isDoomed[child] = true
				doomed = append(doomed, child)
			}
		}
	}
	var steps []step
	for _, gone := range doomed {
		if parentID := p.parents[gone]; parentID != nil {
			if siblings, ok := p.children[*parentID]; ok {
				siblings.remove(gone)
			}
		}
		delete(p.parents, gone)
		delete(p.children, gone)
		delete(p.types, gone)
		steps = append(steps, removeBlock(fromUnitKey(gone)))
		if listed, ok := p.contents[gone]; ok {
			delete(p.contents, gone)
			if listed != nil {
				for _, child := range listed.ids {
					if holders, ok := p.listedBy[child]; ok {
						holders.remove(gone)
					}
				}
			}
		}
		// Every occurrence: a duplicate left behind is a dangling id for good.
		for at := lastIndexOfSlot(p.order, gone); at >= 0; at = lastIndexOfSlot(p.order, gone) {
			p.order = slices.Delete(p.order, at, at+1)
			steps = append(steps, removeRootOrder(at))
		}
		// Unlink wherever the doc lists it, not just from its parent.
		if holders, ok := p.listedBy[gone]; ok {
			delete(p.listedBy, gone)
			for _, holder := range holders.ids {
				if !isDoomed[holder] {
					if c := p.contents[holder]; c != nil {
						c.remove(gone)
					}
					steps = append(steps, unlinkChild(holder, gone))
				}
			}
		}
	}
	return steps, nil
}

func (p *planner) planPatchMaps(op PatchMaps, index int) ([]step, error) {
	var steps []step
	for _, patch := range op.Patches {
		if !slices.Contains(PageMaps, patch.Map) {
			return nil, where(index, fmt.Sprintf("\"%s\" is not a map a patch may write.", patch.Map))
		}
		target := p.doc.GetMap(str(patch.Map))
		if patch.Remove {
			steps = append(steps, patchMap(target, str(patch.Key), nil))
			continue
		}
		if !IsPlainMapValue(patch.Value) {
			return nil, where(index, fmt.Sprintf("the value for \"%s.%s\" is not plain JSON.", patch.Map, patch.Key))
		}
		// C# refuses here only when encoding runs out of stack; Go's writer has no such limit.
		steps = append(steps, patchMap(target, str(patch.Key), encodeAny(patch.Value)))
	}
	return steps, nil
}

// planMove is DocumentStore.moveBlockTo: the id leaves every order that
// lists it, its parentId is rewritten (deleted for the root), and it is
// placed after After. The block map is never replaced.
func (p *planner) planMove(op Move, index int) ([]step, error) {
	return p.move(str(op.ID), strPtr(op.After), strPtr(op.Parent), index)
}

func strPtr(s *string) *jsjson.Str {
	if s == nil {
		return nil
	}
	v := str(*s)
	return &v
}

func screenedKey(s *jsjson.Str, what string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	if _, err := noNul(*s, what); err != nil {
		return nil, err
	}
	k := unitKey(*s)
	return &k, nil
}

func nameOf(s *jsjson.Str) *string {
	if s == nil {
		return nil
	}
	name := s.String()
	return &name
}

// move takes ids as the doc spells them, so Lift can move a child whose id
// a peer wrote.
func (p *planner) move(blockID jsjson.Str, afterID, parentID *jsjson.Str, index int) ([]step, error) {
	name := blockID.String()
	idKey, err := screenedKey(&blockID, "a block id")
	if err != nil {
		return nil, err
	}
	id := *idKey
	oldParent, ok := p.parents[id]
	if !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to move.", name))
	}
	if err := p.refuseUnlessBlockMap(id, name, index); err != nil {
		return nil, err
	}
	var siblings *list
	parentName := nameOf(parentID)
	parent, err := screenedKey(parentID, "a parent id")
	if err != nil {
		return nil, err
	}
	if parent != nil {
		if _, ok := p.parents[*parent]; !ok {
			return nil, where(index, fmt.Sprintf("there is no block \"%s\" to move under.", *parentName))
		}
		if err := p.refuseUnlessBlockMap(*parent, *parentName, index); err != nil {
			return nil, err
		}
		// A cycle a peer wrote must not hang the walk.
		seen := map[string]bool{}
		for cursor := parent; cursor != nil && !seen[*cursor]; cursor = p.parents[*cursor] {
			seen[*cursor] = true
			if *cursor == id {
				return nil, where(index, fmt.Sprintf("block \"%s\" cannot move inside itself.", name))
			}
		}
		siblings = p.contents[*parent]
		if siblings == nil {
			return nil, where(index, fmt.Sprintf("block \"%s\" has no children list, so nothing can be placed under it.", *parentName))
		}
	}
	after, err := screenedKey(afterID, "a block id")
	if err != nil {
		return nil, err
	}
	if after != nil {
		afterParent, known := p.parents[*after]
		listed := false
		if parent == nil {
			listed = indexOfSlot(p.order, *after) >= 0
		} else {
			listed = siblings.indexOf(*after) >= 0
		}
		if *after == id || !known || !sameID(afterParent, parent) || !listed {
			return nil, where(index, fmt.Sprintf("block \"%s\" is not a child of %s, so nothing can be placed after it.", *nameOf(afterID), childOf(parentName)))
		}
	}
	var steps []step
	for at := lastIndexOfSlot(p.order, id); at >= 0; at = lastIndexOfSlot(p.order, id) {
		p.order = slices.Delete(p.order, at, at+1)
		steps = append(steps, removeRootOrder(at))
	}
	if holders, ok := p.listedBy[id]; ok {
		delete(p.listedBy, id)
		for _, holder := range holders.ids {
			if c := p.contents[holder]; c != nil {
				c.remove(id)
			}
			steps = append(steps, unlinkChild(holder, id))
		}
	}
	// The child index follows parentId, and a later removal walks it.
	if oldParent != nil {
		if bucket, ok := p.children[*oldParent]; ok {
			bucket.remove(id)
		}
	}
	p.parents[id] = parent
	p.index(id, parent)
	steps = append(steps, setParentID(id, parent))
	if parent == nil {
		at := 0
		if after != nil {
			at = indexOfSlot(p.order, *after) + 1
		}
		p.order = slices.Insert(p.order, at, &id)
		steps = append(steps, insertRootOrder(at, blockID))
	} else {
		p.listedByOf(id).ids = append(p.listedByOf(id).ids, *parent)
		at := 0
		if after != nil {
			at = siblings.indexOf(*after) + 1
		}
		siblings.insert(at, id)
		steps = append(steps, linkChild(*parent, id, after))
	}
	return steps, nil
}

// planLift moves the children into the block's own slot, in order, right
// after it: listed children first, then any only their parentId names.
func (p *planner) planLift(op Lift, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	parentID, ok := p.parents[id]
	if !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to lift children out of.", op.ID))
	}
	var lifted []string
	seen := map[string]bool{}
	add := func(child string) {
		if !seen[child] {
			seen[child] = true
			lifted = append(lifted, child)
		}
	}
	if listed := p.contents[id]; listed != nil {
		for _, child := range listed.ids {
			if sameID(p.parents[child], &id) {
				add(child)
			}
		}
	}
	if bucket, ok := p.children[id]; ok {
		for _, child := range bucket.ids {
			add(child)
		}
	}
	var parent *jsjson.Str
	if parentID != nil {
		s := fromUnitKey(*parentID)
		parent = &s
	}
	var steps []step
	after := fromUnitKey(id)
	for _, child := range lifted {
		childID := fromUnitKey(child)
		anchor := after
		moved, err := p.move(childID, &anchor, parent, index)
		if err != nil {
			return nil, err
		}
		steps = append(steps, moved...)
		after = childID
	}
	return steps, nil
}

func (p *planner) planRetype(op Retype, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	if _, ok := p.parents[id]; !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to retype.", op.ID))
	}
	if err := p.refuseUnlessBlockMap(id, op.ID, index); err != nil {
		return nil, err
	}
	kind, err := noNul(str(op.Type), "a block type")
	if err != nil {
		return nil, err
	}
	entries, err := p.dataEntries(&kind, op.Data)
	if err != nil {
		return nil, err
	}
	k := unitKey(kind)
	p.types[id] = &k
	block := fromUnitKey(id)
	return []step{setBlockField(block, "type", kind), replaceData(block, entries)}, nil
}

type tune struct {
	name  jsjson.Str
	value any
}

func (p *planner) planSetTunes(op SetTunes, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	if _, ok := p.parents[id]; !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to set tunes on.", op.ID))
	}
	if err := p.refuseUnlessBlockMap(id, op.ID, index); err != nil {
		return nil, err
	}
	var tunes []tune
	for _, m := range op.Tunes.Members {
		name, err := m.Key()
		if err != nil {
			return nil, errors.Join(ErrNotUnicode, err)
		}
		v, err := editValue(m.Value)
		if err != nil {
			return nil, err
		}
		// Screened here: a step must not throw mid-transaction.
		if _, err := plainToYValue(v, blockFieldDepth+1); err != nil {
			return nil, err
		}
		if _, err := noNul(name, "a tune name"); err != nil {
			return nil, err
		}
		tunes = append(tunes, tune{name, v})
	}
	return []step{setTunes(fromUnitKey(id), tunes)}, nil
}

func (p *planner) planSetMetadata(op SetMetadata, index int) ([]step, error) {
	id, err := screened(op.ID, "a block id")
	if err != nil {
		return nil, err
	}
	if _, ok := p.parents[id]; !ok {
		return nil, where(index, fmt.Sprintf("there is no block \"%s\" to stamp.", op.ID))
	}
	if err := p.refuseUnlessBlockMap(id, op.ID, index); err != nil {
		return nil, err
	}
	if math.IsNaN(op.LastEditedAt) || math.IsInf(op.LastEditedAt, 0) {
		return nil, where(index, "\"lastEditedAt\" must be a finite number.")
	}
	by, err := noNul(str(op.LastEditedBy), "an editor id")
	if err != nil {
		return nil, err
	}
	block := fromUnitKey(id)
	steps := []step{setBlockField(block, "lastEditedAt", op.LastEditedAt), setBlockField(block, "lastEditedBy", by)}
	// LOCKSTEP with DocumentStore.updateBlockMetadata: no co-editor removes the old one.
	if op.LastEditedWith != nil {
		with, err := noNul(str(*op.LastEditedWith), "a co-editor id")
		if err != nil {
			return nil, err
		}
		return append(steps, setBlockField(block, "lastEditedWith", with)), nil
	}
	return append(steps, removeBlockField(block, "lastEditedWith")), nil
}

// cleanPageField: a string, or an object's top-level strings, without U+0000.
func cleanPageField(v any) any {
	clean := func(v any) any {
		if s, ok := v.(jsjson.Str); ok {
			return withoutNul(s)
		}
		return v
	}
	if object, ok := v.(*jsjson.Object); ok {
		cleaned := &jsjson.Object{}
		for _, m := range object.Members() {
			cleaned.Set(m.Key, clean(m.Value))
		}
		return cleaned
	}
	return clean(v)
}

// planSetPageField is writePageField: NULs stripped, null or "" deletes.
func (p *planner) planSetPageField(op SetPageField, index int) ([]step, error) {
	if op.Key != "title" && op.Key != "icon" {
		return nil, where(index, fmt.Sprintf("\"%s\" is not a page field.", op.Key))
	}
	var raw any
	if op.Value != nil {
		v, err := strictValue(op.Value)
		if err != nil {
			return nil, err
		}
		raw = v
	}
	v := cleanPageField(raw)
	pageMap := p.doc.GetMap(str(pageRoot))
	if text, ok := v.(jsjson.Str); v == nil || (ok && len(text) == 0) {
		return []step{patchMap(pageMap, str(op.Key), nil)}, nil
	}
	if op.Key == "title" {
		if _, ok := v.(jsjson.Str); !ok {
			return nil, where(index, "a page title is a string.")
		}
	} else if !isPageIcon(v) {
		return nil, where(index, `a page icon is { type: "emoji", value } or { type: "image", url }.`)
	}
	atomic, err := atomicValue(v, 1)
	if err != nil {
		return nil, err
	}
	return []step{patchMap(pageMap, str(op.Key), encodeAny(atomic))}, nil
}

// refuseUnlessBlockMap refuses a target in the blocks map that is not a
// block: a step that reads it as a map would fail mid-transaction.
func (p *planner) refuseUnlessBlockMap(id, name string, index int) error {
	if p.notBlocks[id] {
		return where(index, fmt.Sprintf("\"%s\" is in the document but is not a block.", name))
	}
	return nil
}

func mapValue(m *yjs.Map, key jsjson.Str) any {
	v, ok := m.Get(key)
	if !ok {
		return nil
	}
	return v
}

func blockOf(blockMap *yjs.Map, id jsjson.Str) (*yjs.Map, bool) {
	block, ok := mapValue(blockMap, id).(*yjs.Map)
	return block, ok
}

func putBlock(id jsjson.Str, block *yjs.Map) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) { blockMap.Set(t, id, block) }
}

func removeBlock(id jsjson.Str) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) { blockMap.Delete(t, id) }
}

// replaceData rewrites a block's data key by key and each key in place, so
// a peer's live text or container keeps its identity. Keys the new data
// lacks are still removed.
func replaceData(id jsjson.Str, data []entry) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		block, ok := blockOf(blockMap, id)
		if !ok {
			return
		}
		existing, ok := mapValue(block, str("data")).(*yjs.Map)
		if !ok {
			m, err := toDataMap(data)
			if err != nil {
				panic(err)
			}
			block.Set(t, str("data"), m)
			return
		}
		keep := map[string]bool{}
		for _, e := range data {
			keep[unitKey(e.key)] = true
		}
		for _, key := range existing.Keys() {
			if !keep[unitKey(key)] {
				existing.Delete(t, key)
			}
		}
		for _, e := range data {
			switch v := e.value.(type) {
			case mergeableRichText:
				if live, ok := mapValue(existing, e.key).(*yjs.XmlText); ok {
					ApplyRichTextOps(t, live, PlanRichTextEdit(live.ToDelta(), v.segments))
				} else {
					existing.Set(t, e.key, newRichText(v.segments))
				}
				continue
			case mergeableText:
				if live, ok := mapValue(existing, e.key).(*yjs.Text); ok {
					editText(t, live, v.value)
				} else {
					existing.Set(t, e.key, yjs.NewText(v.value))
				}
				continue
			}
			// Top level: the ordered-id rule is a nested rule on both sides.
			assignEntry(t, existing, e.key, e.value, blockFieldDepth+1, false, false)
		}
	}
}

// editText turns live into next with the smallest edits, back to front.
// Insert first, then delete what it replaces: the other order anchors the
// new text to the tombstones and a peer's keystroke there jumps ahead.
func editText(t *yjs.Transaction, live *yjs.Text, next jsjson.Str) {
	before := live.Units()
	if slices.Equal(before, next) {
		return
	}
	edits := Diff(before, next, true)
	for i := len(edits) - 1; i >= 0; i-- {
		edit := edits[i]
		if len(edit.Insert) > 0 {
			live.Insert(t, edit.Index, edit.Insert, nil)
		}
		if edit.Remove > 0 {
			live.Delete(t, edit.Index+len(edit.Insert), edit.Remove)
		}
	}
}

// patchMap decodes at apply time, so two applies never share a value. nil deletes.
func patchMap(m *yjs.Map, key jsjson.Str, encoded []byte) step {
	return func(t *yjs.Transaction, _ *yjs.Map, _ *yjs.Array) {
		if encoded == nil {
			m.Delete(t, key)
			return
		}
		v, err := lib0.ReadAny(lib0.NewReader(encoded))
		if err != nil {
			panic(err)
		}
		m.Set(t, key, v)
	}
}

func setBlockField(id jsjson.Str, key string, v any) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		if block, ok := blockOf(blockMap, id); ok {
			block.Set(t, str(key), v)
		}
	}
}

func removeBlockField(id jsjson.Str, key string) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		if block, ok := blockOf(blockMap, id); ok {
			if v, ok := block.Get(str(key)); ok && v != nil {
				block.Delete(t, str(key))
			}
		}
	}
}

// setTunes creates the tunes map when a peer's block has none, as
// getOrCreateTunesMap does.
func setTunes(id jsjson.Str, tunes []tune) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		block, ok := blockOf(blockMap, id)
		if !ok {
			return
		}
		m, ok := mapValue(block, str("tunes")).(*yjs.Map)
		if !ok {
			m = yjs.NewMap()
			block.Set(t, str("tunes"), m)
		}
		for _, tn := range tunes {
			if tn.value == nil {
				m.Delete(t, tn.name)
			} else {
				assignEntry(t, m, tn.name, tn.value, blockFieldDepth+1, true, false)
			}
		}
	}
}

// setParentID deletes the key for the root, as applyPlacement does.
func setParentID(id string, parentID *string) step {
	block := fromUnitKey(id)
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		m, ok := blockOf(blockMap, block)
		if !ok {
			return
		}
		if parentID == nil {
			m.Delete(t, str("parentId"))
		} else {
			m.Set(t, str("parentId"), fromUnitKey(*parentID))
		}
	}
}

func insertRootOrder(at int, id jsjson.Str) step {
	return func(t *yjs.Transaction, _ *yjs.Map, rootOrder *yjs.Array) { rootOrder.Insert(t, at, []any{id}) }
}

func removeRootOrder(at int) step {
	return func(t *yjs.Transaction, _ *yjs.Map, rootOrder *yjs.Array) { rootOrder.Delete(t, at, 1) }
}

// linkChild reads the index at apply time: an earlier step in the same
// transaction may have changed the array.
func linkChild(parentID, childID string, afterID *string) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		contentIDs := contentIDsOf(blockMap, parentID)
		if contentIDs == nil {
			panic(fmt.Sprintf("collab: block \"%s\" has no children list to place \"%s\" in.", fromUnitKey(parentID), fromUnitKey(childID)))
		}
		at := 0
		if afterID != nil {
			at = indexOfID(contentIDs, *afterID) + 1
		}
		contentIDs.Insert(t, at, []any{fromUnitKey(childID)})
	}
}

func unlinkChild(parentID, childID string) step {
	return func(t *yjs.Transaction, blockMap *yjs.Map, _ *yjs.Array) {
		contentIDs := contentIDsOf(blockMap, parentID)
		if contentIDs == nil {
			return
		}
		if at := indexOfID(contentIDs, childID); at >= 0 {
			contentIDs.Delete(t, at, 1)
		}
	}
}

func contentIDsOf(blockMap *yjs.Map, id string) *yjs.Array {
	block, ok := blockOf(blockMap, fromUnitKey(id))
	if !ok {
		return nil
	}
	contentIDs, _ := mapValue(block, str("contentIds")).(*yjs.Array)
	return contentIDs
}

func indexOfID(contentIDs *yjs.Array, id string) int {
	for i, entry := range contentIDs.Values() {
		if s, ok := entry.(jsjson.Str); ok && unitKey(s) == id {
			return i
		}
	}
	return -1
}
