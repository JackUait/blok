package room

import "github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"

// GuardOrphanedDatabase is a kept database whose parent the restore removes.
// It is never confirmable: the restore is refused.
const GuardOrphanedDatabase = "orphanedDatabase"

// KeptDatabases is CollabKeptDatabases: the target with every kept block as
// it is now, the kept blocks that exist now (by unitKey), and one guard per
// kept root the restore would orphan.
type KeptDatabases struct {
	Target   []any
	Pinned   map[string]bool
	Orphaned []RestoreGuard
}

// KeepDatabases is CollabRestorePlanner.KeepDatabases: a databases=keep
// restore. Every database on either side stays as it is now, with
// everything below it on either side. One deleted since the point stays
// deleted; one made since stays. Each kept root follows the nearest sibling
// it follows now. A kept root whose parent the restore removes is orphaned.
func KeepDatabases(currentBlocks, targetBlocks []any) KeptDatabases {
	var target []*jsjson.Object
	for _, item := range NormalizeTarget(targetBlocks) {
		if block, ok := item.(*jsjson.Object); ok {
			target = append(target, block)
		}
	}
	live := map[string]*jsjson.Object{}
	var liveOrder []jsjson.Str
	liveChildren := map[string][]jsjson.Str{}
	targetChildren := map[string][]jsjson.Str{}
	// First copy wins, as the planner reads the export.
	for _, item := range currentBlocks {
		block, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		id := stringOf(block, "id")
		if id == nil {
			continue
		}
		if _, dup := live[unitKey(*id)]; dup {
			continue
		}
		live[unitKey(*id)] = block
		liveOrder = append(liveOrder, *id)
		key := parentKey(parentOf(block))
		liveChildren[key] = append(liveChildren[key], *id)
	}
	byID := map[string]*jsjson.Object{}
	for _, block := range target {
		id := *stringOf(block, "id")
		byID[unitKey(id)] = block
		key := parentKey(parentOf(block))
		targetChildren[key] = append(targetChildren[key], id)
	}

	kept := map[string]bool{}
	var pending []jsjson.Str
	for _, id := range liveOrder {
		if isDatabase(live[unitKey(id)]) {
			pending = append(pending, id)
		}
	}
	for _, block := range target {
		if isDatabase(block) {
			pending = append(pending, *stringOf(block, "id"))
		}
	}
	for len(pending) > 0 {
		id := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if kept[unitKey(id)] {
			continue
		}
		kept[unitKey(id)] = true
		pending = append(pending, liveChildren[parentKey(&id)]...)
		pending = append(pending, targetChildren[parentKey(&id)]...)
	}

	placed := map[string][]jsjson.Str{}
	restored := map[string]bool{}
	for _, block := range target {
		id := *stringOf(block, "id")
		if kept[unitKey(id)] {
			continue
		}
		restored[unitKey(id)] = true
		key := parentKey(parentOf(block))
		placed[key] = append(placed[key], id)
	}

	var orphaned []RestoreGuard
	orphans := map[string]bool{}
	// Roots in current order, so a kept root can follow one placed before it.
	for _, id := range liveOrder {
		parent := parentOf(live[unitKey(id)])
		if !kept[unitKey(id)] {
			continue
		}
		if parent != nil && kept[unitKey(*parent)] && live[unitKey(*parent)] != nil {
			continue
		}
		if parent != nil && !restored[unitKey(*parent)] {
			orphaned = append(orphaned, RestoreGuard{Kind: GuardOrphanedDatabase, BlockID: id.String()})
			orphans[unitKey(id)] = true
			placed[parentKey(nil)] = append(placed[parentKey(nil)], id)
			continue
		}
		key := parentKey(parent)
		siblings := placed[key]
		before := liveChildren[key]
		at := 0
		for index := indexOf(before, id) - 1; index >= 0; index-- {
			if found := indexOf(siblings, before[index]); found >= 0 {
				at = found + 1
				break
			}
		}
		placed[key] = append(siblings[:at:at], append([]jsjson.Str{id}, siblings[at:]...)...)
	}

	var blocks []any
	roots := placed[parentKey(nil)]
	walk := make([]jsjson.Str, 0, len(roots))
	for index := len(roots) - 1; index >= 0; index-- {
		walk = append(walk, roots[index])
	}
	for len(walk) > 0 {
		id := walk[len(walk)-1]
		walk = walk[:len(walk)-1]
		var children []jsjson.Str
		if kept[unitKey(id)] {
			clone := deepClone(live[unitKey(id)]).(*jsjson.Object)
			if orphans[unitKey(id)] {
				clone = withoutKey(clone, "parent")
			}
			blocks = append(blocks, clone)
			children = liveChildren[parentKey(&id)]
		} else {
			blocks = append(blocks, deepClone(byID[unitKey(id)]))
			children = placed[parentKey(&id)]
		}
		for index := len(children) - 1; index >= 0; index-- {
			walk = append(walk, children[index])
		}
	}

	pinned := map[string]bool{}
	for key := range kept {
		if live[key] != nil {
			pinned[key] = true
		}
	}
	return KeptDatabases{Target: blocks, Pinned: pinned, Orphaned: orphaned}
}

func isDatabase(block *jsjson.Object) bool {
	kind := typeOf(block)
	return kind != nil && kind.String() == "database"
}

func indexOf(list []jsjson.Str, id jsjson.Str) int {
	for index, item := range list {
		if jsjson.Compare(item, id) == 0 {
			return index
		}
	}
	return -1
}
