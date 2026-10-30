package yjs

import (
	"errors"
	"fmt"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// must unwraps a reader result inside a decode; recoverFormat turns the
// panic back into an error at the decode's edge.
func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}

func recoverFormat(err *error) {
	if recovered := recover(); recovered != nil {
		failure, ok := recovered.(error)
		if !ok || !errors.Is(failure, lib0.ErrFormat) {
			panic(recovered)
		}
		*err = failure
	}
}

// StructKind tells decoded structs apart.
type StructKind uint8

// The decoded struct kinds.
const (
	KindItem StructKind = iota
	KindGC
	KindSkip
)

// DecodedStruct is one struct as the wire spelled it. Info is the raw info
// byte: an item can arrive flagged with a parentSub it does not carry.
type DecodedStruct struct {
	ID          ID
	Length      int
	Kind        StructKind
	Origin      *ID
	RightOrigin *ID
	ParentRoot  *jsjson.Str
	ParentID    *ID
	ParentSub   *jsjson.Str
	Content     Content
	Info        byte
}

// ClientStructs is one client group of an update.
type ClientStructs struct {
	Client  uint64
	Structs []*DecodedStruct
}

// DecodedUpdate is a v1 update parsed and not yet applied. Groups keep the
// update's own order, which keeps a decode then re-encode byte-identical.
type DecodedUpdate struct {
	Groups          []ClientStructs
	DeleteSet       *DeleteSet
	MaxNestingDepth int
}

// Decode reads a whole v1 update and refuses anything unexpected: a client
// listed twice, trailing bytes (which is how a v2 update fails), a length
// past int32. 00 00 is the valid empty update.
func Decode(update []byte) (decoded *DecodedUpdate, err error) {
	defer recoverFormat(&err)
	r := lib0.NewReader(update)
	decoded = &DecodedUpdate{}
	seen := map[uint64]bool{}
	groups := must(r.ReadVarUint())
	for range groups {
		// Never preallocate from the wire's count.
		count := must(r.ReadVarUint())
		client := must(r.ReadVarUint())
		clock := must(r.ReadVarUint())
		if seen[client] {
			panic(lib0.Errorf("yjs: client %d is listed twice; a v1 update lists each client once.", client))
		}
		seen[client] = true
		var structs []*DecodedStruct
		for range count {
			read := readStruct(r, client, clock)
			structs = append(structs, read)
			clock += uint64(read.Length)
		}
		decoded.Groups = append(decoded.Groups, ClientStructs{Client: client, Structs: structs})
	}
	decoded.DeleteSet = readDeleteSet(r)
	if !r.AtEnd() {
		panic(lib0.Errorf("yjs: %d bytes follow the delete set.", r.Len()-r.Pos()))
	}
	decoded.MaxNestingDepth = measureNesting(decoded.Groups)
	return decoded, nil
}

func readStruct(r *lib0.Reader, client, clock uint64) *DecodedStruct {
	info := must(r.ReadUint8())
	id := ID{client, clock}
	switch info & contentRefMask {
	case 0:
		return &DecodedStruct{ID: id, Length: readLength(r, "GC length"), Kind: KindGC, Info: info}
	case 10:
		// A raw varuint: it stands for a gap no run-length scheme predicts.
		return &DecodedStruct{ID: id, Length: readLength(r, "Skip length"), Kind: KindSkip, Info: info}
	}
	return readItem(r, id, info)
}

func readID(r *lib0.Reader) *ID {
	client := must(r.ReadVarUint())
	return &ID{client, must(r.ReadVarUint())}
}

