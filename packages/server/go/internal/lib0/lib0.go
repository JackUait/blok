// Package lib0 is the lib0 binary codec yjs speaks, ported from C#
// Blok.Server/Yjs (Lib0Reader.cs, Lib0Writer.cs, AnyCodec.cs).
//
// An Any value is a JS value from jsjson (nil, bool, float64, jsjson.Str,
// *jsjson.Object, []any, jsjson.Undefined) plus BigInt and []byte.
package lib0

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"unicode/utf8"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// ErrFormat matches every malformed or truncated input (Lib0FormatException).
var ErrFormat = errors.New("lib0: malformed input")

// FormatError is a malformed input with its reason. errors.Is(err, ErrFormat)
// holds for it.
type FormatError struct{ Reason string }

func (e *FormatError) Error() string { return e.Reason }

// Is makes errors.Is(err, ErrFormat) true.
func (e *FormatError) Is(target error) bool { return target == ErrFormat }

// Errorf builds a FormatError.
func Errorf(format string, args ...any) error {
	return &FormatError{Reason: fmt.Sprintf(format, args...)}
}

// MaxSafeInteger is 2^53-1, the largest varuint/varint lib0 reads.
const MaxSafeInteger = 1<<53 - 1

// 2^53-1 needs 8 varuint bytes (8*7 = 56 bits) and 8 varint bytes
// (6 + 7*7 = 55). A ninth byte can only carry an out-of-range value or zero
// padding, which no lib0 encoder writes.
const (
	maxVarUintBytes = 8
	maxVarIntBytes  = 8
)

// Reader reads lib0 values from a byte slice.
type Reader struct {
	data []byte
	pos  int
}

// NewReader reads data from the start.
func NewReader(data []byte) *Reader { return &Reader{data: data} }

// Pos is the read position.
func (r *Reader) Pos() int { return r.pos }

// Len is the whole buffer's length.
func (r *Reader) Len() int { return len(r.data) }

// AtEnd reports that every byte was read.
func (r *Reader) AtEnd() bool { return r.pos >= len(r.data) }

func (r *Reader) take(count int) ([]byte, error) {
	if count > len(r.data)-r.pos {
		return nil, Errorf("lib0: %d bytes were read at %d, %d remain.", count, r.pos, len(r.data)-r.pos)
	}
	slice := r.data[r.pos : r.pos+count]
	r.pos += count
	return slice, nil
}

// ReadUint8 reads one byte.
func (r *Reader) ReadUint8() (byte, error) {
	b, err := r.take(1)
	if err != nil {
		return 0, err
	}
	return b[0], nil
}

// ReadVarUint reads LEB128, refusing anything above 2^53-1.
func (r *Reader) ReadVarUint() (uint64, error) {
	var value uint64
	shift := 0
	for range maxVarUintBytes {
		current, err := r.ReadUint8()
		if err != nil {
			return 0, err
		}
		value |= uint64(current&0x7f) << shift
		if current&0x80 == 0 {
			if value > MaxSafeInteger {
				return 0, Errorf("lib0: the varuint at %d is above 2^53-1.", r.pos)
			}
			return value, nil
		}
		shift += 7
	}
	return 0, Errorf("lib0: the varuint at %d is above 2^53-1.", r.pos)
}

// ReadVarInt reads lib0's signed varint: the sign in bit 0x40 of the first
// byte. It returns a float64 so -0 survives.
func (r *Reader) ReadVarInt() (float64, error) {
	first, err := r.ReadUint8()
	if err != nil {
		return 0, err
	}
	value := uint64(first & 0x3f)
	negative := first&0x40 != 0
	shift := 6
	if first&0x80 != 0 {
		for read := 1; ; {
			if read >= maxVarIntBytes {
				return 0, Errorf("lib0: the varint at %d is above 2^53-1.", r.pos)
			}
			current, err := r.ReadUint8()
			if err != nil {
				return 0, err
			}
			value |= uint64(current&0x7f) << shift
			shift += 7
			read++
			if current&0x80 == 0 {
				break
			}
		}
	}
	if value > MaxSafeInteger {
		return 0, Errorf("lib0: the varint at %d is above 2^53-1.", r.pos)
	}
	if negative {
		return -float64(value), nil
	}
	return float64(value), nil
}

