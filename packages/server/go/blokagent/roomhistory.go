package blokagent

import (
	"bytes"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// The undo steps of agents in live rooms, as C# RoomAgentHistory. A room
// call carries no session, so the steps belong to one actor acting for one
// person in one room, in this process's memory, and go after roomIdleLimit
// without a call. Each step keeps how its blocks and page keys looked before
// and after it, so undo writes back only those, and only while nobody else
// changed them.

// roomIdleLimit is RoomAgentHistory.IdleLimit. The step caps are the
// session's (maxSteps, maxChars).
const roomIdleLimit = time.Hour

// roomStep is one batch. other is a page action, which wrote another
// document. Steps are kept and compared by pointer: replayed checks the top
// step is the very one a call planned against.
type roomStep struct {
	other bool
	// lineage is the journal lineage the step was written in; nil in a
	// room without a journal. Set before the step is added, never after.
	lineage    *string
	ids        map[string]bool
	pageKeys   map[string]bool
	before     *jsjson.Object
	after      *jsjson.Object
	pageBefore map[string]any
	pageAfter  map[string]any
	chars      int
}

// measure sets chars to Before.ToJsonString().Length +
// After.ToJsonString().Length: the .NET form is ASCII, so its bytes are its
// UTF-16 units. Run it whenever before or after changes.
func (s *roomStep) measure() error {
	before, err := serialized(s.before)
	if err != nil {
		return err
	}
	after, err := serialized(s.after)
	if err != nil {
		return err
	}
	s.chars = len(before) + len(after)
	return nil
}

type roomSteps struct {
	done, undone []*roomStep
	lastUsed     time.Time
}

// roomKey: onBehalfOf is part of it, so one agent id acting for two people
// keeps two histories.
type roomKey struct {
	docID, actorID string
	onBehalfOf     string
	hasOnBehalfOf  bool
}

func keyOf(docID string, actor Actor) roomKey {
	key := roomKey{docID: docID, actorID: actor.ID}
	if actor.OnBehalfOf != nil {
		key.onBehalfOf, key.hasOnBehalfOf = *actor.OnBehalfOf, true
	}
	return key
}

type roomHistory struct {
	now   func() time.Time
	mu    sync.Mutex
	rooms map[roomKey]*roomSteps
	// added runs inside add with the step, for tests.
	added func(*roomStep)
}

func newRoomHistory(now func() time.Time) *roomHistory {
	return &roomHistory{now: now, rooms: map[roomKey]*roomSteps{}}
}

// top is the step an undo (or redo) would replay now; nil when there is none.
func (h *roomHistory) top(docID string, actor Actor, undo bool) *roomStep {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.prune()
	steps := h.rooms[keyOf(docID, actor)]
	if steps == nil {
		return nil
	}
	steps.lastUsed = h.now()
	from := steps.undone
	if undo {
		from = steps.done
	}
	if len(from) == 0 {
		return nil
	}
	return from[len(from)-1]
}

// replayed moves a replayed step to the other side with what the room now
// holds. False, and nothing changes, when the steps were forgotten or the
// step is no longer on top. It does not prune.
func (h *roomHistory) replayed(docID string, actor Actor, step *roomStep, undo bool, actual *jsjson.Object) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	steps := h.rooms[keyOf(docID, actor)]
	if steps == nil {
		return false, nil
	}
	from, to := &steps.undone, &steps.done
	if undo {
		from, to = &steps.done, &steps.undone
	}
	if len(*from) == 0 || (*from)[len(*from)-1] != step {
		return false, nil
	}
	if undo {
		step.before = actual
	} else {
		step.after = actual
	}
	if err := step.measure(); err != nil {
		return false, err
	}
	*from = (*from)[:len(*from)-1]
	*to = append(*to, step)
	return true, nil
}

// forget drops every actor's steps in the room. It does not prune.
func (h *roomHistory) forget(docID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for key := range h.rooms {
		if key.docID == docID {
			delete(h.rooms, key)
		}
	}
}