func readItem(r *lib0.Reader, id ID, info byte) *DecodedStruct {
	decoded := &DecodedStruct{ID: id, Kind: KindItem, Info: info}
	if info&originBit != 0 {
		decoded.Origin = readID(r)
	}
	if info&rightOriginBit != 0 {
		decoded.RightOrigin = readID(r)
	}
	// Parent and parentSub are on the wire only when neither origin is.
	if decoded.Origin == nil && decoded.RightOrigin == nil {
		switch parentInfo := must(r.ReadVarUint()); parentInfo {
		case 1:
			root := must(r.ReadVarString())
			decoded.ParentRoot = &root
		case 0:
			decoded.ParentID = readID(r)
		default:
			panic(lib0.Errorf("yjs: the parent info at %d is %d; a v1 update writes 1 for a root name and 0 for a parent id.", r.Pos(), parentInfo))
		}
		if info&parentSubBit != 0 {
			sub := must(r.ReadVarString())
			decoded.ParentSub = &sub
		}
	}
	decoded.Content = readContent(info, r)
	if deleted, ok := decoded.Content.(*ContentDeleted); ok && deleted.ticks == 0 {
		// yjs throws on this one mid-apply; refusing it here leaves the doc as it was.
		panic(lib0.Errorf("yjs: the deleted item at %d:%d has length 0.", id.Client, id.Clock))
	}
	decoded.Length = decoded.Content.Len()
	return decoded
}

// readLength guards a count the engine holds in an int32, as C# does.
func readLength(r *lib0.Reader, what string) int {
	value := must(r.ReadVarUint())
	if value > 1<<31-1 {
		panic(lib0.Errorf("yjs: the %s at %d is %d, past int.MaxValue.", what, r.Pos(), value))
	}
	return int(value)
}

func readJSON(r *lib0.Reader, what string) jsjson.Str {
	raw := must(r.ReadVarString())
	validateJSON(raw, r.Pos(), what)
	return raw
}

func readContent(info byte, r *lib0.Reader) Content {
	switch ref := info & contentRefMask; ref {
	case 1:
		return &ContentDeleted{ticks: readLength(r, "ContentDeleted length")}
	case 2:
		count := readLength(r, "ContentJSON element count")
		content := &ContentJSON{}
		for range count {
			raw := must(r.ReadVarString())
			// 'undefined' is yjs's sentinel and deliberately not JSON.
			if raw.String() != "undefined" {
				validateJSON(raw, r.Pos(), "ContentJSON element")
			}
			content.Raw = append(content.Raw, raw)
		}
		return content
	case 3:
		return &ContentBinary{unsplittable: unsplittable{3}, Bytes: append([]byte{}, must(r.ReadVarBytes())...)}
	case 4:
		return &ContentString{Text: must(r.ReadVarString())}
	case 5:
		return &ContentEmbed{unsplittable: unsplittable{5}, JSON: readJSON(r, "ContentEmbed")}
	case 6:
		key := must(r.ReadVarString())
		return &ContentFormat{unsplittable: unsplittable{6}, Key: key, JSON: readJSON(r, "ContentFormat")}
	case 7:
		return readContentType(r)
	case 8:
		count := readLength(r, "ContentAny element count")
		content := &ContentAny{}
		for range count {
			content.Items = append(content.Items, must(lib0.ReadAny(r)))
		}
		return content
	case 9:
		guid := must(r.ReadVarString())
		options := must(lib0.ReadAny(r))
		// yjs spreads these into a Doc constructor, so null and undefined
		// are a TypeError on every yjs peer.
		switch options.(type) {
		case nil:
			panic(lib0.Errorf("yjs: the subdocument options at %d are null; yjs writes an object.", r.Pos()))
		case jsjson.Undefined:
			panic(lib0.Errorf("yjs: the subdocument options at %d are undefined; yjs writes an object.", r.Pos()))
		}
		return &ContentDoc{unsplittable: unsplittable{9}, GUID: guid, Options: options}
	default:
		panic(lib0.Errorf("yjs: %d at %d is not an item content ref.", ref, r.Pos()-1))
	}
}

