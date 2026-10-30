package lib0_test

import (
	"bytes"
	"encoding/base64"
	"errors"
	"math"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs/yjstest"
)

func load(t *testing.T, name string) any {
	t.Helper()
	file, err := yjstest.Load(name)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func b64(t *testing.T, value any, key string) []byte {
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

func engineNumber(t *testing.T, value any) float64 {
	t.Helper()
	converted, err := yjstest.ToEngine(value)
	if err != nil {
		t.Fatal(err)
	}
	number, ok := converted.(float64)
	if !ok {
		t.Fatalf("%v is not a number", value)
	}
	return number
}

func sameNumber(a, b float64) bool {
	return math.Float64bits(a) == math.Float64bits(b)
}

func TestVarUintGoldens(t *testing.T) {
	cases := yjstest.Items(load(t, "varint.json"), "varuint")
	if len(cases) != 19 {
		t.Fatalf("want 19 varuint cases, got %d", len(cases))
	}
	for _, c := range cases {
		want := uint64(engineNumber(t, yjstest.Field(c, "value")))
		data := b64(t, c, "bytes")
		reader := lib0.NewReader(data)
		got, err := reader.ReadVarUint()
		if err != nil || got != want || !reader.AtEnd() {
			t.Errorf("read %x: got %d, %v, want %d", data, got, err, want)
		}
		writer := &lib0.Writer{}
		writer.WriteVarUint(want)
		if !bytes.Equal(writer.Bytes(), data) {
			t.Errorf("write %d: got %x, want %x", want, writer.Bytes(), data)
		}
	}
}

func TestVarIntGoldens(t *testing.T) {
	cases := yjstest.Items(load(t, "varint.json"), "varint")
	if len(cases) != 22 {
		t.Fatalf("want 22 varint cases, got %d", len(cases))
	}
	for _, c := range cases {
		want := engineNumber(t, yjstest.Field(c, "value"))
		data := b64(t, c, "bytes")
		reader := lib0.NewReader(data)
		got, err := reader.ReadVarInt()
		if err != nil || !sameNumber(got, want) || !reader.AtEnd() {
			t.Errorf("read %x: got %v, %v, want %v", data, got, err, want)
		}
		writer := &lib0.Writer{}
		writer.WriteVarInt(want)
		if !bytes.Equal(writer.Bytes(), data) {
			t.Errorf("write %v: got %x, want %x", want, writer.Bytes(), data)
		}
	}
}

func TestRejectsVarUintPast2Pow53(t *testing.T) {
	_, err := lib0.NewReader([]byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10}).ReadVarUint()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("got %v", err)
	}
	_, err = lib0.NewReader([]byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00}).ReadVarUint()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("nine bytes: got %v", err)
	}
}

func TestRejectsVarIntPast2Pow53(t *testing.T) {
	// 2^53: 6 bits, then 7 per byte, so bit 53 is 0x20 of the eighth byte.
	_, err := lib0.NewReader([]byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x20}).ReadVarInt()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("got %v", err)
	}
	_, err = lib0.NewReader([]byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00}).ReadVarInt()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("nine bytes: got %v", err)
	}
}

func TestWriteVarIntRefusesNonIntegers(t *testing.T) {
	for _, bad := range []float64{0.5, math.NaN(), math.Inf(1), 9007199254740992} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%v: no panic", bad)
				}
			}()
			(&lib0.Writer{}).WriteVarInt(bad)
		}()
	}
}

func TestRejectsTruncatedVarString(t *testing.T) {
	_, err := lib0.NewReader([]byte{0x05, 0x61, 0x62}).ReadVarString()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("got %v", err)
	}
}

func TestRejectsInvalidUTF8(t *testing.T) {
	for _, data := range [][]byte{
		{0x02, 0xc3, 0x28},
		{0x03, 0xed, 0xa0, 0x80}, // CESU-8 surrogate
		{0x02, 0xc0, 0x80},       // overlong NUL
	} {
		_, err := lib0.NewReader(data).ReadVarString()
		if !errors.Is(err, lib0.ErrFormat) {
			t.Errorf("%x: got %v", data, err)
		}
	}
}

func TestRoundTripsANulBearingString(t *testing.T) {
	writer := &lib0.Writer{}
	writer.WriteVarString(jsjson.FromString("a\x00b"))
	if !bytes.Equal(writer.Bytes(), []byte{0x03, 0x61, 0x00, 0x62}) {
		t.Fatalf("got %x", writer.Bytes())
	}
	got, err := lib0.NewReader(writer.Bytes()).ReadVarString()
	if err != nil || got.String() != "a\x00b" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestWritesALoneSurrogateAsTheReplacementCharacter(t *testing.T) {
	writer := &lib0.Writer{}
	writer.WriteVarString(jsjson.Str{'a', 0xd83d})
	if !bytes.Equal(writer.Bytes(), []byte{0x04, 0x61, 0xef, 0xbf, 0xbd}) {
		t.Fatalf("got %x", writer.Bytes())
	}
}

func TestReadsFloatsBigEndian(t *testing.T) {
	reader := lib0.NewReader([]byte{0x3f, 0x00, 0x00, 0x00, 0x3f, 0xb9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a})
	half, err := reader.ReadFloat32()
	if err != nil || half != 0.5 {
		t.Fatalf("float32: %v %v", half, err)
	}
	tenth, err := reader.ReadFloat64()
	if err != nil || tenth != 0.1 {
		t.Fatalf("float64: %v %v", tenth, err)
	}
	if _, err := reader.ReadFloat32(); !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("past the end: %v", err)
	}
}

