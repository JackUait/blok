package room

import (
	"context"
	"iter"
	"sort"
	"strconv"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// BlockChangeKind is CollabBlockChangeKind.
type BlockChangeKind int

const (
	BlockAdded BlockChangeKind = iota
	BlockRemoved
	BlockChanged
	BlockMoved
)

// BlockChange is one block a record touched. Before is nil when added,
// After when removed.
type BlockChange struct {
	ID     jsjson.Str
	Type   *jsjson.Str
	Kind   BlockChangeKind
	Before *jsjson.Object
	After  *jsjson.Object
}

// RecordChanges is one journal record's visible edits. Page lists changed
// page keys, then values keys as "values.<key>".
type RecordChanges struct {
	Sequence    uint64
	CommittedAt time.Time
	ActorID     *string
	Blocks      []BlockChange
	Page        []string
}

// ChangesExportError is CollabChangesExportException: the converter could
// not export or read a step; never a transient limit.
type ChangesExportError struct{ Err error }

func (e *ChangesExportError) Error() string {
	return "collab: a step of the history could not be exported: " + e.Err.Error()
}
func (e *ChangesExportError) Unwrap() error { return e.Err }

// HistoryConverter is what the changes replay needs beyond Converter.
type HistoryConverter interface {
	ExportBlocks(doc *yjs.Doc, warned map[string]bool) ([]any, []convert.RichTextHTMLSlot, error)
	Resolve(ctx context.Context, slots []convert.RichTextHTMLSlot) error
}

type stepExport struct {
	blocks []any
	page   map[string]string
	// slotsByBlock: each top-level block's HTML slots.
	slotsByBlock map[*jsjson.Object][]convert.RichTextHTMLSlot
}

func exportStep(converter HistoryConverter, doc *yjs.Doc, warned map[string]bool) (*stepExport, error) {
	blocks, slots, err := converter.ExportBlocks(doc, warned)
	if err != nil {
		if isTransient(err) || isCancellation(err) {
			return nil, err
		}
		return nil, &ChangesExportError{err}
	}
	// A slot sits somewhere inside its block's data: find the block that
	// holds its target.
	owner := map[*jsjson.Object]*jsjson.Object{}
	for _, item := range blocks {
		if block, ok := item.(*jsjson.Object); ok {
			markObjects(block, block, owner)
		}
	}
	byBlock := map[*jsjson.Object][]convert.RichTextHTMLSlot{}
	for _, slot := range slots {
		if block := owner[slot.Target]; block != nil {
			byBlock[block] = append(byBlock[block], slot)
		}
	}
	return &stepExport{blocks: blocks, page: PageFields(doc), slotsByBlock: byBlock}, nil
}

func markObjects(value any, block *jsjson.Object, owner map[*jsjson.Object]*jsjson.Object) {
	switch v := value.(type) {
	case *jsjson.Object:
		if _, seen := owner[v]; seen {
			return
		}
		owner[v] = block
		for _, member := range v.Members() {
			markObjects(member.Value, block, owner)
		}
	case []any:
		for _, item := range v {
			markObjects(item, block, owner)
		}
	}
}

func (s *stepExport) keep(block *jsjson.Object, kept []convert.RichTextHTMLSlot) []convert.RichTextHTMLSlot {
	if block == nil {
		return kept
	}
	return append(kept, s.slotsByBlock[block]...)
}

// ReplayChanges is CollabVersionChanges.ReplayAsync: one replay from the
// baseline, each record after firstBefore diffed against the step before
// it. Past maxBytes of block JSON the oldest records are dropped, before any
// HTML is read; the newest always stays.
func ReplayChanges(ctx context.Context, baseline [][]byte, records iter.Seq2[operation.Record, error],
	firstBefore uint64, converter HistoryConverter, maxBytes int64) ([]RecordChanges, error) {
	var changes []RecordChanges
	var slotsByRecord [][]convert.RichTextHTMLSlot
	var sizes []int64
	var total int64
	warned := map[string]bool{}
	var previous *stepExport

	err := convert.StepReplay(ctx, baseline, records, func(record *operation.Record, doc *yjs.Doc) error {
		var sequence uint64
		if record != nil {
			sequence = record.Sequence
		}
		if sequence < firstBefore {
			return nil
		}
		current, err := exportStep(converter, doc, warned)
		if err != nil {
			return err
		}
		if record != nil && record.Sequence > firstBefore && previous != nil {
			blocks := DiffBlocks(previous.blocks, current.blocks)
			var slots []convert.RichTextHTMLSlot
			var size int64
			for _, change := range blocks {
				slots = previous.keep(change.Before, slots)
				slots = current.keep(change.After, slots)
				size += jsonBytes(change.Before) + jsonBytes(change.After)
			}
			changes = append(changes, RecordChanges{
				Sequence:    record.Sequence,
				CommittedAt: record.CommittedAt,
				ActorID:     record.ActorID,
				Blocks:      blocks,
				Page:        DiffPage(previous.page, current.page),
			})
			slotsByRecord = append(slotsByRecord, slots)
			sizes = append(sizes, size)
			total += size
			for total > maxBytes && len(changes) > 1 {
				total -= sizes[0]
				changes, slotsByRecord, sizes = changes[1:], slotsByRecord[1:], sizes[1:]
			}
		}
		previous = current
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Only the slots of records still kept: a dropped record's HTML is never read.
	seen := map[*jsjson.Object]map[string]bool{}
	var kept []convert.RichTextHTMLSlot
	for _, slots := range slotsByRecord {
		for _, slot := range slots {
			key := string(slot.Key.String())
			if seen[slot.Target][key] {
				continue
			}
			if seen[slot.Target] == nil {
				seen[slot.Target] = map[string]bool{}
			}
			seen[slot.Target][key] = true
			kept = append(kept, slot)
		}
	}
	if err := converter.Resolve(ctx, kept); err != nil {
		if isTransient(err) || isCancellation(err) {
			return nil, err
		}
		return nil, &ChangesExportError{err}
	}
	return changes, nil
}

func jsonBytes(block *jsjson.Object) int64 {
	if block == nil {
		return 0
	}
	encoded, err := docendpoint.Serialize(block)
	if err != nil {
		return 0
	}
	return int64(len(encoded))
}

type indexedBlock struct {
	id    jsjson.Str
	block *jsjson.Object
}

// DiffBlocks is CollabVersionChanges.Blocks: added, changed and moved in
// after order, then removed in before order. Moved follows the client's
// diff-output-data.ts.
func DiffBlocks(before, after []any) []BlockChange {
	beforeById, beforeOrder := indexByID(before)
	afterById, afterOrder := indexByID(after)
	reordered := reorderedIDs(beforeOrder, afterOrder, beforeById)
	changes := []BlockChange{}
	for _, entry := range afterOrder {
		old, had := beforeById[unitKey(entry.id)]
		switch {
		case !had:
			changes = append(changes, BlockChange{entry.id, typeOf(entry.block), BlockAdded, nil, entry.block})
		case isBlockChanged(old, entry.block):
			changes = append(changes, BlockChange{entry.id, typeOf(entry.block), BlockChanged, old, entry.block})
		case !sameStr(parentOf(old), parentOf(entry.block)) || reordered[unitKey(entry.id)]:
			changes = append(changes, BlockChange{entry.id, typeOf(entry.block), BlockMoved, old, entry.block})
		}
	}
	for _, entry := range beforeOrder {
		if _, still := afterById[unitKey(entry.id)]; !still {
			changes = append(changes, BlockChange{entry.id, typeOf(entry.block), BlockRemoved, entry.block, nil})
		}
	}
	return changes
}

// reorderedIDs: matched blocks that keep their parent but leave the longest
// kept order of its children.
func reorderedIDs(beforeOrder, afterOrder []indexedBlock, beforeById map[string]*jsjson.Object) map[string]bool {
	positionBefore := map[string]int{}
	siblingCounts := map[string]int{}
	for _, entry := range beforeOrder {
		parent := parentKey(parentOf(entry.block))
		positionBefore[unitKey(entry.id)] = siblingCounts[parent]
		siblingCounts[parent]++
	}
	var parents []string
	afterSiblings := map[string][]string{}
	for _, entry := range afterOrder {
		old, had := beforeById[unitKey(entry.id)]
		if !had || !sameStr(parentOf(old), parentOf(entry.block)) {
			continue
		}
		parent := parentKey(parentOf(entry.block))
		if _, ok := afterSiblings[parent]; !ok {
			parents = append(parents, parent)
		}
		afterSiblings[parent] = append(afterSiblings[parent], unitKey(entry.id))
	}
	reordered := map[string]bool{}
	for _, parent := range parents {
		ids := afterSiblings[parent]
		positions := make([]int, len(ids))
		for i, id := range ids {
			positions[i] = positionBefore[id]
		}
		kept := map[int]bool{}
		for _, index := range convert.LongestKeptOrder(positions) {
			kept[index] = true
		}
		for index, id := range ids {
			if !kept[index] {
				reordered[id] = true
			}
		}
	}
	return reordered
}

// indexByID keeps the first block per id, in array order.
func indexByID(blocks []any) (map[string]*jsjson.Object, []indexedBlock) {
	byID := map[string]*jsjson.Object{}
	var order []indexedBlock
	for _, item := range blocks {
		block, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		id := stringOf(block, "id")
		if id == nil {
			continue
		}
		if _, dup := byID[unitKey(*id)]; dup {
			continue
		}
		byID[unitKey(*id)] = block
		order = append(order, indexedBlock{*id, block})
	}
	return byID, order
}

// isBlockChanged: a format-1 rich field is still raw HTML here, so two HTMLs
// that say the same thing read as changed.
func isBlockChanged(before, after *jsjson.Object) bool {
	if !sameStr(typeOf(before), typeOf(after)) {
		return true
	}
	beforeData, _ := before.Get(jsjson.FromString("data"))
	afterData, _ := after.Get(jsjson.FromString("data"))
	if !convert.SameValue(beforeData, afterData) {
		return true
	}
	return !convert.SameValue(tunesOf(before), tunesOf(after))
}

func tunesOf(block *jsjson.Object) any {
	if tunes, ok := block.Get(jsjson.FromString("tunes")); ok && tunes != nil {
		return tunes
	}
	return &jsjson.Object{}
}

func typeOf(block *jsjson.Object) *jsjson.Str   { return stringOf(block, "type") }
func parentOf(block *jsjson.Object) *jsjson.Str { return stringOf(block, "parent") }

func stringOf(block *jsjson.Object, key string) *jsjson.Str {
	value, ok := block.Get(jsjson.FromString(key))
	if !ok {
		return nil
	}
	if s, isString := value.(jsjson.Str); isString {
		return &s
	}
	return nil
}

func sameStr(a, b *jsjson.Str) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return jsjson.Compare(*a, *b) == 0
}

// unitKey keys a UTF-16 string exactly, lone surrogates included.
func unitKey(s jsjson.Str) string {
	b := make([]byte, 0, 2*len(s))
	for _, unit := range s {
		b = append(b, byte(unit>>8), byte(unit))
	}
	return string(b)
}

// parentKey: the root is its own key, apart from every id.
func parentKey(parent *jsjson.Str) string {
	if parent == nil {
		return "\x00root"
	}
	return "\x01" + unitKey(*parent)
}

const valuesPrefix = "values."

// PageFields is a comparable form of every page and values key: plain JSON
// by content, anything else by the item that holds it.
func PageFields(doc *yjs.Doc) map[string]string {
	fields := map[string]string{}
	readPageFields(doc.GetMap(jsjson.FromString("page")), "", fields)
	readPageFields(doc.GetMap(jsjson.FromString("values")), valuesPrefix, fields)
	return fields
}

func readPageFields(m *yjs.Map, prefix string, fields map[string]string) {
	for _, key := range m.Keys() {
		value, _ := m.Get(key)
		name := prefix + key.String()
		if fingerprint, ok := fingerprintOf(value); ok {
			fields[name] = fingerprint
			continue
		}
		id, _ := m.HeadID(key)
		fields[name] = "#" + strconv.FormatUint(id.Client, 10) + ":" + strconv.FormatUint(id.Clock, 10)
	}
}

func fingerprintOf(value any) (string, bool) {
	switch value.(type) {
	case yjs.AbstractType, jsjson.Undefined:
		return "", false
	}
	text, err := jsjson.Stringify(value)
	if err != nil {
		return "", false
	}
	// "=" keeps a JSON text apart from the "#" item ids.
	return "=" + text, true
}

// DiffPage lists the keys whose fingerprint differs: page keys first, then
// values keys, each in ordinal order.
func DiffPage(before, after map[string]string) []string {
	var keys []string
	seen := map[string]bool{}
	for _, side := range []map[string]string{before, after} {
		for key := range side {
			if seen[key] {
				continue
			}
			seen[key] = true
			b, hasBefore := before[key]
			a, hasAfter := after[key]
			if hasBefore != hasAfter || b != a {
				keys = append(keys, key)
			}
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		vi, vj := len(keys[i]) >= len(valuesPrefix) && keys[i][:len(valuesPrefix)] == valuesPrefix,
			len(keys[j]) >= len(valuesPrefix) && keys[j][:len(valuesPrefix)] == valuesPrefix
		if vi != vj {
			return !vi
		}
		return jsjson.Compare(jsjson.FromString(keys[i]), jsjson.FromString(keys[j])) < 0
	})
	return keys
}