// ContainsNul reports a NUL in any string the update carries. It never
// refuses.
func (u *DecodedUpdate) ContainsNul() bool {
	for _, group := range u.Groups {
		for _, decoded := range group.Structs {
			if hasNul(decoded.ParentRoot) || hasNul(decoded.ParentSub) ||
				(decoded.Content != nil && contentHasNul(decoded.Content)) {
				return true
			}
		}
	}
	return false
}

func hasNul(value *jsjson.Str) bool {
	return value != nil && unitsHaveNul(*value)
}

func unitsHaveNul(value jsjson.Str) bool {
	for _, unit := range value {
		if unit == 0 {
			return true
		}
	}
	return false
}

func contentHasNul(content Content) bool {
	switch content := content.(type) {
	case *ContentString:
		return unitsHaveNul(content.Text)
	case *ContentFormat:
		return unitsHaveNul(content.Key) || unitsHaveNul(content.JSON)
	case *ContentEmbed:
		return unitsHaveNul(content.JSON)
	case *ContentJSON:
		for _, raw := range content.Raw {
			if unitsHaveNul(raw) {
				return true
			}
		}
	case *ContentType:
		return hasNul(content.Name)
	case *ContentDoc:
		return unitsHaveNul(content.GUID) || anyHasNul(content.Options)
	case *ContentAny:
		for _, item := range content.Items {
			if anyHasNul(item) {
				return true
			}
		}
	}
	return false
}

func anyHasNul(value any) bool {
	pending := []any{value}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch current := current.(type) {
		case jsjson.Str:
			if unitsHaveNul(current) {
				return true
			}
		case *jsjson.Object:
			for _, member := range current.Members() {
				if unitsHaveNul(member.Key) {
					return true
				}
				pending = append(pending, member.Value)
			}
		case []any:
			pending = append(pending, current...)
		}
	}
	return false
}

// measureNesting is the deepest Any nesting in ContentAny and ContentDoc.
// Raw JSON is not measured.
func measureNesting(groups []ClientStructs) int {
	deepest := 0
	for _, group := range groups {
		for _, decoded := range group.Structs {
			switch content := decoded.Content.(type) {
			case *ContentAny:
				for _, item := range content.Items {
					deepest = max(deepest, anyDepth(item))
				}
			case *ContentDoc:
				deepest = max(deepest, anyDepth(content.Options))
			}
		}
	}
	return deepest
}

func anyDepth(value any) int {
	type frame struct {
		value any
		depth int
	}
	deepest := 0
	pending := []frame{{value, 0}}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch v := current.value.(type) {
		case *jsjson.Object:
			deepest = max(deepest, current.depth+1)
			for _, member := range v.Members() {
				pending = append(pending, frame{member.Value, current.depth + 1})
			}
		case []any:
			deepest = max(deepest, current.depth+1)
			for _, item := range v {
				pending = append(pending, frame{item, current.depth + 1})
			}
		}
	}
	return deepest
}

// Verdict is UpdateInspector's answer.
type Verdict uint8

// The verdicts.
const (
	VerdictOK Verdict = iota
	VerdictMalformed
	VerdictTooDeep
)

// Inspection is a verdict with its reason and, when OK, the decoded update.
type Inspection struct {
	Verdict Verdict
	Reason  string
	Decoded *DecodedUpdate
}

// DefaultInspectDepth is the room's nesting cap.
const DefaultInspectDepth = 256

// Inspect decodes once and judges the update.
func Inspect(update []byte, maxDepth int) Inspection {
	decoded, err := Decode(update)
	if err != nil {
		return Inspection{Verdict: VerdictMalformed, Reason: err.Error()}
	}
	if decoded.MaxNestingDepth > maxDepth {
		return Inspection{
			Verdict: VerdictTooDeep,
			Reason:  fmt.Sprintf("yjs: a value nests %d levels, past the %d allowed.", decoded.MaxNestingDepth, maxDepth),
		}
	}
	return Inspection{Verdict: VerdictOK, Decoded: decoded}
}