func TestRejectsVarBytesPastTheBuffer(t *testing.T) {
	// A length near 2^53 must be refused before any slice is made.
	_, err := lib0.NewReader([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f}).ReadVarBytes()
	if !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("got %v", err)
	}
}

func anyCases(t *testing.T) []any {
	t.Helper()
	cases, err := yjstest.Cases("any.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) != 35 {
		t.Fatalf("want 35 any cases, got %d", len(cases))
	}
	return cases
}

func TestReadsEveryAnyGolden(t *testing.T) {
	for _, c := range anyCases(t) {
		name := yjstest.String(c, "name")
		data := b64(t, c, "bytes")
		if data[0] != byte(yjstest.Number(c, "tag")) {
			t.Errorf("%s: tag %d", name, data[0])
		}
		reader := lib0.NewReader(data)
		value, err := lib0.ReadAny(reader)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !reader.AtEnd() {
			t.Errorf("%s: %d bytes unread", name, reader.Len()-reader.Pos())
		}
		got := canonical(t, yjstest.ToFixture(value))
		want := canonical(t, yjstest.Field(c, "value"))
		if got != want {
			t.Errorf("%s: got %s, want %s", name, got, want)
		}
	}
}

func TestWritesEveryAnyGolden(t *testing.T) {
	written := 0
	for _, c := range anyCases(t) {
		if yjstest.Bool(c, "decodeOnly") {
			continue
		}
		written++
		name := yjstest.String(c, "name")
		value, err := yjstest.ToEngine(yjstest.Field(c, "value"))
		if err != nil {
			t.Fatal(err)
		}
		writer := &lib0.Writer{}
		lib0.WriteAny(writer, value)
		if want := b64(t, c, "bytes"); !bytes.Equal(writer.Bytes(), want) {
			t.Errorf("%s: got %s, want %s", name,
				base64.StdEncoding.EncodeToString(writer.Bytes()), base64.StdEncoding.EncodeToString(want))
		}
	}
	if written != 34 {
		t.Fatalf("want 34 writable cases, got %d", written)
	}
}

func writeAny(value any) []byte {
	writer := &lib0.Writer{}
	lib0.WriteAny(writer, value)
	return writer.Bytes()
}

func TestNumberTags(t *testing.T) {
	for _, c := range []struct {
		value float64
		want  []byte
	}{
		{math.Copysign(0, -1), []byte{0x7d, 0x40}},
		{math.NaN(), []byte{0x7b, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0}},
		{math.Float64frombits(0xfff8000000000000), []byte{0x7b, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0}},
		{math.Inf(1), []byte{0x7c, 0x7f, 0x80, 0, 0}},
		{2147483648, []byte{0x7c, 0x4f, 0, 0, 0}},
	} {
		if got := writeAny(c.value); !bytes.Equal(got, c.want) {
			t.Errorf("%v: got %x, want %x", c.value, got, c.want)
		}
	}
}

func TestObjectKeysKeepInsertionOrderAndUndefinedRoundTrips(t *testing.T) {
	for _, c := range anyCases(t) {
		name := yjstest.String(c, "name")
		if name != "object-order" && name != "object-undefined-member" {
			continue
		}
		data := b64(t, c, "bytes")
		value, err := lib0.ReadAny(lib0.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		object := value.(*jsjson.Object)
		if name == "object-order" && object.Members()[0].Key.String() != "b" {
			t.Errorf("order lost: %v", object.Members())
		}
		if name == "object-undefined-member" {
			if u, _ := object.Get(jsjson.FromString("u")); u != (jsjson.Undefined{}) {
				t.Errorf("u = %#v", u)
			}
		}
		if got := writeAny(value); !bytes.Equal(got, data) {
			t.Errorf("%s: rewrite %x, want %x", name, got, data)
		}
	}
}

func TestRepeatedObjectKeyKeepsItsFirstPlace(t *testing.T) {
	// {"a":1,"b":2,"a":3} on the wire.
	data := []byte{118, 3, 1, 'a', 125, 1, 1, 'b', 125, 2, 1, 'a', 125, 3}
	value, err := lib0.ReadAny(lib0.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got := writeAny(value); !bytes.Equal(got, []byte{118, 2, 1, 'a', 125, 3, 1, 'b', 125, 2}) {
		t.Fatalf("got %x", got)
	}
}

func nestedArrays(depth int) []byte {
	data := make([]byte, depth*2+1)
	for i := range depth {
		data[2*i], data[2*i+1] = 117, 1
	}
	data[len(data)-1] = 126
	return data
}

func TestNestedDepthPast4096Rejects(t *testing.T) {
	if _, err := lib0.ReadAny(lib0.NewReader(nestedArrays(4096))); err != nil {
		t.Fatalf("4096: %v", err)
	}
	if _, err := lib0.ReadAny(lib0.NewReader(nestedArrays(4097))); !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("4097: %v", err)
	}
}

func TestUnknownAnyTagIsAFormatError(t *testing.T) {
	if _, err := lib0.ReadAny(lib0.NewReader([]byte{115})); !errors.Is(err, lib0.ErrFormat) {
		t.Fatalf("got %v", err)
	}
}

func TestWriteAnyRefusesNonAnyValues(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("no panic")
		}
	}()
	writeAny(struct{}{})
}