// add is a new batch: it drops the redo side and the oldest done steps past
// the caps. Only done steps are trimmed, so after a page action (which
// keeps the redo side) the step just added can be the one dropped.
func (h *roomHistory) add(docID string, actor Actor, step *roomStep) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.added != nil {
		h.added(step)
	}
	h.prune()
	key := keyOf(docID, actor)
	steps := h.rooms[key]
	if steps == nil {
		steps = &roomSteps{}
		h.rooms[key] = steps
	}
	steps.lastUsed = h.now()
	steps.done = append(steps.done, step)
	// A page action leaves the redo side, as the stored session's marks do.
	if !step.other {
		steps.undone = nil
	}
	for len(steps.done) > 0 && (len(steps.done)+len(steps.undone) > maxSteps ||
		(len(steps.done) > 1 && sumChars(steps.done)+sumChars(steps.undone) > maxChars)) {
		steps.done = steps.done[1:]
	}
}

func sumChars(steps []*roomStep) int {
	total := 0
	for _, step := range steps {
		total += step.chars
	}
	return total
}

func (h *roomHistory) prune() {
	now := h.now()
	for key, steps := range h.rooms {
		if now.Sub(steps.lastUsed) > roomIdleLimit {
			delete(h.rooms, key)
		}
	}
}

// pageMaps is CollabPageMaps: map name → key → raw value, keys in map order.
type pageMaps []convert.PageMap

func (m pageMaps) entries(name string) []yjs.MapEntry {
	for _, page := range m {
		if page.Name == name {
			return page.Entries
		}
	}
	return nil
}

func (m pageMaps) value(name, key string) (any, bool) {
	for _, entry := range m.entries(name) {
		if entry.Key.String() == key {
			return entry.Value, true
		}
	}
	return nil, false
}

// between is a step from what the batch changed between two exports.
func between(before *jsjson.Object, beforeMaps pageMaps, after *jsjson.Object, afterMaps pageMaps) (*roomStep, error) {
	was, err := shapes(before)
	if err != nil {
		return nil, err
	}
	now, err := shapes(after)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for id, shape := range was {
		if other, ok := now[id]; !ok || other != shape {
			ids[id] = true
		}
	}
	for id := range now {
		if _, ok := was[id]; !ok {
			ids[id] = true
		}
	}
	keys := map[string]bool{}
	for _, name := range convert.PageMaps {
		seen := map[string]bool{}
		for _, list := range [][]yjs.MapEntry{beforeMaps.entries(name), afterMaps.entries(name)} {
			for _, entry := range list {
				key := entry.Key.String()
				if seen[key] {
					continue
				}
				seen[key] = true
				left, err := fingerprint(beforeMaps, name, key)
				if err != nil {
					return nil, err
				}
				right, err := fingerprint(afterMaps, name, key)
				if err != nil {
					return nil, err
				}
				if left != right {
					keys[name+"/"+key] = true
				}
			}
		}
	}
	beforeProjection, err := project(before, beforeMaps, ids, keys)
	if err != nil {
		return nil, err
	}
	afterProjection, err := project(after, afterMaps, ids, keys)
	if err != nil {
		return nil, err
	}
	step := &roomStep{
		ids:        ids,
		pageKeys:   keys,
		before:     beforeProjection,
		after:      afterProjection,
		pageBefore: pageValues(beforeMaps, keys),
		pageAfter:  pageValues(afterMaps, keys),
	}
	return step, step.measure()
}

// project is the step's blocks (whole, with their slot) and page keys as an
// export has them. order lists the present blocks in document order, so a
// restore puts each one back after a sibling already in place.
func project(export *jsjson.Object, maps pageMaps, ids, keys map[string]bool) (*jsjson.Object, error) {
	exported := exportBlocks(export)
	slots, err := slotsOf(exported)
	if err != nil {
		return nil, err
	}
	var order []any
	for _, block := range exported {
		if id, ok := idOfBlock(block); ok && ids[id] {
			order = append(order, jsjson.FromString(id))
		}
	}
	blocks := &jsjson.Object{}
	for _, id := range sortedKeys(ids) {
		var found *jsjson.Object
		for _, block := range exported {
			if other, ok := idOfBlock(block); ok && other == id {
				found = block
				break
			}
		}
		if found == nil {
			blocks.Set(jsjson.FromString(id), nil)
			continue
		}
		entry := &jsjson.Object{}
		entry.Set(jsjson.FromString("block"), unstamped(found))
		var slot any
		if previous := slots[id]; previous != nil {
			slot = jsjson.FromString(*previous)
		}
		entry.Set(jsjson.FromString("after"), slot)
		blocks.Set(jsjson.FromString(id), entry)
	}
	page := &jsjson.Object{}
	for _, entry := range sortedKeys(keys) {
		name, key := splitPageKey(entry)
		print, err := fingerprint(maps, name, key)
		if err != nil {
			return nil, err
		}
		page.Set(jsjson.FromString(entry), jsjson.FromString(print))
	}
	// Kept beside the projection, not in it: a replay restamps, and the
	// next check must still match.
	stamps := &jsjson.Object{}
	for _, block := range exported {
		id, ok := idOfBlock(block)
		if !ok || !ids[id] {
			continue
		}
		at, ok := block.Get(jsjson.FromString("lastEditedAt"))
		if !ok || at == nil {
			continue
		}
		stamp := &jsjson.Object{}
		stamp.Set(jsjson.FromString("at"), deepCopy(at))
		by, _ := block.Get(jsjson.FromString("lastEditedBy"))
		stamp.Set(jsjson.FromString("by"), deepCopy(by))
		with, _ := block.Get(jsjson.FromString("lastEditedWith"))
		stamp.Set(jsjson.FromString("with"), deepCopy(with))
		stamps.Set(jsjson.FromString(id), stamp)
	}
	projection := &jsjson.Object{}
	projection.Set(jsjson.FromString("blocks"), blocks)
	projection.Set(jsjson.FromString("order"), orEmpty(order))
	projection.Set(jsjson.FromString("page"), page)
	projection.Set(jsjson.FromString("stamps"), stamps)
	return projection, nil
}

