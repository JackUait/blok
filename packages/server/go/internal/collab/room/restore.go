package room

import (
	"math"
	"sort"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// PlanRestore is CollabRestorePlanner.Plan: /edit ops that make the live
// doc equal the target. Blocks that can stay keep their place; everything
// else is removed and inserted again. Page and values keys are patched with
// plain JSON only.
func PlanRestore(currentBlocks []any, current convert.DocStructure, targetBlocks []any,
	currentMaps, targetMaps []convert.PageMap) []convert.EditOp {
	return PlanRestoreTrashing(currentBlocks, current, targetBlocks, currentMaps, targetMaps, nil)
}

// RestoreTrash is who restores and when, in ms since the epoch. With it, a
// restore trashes a page pointer the target lacks instead of removing it.
type RestoreTrash struct {
	By *string
	At int64
}

// PlanRestoreTrashing is PlanRestore with the C# planner's trash argument.
func PlanRestoreTrashing(currentBlocks []any, current convert.DocStructure, targetBlocks []any,
	currentMaps, targetMaps []convert.PageMap, trash *RestoreTrash) []convert.EditOp {
	if trash != nil {
		targetBlocks = withTrashedPages(currentBlocks, targetBlocks, trash)
	}
	ops := planBlocks(currentBlocks, current, targetBlocks)
	var patches []convert.MapPatch
	for _, name := range convert.PageMaps {
		live := pageMapEntries(currentMaps, name)
		wanted := pageMapEntries(targetMaps, name)
		var removed []string
		for key := range live {
			if _, ok := wanted[key]; !ok {
				removed = append(removed, key)
			}
		}
		sortOrdinal(removed)
		for _, key := range removed {
			patches = append(patches, convert.MapPatch{Map: name, Key: key, Remove: true})
		}
		wantedKeys := make([]string, 0, len(wanted))
		for key := range wanted {
			wantedKeys = append(wantedKeys, key)
		}
		sortOrdinal(wantedKeys)
		for _, key := range wantedKeys {
			value := wanted[key]
			// A shared type or undefined has no copy this server can make.
			if !convert.IsPlainMapValue(value) {
				continue
			}
			if now, ok := live[key]; ok && convert.PlainMapValuesEqual(now, value) {
				continue
			}
			patches = append(patches, convert.MapPatch{Map: name, Key: key, Value: value})
		}
	}
	if len(patches) > 0 {
		ops = append(ops, convert.PatchMaps{Patches: patches})
	}
	return ops
}

func pageMapEntries(maps []convert.PageMap, name string) map[string]any {
	entries := map[string]any{}
	for _, m := range maps {
		if m.Name != name {
			continue
		}
		for _, entry := range m.Entries {
			entries[entry.Key.String()] = entry.Value
		}
	}
	return entries
}

func sortOrdinal(keys []string) {
	sort.Slice(keys, func(i, j int) bool {
		return jsjson.Compare(jsjson.FromString(keys[i]), jsjson.FromString(keys[j])) < 0
	})
}

type exportedBlock struct {
	block    *jsjson.Object
	position int
}

func planBlocks(currentBlocks []any, current convert.DocStructure, targetBlocks []any) []convert.EditOp {
	var target []*jsjson.Object
	for _, item := range NormalizeTarget(targetBlocks) {
		if block, ok := item.(*jsjson.Object); ok {
			target = append(target, block)
		}
	}
	exported := map[string]exportedBlock{}
	for _, item := range currentBlocks {
		block, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		if id := stringOf(block, "id"); id != nil {
			if _, dup := exported[unitKey(*id)]; !dup {
				exported[unitKey(*id)] = exportedBlock{block, len(exported)}
			}
		}
	}
	hasTargetChildren := map[string]bool{}
	for _, block := range target {
		if parent := parentOf(block); parent != nil {
			hasTargetChildren[unitKey(*parent)] = true
		}
	}
	shapes := map[string]convert.KeyShape{}
	for _, shape := range current.Keys {
		shapes[unitKey(shape.ID)] = shape
	}
	kept := keptInPlace(target, exported, current, shapes, hasTargetChildren)
	var ops []convert.EditOp
	removed := removals(currentBlocks, current, shapes, kept, &ops)
	for id := range removed {
		delete(kept, id)
	}
	for _, block := range target {
		id := *stringOf(block, "id")
		if !kept[unitKey(id)] {
			continue
		}
		targetData, _ := block.Get(jsjson.FromString("data"))
		liveData, _ := exported[unitKey(id)].block.Get(jsjson.FromString("data"))
		if !sameData(targetData, liveData) {
			data := targetData
			if _, isObject := data.(*jsjson.Object); !isObject {
				data = &jsjson.Object{}
			}
			ops = append(ops, convert.Update{ID: id.String(), Data: toNode(data)})
		}
	}
	// Pre-order, so a parent is in place before its first child.
	lastChild := map[string]string{}
	for _, block := range target {
		id := *stringOf(block, "id")
		parent := parentOf(block)
		key := parentKey(parent)
		var after *string
		if previous, ok := lastChild[key]; ok {
			after = &previous
		}
		lastChild[key] = id.String()
		if kept[unitKey(id)] {
			continue
		}
		var parentID *string
		if parent != nil {
			p := parent.String()
			parentID = &p
		}
		ops = append(ops, convert.Insert{ID: id.String(), Block: toNode(insertedBlock(block)), After: after, Parent: parentID})
	}
	return ops
}

type siblingSlot struct {
	parent string
	index  int
}

// withTrashedPages is the target plus every live page pointer it lacks, with
// trashed set, so the sub-page is not cut off. A pointer keeps its place
// among its live siblings; one whose parent the target lacks goes to the end
// of the root. A pointer already trashed keeps its stamps.
func withTrashedPages(currentBlocks, targetBlocks []any, trash *RestoreTrash) []any {
	targetIDs := map[string]bool{}
	for _, item := range targetBlocks {
		if block, ok := item.(*jsjson.Object); ok {
			if id := stringOf(block, "id"); id != nil {
				targetIDs[unitKey(*id)] = true
			}
		}
	}
	var live []*jsjson.Object
	slots := map[string]siblingSlot{}
	counts := map[string]int{}
	for _, item := range currentBlocks {
		block, ok := item.(*jsjson.Object)
		if !ok || stringOf(block, "id") == nil {
			continue
		}
		live = append(live, block)
		parent := parentKey(parentOf(block))
		key := unitKey(*stringOf(block, "id"))
		if _, seen := slots[key]; !seen {
			slots[key] = siblingSlot{parent, counts[parent]}
		}
		counts[parent]++
	}
	result := make([]any, len(targetBlocks))
	for i, item := range targetBlocks {
		result[i] = deepClone(item)
	}
	for _, block := range live {
		id := *stringOf(block, "id")
		if kind := typeOf(block); kind == nil || kind.String() != "page" || targetIDs[unitKey(id)] {
			continue
		}
		targetIDs[unitKey(id)] = true
		former := parentOf(block)
		slot := slots[unitKey(id)]
		liveData, _ := block.Get(jsjson.FromString("data"))
		data, isObject := deepClone(liveData).(*jsjson.Object)
		if !isObject {
			data = &jsjson.Object{}
		}
		if existing, _ := data.Get(jsjson.FromString("trashed")); !isTrashed(existing) {
			stamp := &jsjson.Object{}
			stamp.Set(jsjson.FromString("at"), float64(trash.At))
			if trash.By != nil {
				stamp.Set(jsjson.FromString("by"), jsjson.FromString(*trash.By))
			} else {
				stamp.Set(jsjson.FromString("by"), nil)
			}
			if former != nil {
				stamp.Set(jsjson.FromString("formerParentId"), *former)
			} else {
				stamp.Set(jsjson.FromString("formerParentId"), nil)
			}
			stamp.Set(jsjson.FromString("formerIndex"), float64(slot.index))
			data.Set(jsjson.FromString("trashed"), stamp)
		}
		trashed := &jsjson.Object{}
		for _, member := range block.Members() {
			switch member.Key.String() {
			case "parent", "content", "data":
				continue
			}
			trashed.Set(member.Key, deepClone(member.Value))
		}
		trashed.Set(jsjson.FromString("data"), data)
		if former == nil || targetIDs[unitKey(*former)] {
			if former != nil {
				trashed.Set(jsjson.FromString("parent"), *former)
			}
			at := slotAmongSiblings(result, parentKey(former), slots, slot.index)
			result = append(result[:at], append([]any{trashed}, result[at:]...)...)
		} else {
			result = append(result, trashed)
		}
	}
	return result
}

// isTrashed is the page tool's readTrashed check, so a value it would drop
// is stamped afresh here.
func isTrashed(value any) bool {
	trashed, ok := value.(*jsjson.Object)
	if !ok {
		return false
	}
	at, isNumber := memberOf(trashed, "at")
	if n, ok := at.(float64); !isNumber || !ok || math.IsInf(n, 0) || math.IsNaN(n) {
		return false
	}
	for _, key := range []string{"by", "formerParentId"} {
		id, present := memberOf(trashed, key)
		if _, isString := id.(jsjson.Str); !present || (id != nil && !isString) {
			return false
		}
	}
	index, _ := memberOf(trashed, "formerIndex")
	position, ok := index.(float64)
	return ok && position >= 0 && math.Floor(position) == position
}

// slotAmongSiblings is where in the target list a block goes so that, among
// the target's children of parent, it follows every one that sat before it live.
func slotAmongSiblings(target []any, parent string, slots map[string]siblingSlot, index int) int {
	first, afterLast := -1, -1
	for position, item := range target {
		block, ok := item.(*jsjson.Object)
		if !ok || parentKey(parentOf(block)) != parent {
			continue
		}
		if first < 0 {
			first = position
		}
		if id := stringOf(block, "id"); id != nil {
			if live, ok := slots[unitKey(*id)]; ok && live.parent == parent && live.index < index {
				afterLast = position + 1
			}
		}
	}
	if afterLast >= 0 {
		return afterLast
	}
	if first >= 0 {
		return first
	}
	return len(target)
}

// NormalizeTarget is the target as a restore reproduces it: a parent naming
// no target block becomes root, blocks come in pre-order, content is rebuilt
// from the parent links, and empty tunes are dropped.
func NormalizeTarget(targetBlocks []any) []any {
	var blocks []*jsjson.Object
	ids := map[string]bool{}
	byID := map[string]*jsjson.Object{}
	for _, item := range targetBlocks {
		block, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		id := stringOf(block, "id")
		if id == nil || ids[unitKey(*id)] {
			continue
		}
		ids[unitKey(*id)] = true
		byID[unitKey(*id)] = block
		blocks = append(blocks, block)
	}
	parents := map[string]*jsjson.Str{}
	for _, block := range blocks {
		id := *stringOf(block, "id")
		var parent *jsjson.Str
		if named := parentOf(block); named != nil && jsjson.Compare(*named, id) != 0 && ids[unitKey(*named)] {
			parent = named
		}
		parents[unitKey(id)] = parent
	}
	children := map[string][]jsjson.Str{}
	for _, block := range blocks {
		id := *stringOf(block, "id")
		key := parentKey(parents[unitKey(id)])
		children[key] = append(children[key], id)
	}
	var ordered []jsjson.Str
	seen := map[string]bool{}
	starts := append([]jsjson.Str(nil), children[parentKey(nil)]...)
	for _, block := range blocks {
		starts = append(starts, *stringOf(block, "id"))
	}
	// A block still unreached sits on a parent cycle and is made a root.
	for _, start := range starts {
		if seen[unitKey(start)] {
			continue
		}
		parents[unitKey(start)] = nil
		pending := []jsjson.Str{start}
		for len(pending) > 0 {
			id := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[unitKey(id)] {
				continue
			}
			seen[unitKey(id)] = true
			ordered = append(ordered, id)
			below := children[parentKey(&id)]
			for index := len(below) - 1; index >= 0; index-- {
				pending = append(pending, below[index])
			}
		}
	}
	normalized := make([]any, 0, len(ordered))
	for _, id := range ordered {
		source := byID[unitKey(id)]
		block := &jsjson.Object{}
		for _, member := range source.Members() {
			name := member.Key.String()
			if name == "parent" || name == "content" {
				continue
			}
			if tunes, isObject := member.Value.(*jsjson.Object); name == "tunes" && isObject && tunes.Len() == 0 {
				continue
			}
			block.Set(member.Key, deepClone(member.Value))
		}
		if parent := parents[unitKey(id)]; parent != nil {
			block.Set(jsjson.FromString("parent"), *parent)
		}
		// A cycle member made root is still in its old parent's list.
		var content []any
		for _, child := range children[parentKey(&id)] {
			if parent := parents[unitKey(child)]; parent != nil && jsjson.Compare(*parent, id) == 0 {
				content = append(content, child)
			}
		}
		if len(content) > 0 {
			block.Set(jsjson.FromString("content"), content)
		}
		normalized = append(normalized, block)
	}
	return normalized
}

// keptInPlace: per target parent, the anchorable live blocks under the same
// parent with the same type and tunes, cut to the longest run whose live
// positions increase.
func keptInPlace(target []*jsjson.Object, exported map[string]exportedBlock, current convert.DocStructure,
	shapes map[string]convert.KeyShape, hasTargetChildren map[string]bool) map[string]bool {
	rootOrder := map[string]bool{}
	for _, id := range current.RootOrder {
		rootOrder[unitKey(id)] = true
	}
	var parents []string
	groups := map[string][]string{}
	for _, block := range target {
		id := *stringOf(block, "id")
		key := unitKey(id)
		live, ok := exported[key]
		shape, known := shapes[key]
		if !ok || !known || !shape.IsBlock || !current.Reached(id) {
			continue
		}
		parent := parentOf(live.block)
		if !sameStr(parent, parentOf(block)) ||
			!sameStr(shape.StoredParent, parent) ||
			!listsIt(parent, id, shapes, rootOrder) ||
			!sameStr(typeOf(live.block), typeOf(block)) ||
			!sameData(tunesOf(live.block), tunesOf(block)) ||
			(hasTargetChildren[key] && shape.Listed == nil) {
			continue
		}
		group := parentKey(parent)
		if _, ok := groups[group]; !ok {
			parents = append(parents, group)
		}
		groups[group] = append(groups[group], key)
	}
	kept := map[string]bool{}
	for _, group := range parents {
		members := groups[group]
		positions := make([]int, len(members))
		for i, key := range members {
			positions[i] = exported[key].position
		}
		for _, index := range convert.LongestKeptOrder(positions) {
			kept[members[index]] = true
		}
	}
	return kept
}

func listsIt(parent *jsjson.Str, id jsjson.Str, shapes map[string]convert.KeyShape, rootOrder map[string]bool) bool {
	if parent == nil {
		return rootOrder[unitKey(id)]
	}
	shape, ok := shapes[unitKey(*parent)]
	if !ok || shape.Listed == nil {
		return false
	}
	for _, child := range shape.Listed {
		if jsjson.Compare(child, id) == 0 {
			return true
		}
	}
	return false
}

// removals: every key that does not stay is removed, never twice; a remove
// takes everything below it by stored parentId.
func removals(currentBlocks []any, current convert.DocStructure, shapes map[string]convert.KeyShape,
	kept map[string]bool, ops *[]convert.EditOp) map[string]bool {
	below := map[string][]jsjson.Str{}
	for _, shape := range current.Keys {
		if shape.StoredParent != nil {
			key := unitKey(*shape.StoredParent)
			below[key] = append(below[key], shape.ID)
		}
	}
	// Export order first, so a parent's remove usually covers its children.
	var marked []jsjson.Str
	for _, item := range currentBlocks {
		if block, ok := item.(*jsjson.Object); ok {
			if id := stringOf(block, "id"); id != nil {
				if _, known := shapes[unitKey(*id)]; known {
					marked = append(marked, *id)
				}
			}
		}
	}
	sortedKeys := make([]jsjson.Str, 0, len(current.Keys))
	for _, shape := range current.Keys {
		sortedKeys = append(sortedKeys, shape.ID)
	}
	sort.Slice(sortedKeys, func(i, j int) bool { return jsjson.Compare(sortedKeys[i], sortedKeys[j]) < 0 })
	marked = append(marked, sortedKeys...)

	removed := map[string]bool{}
	distinct := map[string]bool{}
	for _, id := range marked {
		key := unitKey(id)
		if kept[key] || distinct[key] {
			continue
		}
		distinct[key] = true
		if removed[key] {
			continue
		}
		removed[key] = true
		*ops = append(*ops, convert.Remove{ID: id.String()})
		pending := []string{key}
		for len(pending) > 0 {
			next := pending[0]
			pending = pending[1:]
			for _, child := range below[next] {
				if childKey := unitKey(child); !removed[childKey] {
					removed[childKey] = true
					pending = append(pending, childKey)
				}
			}
		}
	}
	return removed
}

var insertedKeys = []string{"type", "data", "tunes", "lastEditedAt", "lastEditedBy", "lastEditedWith", "createdAt", "createdBy", "createdWith"}

// insertedBlock never carries parent or content: the op owns the position.
func insertedBlock(block *jsjson.Object) *jsjson.Object {
	inserted := &jsjson.Object{}
	for _, key := range insertedKeys {
		if value, ok := block.Get(jsjson.FromString(key)); ok {
			inserted.Set(jsjson.FromString(key), deepClone(value))
		}
	}
	return inserted
}

func deepClone(value any) any {
	switch v := value.(type) {
	case *jsjson.Object:
		clone := &jsjson.Object{}
		for _, member := range v.Members() {
			clone.Set(member.Key, deepClone(member.Value))
		}
		return clone
	case []any:
		clone := make([]any, len(v))
		for i, item := range v {
			clone[i] = deepClone(item)
		}
		return clone
	}
	return value
}

// toNode turns an exported JS value into the node an edit op carries.
// Numbers are written as .NET writes a double, which reads back the same.
func toNode(value any) *jsjson.Node {
	switch v := value.(type) {
	case nil:
		return jsjson.NewNull()
	case bool:
		return jsjson.NewBool(v)
	case float64:
		return jsjson.NewNumber(dotnet.FormatDouble(v))
	case int64:
		return jsjson.NewNumber(strconv.FormatInt(v, 10))
	case jsjson.Str:
		return jsjson.NewString(v)
	case *jsjson.Object:
		members := make([]jsjson.NodeMember, 0, v.Len())
		for _, member := range v.Members() {
			members = append(members, jsjson.NewMember(member.Key.String(), toNode(member.Value)))
		}
		return jsjson.NewObject(members...)
	case []any:
		items := make([]*jsjson.Node, len(v))
		for i, item := range v {
			items[i] = toNode(item)
		}
		return jsjson.NewArray(items...)
	}
	return jsjson.NewNull()
}
