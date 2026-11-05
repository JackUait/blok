package convert

import (
	"fmt"
	"slices"
	"sort"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// RichTextOp is one write against a live formatted text (C# RichTextEdit.cs,
// client planRichTextEdit). The fixtures pin the exact ops both sides issue.
type RichTextOp interface{ richTextOp() }

type RichTextInsert struct {
	Index      int
	Text       jsjson.Str
	Attributes *jsjson.Object
}

type RichTextInsertEmbed struct {
	Index      int
	Embed      *jsjson.Object
	Attributes *jsjson.Object
}

type RichTextDelete struct{ Index, Length int }

type RichTextFormat struct {
	Index, Length int
	Attributes    *jsjson.Object
}

func (RichTextInsert) richTextOp()      {}
func (RichTextInsertEmbed) richTextOp() {}
func (RichTextDelete) richTextOp()      {}
func (RichTextFormat) richTextOp()      {}

// embedUnit stands for an embed in the projected text the diff runs over.
const embedUnit = 0xFFFC

// richTextTarget is a Y.XmlText or a Y.Text.
type richTextTarget interface {
	Insert(t *yjs.Transaction, index int, chunk jsjson.Str, attributes *jsjson.Object)
	InsertEmbed(t *yjs.Transaction, index int, embed any, attributes *jsjson.Object)
	Delete(t *yjs.Transaction, index, length int)
	Format(t *yjs.Transaction, index, length int, attributes *jsjson.Object)
}

// PlanRichTextEdit is the writes turning the live delta into next (canonical).
func PlanRichTextEdit(live []yjs.Delta, next []any) []RichTextOp {
	// A respelling must write nothing, or two peers re-saving it ping-pong.
	if SameJSON(FromDelta(live), next) {
		return nil
	}
	// From the raw delta: an item the canonical form drops still takes an index.
	before := liveUnits(live)
	after := nextUnits(next)
	edits := Diff(project(before), project(after), false)
	matchBefore, matchAfter := align(before, after, edits)
	var ops []RichTextOp
	found := regions(matchBefore, matchAfter)
	for r := len(found) - 1; r >= 0; r-- {
		region := found[r]
		position := region.before
		index := region.after
		end := region.after + region.inserted
		for index < end {
			unit := after[index]
			if unit.embed != nil {
				ops = append(ops, RichTextInsertEmbed{Index: position, Embed: unit.embed, Attributes: Normalize(unit.marks)})
				position++
				index++
				continue
			}
			stop := index
			for stop < end && after[stop].embed == nil && after[stop].segment == unit.segment {
				stop++
			}
			text := make(jsjson.Str, 0, stop-index)
			for _, part := range after[index:stop] {
				text = append(text, part.character)
			}
			ops = append(ops, RichTextInsert{Index: position, Text: text, Attributes: Normalize(unit.marks)})
			position += stop - index
			index = stop
		}
		if region.removed > 0 {
			ops = append(ops, RichTextDelete{Index: region.before + region.inserted, Length: region.removed})
		}
	}
	return append(ops, formatOps(before, after, matchAfter)...)
}

// ApplyRichTextOps runs the planned writes in one transaction.
func ApplyRichTextOps(t *yjs.Transaction, text richTextTarget, ops []RichTextOp) {
	for _, op := range ops {
		switch op := op.(type) {
		case RichTextInsert:
			text.Insert(t, op.Index, op.Text, op.Attributes)
		case RichTextInsertEmbed:
			text.InsertEmbed(t, op.Index, op.Embed, op.Attributes)
		case RichTextDelete:
			text.Delete(t, op.Index, op.Length)
		case RichTextFormat:
			text.Format(t, op.Index, op.Length, op.Attributes)
		default:
			panic(fmt.Sprintf("collab: unknown rich text op %T", op))
		}
	}
}

// SameJSON compares two values as JSON.stringify text.
func SameJSON(left, right any) bool {
	a, errA := jsjson.Stringify(left)
	b, errB := jsjson.Stringify(right)
	return errA == nil && errB == nil && a == b
}

type textUnit struct {
	character uint16
	embed     *jsjson.Object
	foreign   bool
	marks     *jsjson.Object
	segment   int
}

func liveUnits(live []yjs.Delta) []textUnit {
	var units []textUnit
	for _, op := range live {
		marks := CanonicalMarks(anyOrNil(op.Attributes))
		if text, ok := op.Insert.(jsjson.Str); ok {
			for _, character := range text {
				units = append(units, textUnit{character: character, marks: marks, segment: -1})
			}
			continue
		}
		embed, isObject := op.Insert.(*jsjson.Object)
		units = append(units, textUnit{character: embedUnit, embed: embed, foreign: !isObject, marks: marks, segment: -1})
	}
	return units
}

// anyOrNil keeps a nil *Object from becoming a non-nil interface.
func anyOrNil(object *jsjson.Object) any {
	if object == nil {
		return nil
	}
	return object
}

func nextUnits(next []any) []textUnit {
	var units []textUnit
	for index, item := range next {
		segment := item.(*jsjson.Object)
		raw, _ := lookup(segment, "marks")
		marks, _ := raw.(*jsjson.Object)
		if text, ok := textOf(segment); ok {
			for _, character := range text {
				units = append(units, textUnit{character: character, marks: marks, segment: index})
			}
		} else if value, ok := lookup(segment, "embed"); ok {
			if embed, isObject := value.(*jsjson.Object); isObject {
				units = append(units, textUnit{character: embedUnit, embed: embed, marks: marks, segment: index})
			}
		}
	}
	return units
}

func project(units []textUnit) jsjson.Str {
	text := make(jsjson.Str, len(units))
	for i, unit := range units {
		text[i] = unit.character
	}
	return text
}

func align(before, after []textUnit, edits []TextEdit) ([]int, []int) {
	matchBefore := slices.Repeat([]int{-1}, len(before))
	matchAfter := slices.Repeat([]int{-1}, len(after))
	b, a := 0, 0
	keep := func(until int) {
		for b < until {
			if sameContent(before[b], after[a]) {
				matchBefore[b] = a
				matchAfter[a] = b
			}
			b++
			a++
		}
	}
	for _, edit := range edits {
		keep(edit.Index)
		b += edit.Remove
		a += len(edit.Insert)
	}
	keep(len(before))
	return matchBefore, matchAfter
}

func sameContent(live, next textUnit) bool {
	if live.embed == nil && next.embed == nil {
		return !live.foreign
	}
	return !live.foreign && live.embed != nil && next.embed != nil && SameValue(live.embed, next.embed)
}

type textRegion struct{ before, removed, after, inserted int }

func regions(matchBefore, matchAfter []int) []textRegion {
	var found []textRegion
	b, a := 0, 0
	for b < len(matchBefore) || a < len(matchAfter) {
		if b < len(matchBefore) && a < len(matchAfter) && matchBefore[b] == a {
			b++
			a++
			continue
		}
		startBefore, startAfter := b, a
		for b < len(matchBefore) && matchBefore[b] < 0 {
			b++
		}
		for a < len(matchAfter) && matchAfter[a] < 0 {
			a++
		}
		found = append(found, textRegion{startBefore, b - startBefore, startAfter, a - startAfter})
	}
	return found
}

func formatOps(before, after []textUnit, matchAfter []int) []RichTextOp {
	var ops []RichTextOp
	start, length := -1, 0
	var pending *jsjson.Object
	pendingKey := ""
	flush := func() {
		if pending != nil {
			ops = append(ops, RichTextFormat{Index: start, Length: length, Attributes: pending})
		}
		pending = nil
		pendingKey = ""
	}
	for index := range after {
		var changes *jsjson.Object
		if matchAfter[index] >= 0 {
			changes = markChanges(before[matchAfter[index]].marks, after[index].marks)
		}
		if changes == nil {
			flush()
			continue
		}
		key, _ := jsjson.Stringify(changes)
		if pending != nil && key == pendingKey && start+length == index {
			length++
			continue
		}
		flush()
		pending, pendingKey, start, length = changes, key, index, 1
	}
	flush()
	return ops
}

func markChanges(live, next *jsjson.Object) *jsjson.Object {
	var keys []jsjson.Str
	for _, record := range []*jsjson.Object{live, next} {
		if record == nil {
			continue
		}
		for _, m := range record.Members() {
			if !slices.ContainsFunc(keys, func(k jsjson.Str) bool { return slices.Equal(k, m.Key) }) {
				keys = append(keys, m.Key)
			}
		}
	}
	sort.SliceStable(keys, func(i, j int) bool { return jsjson.Compare(keys[i], keys[j]) < 0 })
	changes := &jsjson.Object{}
	for _, key := range keys {
		var liveValue, nextValue any
		inLive, inNext := false, false
		if live != nil {
			liveValue, inLive = live.Get(key)
		}
		if next != nil {
			nextValue, inNext = next.Get(key)
		}
		if inLive == inNext && SameValue(liveValue, nextValue) {
			continue
		}
		if inNext {
			changes.Set(key, NormalizeValue(nextValue))
		} else {
			changes.Set(key, nil)
		}
	}
	if changes.Len() == 0 {
		return nil
	}
	return changes
}