func orEmpty(items []any) []any {
	if items == nil {
		return []any{}
	}
	return items
}

// same reports whether two projections hold the same blocks, slots and
// page keys, compared as written JSON; edit stamps do not count.
func same(left, right *jsjson.Object) (bool, error) {
	for _, key := range []string{"blocks", "order", "page"} {
		a, _ := left.Get(jsjson.FromString(key))
		b, _ := right.Get(jsjson.FromString(key))
		x, err := serialized(a)
		if err != nil {
			return false, err
		}
		y, err := serialized(b)
		if err != nil {
			return false, err
		}
		if !bytes.Equal(x, y) {
			return false, nil
		}
	}
	return true, nil
}

// netString is C#'s `?.GetValue<string>()`: nil for a missing or null
// node, an error for any other kind.
func netString(value any, present bool) (*string, error) {
	if !present || value == nil {
		return nil, nil
	}
	if s, ok := value.(jsjson.Str); ok {
		text := s.String()
		return &text, nil
	}
	return nil, &InvalidOperationError{Message: fmt.Sprintf("The node must be of type 'JsonValue' holding a String, not %T.", value)}
}

// netIndex is C#'s `node?[key]` on the JS value model: the indexer throws
// on a node that is not an object.
func netIndex(node any, key string) (any, bool, error) {
	switch node := node.(type) {
	case nil:
		return nil, false, nil
	case *jsjson.Object:
		value, ok := node.Get(jsjson.FromString(key))
		return value, ok, nil
	}
	return nil, false, &InvalidOperationError{Message: "The node must be of type 'JsonObject'."}
}

func locked(entry any) (bool, error) {
	block, _, err := netIndex(entry, "block")
	if err != nil {
		return false, err
	}
	object, ok := block.(*jsjson.Object)
	if !ok {
		return false, nil
	}
	kindValue, present := object.Get(jsjson.FromString("type"))
	kind, err := netString(kindValue, present)
	if err != nil || kind == nil || *kind != "database" {
		return false, err
	}
	data, _, err := netIndex(object, "data")
	if err != nil {
		return false, err
	}
	schemaValue, _, err := netIndex(data, "schema")
	if err != nil {
		return false, err
	}
	schema, ok := schemaValue.([]any)
	if !ok {
		return false, nil
	}
	for _, property := range schema {
		kindValue, present, err := netIndex(property, "type")
		if err != nil {
			return false, err
		}
		kind, err := netString(kindValue, present)
		if err != nil {
			return false, err
		}
		if kind == nil || *kind != "title" {
			continue
		}
		flag, present, err := netIndex(property, "databaseLocked")
		if err != nil {
			return false, err
		}
		if !present || flag == nil {
			continue
		}
		value, ok := flag.(bool)
		if !ok {
			return false, &InvalidOperationError{Message: "The node must be of type 'JsonValue' holding a Boolean."}
		}
		if value {
			return true, nil
		}
	}
	return false, nil
}

