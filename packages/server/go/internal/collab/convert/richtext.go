package convert

import (
	"errors"
	"slices"
	"sort"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Rich text segments ({text|embed, marks}) and the Y.XmlText delta, in the
// client's canonical form (C# RichText.cs, client rich-text.ts). The export,
// the echo check and the edit no-op check compare this form as JSON text.

var markOrder = []string{
	"link", "color", "background", "highlight", "bold", "italic", "underline",
	"strikethrough", "code", "sup", "sub",
}

var booleanMarks = []string{"highlight", "bold", "italic", "underline", "strikethrough", "code", "sup", "sub"}

// WriteOp is one insert that builds a formatted text from canonical segments.
type WriteOp struct {
	Insert     any // jsjson.Str, or an embed object
	Attributes *jsjson.Object
}

// Length is the op's length in Y.Text units.
func (op WriteOp) Length() int {
	if text, ok := op.Insert.(jsjson.Str); ok {
		return len(text)
	}
	return 1
}

func str(s string) jsjson.Str { return jsjson.FromString(s) }

func lookup(object *jsjson.Object, key string) (any, bool) {
	return object.Get(str(key))
}

func put(object *jsjson.Object, key string, value any) {
	object.Set(str(key), value)
}

// IsRichText is a value already in segment shape.
func IsRichText(value []any) bool {
	for _, item := range value {
		if !isSegment(item) {
			return false
		}
	}
	return true
}

// ReadInput reads segments a host sent, leniently, into canonical form.
func ReadInput(value []any) []any {
	segments := value
	if !IsRichText(value) {
		segments = readLeniently(value)
	}
	kept := make([]any, len(segments))
	for i, segment := range segments {
		kept[i] = dropUnknownMarks(segment)
	}
	return Canonicalize(kept)
}

// Canonicalize keeps only content and known marks in order, drops empty
// text and merges neighbouring runs with the same marks.
func Canonicalize(segments []any) []any {
	var result []*jsjson.Object
	for _, item := range segments {
		raw, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		segment := &jsjson.Object{}
		if content, ok := textOf(raw); ok {
			put(segment, "text", content)
		} else if embed, ok := lookup(raw, "embed"); ok && isEmbed(embed) {
			put(segment, "embed", embed)
		} else {
			continue
		}
		marks, _ := lookup(raw, "marks")
		record, _ := marks.(*jsjson.Object)
		if record == nil {
			record = &jsjson.Object{}
		}
		if ordered := orderMarks(record); ordered != nil {
			put(segment, "marks", ordered)
		}
		text, isText := textOf(segment)
		if isText && len(text) == 0 {
			continue
		}
		if isText && len(result) > 0 {
			last := result[len(result)-1]
			if previous, ok := textOf(last); ok && sameMarks(last, segment) {
				merged := &jsjson.Object{}
				for _, m := range last.Members() {
					merged.Set(m.Key, m.Value)
				}
				put(merged, "text", append(slices.Clone(previous), text...))
				result[len(result)-1] = merged
				continue
			}
		}
		result = append(result, segment)
	}
	array := make([]any, len(result))
	for i, segment := range result {
		array[i] = segment
	}
	return array
}

// FromDelta reads a live delta as canonical segments. It never changes the delta.
func FromDelta(delta []yjs.Delta) []any {
	var segments []any
	for _, op := range delta {
		segment := &jsjson.Object{}
		switch insert := op.Insert.(type) {
		case jsjson.Str:
			put(segment, "text", insert)
		case *jsjson.Object:
			if !isEmbed(insert) {
				continue
			}
			put(segment, "embed", insert)
		default:
			continue
		}
		if op.Attributes != nil && op.Attributes.Len() > 0 {
			put(segment, "marks", op.Attributes)
		}
		segments = append(segments, segment)
	}
	return Canonicalize(segments)
}

// ToWriteOps is one insert per canonical segment, with normalised marks.
func ToWriteOps(canonical []any) []WriteOp {
	ops := make([]WriteOp, 0, len(canonical))
	for _, item := range canonical {
		segment := item.(*jsjson.Object)
		marks, _ := lookup(segment, "marks")
		var insert any
		if text, ok := textOf(segment); ok {
			insert = text
		} else if embed, ok := lookup(segment, "embed"); ok {
			insert = embed
		} else {
			panic(errors.New("collab: a rich text segment has neither text nor embed"))
		}
		ops = append(ops, WriteOp{Insert: insert, Attributes: Normalize(marks)})
	}
	return ops
}

// Normalize is the marks a write carries: keys sorted, undefined dropped, NUL removed.
func Normalize(marks any) *jsjson.Object {
	if record, ok := marks.(*jsjson.Object); ok && record != nil {
		return NormalizeValue(record).(*jsjson.Object)
	}
	return &jsjson.Object{}
}

// NormalizeValue copies value with NUL removed from every string and key,
// undefined members dropped and object keys in UTF-16 order.
func NormalizeValue(value any) any {
	switch value := value.(type) {
	case jsjson.Str:
		return withoutNul(value)
	case []any:
		array := make([]any, len(value))
		for i, item := range value {
			array[i] = NormalizeValue(item)
		}
		return array
	case *jsjson.Object:
		type entry struct {
			key   jsjson.Str
			value any
		}
		var entries []entry
		for _, m := range value.Members() {
			if _, undefined := m.Value.(jsjson.Undefined); undefined {
				continue
			}
			entries = append(entries, entry{withoutNul(m.Key), m.Value})
		}
		sort.SliceStable(entries, func(i, j int) bool { return jsjson.Compare(entries[i].key, entries[j].key) < 0 })
		normalized := &jsjson.Object{}
		for _, e := range entries {
			normalized.Set(e.key, NormalizeValue(e.value))
		}
		return normalized
	}
	return value
}

func withoutNul(text jsjson.Str) jsjson.Str {
	if !slices.Contains(text, 0) {
		return text
	}
	out := make(jsjson.Str, 0, len(text))
	for _, unit := range text {
		if unit != 0 {
			out = append(out, unit)
		}
	}
	return out
}

// CanonicalMarks orders marks the canonical way, or nil when none survive.
func CanonicalMarks(marks any) *jsjson.Object {
	record, _ := marks.(*jsjson.Object)
	if record == nil {
		return nil
	}
	return orderMarks(record)
}

// SameValue compares as JSON text with object keys sorted, arrays included.
func SameValue(left, right any) bool {
	a, errA := jsjson.Stringify(sortDeep(left, true))
	b, errB := jsjson.Stringify(sortDeep(right, true))
	return errA == nil && errB == nil && a == b
}

func textOf(segment *jsjson.Object) (jsjson.Str, bool) {
	value, ok := lookup(segment, "text")
	if !ok {
		return nil, false
	}
	text, ok := value.(jsjson.Str)
	return text, ok
}

func isSegment(item any) bool {
	record, ok := item.(*jsjson.Object)
	if !ok {
		return false
	}
	text, hasText := lookup(record, "text")
	embed, hasEmbed := lookup(record, "embed")
	if hasText && hasEmbed {
		return false
	}
	if marks, ok := lookup(record, "marks"); ok {
		if _, isObject := marks.(*jsjson.Object); !isObject {
			return false
		}
	}
	if _, isText := text.(jsjson.Str); isText && hasOnlyKeys(record, "text") {
		return true
	}
	return isEmbed(embed) && hasOnlyKeys(record, "embed")
}

func present(record *jsjson.Object) []jsjson.Member {
	var members []jsjson.Member
	for _, m := range record.Members() {
		if _, undefined := m.Value.(jsjson.Undefined); !undefined {
			members = append(members, m)
		}
	}
	return members
}

func isEmbed(value any) bool {
	embed, ok := value.(*jsjson.Object)
	if !ok {
		return false
	}
	members := present(embed)
	if len(members) != 1 {
		return false
	}
	switch members[0].Key.String() {
	case "html":
		_, ok := members[0].Value.(jsjson.Str)
		return ok
	case "equation":
		return hasOneString(members[0].Value, "expression")
	case "page":
		return hasOneString(members[0].Value, "id")
	}
	return false
}

func hasOneString(value any, key string) bool {
	record, ok := value.(*jsjson.Object)
	if !ok {
		return false
	}
	members := present(record)
	if len(members) != 1 || members[0].Key.String() != key {
		return false
	}
	_, ok = members[0].Value.(jsjson.Str)
	return ok
}

func hasOnlyKeys(record *jsjson.Object, shapeKey string) bool {
	for _, m := range record.Members() {
		key := m.Key.String()
		if _, undefined := m.Value.(jsjson.Undefined); key != shapeKey && key != "marks" && !undefined {
			return false
		}
	}
	return true
}

func readLeniently(value []any) []any {
	var segments []any
	for _, item := range value {
		record, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		segment := &jsjson.Object{}
		if text, ok := lookup(record, "text"); ok {
			if _, isText := text.(jsjson.Str); isText {
				put(segment, "text", text)
			} else if !putEmbed(segment, record) {
				continue
			}
		} else if !putEmbed(segment, record) {
			continue
		}
		if marks, ok := lookup(record, "marks"); ok {
			if _, isObject := marks.(*jsjson.Object); isObject {
				put(segment, "marks", marks)
			}
		}
		segments = append(segments, segment)
	}
	return segments
}

func putEmbed(segment, record *jsjson.Object) bool {
	embed, ok := lookup(record, "embed")
	if !ok || !isEmbed(embed) {
		return false
	}
	put(segment, "embed", embed)
	return true
}

// isSafeTagName is segments-to-html.ts's tag name rule: ASCII, like JS /i.
func isSafeTagName(name jsjson.Str) bool {
	if len(name) == 0 || !(name[0] >= 'a' && name[0] <= 'z' || name[0] >= 'A' && name[0] <= 'Z') {
		return false
	}
	for _, c := range name[1:] {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

func dropUnknownMarks(item any) any {
	segment, ok := item.(*jsjson.Object)
	if !ok {
		return item
	}
	marks, ok := lookup(segment, "marks")
	record, isObject := marks.(*jsjson.Object)
	if !ok || !isObject {
		return item
	}
	kept := &jsjson.Object{}
	for _, m := range record.Members() {
		key := m.Key.String()
		var keep bool
		if tag, isTag := tagName(m.Key); isTag {
			keep = isSafeTagName(tag)
		} else {
			keep = slices.Contains(markOrder, key)
		}
		if keep {
			kept.Set(m.Key, m.Value)
		}
	}
	result := &jsjson.Object{}
	for _, m := range segment.Members() {
		if m.Key.String() == "marks" {
			result.Set(m.Key, kept)
		} else {
			result.Set(m.Key, m.Value)
		}
	}
	return result
}

// tagName is the name after "tag:", compared by units.
func tagName(key jsjson.Str) (jsjson.Str, bool) {
	prefix := str("tag:")
	if len(key) >= len(prefix) && slices.Equal(key[:len(prefix)], prefix) {
		return key[len(prefix):], true
	}
	return nil, false
}

func orderMarks(record *jsjson.Object) *jsjson.Object {
	var unknown []jsjson.Str
	for _, m := range record.Members() {
		if !slices.Contains(markOrder, m.Key.String()) {
			unknown = append(unknown, m.Key)
		}
	}
	sort.SliceStable(unknown, func(i, j int) bool { return jsjson.Compare(unknown[i], unknown[j]) < 0 })
	keys := make([]jsjson.Str, 0, len(markOrder)+len(unknown))
	for _, key := range markOrder {
		keys = append(keys, str(key))
	}
	keys = append(keys, unknown...)
	ordered := &jsjson.Object{}
	for _, key := range keys {
		raw, ok := record.Get(key)
		if !ok {
			continue
		}
		if value, keep := markValue(key, raw); keep {
			ordered.Set(key, value)
		}
	}
	if ordered.Len() == 0 {
		return nil
	}
	return ordered
}

func markValue(key jsjson.Str, raw any) (any, bool) {
	if _, undefined := raw.(jsjson.Undefined); undefined {
		return nil, false
	}
	name := key.String()
	if name == "link" {
		link, ok := raw.(*jsjson.Object)
		if !ok {
			return nil, false
		}
		href, ok := lookup(link, "href")
		if _, isText := href.(jsjson.Str); !ok || !isText {
			return nil, false
		}
		canonical := &jsjson.Object{}
		put(canonical, "href", href)
		for _, extra := range []string{"target", "rel"} {
			if value, ok := lookup(link, extra); ok {
				if _, isText := value.(jsjson.Str); isText {
					put(canonical, extra, value)
				}
			}
		}
		return canonical, true
	}
	if slices.Contains(booleanMarks, name) {
		return true, raw == true
	}
	if raw == nil {
		return nil, false
	}
	// The client's HTML writer escapes these with string calls.
	if name == "color" || name == "background" {
		_, ok := raw.(jsjson.Str)
		return raw, ok
	}
	if _, isTag := tagName(key); isTag {
		attributes, ok := raw.(*jsjson.Object)
		if !ok {
			return nil, false
		}
		var members []jsjson.Member
		for _, m := range attributes.Members() {
			if _, isText := m.Value.(jsjson.Str); isText {
				members = append(members, m)
			}
		}
		sort.SliceStable(members, func(i, j int) bool { return jsjson.Compare(members[i].Key, members[j].Key) < 0 })
		sorted := &jsjson.Object{}
		for _, m := range members {
			sorted.Set(m.Key, m.Value)
		}
		return sorted, true
	}
	return raw, true
}

func sameMarks(left, right *jsjson.Object) bool {
	leftMarks, _ := lookup(left, "marks")
	rightMarks, _ := lookup(right, "marks")
	if leftMarks == nil {
		leftMarks = &jsjson.Object{}
	}
	if rightMarks == nil {
		rightMarks = &jsjson.Object{}
	}
	a, errA := jsjson.Stringify(sortDeep(leftMarks, false))
	b, errB := jsjson.Stringify(sortDeep(rightMarks, false))
	return errA == nil && errB == nil && a == b
}

func sortDeep(value any, intoArrays bool) any {
	switch value := value.(type) {
	case *jsjson.Object:
		members := slices.Clone(value.Members())
		sort.SliceStable(members, func(i, j int) bool { return jsjson.Compare(members[i].Key, members[j].Key) < 0 })
		sorted := &jsjson.Object{}
		for _, m := range members {
			sorted.Set(m.Key, sortDeep(m.Value, intoArrays))
		}
		return sorted
	case []any:
		if !intoArrays {
			return value
		}
		array := make([]any, len(value))
		for i, item := range value {
			array[i] = sortDeep(item, intoArrays)
		}
		return array
	}
	return value
}
