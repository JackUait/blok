package lib0

import (
	"fmt"
	"math"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// BigInt is a peer's bigint (tag 122). The engine never writes one of its
// own, so int64 holds every value that can arrive.
type BigInt int64

// MaxAnyDepth caps Any nesting on read. C# also refuses earlier when its
// stack probe fails, which Go does not need: its stacks grow.
const MaxAnyDepth = 4096

const (
	tagUint8Array = 116
	tagArray      = 117
	tagObject     = 118
	tagString     = 119
	tagTrue       = 120
	tagFalse      = 121
	tagBigInt     = 122
	tagFloat64    = 123
	tagFloat32    = 124
	tagInteger    = 125
	tagNull       = 126
	tagUndefined  = 127
)

// Tag 125 covers integers up to this magnitude; larger ones are floats.
const maxTaggedInteger = 0x7fffffff

// ReadAny reads one Any value.
func ReadAny(r *Reader) (any, error) { return readAny(r, 0) }

func readAny(r *Reader, depth int) (any, error) {
	tag, err := r.ReadUint8()
	if err != nil {
		return nil, err
	}
	switch tag {
	case tagUndefined:
		return jsjson.Undefined{}, nil
	case tagNull:
		return nil, nil
	case tagInteger:
		return r.ReadVarInt()
	case tagFloat32:
		value, err := r.ReadFloat32()
		return float64(value), err
	case tagFloat64:
		return r.ReadFloat64()
	case tagBigInt:
		value, err := r.ReadBigInt64()
		return BigInt(value), err
	case tagFalse:
		return false, nil
	case tagTrue:
		return true, nil
	case tagString:
		return r.ReadVarString()
	case tagObject:
		count, err := r.ReadVarUint()
		if err != nil {
			return nil, err
		}
		object := &jsjson.Object{}
		for range count {
			key, err := r.ReadVarString()
			if err != nil {
				return nil, err
			}
			value, err := readNested(r, depth)
			if err != nil {
				return nil, err
			}
			object.Set(key, value)
		}
		return object, nil
	case tagArray:
		count, err := r.ReadVarUint()
		if err != nil {
			return nil, err
		}
		// Never preallocate from the wire's count.
		items := []any{}
		for range count {
			value, err := readNested(r, depth)
			if err != nil {
				return nil, err
			}
			items = append(items, value)
		}
		return items, nil
	case tagUint8Array:
		b, err := r.ReadVarBytes()
		if err != nil {
			return nil, err
		}
		return append([]byte{}, b...), nil
	}
	return nil, Errorf("lib0: %d at %d is not an Any tag.", tag, r.pos-1)
}

func readNested(r *Reader, depth int) (any, error) {
	if depth >= MaxAnyDepth {
		return nil, Errorf("lib0: the Any value at %d nests past %d levels.", r.pos, MaxAnyDepth)
	}
	return readAny(r, depth+1)
}

// WriteAny writes one Any value. It panics on a value that is not an Any
// (ArgumentException in C#).
func WriteAny(w *Writer, value any) {
	switch value := value.(type) {
	case nil:
		w.WriteUint8(tagNull)
	case jsjson.Str:
		w.WriteUint8(tagString)
		w.WriteVarString(value)
	case bool:
		if value {
			w.WriteUint8(tagTrue)
		} else {
			w.WriteUint8(tagFalse)
		}
	case float64:
		writeNumber(w, value)
	case BigInt:
		w.WriteUint8(tagBigInt)
		w.WriteBigInt64(int64(value))
	case []byte:
		w.WriteUint8(tagUint8Array)
		w.WriteVarBytes(value)
	case *jsjson.Object:
		w.WriteUint8(tagObject)
		w.WriteVarUint(uint64(value.Len()))
		for _, member := range value.Members() {
			w.WriteVarString(member.Key)
			WriteAny(w, member.Value)
		}
	case []any:
		w.WriteUint8(tagArray)
		w.WriteVarUint(uint64(len(value)))
		for _, item := range value {
			WriteAny(w, item)
		}
	case jsjson.Undefined:
		w.WriteUint8(tagUndefined)
	default:
		panic(fmt.Sprintf("lib0: %T is not an Any value.", value))
	}
}

// writeNumber is lib0's writeAny dispatch: integer, else float32 if it
// round-trips, else float64.
func writeNumber(w *Writer, number float64) {
	if math.IsNaN(number) {
		w.WriteUint8(tagFloat64)
		w.WriteFloat64(jsjson.NaN())
		return
	}
	if number == math.Trunc(number) && math.Abs(number) <= maxTaggedInteger {
		w.WriteUint8(tagInteger)
		w.WriteVarInt(number)
		return
	}
	// Infinity round-trips through float32, so it lands here, as in lib0.
	if float64(float32(number)) == number {
		w.WriteUint8(tagFloat32)
		w.WriteFloat32(float32(number))
		return
	}
	w.WriteUint8(tagFloat64)
	w.WriteFloat64(number)
}