// unlocks is a database the replay would unlock: locked in now, still there
// and unlocked in wanted. Mirrors unlockedBetween in
// src/shared/agent/approval.ts.
func unlocks(now, wanted *jsjson.Object) (string, bool, error) {
	currentValue, _ := now.Get(jsjson.FromString("blocks"))
	targetValue, _ := wanted.Get(jsjson.FromString("blocks"))
	current, ok := currentValue.(*jsjson.Object)
	target, ok2 := targetValue.(*jsjson.Object)
	if !ok || !ok2 {
		return "", false, nil
	}
	for _, m := range current.Members() {
		isLocked, err := locked(m.Value)
		if err != nil {
			return "", false, err
		}
		if !isLocked {
			continue
		}
		there, _ := target.Get(m.Key)
		block, _, err := netIndex(there, "block")
		if err != nil {
			return "", false, err
		}
		if _, ok := block.(*jsjson.Object); !ok {
			continue
		}
		stillLocked, err := locked(there)
		if err != nil {
			return "", false, err
		}
		if !stillLocked {
			return m.Key.String(), true, nil
		}
	}
	return "", false, nil
}

func tryText(value any) (string, bool) {
	s, ok := value.(jsjson.Str)
	return s.String(), ok
}

func shareOf(view *jsjson.Object) (string, error) {
	var form *jsjson.Object
	formIsNullOrObject := true
	values := make([]any, 0, 6)
	if view != nil {
		if value, ok := view.Get(jsjson.FromString("form")); ok && value != nil {
			form, formIsNullOrObject = value.(*jsjson.Object)
		}
	}
	values = append(values, formIsNullOrObject)
	for _, key := range []string{"closed", "public", "anonymous", "submissionAccess"} {
		var value any
		if form != nil {
			value, _ = form.Get(jsjson.FromString(key))
		}
		values = append(values, deepCopy(value))
	}
	var sync any
	if view != nil {
		sync, _ = view.Get(jsjson.FromString("calendarSync"))
	}
	values = append(values, deepCopy(sync))
	out, err := serialized(values)
	return string(out), err
}

func views(entry any) ([]*jsjson.Object, error) {
	block, _, err := netIndex(entry, "block")
	if err != nil {
		return nil, err
	}
	object, ok := block.(*jsjson.Object)
	if !ok {
		return nil, nil
	}
	kind, _ := object.Get(jsjson.FromString("type"))
	if name, ok := tryText(kind); !ok || name != "database" {
		return nil, nil
	}
	data, _, err := netIndex(object, "data")
	if err != nil {
		return nil, err
	}
	listValue, _, err := netIndex(data, "views")
	if err != nil {
		return nil, err
	}
	list, ok := listValue.([]any)
	if !ok {
		return nil, nil
	}
	var out []*jsjson.Object
	for _, item := range list {
		if view, ok := item.(*jsjson.Object); ok {
			out = append(out, view)
		}
	}
	return out, nil
}

// shares is a database view whose sharing the replay would change: who can
// fill out its form, anonymous answers, access to submissions or calendar
// sync. Raw values are compared, so a value Blok cannot read still counts,
// and a view with no id counts against the defaults. Mirrors sharedBetween
// in src/shared/agent/approval.ts, failing closed where that refuses an
// unreadable value.
func shares(now, wanted *jsjson.Object) (blockID, viewID string, found bool, err error) {
	currentValue, _ := now.Get(jsjson.FromString("blocks"))
	targetValue, _ := wanted.Get(jsjson.FromString("blocks"))
	current, ok := currentValue.(*jsjson.Object)
	target, ok2 := targetValue.(*jsjson.Object)
	if !ok || !ok2 {
		return "", "", false, nil
	}
	for _, m := range target.Members() {
		before := map[string]*jsjson.Object{}
		there, _ := current.Get(m.Key)
		known, err := views(there)
		if err != nil {
			return "", "", false, err
		}
		for _, view := range known {
			value, _ := view.Get(jsjson.FromString("id"))
			if id, ok := tryText(value); ok {
				if _, taken := before[id]; !taken {
					before[id] = view
				}
			}
		}
		wantedViews, err := views(m.Value)
		if err != nil {
			return "", "", false, err
		}
		for _, view := range wantedViews {
			value, _ := view.Get(jsjson.FromString("id"))
			id, _ := tryText(value)
			var other *jsjson.Object
			if id != "" {
				other = before[id]
			}
			wantedShare, err := shareOf(view)
			if err != nil {
				return "", "", false, err
			}
			otherShare, err := shareOf(other)
			if err != nil {
				return "", "", false, err
			}
			if wantedShare != otherShare {
				return m.Key.String(), id, true, nil
			}
		}
	}
	return "", "", false, nil
}

