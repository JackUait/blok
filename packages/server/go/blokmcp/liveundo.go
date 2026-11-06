package blokmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"

	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// historyStepLimit is AGENT_HISTORY_LIMITS.steps.
const historyStepLimit = 100

// liveStep is one applied batch, as Node's StoreApplier keeps it for
// history.undo and history.redo.
type liveStep struct {
	item       *yjs.StackItem
	ids        map[string]bool
	placedOnly map[string]bool
	parents    map[string]bool // "" is the root
	shape      string
}

type exportedBlock struct {
	ID      string          `json:"id"`
	Parent  *string         `json:"parent"`
	Content []string        `json:"content"`
	Raw     json.RawMessage `json:"-"`
}

// blocksOf reads an exported document's blocks, each with its raw JSON.
func blocksOf(document json.RawMessage) []exportedBlock {
	var doc struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	_ = json.Unmarshal(document, &doc)
	blocks := make([]exportedBlock, 0, len(doc.Blocks))
	for _, raw := range doc.Blocks {
		var block exportedBlock
		_ = json.Unmarshal(raw, &block)
		block.Raw = raw
		blocks = append(blocks, block)
	}
	return blocks
}

func parentKey(parent *string) string {
	if parent == nil {
		return ""
	}
	return "#" + *parent
}

