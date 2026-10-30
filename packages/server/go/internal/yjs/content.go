package yjs

import (
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

type writer = lib0.Writer

// JSONMaxDepth is how deep a raw JSON payload (refs 2, 5, 6) may nest. C#
// validates with JsonDocument at MaxDepth 512; Go's json.Valid would accept
// far deeper, so the jsjson reader does the check.
const JSONMaxDepth = 512

// Content is an item's payload, one of the nine kinds 1..9.
type Content interface {
	// Ref is the wire's content ref.
	Ref() byte
	// Len is how many clock ticks the content occupies.
	Len() int
	// Countable is false for tombstones and formatting marks.
	Countable() bool
	// Values is one value per tick, or none for content that holds none.
	Values() []any
	write(w *writer, offset int)
	splice(offset int) Content
	integrate(t *Transaction, item *Item)
	delete(t *Transaction)
	gc(store *Store)
	copy() Content
}

// noHooks gives a content the do-nothing lifecycle most kinds have.
type noHooks struct{}

func (noHooks) integrate(*Transaction, *Item) {}
func (noHooks) delete(*Transaction)           {}
func (noHooks) gc(*Store)                     {}

// unsplittable panics as yjs throws: one-tick content has no halves.
type unsplittable struct{ ref byte }

func (u unsplittable) splice(int) Content {
	fail("yjs: content ref %d occupies one tick and cannot be split.", u.ref)
	return nil
}

// ContentDeleted (1) is a tombstone that keeps its length.
type ContentDeleted struct {
	noHooks
	ticks int
}

func (*ContentDeleted) Ref() byte       { return 1 }
func (c *ContentDeleted) Len() int      { return c.ticks }
func (*ContentDeleted) Countable() bool { return false }
func (*ContentDeleted) Values() []any   { return nil }
func (c *ContentDeleted) copy() Content { return &ContentDeleted{ticks: c.ticks} }
func (c *ContentDeleted) write(w *writer, offset int) {
	w.WriteVarUint(uint64(c.ticks - offset))
}

func (c *ContentDeleted) splice(offset int) Content {
	right := &ContentDeleted{ticks: c.ticks - offset}
	c.ticks = offset
	return right
}

// The wire's own tombstone arrives deleted, so the deletion is recorded in
// this transaction.
func (c *ContentDeleted) integrate(t *Transaction, item *Item) {
	t.deleteSet.add(item.id.Client, item.id.Clock, uint64(c.ticks))
	item.deleted = true
}

// ContentJSON (2) is legacy JSON content, kept as the wire's raw strings.
// "undefined" is yjs's sentinel, not JSON.
type ContentJSON struct {
	noHooks
	Raw []jsjson.Str
}

func (*ContentJSON) Ref() byte       { return 2 }
func (c *ContentJSON) Len() int      { return len(c.Raw) }
func (*ContentJSON) Countable() bool { return true }
func (c *ContentJSON) copy() Content { return &ContentJSON{Raw: c.Raw} }

// Values parses on read, as JSON.parse does.
func (c *ContentJSON) Values() []any {
	values := make([]any, len(c.Raw))
	for i, raw := range c.Raw {
		if raw.String() == "undefined" {
			values[i] = jsjson.Undefined{}
			continue
		}
		values[i] = parseValidated(raw)
	}
	return values
}

func (c *ContentJSON) splice(offset int) Content {
	right := &ContentJSON{Raw: append([]jsjson.Str{}, c.Raw[offset:]...)}
	c.Raw = append([]jsjson.Str{}, c.Raw[:offset]...)
	return right
}

func (c *ContentJSON) write(w *writer, offset int) {
	w.WriteVarUint(uint64(len(c.Raw) - offset))
	for _, raw := range c.Raw[offset:] {
		w.WriteVarString(raw)
	}
}

// ContentBinary (3) is one opaque byte array.
type ContentBinary struct {
	noHooks
	unsplittable
	Bytes []byte
}

func (*ContentBinary) Ref() byte                { return 3 }
func (*ContentBinary) Len() int                 { return 1 }
func (*ContentBinary) Countable() bool          { return true }
func (c *ContentBinary) Values() []any          { return []any{c.Bytes} }
func (c *ContentBinary) copy() Content          { return c }
func (c *ContentBinary) write(w *writer, _ int) { w.WriteVarBytes(c.Bytes) }

// ContentString (4) is Y.Text's characters, one tick per UTF-16 unit.
type ContentString struct {
	noHooks
	Text jsjson.Str
}

func (*ContentString) Ref() byte       { return 4 }
func (c *ContentString) Len() int      { return len(c.Text) }
func (*ContentString) Countable() bool { return true }
func (c *ContentString) copy() Content { return &ContentString{Text: c.Text} }

// Values yields one unit per tick, so an astral character reads back as its
// two halves.
func (c *ContentString) Values() []any {
	values := make([]any, len(c.Text))
	for i, unit := range c.Text {
		values[i] = jsjson.Str{unit}
	}
	return values
}

// splice turns both halves of a split surrogate pair into U+FFFD, keeping
// each side's unit count.
func (c *ContentString) splice(offset int) Content {
	right := &ContentString{Text: append(jsjson.Str{}, c.Text[offset:]...)}
	c.Text = append(jsjson.Str{}, c.Text[:offset]...)
	if offset > 0 && isHighSurrogate(c.Text[offset-1]) {
		c.Text[offset-1] = 0xfffd
		if len(right.Text) > 0 {
			right.Text[0] = 0xfffd
		} else {
			right.Text = jsjson.Str{0xfffd}
		}
	}
	return right
}

func (c *ContentString) write(w *writer, offset int) { w.WriteVarString(c.Text[offset:]) }

func isHighSurrogate(unit uint16) bool { return unit >= 0xd800 && unit <= 0xdbff }

// ContentEmbed (5) is one embedded value in a Y.Text, kept as raw JSON.
type ContentEmbed struct {
	noHooks
	unsplittable
	JSON jsjson.Str
}

func (*ContentEmbed) Ref() byte                { return 5 }
func (*ContentEmbed) Len() int                 { return 1 }
func (*ContentEmbed) Countable() bool          { return true }
func (c *ContentEmbed) Values() []any          { return []any{parseValidated(c.JSON)} }
func (c *ContentEmbed) copy() Content          { return c }
func (c *ContentEmbed) write(w *writer, _ int) { w.WriteVarString(c.JSON) }

// ContentFormat (6) is a formatting mark: a key and a raw JSON value. It
// occupies a tick and counts for nothing.
type ContentFormat struct {
	noHooks
	unsplittable
	Key  jsjson.Str
	JSON jsjson.Str
	// The value is parsed once per item: yjs compares marks with ===, which
	// for an object is identity.
	value  any
	parsed bool
}

func newLocalFormat(key jsjson.Str, value any) *ContentFormat {
	text, err := jsjson.Stringify(value)
	if err != nil {
		fail("%v", err)
	}
	return &ContentFormat{unsplittable: unsplittable{6}, Key: key, JSON: jsjson.FromString(text), value: value, parsed: true}
}

func (*ContentFormat) Ref() byte       { return 6 }
func (*ContentFormat) Len() int        { return 1 }
func (*ContentFormat) Countable() bool { return false }
func (*ContentFormat) Values() []any   { return nil }
func (c *ContentFormat) copy() Content { return c }

// Value is the parsed mark value.
func (c *ContentFormat) Value() any {
	if !c.parsed {
		c.value = parseValidated(c.JSON)
		c.parsed = true
	}
	return c.value
}

func (c *ContentFormat) write(w *writer, _ int) {
	w.WriteVarString(c.Key)
	w.WriteVarString(c.JSON)
}

// ContentAny (8) is a run of Any values, one tick each.
type ContentAny struct {
	noHooks
	Items []any
}

func (*ContentAny) Ref() byte       { return 8 }
func (c *ContentAny) Len() int      { return len(c.Items) }
func (*ContentAny) Countable() bool { return true }
func (c *ContentAny) Values() []any { return c.Items }
func (c *ContentAny) copy() Content { return &ContentAny{Items: c.Items} }

func (c *ContentAny) splice(offset int) Content {
	right := &ContentAny{Items: append([]any{}, c.Items[offset:]...)}
	c.Items = append([]any{}, c.Items[:offset]...)
	return right
}

func (c *ContentAny) write(w *writer, offset int) {
	w.WriteVarUint(uint64(len(c.Items) - offset))
	for _, item := range c.Items[offset:] {
		lib0.WriteAny(w, item)
	}
}

// Subdoc is a subdocument as a value: opaque, never a string.
type Subdoc struct {
	GUID    jsjson.Str
	Options any
}

// ContentDoc (9) is a subdocument: a guid and its Any options.
type ContentDoc struct {
	noHooks
	unsplittable
	GUID    jsjson.Str
	Options any
}

func (*ContentDoc) Ref() byte       { return 9 }
func (*ContentDoc) Len() int        { return 1 }
func (*ContentDoc) Countable() bool { return true }
func (c *ContentDoc) Values() []any { return []any{&Subdoc{GUID: c.GUID, Options: c.Options}} }
func (c *ContentDoc) copy() Content { return c }

func (c *ContentDoc) write(w *writer, _ int) {
	w.WriteVarString(c.GUID)
	lib0.WriteAny(w, c.Options)
}

// parseValidated parses JSON the decoder already validated.
func parseValidated(raw jsjson.Str) any {
	value, err := jsjson.Parse([]byte(raw.String()))
	if err != nil {
		fail("yjs: validated JSON did not parse: %v", err)
	}
	return value
}

// validateJSON refuses a payload no yjs peer's JSON.parse would read.
func validateJSON(raw jsjson.Str, position int, what string) {
	if _, err := jsjson.ParseNode([]byte(raw.String()), jsjson.Options{MaxDepth: JSONMaxDepth}); err != nil {
		panic(lib0.Errorf("yjs: the %s at %d is not JSON: %v", what, position, err))
	}
}