// restoreTarget is the room as it would be with the step's blocks and page
// keys as wanted has them.
func restoreTarget(export *jsjson.Object, maps pageMaps, step *roomStep, wanted *jsjson.Object, page map[string]any) ([]any, pageMaps, error) {
	var target []*jsjson.Object
	for _, block := range exportBlocks(export) {
		if id, ok := idOfBlock(block); ok && step.ids[id] {
			continue
		}
		target = append(target, deepCopy(block).(*jsjson.Object))
	}
	entriesValue, _ := wanted.Get(jsjson.FromString("blocks"))
	entries, _ := entriesValue.(*jsjson.Object)
	orderValue, _ := wanted.Get(jsjson.FromString("order"))
	order, _ := orderValue.([]any)
	for _, item := range order {
		id, err := netString(item, true)
		if err != nil {
			return nil, nil, err
		}
		if id == nil || entries == nil {
			continue
		}
		entryValue, _ := entries.Get(jsjson.FromString(*id))
		entry, ok := entryValue.(*jsjson.Object)
		if !ok {
			continue
		}
		blockValue, _ := entry.Get(jsjson.FromString("block"))
		block, ok := deepCopy(blockValue).(*jsjson.Object)
		if !ok {
			continue
		}
		parentValue, present := block.Get(jsjson.FromString("parent"))
		parent, err := netString(parentValue, present)
		if err != nil {
			return nil, nil, err
		}
		afterValue, present := entry.Get(jsjson.FromString("after"))
		after, err := netString(afterValue, present)
		if err != nil {
			return nil, nil, err
		}
		at := -1
		if after != nil {
			at = indexOf(target, func(other *jsjson.Object) bool {
				id, ok := idOfBlock(other)
				return ok && id == *after
			})
		}
		if at < 0 {
			var findErr error
			first := indexOf(target, func(other *jsjson.Object) bool {
				value, present := other.Get(jsjson.FromString("parent"))
				otherParent, err := netString(value, present)
				if err != nil {
					findErr = err
					return true
				}
				return equalOptional(otherParent, parent)
			})
			if findErr != nil {
				return nil, nil, findErr
			}
			if first < 0 {
				at = len(target) - 1
			} else {
				at = first - 1
			}
		}
		target = slices.Insert(target, at+1, block)
	}

	restored := make(pageMaps, 0, len(maps))
	for _, m := range maps {
		restored = append(restored, convert.PageMap{Name: m.Name, Entries: slices.Clone(m.Entries)})
	}
	for _, entry := range sortedKeys(step.pageKeys) {
		name, key := splitPageKey(entry)
		at := slices.IndexFunc(restored, func(m convert.PageMap) bool { return m.Name == name })
		if at < 0 {
			restored = append(restored, convert.PageMap{Name: name})
			at = len(restored) - 1
		}
		list := restored[at].Entries
		index := slices.IndexFunc(list, func(e yjs.MapEntry) bool { return e.Key.String() == key })
		if value, ok := page[entry]; ok {
			if index >= 0 {
				list[index].Value = value
			} else {
				list = append(list, yjs.MapEntry{Key: jsjson.FromString(key), Value: value})
			}
		} else if index >= 0 {
			list = slices.Delete(list, index, index+1)
		}
		restored[at].Entries = list
	}
	blocks := make([]any, len(target))
	for i, block := range target {
		blocks[i] = block
	}
	return blocks, restored, nil
}