// shape is the step's blocks as the document has them now (a moved one by
// its slot), with each parent's order of them: Node's StoreApplier.shape.
func (step *liveStep) shapeOf(document json.RawMessage) string {
	blocks := blocksOf(document)
	byID := map[string]exportedBlock{}
	var roots []string
	for _, block := range blocks {
		byID[block.ID] = block
		if block.Parent == nil {
			roots = append(roots, block.ID)
		}
	}
	ids := make([]string, 0, len(step.ids))
	for id := range step.ids {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	shape := []any{}
	for _, id := range ids {
		block, ok := byID[id]
		switch {
		case !ok:
			shape = append(shape, "gone")
		case step.placedOnly[id]:
			shape = append(shape, placement(byID, roots, id))
		default:
			shape = append(shape, block.Raw)
		}
	}
	parents := []any{}
	keys := make([]string, 0, len(step.parents))
	for key := range step.parents {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		var order []string
		if key == "" {
			order = roots
		} else if parent, ok := byID[key[1:]]; ok {
			order = parent.Content
		} else {
			parents = append(parents, []any{key, nil})
			continue
		}
		filtered := []string{}
		for _, id := range order {
			if step.ids[id] {
				filtered = append(filtered, id)
			}
		}
		parents = append(parents, []any{key, filtered})
	}
	written, _ := json.Marshal(map[string]any{"blocks": shape, "parents": parents})
	return string(written)
}

// placement is the store's getPlacement: the parent and the sibling before.
func placement(byID map[string]exportedBlock, roots []string, id string) map[string]any {
	block := byID[id]
	order := roots
	if block.Parent != nil {
		order = byID[*block.Parent].Content
	}
	var after any
	if at := slices.Index(order, id); at > 0 {
		after = order[at-1]
	}
	var parent any
	if block.Parent != nil {
		parent = *block.Parent
	}
	return map[string]any{"parentId": parent, "afterId": after}
}

type plannedBlock struct {
	ID       string         `json:"id"`
	Children []plannedBlock `json:"children"`
}

// stepFor reads which blocks a batch's edits added, removed or moved.
func stepFor(edits json.RawMessage, before json.RawMessage) *liveStep {
	step := &liveStep{ids: map[string]bool{}, placedOnly: map[string]bool{}, parents: map[string]bool{}}
	byID := map[string]exportedBlock{}
	for _, block := range blocksOf(before) {
		byID[block.ID] = block
	}
	var list []struct {
		Op           string       `json:"op"`
		ID           string       `json:"id"`
		Block        plannedBlock `json:"block"`
		WithChildren bool         `json:"withChildren"`
	}
	_ = json.Unmarshal(edits, &list)
	var insertTree func(block plannedBlock)
	insertTree = func(block plannedBlock) {
		step.ids[block.ID] = true
		for _, child := range block.Children {
			insertTree(child)
		}
	}
	moved := func(id string) {
		if !step.ids[id] {
			step.ids[id] = true
			step.placedOnly[id] = true
		}
	}
	removed := func(id string) {
		step.ids[id] = true
		delete(step.placedOnly, id)
	}
	for _, edit := range list {
		switch edit.Op {
		case "insert":
			insertTree(edit.Block)
		case "remove":
			if edit.WithChildren {
				var walk func(id string)
				walk = func(id string) {
					for _, child := range byID[id].Content {
						walk(child)
					}
					removed(id)
				}
				walk(edit.ID)
				continue
			}
			for _, child := range byID[edit.ID].Content {
				moved(child)
			}
			removed(edit.ID)
		case "move":
			moved(edit.ID)
		}
	}
	return step
}

// noteParents records the step blocks' parents before and after.
func (step *liveStep) noteParents(documents ...json.RawMessage) {
	for _, document := range documents {
		for _, block := range blocksOf(document) {
			if step.ids[block.ID] {
				step.parents[parentKey(block.Parent)] = true
			}
		}
	}
}

// replay runs history.undo or history.redo on the session's own steps.
// gate is the bundle's answer with no steps; mu is held.
func (l *liveSession) replay(ctx context.Context, name string, gate json.RawMessage) (json.RawMessage, bool, error) {
	undo := name == "history.undo"
	from, to := &l.done, &l.undone
	if !undo {
		from, to = &l.undone, &l.done
	}
	if len(*from) == 0 {
		return gate, false, nil
	}
	step := (*from)[len(*from)-1]
	document, _, err := l.exportLocked(ctx)
	if err != nil {
		return nil, false, err
	}
	top := l.undo.UndoTop()
	if !undo {
		top = l.undo.RedoTop()
	}
	if step.shapeOf(document) != step.shape || (step.item != nil && top != step.item) {
		verb := "undone"
		if !undo {
			verb = "redone"
		}
		result, _ := marshal(map[string]any{
			"ok": false, "revision": fmt.Sprintf("l%d", l.room.count),
			"error":    map[string]any{"code": "CONFLICT", "message": "Someone else changed the blocks this step added, removed or moved, so it can no longer be " + verb + ". Re-read the document before retrying.", "retryable": true},
			"warnings": []any{},
		})
		return result, false, nil
	}
	if step.item != nil {
		var replayed bool
		if undo {
			replayed, err = l.undo.Undo()
		} else {
			replayed, err = l.undo.Redo()
		}
		if err != nil {
			return nil, false, err
		}
		step.item = nil
		if replayed {
			step.item = l.undo.RedoTop()
			if !undo {
				step.item = l.undo.UndoTop()
			}
		}
	}
	after, _, err := l.exportLocked(ctx)
	if err != nil {
		return nil, false, err
	}
	step.shape = step.shapeOf(after)
	*from = (*from)[:len(*from)-1]
	*to = append(*to, step)
	result, _ := marshal(map[string]any{
		"ok": true, "revision": fmt.Sprintf("l%d", l.room.count), "results": []any{map[string]any{}}, "refs": map[string]any{},
		"changed": map[string]any{"created": []any{}, "updated": []any{}, "moved": []any{}, "removed": []any{}}, "warnings": []any{},
	})
	return result, true, nil
}

// historyReplay names a batch that is one history.undo or history.redo.
func historyReplay(batch json.RawMessage) string {
	var envelope struct {
		Commands []struct {
			Name string `json:"name"`
		} `json:"commands"`
	}
	if json.Unmarshal(batch, &envelope) != nil || len(envelope.Commands) != 1 {
		return ""
	}
	if name := envelope.Commands[0].Name; name == "history.undo" || name == "history.redo" {
		return name
	}
	return ""
}

// recordStep keeps a write batch as a step, as StoreApplier.apply does.
func (l *liveSession) recordStep(step *liveStep, before, after json.RawMessage, stacked *yjs.StackItem) {
	step.noteParents(before, after)
	if top := l.undo.UndoTop(); top != stacked {
		step.item = top
	}
	step.shape = step.shapeOf(after)
	l.done = append(l.done, step)
	l.undone = nil
	for len(l.done) > historyStepLimit {
		oldest := l.done[0]
		l.done = l.done[1:]
		if oldest.item != nil {
			l.undo.DropOldest(oldest.item)
		}
	}
}
