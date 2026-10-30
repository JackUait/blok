package yjs

import (
	"strconv"
	"unsafe"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// attr is one formatting mark in force.
type attr struct {
	key   jsjson.Str
	value any
}

// attrs is an ordered map with JS Map semantics (.NET OrderedDictionary):
// setting an existing key keeps its place, a removed key re-added goes to
// the end.
type attrs []attr

func (a attrs) find(key jsjson.Str) int {
	for i := range a {
		if jsjson.Compare(a[i].key, key) == 0 {
			return i
		}
	}
	return -1
}

func (a attrs) get(key jsjson.Str) (any, bool) {
	if i := a.find(key); i >= 0 {
		return a[i].value, true
	}
	return nil, false
}

func (a *attrs) set(key jsjson.Str, value any) {
	if i := a.find(key); i >= 0 {
		(*a)[i].value = value
		return
	}
	*a = append(*a, attr{key, value})
}

func (a *attrs) tryAdd(key jsjson.Str, value any) {
	if a.find(key) < 0 {
		*a = append(*a, attr{key, value})
	}
}

func (a *attrs) remove(key jsjson.Str) {
	if i := a.find(key); i >= 0 {
		*a = append((*a)[:i:i], (*a)[i+1:]...)
	}
}

func (a attrs) clone() attrs { return append(attrs{}, a...) }

// Delta is one toDelta op: a jsjson.Str, an embed value, or an
// AbstractType, with the marks in force (nil when none).
type Delta struct {
	Insert     any
	Attributes *jsjson.Object
}

// textBase is the item-chain text logic Y.Text and Y.XmlText share, ported
// line for line from yjs's YText.js because each step decides which
// neighbours a new item names, and so its bytes. The after-transaction
// format cleanup is NOT ported: Blok clients run it and send the result.
type textBase struct {
	typeCore
	pending    []func(*Transaction)
	integrated bool
}

// Text is a Y.Text.
type Text struct{ textBase }

// XmlText is a Y.XmlText: a text under another type ref, not a Text.
type XmlText struct{ textBase }

// NewText is a prelim text seeded with initial text.
func NewText(initial jsjson.Str) *Text {
	text := &Text{}
	text.seed(text, initial)
	return text
}

// NewXmlText is a prelim XML text seeded with initial text.
func NewXmlText(initial jsjson.Str) *XmlText {
	text := &XmlText{}
	text.seed(text, initial)
	return text
}

func (b *textBase) seed(self AbstractType, initial jsjson.Str) {
	if initial != nil {
		b.pending = append(b.pending, func(t *Transaction) { b.insert(self, t, 0, initial, nil) })
	}
}

func (b *textBase) integratePrelim(t *Transaction) {
	queued := b.pending
	b.pending = nil
	b.integrated = true
	for _, write := range queued {
		write(t)
	}
}

// Insert is YText.insert. nil attributes inherit the marks in force at the
// index; an object (even empty) sets exactly those. On a prelim text the
// write is queued and t may be nil.
func (x *Text) Insert(t *Transaction, index int, chunk jsjson.Str, attributes *jsjson.Object) {
	x.insert(x, t, index, chunk, attributes)
}

// InsertEmbed is YText.insertEmbed. nil attributes mean no marks.
func (x *Text) InsertEmbed(t *Transaction, index int, embed any, attributes *jsjson.Object) {
	x.insertEmbed(x, t, index, embed, attributes)
}

// Format sets marks over a range; a nil mark value removes the mark.
func (x *Text) Format(t *Transaction, index, length int, attributes *jsjson.Object) {
	x.format(x, t, index, length, attributes)
}

// Delete removes length ticks from index.
func (x *Text) Delete(t *Transaction, index, length int) { x.deleteRange(x, t, index, length) }

// Insert is YText.insert on an XML text.
func (x *XmlText) Insert(t *Transaction, index int, chunk jsjson.Str, attributes *jsjson.Object) {
	x.insert(x, t, index, chunk, attributes)
}

// InsertEmbed is YText.insertEmbed on an XML text.
func (x *XmlText) InsertEmbed(t *Transaction, index int, embed any, attributes *jsjson.Object) {
	x.insertEmbed(x, t, index, embed, attributes)
}

// Format sets marks over a range on an XML text.
func (x *XmlText) Format(t *Transaction, index, length int, attributes *jsjson.Object) {
	x.format(x, t, index, length, attributes)
}

// Delete removes length ticks from an XML text.
func (x *XmlText) Delete(t *Transaction, index, length int) { x.deleteRange(x, t, index, length) }

// String is the text of every live ContentString; embeds carry no text.
func (b *textBase) String() string { return b.Units().String() }

// Units is String as UTF-16 units.
func (b *textBase) Units() jsjson.Str {
	var text jsjson.Str
	for item := b.start; item != nil; item = item.right {
		if content, ok := item.content.(*ContentString); ok && !item.deleted {
			text = append(text, content.Text...)
		}
	}
	return text
}

func (b *textBase) insert(self AbstractType, t *Transaction, index int, chunk jsjson.Str, attributes *jsjson.Object) {
	if index < 0 {
		fail("yjs: negative index.")
	}
	if len(chunk) == 0 {
		return
	}
	var given attrs
	if attributes != nil {
		given = marksOf(attributes)
	}
	live := b.queue(t, func(attached *Transaction) { b.insert(self, attached, index, chunk, attributes) })
	if live == nil {
		return
	}
	position := b.findPosition(live, index)
	marks := given
	if attributes == nil {
		marks = position.current.clone()
	}
	b.insertText(self, live, position, &ContentString{Text: append(jsjson.Str{}, chunk...)}, marks)
}

func (b *textBase) insertEmbed(self AbstractType, t *Transaction, index int, embed any, attributes *jsjson.Object) {
	if index < 0 {
		fail("yjs: negative index.")
	}
	switch embed.(type) {
	case nil:
		fail("yjs: an embed cannot be null.")
	case jsjson.Str, AbstractType:
		fail("yjs: an embed is a JSON value other than a string.")
	}
	json, err := jsjson.Stringify(embed)
	if err != nil {
		fail("%v", err)
	}
	marks := attrs{}
	if attributes != nil {
		marks = marksOf(attributes)
	}
	live := b.queue(t, func(attached *Transaction) { b.insertEmbed(self, attached, index, embed, attributes) })
	if live == nil {
		return
	}
	content := &ContentEmbed{unsplittable: unsplittable{5}, JSON: jsjson.FromString(json)}
	b.insertText(self, live, b.findPosition(live, index), content, marks)
}

func (b *textBase) format(self AbstractType, t *Transaction, index, length int, attributes *jsjson.Object) {
	if index < 0 {
		fail("yjs: negative index.")
	}
	if length == 0 {
		return
	}
	marks := marksOf(attributes)
	live := b.queue(t, func(attached *Transaction) { b.format(self, attached, index, length, attributes) })
	if live == nil {
		return
	}
	position := b.findPosition(live, index)
	if position.right == nil {
		return
	}
	b.formatText(self, live, position, length, marks)
}

func (b *textBase) deleteRange(self AbstractType, t *Transaction, index, length int) {
	if index < 0 || length < 0 {
		fail("yjs: negative index or length.")
	}
	if length == 0 {
		return
	}
	live := b.queue(t, func(attached *Transaction) { b.deleteRange(self, attached, index, length) })
	if live == nil {
		return
	}
	deleteText(live, b.findPosition(live, index), length)
}

// ToDelta is YText.toDelta with no snapshot. Every mark item ends a run.
func (b *textBase) ToDelta() []Delta {
	var delta []Delta
	current := attrs{}
	var run jsjson.Str
	packRun := func() {
		if len(run) > 0 {
			delta = append(delta, Delta{Insert: run, Attributes: snapshot(current)})
			run = nil
		}
	}
	ychange := jsjson.FromString("ychange")
	for item := b.start; item != nil; item = item.right {
		if item.deleted {
			continue
		}
		switch content := item.content.(type) {
		case *ContentString:
			// With no snapshot, a "ychange" mark is dropped at the next string.
			if current.find(ychange) >= 0 {
				packRun()
				current.remove(ychange)
			}
			run = append(run, content.Text...)
		case *ContentEmbed:
			packRun()
			delta = append(delta, Delta{Insert: parseValidated(content.JSON), Attributes: snapshot(current)})
		case *ContentType:
			packRun()
			delta = append(delta, Delta{Insert: content.Type, Attributes: snapshot(current)})
		case *ContentFormat:
			packRun()
			updateCurrentAttributes(&current, content)
		}
	}
	packRun()
	return delta
}

// queue stashes a write on a text with no document and answers nil.
func (b *textBase) queue(t *Transaction, write func(*Transaction)) *Transaction {
	if b.doc == nil {
		if b.integrated {
			fail("yjs: this text was integrated without a document.")
		}
		b.pending = append(b.pending, write)
		return nil
	}
	if t == nil {
		fail("yjs: a text in a document needs a transaction.")
	}
	return t
}

func snapshot(current attrs) *jsjson.Object {
	if len(current) == 0 {
		return nil
	}
	object := &jsjson.Object{}
	for _, a := range current {
		object.Set(a.key, a.value)
	}
	return object
}

func marksOf(attributes *jsjson.Object) attrs {
	marks := attrs{}
	for _, member := range attributes.Members() {
		if _, undefined := member.Value.(jsjson.Undefined); undefined {
			fail("yjs: the mark %q is undefined; use null to remove it.", member.Key.String())
		}
		marks.set(member.Key, member.Value)
	}
	return marks
}

// textPosition is yjs's ItemTextListPosition.
type textPosition struct {
	left, right *Item
	index       int
	current     attrs
}

func (p *textPosition) forward() {
	right := p.right
	if right == nil {
		fail("yjs: nothing to the right to step over.")
	}
	if format, ok := right.content.(*ContentFormat); ok {
		if !right.deleted {
			updateCurrentAttributes(&p.current, format)
		}
	} else if !right.deleted {
		p.index += right.length
	}
	p.left = right
	p.right = right.right
}

// findPosition is yjs's findPosition without the search marker, a cache
// that lands on the same item.
func (b *textBase) findPosition(t *Transaction, index int) *textPosition {
	position := &textPosition{right: b.start, current: attrs{}}
	return findNextPosition(t, position, index)
}

func findNextPosition(t *Transaction, position *textPosition, count int) *textPosition {
	for position.right != nil && count > 0 {
		right := position.right
		if format, ok := right.content.(*ContentFormat); ok {
			if !right.deleted {
				updateCurrentAttributes(&position.current, format)
			}
		} else if !right.deleted {
			if count < right.length {
				t.doc.store.getItemCleanStart(t, ID{right.id.Client, right.id.Clock + uint64(count)})
			}
			position.index += right.length
			count -= right.length
		}
		position.left = right
		position.right = right.right
	}
	return position
}

// insertText switches off every mark in force the insert does not name,
// then writes marks, content, and the negations.
func (b *textBase) insertText(self AbstractType, t *Transaction, position *textPosition, content Content, attributes attrs) {
	for _, a := range position.current {
		attributes.tryAdd(a.key, nil)
	}
	minimizeAttributeChanges(position, attributes)
	negated := insertAttributes(self, t, position, attributes)
	item := newItem(t, self, position.left, position.right, nil, content)
	item.integrate(t, 0)
	position.right = item
	position.forward()
	insertNegatedAttributes(self, t, position, negated)
}

// formatText writes the marks, then walks the range deleting every mark it
// overrides and remembering what to restore at its end.
func (b *textBase) formatText(self AbstractType, t *Transaction, position *textPosition, length int, attributes attrs) {
	minimizeAttributeChanges(position, attributes)
	negated := insertAttributes(self, t, position, attributes)
	for position.right != nil {
		right := position.right
		_, isFormat := right.content.(*ContentFormat)
		if !(length > 0 || (len(negated) > 0 && (right.deleted || isFormat))) {
			break
		}
		if !right.deleted {
			if format, ok := right.content.(*ContentFormat); ok {
				if wanted, ok := attributes.get(format.Key); ok {
					if equalAttrs(wanted, format.Value()) {
						negated.remove(format.Key)
					} else {
						if length == 0 {
							break
						}
						negated.set(format.Key, format.Value())
					}
					right.delete(t)
				} else {
					position.current.set(format.Key, format.Value())
				}
			} else {
				if length < right.length {
					t.doc.store.getItemCleanStart(t, ID{right.id.Client, right.id.Clock + uint64(length)})
				}
				length -= right.length
			}
		}
		position.forward()
	}
	// yjs pads with newlines when the range runs past the end (a Quill rule).
	if length > 0 {
		newlines := make(jsjson.Str, length)
		for i := range newlines {
			newlines[i] = '\n'
		}
		item := newItem(t, self, position.left, position.right, nil, &ContentString{Text: newlines})
		item.integrate(t, 0)
		position.right = item
		position.forward()
	}
	insertNegatedAttributes(self, t, position, negated)
}

func minimizeAttributeChanges(position *textPosition, attributes attrs) {
	for position.right != nil {
		right := position.right
		if !right.deleted {
			format, ok := right.content.(*ContentFormat)
			if !ok {
				break
			}
			wanted, _ := attributes.get(format.Key)
			if !equalAttrs(wanted, format.Value()) {
				break
			}
		}
		position.forward()
	}
}

// insertAttributes writes one mark per attribute that differs from the
// marks in force, in JS key order, and answers what was in force before.
func insertAttributes(self AbstractType, t *Transaction, position *textPosition, attributes attrs) attrs {
	negated := attrs{}
	members := make([]jsjson.Member, len(attributes))
	for i, a := range attributes {
		members[i] = jsjson.Member{Key: a.key, Value: a.value}
	}
	for _, member := range jsjson.KeyOrder(members) {
		current, _ := position.current.get(member.Key)
		if !equalAttrs(current, member.Value) {
			negated.set(member.Key, current)
			writeMark(self, t, position, member.Key, member.Value)
		}
	}
	return negated
}

// insertNegatedAttributes skips marks that already restore what is needed,
// then writes the rest in the order they were collected. A key missing
// from negated is undefined in yjs, never equal to a mark.
func insertNegatedAttributes(self AbstractType, t *Transaction, position *textPosition, negated attrs) {
	for position.right != nil {
		right := position.right
		if !right.deleted {
			format, ok := right.content.(*ContentFormat)
			if !ok {
				break
			}
			wanted, found := negated.get(format.Key)
			if !found || !equalAttrs(wanted, format.Value()) {
				break
			}
			negated.remove(format.Key)
		}
		position.forward()
	}
	for _, a := range negated {
		writeMark(self, t, position, a.key, a.value)
	}
}

func writeMark(self AbstractType, t *Transaction, position *textPosition, key jsjson.Str, value any) {
	content := newLocalFormat(key, value)
	mark := newItem(t, self, position.left, position.right, nil, content)
	mark.integrate(t, 0)
	position.right = mark
	position.forward()
}

// deleteText deletes content forward, then cleans up stranded marks.
func deleteText(t *Transaction, position *textPosition, length int) {
	startAttributes := position.current.clone()
	start := position.right
	for length > 0 && position.right != nil {
		right := position.right
		if !right.deleted {
			switch right.content.(type) {
			case *ContentString, *ContentEmbed, *ContentType:
				if length < right.length {
					t.doc.store.getItemCleanStart(t, ID{right.id.Client, right.id.Clock + uint64(length)})
				}
				length -= right.length
				right.delete(t)
			}
		}
		position.forward()
	}
	if start != nil {
		cleanupFormattingGap(t, start, position.right, startAttributes, &position.current)
	}
}

// cleanupFormattingGap deletes marks a deletion left overwritten or already
// true. yjs compares with === here, not equalAttrs.
func cleanupFormattingGap(t *Transaction, start, current *Item, startAttributes attrs, currentAttributes *attrs) {
	type endFormat struct {
		key    jsjson.Str
		format *ContentFormat
	}
	var endFormats []endFormat
	endFormatOf := func(key jsjson.Str) *ContentFormat {
		for _, e := range endFormats {
			if jsjson.Compare(e.key, key) == 0 {
				return e.format
			}
		}
		return nil
	}
	end := start
	for end != nil && (!end.countable() || end.deleted) {
		if format, ok := end.content.(*ContentFormat); ok && !end.deleted {
			replaced := false
			for i := range endFormats {
				if jsjson.Compare(endFormats[i].key, format.Key) == 0 {
					endFormats[i].format = format
					replaced = true
				}
			}
			if !replaced {
				endFormats = append(endFormats, endFormat{format.Key, format})
			}
		}
		end = end.right
	}
	reachedCurrent := false
	for walked := start; walked != end; walked = walked.right {
		if walked == nil {
			fail("yjs: the text chain ended before its gap did.")
		}
		if current == walked {
			reachedCurrent = true
		}
		mark, ok := walked.content.(*ContentFormat)
		if walked.deleted || !ok {
			continue
		}
		value := mark.Value()
		startValue, _ := startAttributes.get(mark.Key)
		startedTrue := strictEquals(startValue, value)
		if endFormatOf(mark.Key) != mark || startedTrue {
			walked.delete(t)
			currentValue, _ := currentAttributes.get(mark.Key)
			if !reachedCurrent && !startedTrue && strictEquals(currentValue, value) {
				if startValue == nil {
					currentAttributes.remove(mark.Key)
				} else {
					currentAttributes.set(mark.Key, startValue)
				}
			}
		}
		if !reachedCurrent && !walked.deleted {
			updateCurrentAttributes(currentAttributes, mark)
		}
	}
}

// updateCurrentAttributes: a null mark switches the attribute off.
func updateCurrentAttributes(current *attrs, format *ContentFormat) {
	if format.Value() == nil {
		current.remove(format.Key)
	} else {
		current.set(format.Key, format.Value())
	}
}

// equalAttrs is yjs's equalAttrs: ===, or two objects (or arrays) with the
// same keys whose values are === (lib0 equalFlat).
func equalAttrs(left, right any) bool {
	if strictEquals(left, right) {
		return true
	}
	leftMembers, ok := flatMembers(left)
	if !ok {
		return false
	}
	rightMembers, ok := flatMembers(right)
	if !ok || len(leftMembers) != len(rightMembers) {
		return false
	}
	for key, value := range leftMembers {
		other, found := rightMembers[key]
		if !found || !strictEquals(other, value) {
			return false
		}
	}
	return true
}

func flatMembers(value any) (map[string]any, bool) {
	switch value := value.(type) {
	case *jsjson.Object:
		members := map[string]any{}
		for _, member := range value.Members() {
			members[unitsKey(member.Key)] = member.Value
		}
		return members, true
	case []any:
		members := map[string]any{}
		for i, item := range value {
			members[unitsKey(jsjson.FromString(strconv.Itoa(i)))] = item
		}
		return members, true
	}
	return nil, false
}

// strictEquals is ===: scalars by value (NaN !== NaN, -0 === 0), objects and
// arrays by identity. Go cannot compare []any with ==, so an array's
// identity is its backing array; an empty array with no backing store is
// never identical to anything (UNVERIFIED edge: C# compares the reference).
func strictEquals(left, right any) bool {
	switch l := left.(type) {
	case nil:
		return right == nil
	case bool:
		r, ok := right.(bool)
		return ok && l == r
	case float64:
		r, ok := right.(float64)
		return ok && l == r
	case jsjson.Str:
		r, ok := right.(jsjson.Str)
		return ok && jsjson.Compare(l, r) == 0
	case *jsjson.Object:
		r, ok := right.(*jsjson.Object)
		return ok && l == r
	case []any:
		r, ok := right.([]any)
		return ok && cap(l) > 0 && len(l) == len(r) && unsafe.SliceData(l) == unsafe.SliceData(r)
	}
	return false
}