func equalOptional(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func indexOf(list []*jsjson.Object, match func(*jsjson.Object) bool) int {
	for i, item := range list {
		if match(item) {
			return i
		}
	}
	return -1
}

// stamps is the edit stamps the wanted blocks had, as ops after the
// restore: the planner writes data and structure only.
func stamps(wanted *jsjson.Object) ([]convert.EditOp, error) {
	value, _ := wanted.Get(jsjson.FromString("stamps"))
	list, ok := value.(*jsjson.Object)
	if !ok {
		return nil, nil
	}
	var ops []convert.EditOp
	for _, m := range list.Members() {
		stamp, ok := m.Value.(*jsjson.Object)
		if !ok {
			continue
		}
		atValue, _ := stamp.Get(jsjson.FromString("at"))
		// C# parses the written number text, so an integer export counts.
		var at float64
		switch v := atValue.(type) {
		case float64:
			at = v
		case int64:
			at = float64(v)
		default:
			continue
		}
		byValue, _ := stamp.Get(jsjson.FromString("by"))
		by, ok := byValue.(jsjson.Str)
		if !ok {
			continue
		}
		withValue, present := stamp.Get(jsjson.FromString("with"))
		with, err := netString(withValue, present)
		if err != nil {
			return nil, err
		}
		ops = append(ops, convert.SetMetadata{ID: m.Key.String(), LastEditedAt: at, LastEditedBy: by.String(), LastEditedWith: with})
	}
	return ops, nil
}

// unstamped is the block without its edit stamp: a replay writes the data
// back but stamps the block anew, and the next undo must still find it as
// the step before left it.
func unstamped(block *jsjson.Object) *jsjson.Object {
	copy := &jsjson.Object{}
	for _, m := range block.Members() {
		switch m.Key.String() {
		case "lastEditedAt", "lastEditedBy", "lastEditedWith":
			continue
		}
		copy.Set(m.Key, deepCopy(m.Value))
	}
	return copy
}

func exportBlocks(export *jsjson.Object) []*jsjson.Object {
	if export == nil {
		return nil
	}
	value, _ := export.Get(jsjson.FromString("blocks"))
	list, _ := value.([]any)
	var blocks []*jsjson.Object
	for _, item := range list {
		if block, ok := item.(*jsjson.Object); ok {
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func idOfBlock(block *jsjson.Object) (string, bool) {
	value, _ := block.Get(jsjson.FromString("id"))
	return tryText(value)
}

// slotsOf is each block's previous sibling, by parent link and doc order.
func slotsOf(blocks []*jsjson.Object) (map[string]*string, error) {
	last := map[string]*string{}
	slots := map[string]*string{}
	for _, block := range blocks {
		id, ok := idOfBlock(block)
		if !ok {
			continue
		}
		value, present := block.Get(jsjson.FromString("parent"))
		parent, err := netString(value, present)
		if err != nil {
			return nil, err
		}
		key := ""
		if parent != nil {
			key = *parent
		}
		slots[id] = last[key]
		own := id
		last[key] = &own
	}
	return slots, nil
}

func shapes(export *jsjson.Object) (map[string]string, error) {
	blocks := exportBlocks(export)
	slots, err := slotsOf(blocks)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, block := range blocks {
		id, ok := idOfBlock(block)
		if !ok {
			continue
		}
		if _, seen := out[id]; seen {
			continue
		}
		slot := ""
		if previous := slots[id]; previous != nil {
			slot = *previous
		}
		written, err := serialized(unstamped(block))
		if err != nil {
			return nil, err
		}
		out[id] = slot + "\n" + string(written)
	}
	return out, nil
}

func splitPageKey(entry string) (string, string) {
	name, key, _ := strings.Cut(entry, "/")
	return name, key
}

func pageValues(maps pageMaps, keys map[string]bool) map[string]any {
	values := map[string]any{}
	for entry := range keys {
		name, key := splitPageKey(entry)
		if value, ok := maps.value(name, key); ok {
			values[entry] = value
		}
	}
	return values
}

// fingerprint is a comparable spelling of a page map value; a shared type
// only says it is one.
func fingerprint(maps pageMaps, name, key string) (string, error) {
	value, ok := maps.value(name, key)
	if !ok {
		return "absent", nil
	}
	if !convert.IsPlainMapValue(value) {
		return fmt.Sprintf("shared:%T", value), nil
	}
	plain, err := convert.PlainJSON(value)
	if err != nil {
		return "", err
	}
	written, err := serialized(plain)
	return string(written), err
}

// serialized writes a JS value as System.Text.Json writes the C# node.
func serialized(value any) ([]byte, error) {
	if object, ok := value.(*jsjson.Object); ok && object == nil {
		return []byte("null"), nil
	}
	return docendpoint.Serialize(value)
}

func deepCopy(value any) any {
	switch v := value.(type) {
	case *jsjson.Object:
		clone := &jsjson.Object{}
		for _, m := range v.Members() {
			clone.Set(m.Key, deepCopy(m.Value))
		}
		return clone
	case []any:
		clone := make([]any, len(v))
		for i, item := range v {
			clone[i] = deepCopy(item)
		}
		return clone
	}
	return value
}

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	// Ordinal is UTF-16 order in .NET.
	slices.SortFunc(keys, func(a, b string) int { return jsjson.Compare(jsjson.FromString(a), jsjson.FromString(b)) })
	return keys
}
