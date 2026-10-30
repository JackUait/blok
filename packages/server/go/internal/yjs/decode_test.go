package yjs

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

const pinnedClient = 1000

func s(text string) jsjson.Str { return jsjson.FromString(text) }

func obj(pairs ...any) *jsjson.Object {
	object := &jsjson.Object{}
	for i := 0; i < len(pairs); i += 2 {
		object.Set(s(pairs[i].(string)), pairs[i+1])
	}
	return object
}

func fixtureCases(t *testing.T, file string) []any {
	t.Helper()
	cases, err := yjstest.Cases(file)
	if err != nil {
		t.Fatal(err)
	}
	return cases
}

func fixtureCase(t *testing.T, file, name string) any {
	t.Helper()
	for _, c := range fixtureCases(t, file) {
		if yjstest.String(c, "name") == name {
			return c
		}
	}
	t.Fatalf("%s has no case %s", file, name)
	return nil
}

func fixtureBytes(t *testing.T, value any, key string) []byte {
	t.Helper()
	data, err := yjstest.Bytes(value, key)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func canonical(t *testing.T, value any) string {
	t.Helper()
	text, err := yjstest.Canonical(value)
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func mustDecode(t *testing.T, update []byte) *DecodedUpdate {
	t.Helper()
	decoded, err := Decode(update)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func renderID(id *ID) any {
	if id == nil {
		return nil
	}
	return obj("client", float64(id.Client), "clock", float64(id.Clock))
}

func parseRaw(t *testing.T, raw jsjson.Str) any {
	t.Helper()
	value, err := jsjson.Parse([]byte(raw.String()))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func renderContent(t *testing.T, content Content) any {
	rendered := obj("ref", float64(content.Ref()))
	switch c := content.(type) {
	case *ContentDeleted:
		rendered.Set(s("len"), float64(c.Len()))
	case *ContentJSON:
		items := []any{}
		for _, raw := range c.Raw {
			if raw.String() == "undefined" {
				items = append(items, obj("$undefined", true))
			} else {
				items = append(items, parseRaw(t, raw))
			}
		}
		rendered.Set(s("arr"), items)
	case *ContentBinary:
		rendered.Set(s("bytes"), s(base64.StdEncoding.EncodeToString(c.Bytes)))
	case *ContentString:
		rendered.Set(s("str"), c.Text)
	case *ContentEmbed:
		rendered.Set(s("embed"), parseRaw(t, c.JSON))
	case *ContentFormat:
		rendered.Set(s("key"), c.Key)
		rendered.Set(s("value"), parseRaw(t, c.JSON))
	case *ContentType:
		rendered.Set(s("typeRef"), float64(c.TypeRef))
		if c.Name != nil {
			key := "hookName"
			if c.TypeRef == 3 {
				key = "nodeName"
			}
			rendered.Set(s(key), *c.Name)
		}
	case *ContentAny:
		items := []any{}
		for _, item := range c.Items {
			items = append(items, yjstest.ToFixture(item))
		}
		rendered.Set(s("arr"), items)
	case *ContentDoc:
		rendered.Set(s("guid"), c.GUID)
		rendered.Set(s("opts"), yjstest.ToFixture(c.Options))
	default:
		t.Fatalf("%T is not a content", content)
	}
	return rendered
}

func renderDecoded(t *testing.T, update *DecodedUpdate) any {
	structs := []any{}
	for _, group := range update.Groups {
		for _, d := range group.Structs {
			kind := map[StructKind]string{KindItem: "item", KindGC: "gc", KindSkip: "skip"}[d.Kind]
			rendered := obj("kind", s(kind), "client", float64(d.ID.Client), "clock", float64(d.ID.Clock), "length", float64(d.Length))
			if d.Kind == KindItem {
				rendered.Set(s("origin"), renderID(d.Origin))
				rendered.Set(s("rightOrigin"), renderID(d.RightOrigin))
				var parent any
				switch {
				case d.ParentRoot != nil:
					parent = obj("root", *d.ParentRoot)
				case d.ParentID != nil:
					parent = obj("item", renderID(d.ParentID))
				}
				rendered.Set(s("parent"), parent)
				var sub any
				if d.ParentSub != nil {
					sub = *d.ParentSub
				}
				rendered.Set(s("parentSub"), sub)
				rendered.Set(s("content"), renderContent(t, d.Content))
			}
			structs = append(structs, rendered)
		}
	}
	deleteSet := &jsjson.Object{}
	for _, client := range update.DeleteSet.Clients() {
		ranges := []any{}
		for _, r := range update.DeleteSet.Ranges(client) {
			ranges = append(ranges, []any{float64(r.Clock), float64(r.Length)})
		}
		deleteSet.Set(s(strconv.FormatUint(client, 10)), ranges)
	}
	return obj("structs", structs, "deleteSet", deleteSet)
}

// reEncode writes a decoded update back through the engine's own struct
// writers, groups in the update's order.
func reEncode(update *DecodedUpdate) []byte {
	w := &writer{}
	w.WriteVarUint(uint64(len(update.Groups)))
	for _, group := range update.Groups {
		w.WriteVarUint(uint64(len(group.Structs)))
		w.WriteVarUint(group.Client)
		if len(group.Structs) > 0 {
			w.WriteVarUint(group.Structs[0].ID.Clock)
		} else {
			w.WriteVarUint(0)
		}
		for _, d := range group.Structs {
			toRuntimeStruct(d).write(w, 0)
		}
	}
	update.DeleteSet.write(w)
	return w.Bytes()
}

func TestDecodesEveryStructsGolden(t *testing.T) {
	cases := fixtureCases(t, "structs.json")
	if len(cases) == 0 {
		t.Fatal("no structs cases")
	}
	for _, c := range cases {
		name := yjstest.String(c, "name")
		decoded := mustDecode(t, fixtureBytes(t, c, "update"))
		if got, want := canonical(t, renderDecoded(t, decoded)), canonical(t, yjstest.Field(c, "decoded")); got != want {
			t.Errorf("%s:\n got %s\nwant %s", name, got, want)
		}
	}
}

var reasonText = map[string]string{
	"eos":                  "remain",
	"integer-out-of-range": "above 2^53-1",
	"invalid-utf8":         "is not UTF-8",
	"trailing-bytes":       "follow the delete set",
	"duplicate-client":     "is listed twice",
	"unknown-content-ref":  "is not an item content ref",
	"v2-update":            "follow the delete set",
	"empty-struct":         "has length 0",
}

func TestRejectsEveryNegativeGolden(t *testing.T) {
	cases := fixtureCases(t, "negative.json")
	if len(cases) != 9 {
		t.Fatalf("want 9 negative cases, got %d", len(cases))
	}
	for _, c := range cases {
		name, reason := yjstest.String(c, "name"), yjstest.String(c, "reason")
		_, err := Decode(fixtureBytes(t, c, "update"))
		if !errors.Is(err, lib0.ErrFormat) || !strings.Contains(err.Error(), reasonText[reason]) {
			t.Errorf("%s: got %v, want a format error containing %q", name, err, reasonText[reason])
		}
		inspection := Inspect(fixtureBytes(t, c, "update"), DefaultInspectDepth)
		if inspection.Verdict != VerdictMalformed || inspection.Reason == "" || inspection.Decoded != nil {
			t.Errorf("%s: inspection %+v", name, inspection)
		}
	}
}

// yrs writes these two with integer tags yjs would write as floats, so
// only their decoded form survives a rewrite.
var yrsIntegerTagCases = []string{"array-kinds", "edit-metadata"}

func TestDecodeThenWriteIsByteIdentical(t *testing.T) {
	for _, file := range []string{"structs.json", "yrs-compat.json"} {
		for _, c := range fixtureCases(t, file) {
			name := yjstest.String(c, "name")
			update := fixtureBytes(t, c, "update")
			decoded := mustDecode(t, update)
			written := reEncode(decoded)
			if file == "structs.json" || !slices.Contains(yrsIntegerTagCases, name) {
				if !bytes.Equal(written, update) {
					t.Errorf("%s:%s: rewrite differs", file, name)
				}
			}
			if canonical(t, renderDecoded(t, decoded)) != canonical(t, renderDecoded(t, mustDecode(t, written))) {
				t.Errorf("%s:%s: rewrite decodes differently", file, name)
			}
			if file == "yrs-compat.json" && decoded.ContainsNul() {
				t.Errorf("%s: decoded a NUL its seed refused", name)
			}
		}
	}
}

func collabUpdates(t *testing.T) map[string][]byte {
	t.Helper()
	root, err := yjstest.RepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "test", "unit", "server-conformance", "fixtures", "collab")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	updates := map[string][]byte{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		text, err := os.ReadFile(filepath.Join(dir, entry.Name(), "update.b64"))
		if err != nil {
			t.Fatal(err)
		}
		update, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(text)))
		if err != nil {
			t.Fatal(err)
		}
		updates[entry.Name()] = update
	}
	if len(updates) != 31 {
		t.Fatalf("want 31 collab fixtures, got %d", len(updates))
	}
	return updates
}

func TestDecodesAndInspectsEveryCollabFixture(t *testing.T) {
	for name, update := range collabUpdates(t) {
		if written := reEncode(mustDecode(t, update)); !bytes.Equal(written, update) {
			t.Errorf("%s: rewrite differs", name)
		}
		inspection := Inspect(update, DefaultInspectDepth)
		if inspection.Verdict != VerdictOK || inspection.Reason != "" || inspection.Decoded == nil {
			t.Errorf("%s: inspection %+v", name, inspection)
		}
	}
}

func TestParentIsAbsentWhenAnOriginBitIsSet(t *testing.T) {
	decoded := mustDecode(t, fixtureBytes(t, fixtureCase(t, "structs.json", "map-key-overwrite"), "update"))
	overwrite := decoded.Groups[0].Structs[1]
	if overwrite.Origin == nil || overwrite.ParentRoot != nil || overwrite.ParentID != nil || overwrite.ParentSub != nil {
		t.Fatalf("%+v", overwrite)
	}
	if overwrite.Info&parentSubBit == 0 || overwrite.Info&originBit == 0 {
		t.Fatalf("info %x", overwrite.Info)
	}
}

// rawStruct is one struct for client 1000 at clock 0, then an empty
// delete set.
func rawStruct(info byte, body func(w *writer)) []byte {
	w := &writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(1)
	w.WriteVarUint(pinnedClient)
	w.WriteVarUint(0)
	w.WriteUint8(info)
	body(w)
	w.WriteVarUint(0)
	return w.Bytes()
}

func singleStruct(ref byte, root string, parentSub *string, content func(w *writer)) []byte {
	info := ref
	if parentSub != nil {
		info |= parentSubBit
	}
	return rawStruct(info, func(w *writer) {
		w.WriteVarUint(1)
		w.WriteVarString(s(root))
		if parentSub != nil {
			w.WriteVarString(s(*parentSub))
		}
		content(w)
	})
}

func ptr(text string) *string { return &text }

func mapKey(key, value, root string) []byte {
	return singleStruct(0x08, root, ptr(key), func(w *writer) {
		w.WriteVarUint(1)
		lib0.WriteAny(w, s(value))
	})
}

func assertRefused(t *testing.T, reason string, update []byte) {
	t.Helper()
	_, err := Decode(update)
	if !errors.Is(err, lib0.ErrFormat) || !strings.Contains(err.Error(), reason) {
		t.Errorf("got %v, want a format error containing %q", err, reason)
	}
}

func TestSkipLengthIsARawVarUint(t *testing.T) {
	w := &writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(2)
	w.WriteVarUint(pinnedClient)
	w.WriteVarUint(0)
	w.WriteUint8(10)
	w.WriteVarUint(300)
	w.WriteUint8(0x08)
	w.WriteVarUint(1)
	w.WriteVarString(s("m"))
	w.WriteVarUint(1)
	lib0.WriteAny(w, s("v"))
	w.WriteVarUint(0)
	structs := mustDecode(t, w.Bytes()).Groups[0].Structs
	if structs[0].Kind != KindSkip || structs[0].Length != 300 || structs[1].ID.Clock != 300 {
		t.Fatalf("%+v %+v", structs[0], structs[1])
	}
}

func nulBearingUpdates() map[string][]byte {
	return map[string][]byte{
		"a root name":        mapKey("k", "v", "r\x00t"),
		"a parentSub":        mapKey("k\x00", "v", "m"),
		"an Any string leaf": mapKey("k", "v\x00v", "m"),
		"an Any object key": singleStruct(0x08, "m", ptr("k"), func(w *writer) {
			w.WriteVarUint(1)
			w.WriteUint8(118)
			w.WriteVarUint(1)
			w.WriteVarString(s("n\x00l"))
			w.WriteUint8(126)
		}),
		"ContentString": singleStruct(0x04, "t", nil, func(w *writer) { w.WriteVarString(s("a\x00b")) }),
		"a ContentFormat key": singleStruct(0x06, "t", nil, func(w *writer) {
			w.WriteVarString(s("b\x00d"))
			w.WriteVarString(s("true"))
		}),
		"an XmlElement node name": singleStruct(0x07, "m", ptr("k"), func(w *writer) {
			w.WriteVarUint(3)
			w.WriteVarString(s("d\x00v"))
		}),
		"a ContentDoc guid": singleStruct(0x09, "m", ptr("k"), func(w *writer) {
			w.WriteVarString(s("g\x00d"))
			w.WriteUint8(118)
			w.WriteVarUint(0)
		}),
	}
}

func jsonPayloadUpdates() map[string][]byte {
	return map[string][]byte{
		"a ContentEmbed payload": singleStruct(0x05, "t", nil, func(w *writer) { w.WriteVarString(s(`"a\u0000b"`)) }),
		"a ContentJSON payload": singleStruct(0x02, "m", ptr("k"), func(w *writer) {
			w.WriteVarUint(1)
			w.WriteVarString(s(`"a\u0000b"`))
		}),
	}
}

func TestContainsNulSeesKeysValuesAndParentSub(t *testing.T) {
	if mustDecode(t, mapKey("k", "v", "m")).ContainsNul() {
		t.Fatal("a NUL-free update reports one")
	}
	for what, update := range nulBearingUpdates() {
		if !mustDecode(t, update).ContainsNul() {
			t.Errorf("the NUL in %s went unseen", what)
		}
	}
	canary, _ := base64.StdEncoding.DecodeString("AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE" +
		"dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk" +
		"cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA")
	inspection := Inspect(canary, DefaultInspectDepth)
	if inspection.Verdict != VerdictOK || !inspection.Decoded.ContainsNul() {
		t.Fatalf("canary: %+v", inspection)
	}
}

func TestEveryHandBuiltContentRefSurvivesAWriteBack(t *testing.T) {
	all := nulBearingUpdates()
	for what, update := range jsonPayloadUpdates() {
		all[what] = update
	}
	for what, update := range all {
		if written := reEncode(mustDecode(t, update)); !bytes.Equal(written, update) {
			t.Errorf("the update carrying %s did not write back byte for byte", what)
		}
	}
}

func TestContentWritesOnlyTheTailAtAnOffset(t *testing.T) {
	for _, c := range []struct{ whole, tail Content }{
		{&ContentString{Text: s("hello")}, &ContentString{Text: s("llo")}},
		{&ContentAny{Items: []any{s("a"), s("b"), s("c")}}, &ContentAny{Items: []any{s("c")}}},
		{&ContentJSON{Raw: []jsjson.Str{s("1"), s("2"), s("3")}}, &ContentJSON{Raw: []jsjson.Str{s("3")}}},
		{&ContentDeleted{ticks: 5}, &ContentDeleted{ticks: 3}},
	} {
		written, expected := &writer{}, &writer{}
		c.whole.write(written, 2)
		c.tail.write(expected, 0)
		if !bytes.Equal(written.Bytes(), expected.Bytes()) {
			t.Errorf("%T: %x, want %x", c.whole, written.Bytes(), expected.Bytes())
		}
	}
}

func TestRefusesWireValuesNoEncoderWrites(t *testing.T) {
	assertRefused(t, "the parent info", rawStruct(0x08, func(w *writer) {
		w.WriteVarUint(2)
		w.WriteVarString(s("m"))
		w.WriteVarUint(1)
		lib0.WriteAny(w, s("v"))
	}))
	assertRefused(t, "is not a shared type ref", singleStruct(0x07, "m", ptr("k"), func(w *writer) { w.WriteVarUint(7) }))
	assertRefused(t, "past int.MaxValue", rawStruct(0, func(w *writer) { w.WriteVarUint(1 << 32) }))
	// The boundary: 2^31-1 reads, 2^31 does not.
	assertRefused(t, "past int.MaxValue", rawStruct(0, func(w *writer) { w.WriteVarUint(1 << 31) }))
	if _, err := Decode(rawStruct(0, func(w *writer) { w.WriteVarUint(1<<31 - 1) })); err != nil {
		t.Errorf("2^31-1: %v", err)
	}
	assertRefused(t, "subdocument options", singleStruct(0x09, "m", ptr("k"), func(w *writer) {
		w.WriteVarString(s("g"))
		w.WriteUint8(126)
	}))
	assertRefused(t, "subdocument options", singleStruct(0x09, "m", ptr("k"), func(w *writer) {
		w.WriteVarString(s("g"))
		w.WriteUint8(127)
	}))
}

func TestRefusesRawJSONContentNoYjsPeerCanParse(t *testing.T) {
	assertRefused(t, "is not JSON", singleStruct(0x02, "m", ptr("k"), func(w *writer) {
		w.WriteVarUint(1)
		w.WriteVarString(s("{not json"))
	}))
	assertRefused(t, "is not JSON", singleStruct(0x05, "m", ptr("k"), func(w *writer) { w.WriteVarString(s("nope")) }))
	assertRefused(t, "is not JSON", singleStruct(0x06, "m", ptr("k"), func(w *writer) {
		w.WriteVarString(s("bold"))
		w.WriteVarString(s("nope"))
	}))
}

func embedUpdate(json string) []byte {
	return singleStruct(0x05, "m", ptr("k"), func(w *writer) { w.WriteVarString(s(json)) })
}

func TestAcceptsEveryRawJSONPayloadABrowserAccepts(t *testing.T) {
	for _, json := range []string{`"\ud800"`, `{"a":1,"a":2}`, `1e999`, `[[[[[[[[[[1]]]]]]]]]]`, `"undefined"`} {
		if _, err := Decode(embedUpdate(json)); err != nil {
			t.Errorf("%s: %v", json, err)
		}
	}
}

func TestRawJSONDepthIs512(t *testing.T) {
	deep := func(depth int) string { return strings.Repeat("[", depth) + "1" + strings.Repeat("]", depth) }
	decoded, err := Decode(embedUpdate(deep(512)))
	if err != nil {
		t.Fatalf("512: %v", err)
	}
	if decoded.Groups[0].Structs[0].Content.Values()[0] == nil {
		t.Fatal("512: no value read back")
	}
	assertRefused(t, "is not JSON", embedUpdate(deep(513)))
}

func TestWireJSONReadsBackAsEngineValuesEvenWithALoneSurrogate(t *testing.T) {
	embed := (&ContentEmbed{JSON: s(`"\ud800"`)}).Values()[0]
	if text, ok := embed.(jsjson.Str); !ok || len(text) != 1 || text[0] != 0xd800 {
		t.Fatalf("embed %#v", embed)
	}
	legacy := (&ContentJSON{Raw: []jsjson.Str{s(`{"a":"\ud800"}`), s("[1,2]"), s("undefined")}}).Values()
	if text, _ := jsjson.Stringify(legacy[0]); text != `{"a":"\ud800"}` {
		t.Errorf("object: %s", text)
	}
	if text, _ := jsjson.Stringify(legacy[1]); text != "[1,2]" {
		t.Errorf("array: %s", text)
	}
	if legacy[2] != (jsjson.Undefined{}) {
		t.Errorf("undefined: %#v", legacy[2])
	}
}

func nestedArrayUpdate(depth int) []byte {
	w := &writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(1)
	w.WriteVarUint(pinnedClient)
	w.WriteVarUint(0)
	w.WriteUint8(0x28)
	w.WriteVarUint(1)
	w.WriteVarString(s("m"))
	w.WriteVarString(s("k"))
	w.WriteVarUint(1)
	for range depth {
		w.WriteUint8(117)
		w.WriteVarUint(1)
	}
	w.WriteUint8(126)
	w.WriteVarUint(0)
	return w.Bytes()
}

func TestTooDeepPastTheCap(t *testing.T) {
	atCap := Inspect(nestedArrayUpdate(DefaultInspectDepth), DefaultInspectDepth)
	if atCap.Verdict != VerdictOK || atCap.Decoded.MaxNestingDepth != DefaultInspectDepth {
		t.Fatalf("at cap: %+v", atCap)
	}
	past := Inspect(nestedArrayUpdate(DefaultInspectDepth+1), DefaultInspectDepth)
	if past.Verdict != VerdictTooDeep || past.Reason == "" || past.Decoded != nil {
		t.Fatalf("past cap: %+v", past)
	}
	if Inspect(nestedArrayUpdate(DefaultInspectDepth+1), DefaultInspectDepth+1).Verdict != VerdictOK {
		t.Fatal("the cap is the caller's")
	}
}