// ReadVarString reads length-prefixed strict UTF-8.
func (r *Reader) ReadVarString() (jsjson.Str, error) {
	b, err := r.ReadVarBytes()
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(b) {
		return nil, Errorf("lib0: the varstring ending at %d is not UTF-8.", r.pos)
	}
	return jsjson.FromString(string(b)), nil
}

// ReadVarBytes reads length-prefixed bytes. The slice aliases the buffer.
func (r *Reader) ReadVarBytes() ([]byte, error) {
	length, err := r.ReadVarUint()
	if err != nil {
		return nil, err
	}
	if length > uint64(len(r.data)-r.pos) {
		return nil, Errorf("lib0: %d bytes were announced at %d, %d remain.", length, r.pos, len(r.data)-r.pos)
	}
	return r.take(int(length))
}

// ReadFloat32 reads a big-endian IEEE single.
func (r *Reader) ReadFloat32() (float32, error) {
	b, err := r.take(4)
	if err != nil {
		return 0, err
	}
	return math.Float32frombits(binary.BigEndian.Uint32(b)), nil
}

// ReadFloat64 reads a big-endian IEEE double.
func (r *Reader) ReadFloat64() (float64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(binary.BigEndian.Uint64(b)), nil
}

// ReadBigInt64 reads a big-endian int64.
func (r *Reader) ReadBigInt64() (int64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(b)), nil
}

// Writer collects lib0 bytes. The zero value is ready to use.
type Writer struct{ buf []byte }

// Bytes is what was written so far. It aliases the writer's buffer.
func (w *Writer) Bytes() []byte { return w.buf }

// Len is the number of bytes written.
func (w *Writer) Len() int { return len(w.buf) }

// WriteUint8 writes one byte.
func (w *Writer) WriteUint8(b byte) { w.buf = append(w.buf, b) }

// WriteVarUint writes LEB128, low 7 bits first.
func (w *Writer) WriteVarUint(value uint64) {
	for value > 0x7f {
		w.buf = append(w.buf, byte(0x80|value&0x7f))
		value >>= 7
	}
	w.buf = append(w.buf, byte(value))
}

// WriteVarInt writes lib0's signed varint. It panics on a non-integer or a
// magnitude above 2^53-1 (ArgumentOutOfRangeException in C#). -0 writes 0x40.
func (w *Writer) WriteVarInt(integral float64) {
	if integral != math.Trunc(integral) || math.IsInf(integral, 0) || math.Abs(integral) > MaxSafeInteger {
		panic(fmt.Sprintf("lib0: a varint is an integer no larger than 2^53-1, not %v.", integral))
	}
	negative := math.Signbit(integral)
	magnitude := uint64(math.Abs(integral))
	first := byte(magnitude & 0x3f)
	if magnitude > 0x3f {
		first |= 0x80
	}
	if negative {
		first |= 0x40
	}
	w.buf = append(w.buf, first)
	magnitude >>= 6
	for magnitude > 0 {
		next := byte(magnitude & 0x7f)
		if magnitude > 0x7f {
			next |= 0x80
		}
		w.buf = append(w.buf, next)
		magnitude >>= 7
	}
}

// WriteVarString writes length-prefixed UTF-8. A lone surrogate becomes
// U+FFFD, as TextEncoder writes it.
func (w *Writer) WriteVarString(value jsjson.Str) {
	text := value.String()
	w.WriteVarUint(uint64(len(text)))
	w.buf = append(w.buf, text...)
}

// WriteVarBytes writes length-prefixed bytes.
func (w *Writer) WriteVarBytes(value []byte) {
	w.WriteVarUint(uint64(len(value)))
	w.buf = append(w.buf, value...)
}

// WriteFloat32 writes a big-endian IEEE single.
func (w *Writer) WriteFloat32(value float32) {
	w.buf = binary.BigEndian.AppendUint32(w.buf, math.Float32bits(value))
}

// WriteFloat64 writes a big-endian IEEE double.
func (w *Writer) WriteFloat64(value float64) {
	w.buf = binary.BigEndian.AppendUint64(w.buf, math.Float64bits(value))
}

// WriteBigInt64 writes a big-endian int64.
func (w *Writer) WriteBigInt64(value int64) {
	w.buf = binary.BigEndian.AppendUint64(w.buf, uint64(value))
}
