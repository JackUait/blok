package jsjson

import (
	"errors"
	"fmt"
	"slices"
	"unicode/utf16"
	"unicode/utf8"
)

// Undefined is JS undefined. JSON.stringify skips it as an object member,
// writes it as null in an array, and writes nothing for it at the top.
type Undefined struct{}

// Member is one own property of an Object.
type Member struct {
	Key   Str
	Value any
}

// Object is a JS object's own string keys in insertion order. A JS value is
// nil (null), bool, float64, Str, *Object, []any or Undefined.
type Object struct {
	members []Member
	index   map[string]int
}

func keyOf(key Str) string {
	b := make([]byte, 0, 2*len(key))
	for _, unit := range key {
		b = append(b, byte(unit>>8), byte(unit))
	}
	return string(b)
}

// Set adds key at the end, or replaces its value in place when it exists.
func (o *Object) Set(key Str, value any) {
	if o.index == nil {
		o.index = map[string]int{}
	}
	k := keyOf(key)
	if at, ok := o.index[k]; ok {
		o.members[at].Value = value
		return
	}
	o.index[k] = len(o.members)
	o.members = append(o.members, Member{Key: slices.Clone(key), Value: value})
}

// Get returns the value under key.
func (o *Object) Get(key Str) (any, bool) {
	at, ok := o.index[keyOf(key)]
	if !ok {
		return nil, false
	}
	return o.members[at].Value, true
}

// Len is the number of members.
func (o *Object) Len() int { return len(o.members) }

// Members returns the members in insertion order. Do not modify the slice.
func (o *Object) Members() []Member { return o.members }

// KeyOrder is the order JS gives own string keys: array indexes (canonical
// integers below 2^32-1) ascending, then the rest in insertion order.
func KeyOrder(members []Member) []Member {
	type indexed struct {
		index  uint32
		member Member
	}
	var indexes []indexed
	var rest []Member
	for _, member := range members {
		if index, ok := arrayIndex(member.Key); ok {
			indexes = append(indexes, indexed{index, member})
		} else {
			rest = append(rest, member)
		}
	}
	slices.SortStableFunc(indexes, func(a, b indexed) int {
		return int(int64(a.index) - int64(b.index))
	})
	ordered := make([]Member, 0, len(members))
	for _, entry := range indexes {
		ordered = append(ordered, entry.member)
	}
	return append(ordered, rest...)
}

func arrayIndex(key Str) (uint32, bool) {
	if len(key) == 0 || len(key) > 10 || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	var value uint64
	for _, unit := range key {
		if unit < '0' || unit > '9' {
			return 0, false
		}
		value = value*10 + uint64(unit-'0')
	}
	if value >= 1<<32-1 {
		return 0, false
	}
	return uint32(value), true
}

// ErrNoJSONForm is returned for undefined at the top and for Go values that
// are not JS values.
var ErrNoJSONForm = errors.New("jsjson: value has no JSON form")

// Stringify is JSON.stringify.
func Stringify(value any) (string, error) {
	if _, ok := value.(Undefined); ok {
		return "", fmt.Errorf("%w: JSON.stringify(undefined) writes nothing", ErrNoJSONForm)
	}
	b, err := appendJS(nil, value)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func appendJS(dst []byte, value any) ([]byte, error) {
	switch value := value.(type) {
	case nil:
		return append(dst, "null"...), nil
	case bool:
		if value {
			return append(dst, "true"...), nil
		}
		return append(dst, "false"...), nil
	case float64:
		return append(dst, FormatNumber(value)...), nil
	case Str:
		return appendJSQuoted(dst, value), nil
	case *Object:
		dst = append(dst, '{')
		first := true
		for _, member := range KeyOrder(value.members) {
			if _, skip := member.Value.(Undefined); skip {
				continue
			}
			if !first {
				dst = append(dst, ',')
			}
			first = false
			dst = appendJSQuoted(dst, member.Key)
			dst = append(dst, ':')
			var err error
			if dst, err = appendJS(dst, member.Value); err != nil {
				return nil, err
			}
		}
		return append(dst, '}'), nil
	case []any:
		dst = append(dst, '[')
		for i, item := range value {
			if i > 0 {
				dst = append(dst, ',')
			}
			if _, ok := item.(Undefined); ok {
				item = nil
			}
			var err error
			if dst, err = appendJS(dst, item); err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	}
	return nil, fmt.Errorf("%w: %T", ErrNoJSONForm, value)
}

// appendJSQuoted is QuoteJSONString: the short escapes, other controls and
// lone surrogates as lowercase \uxxxx, everything else raw.
func appendJSQuoted(dst []byte, s Str) []byte {
	dst = append(dst, '"')
	for i := 0; i < len(s); i++ {
		unit := s[i]
		switch {
		case unit == '"':
			dst = append(dst, `\"`...)
		case unit == '\\':
			dst = append(dst, `\\`...)
		case unit < 0x20:
			dst = appendShortOrHex(dst, unit, lowerHex)
		case isHigh(unit) && i+1 < len(s) && isLow(s[i+1]):
			dst = utf8.AppendRune(dst, utf16.DecodeRune(rune(unit), rune(s[i+1])))
			i++
		case isHigh(unit) || isLow(unit):
			dst = appendHex(dst, unit, lowerHex)
		default:
			dst = utf8.AppendRune(dst, rune(unit))
		}
	}
	return append(dst, '"')
}

const (
	lowerHex = "0123456789abcdef"
	upperHex = "0123456789ABCDEF"
)

func appendHex(dst []byte, unit uint16, digits string) []byte {
	return append(dst, '\\', 'u',
		digits[unit>>12], digits[unit>>8&0xf], digits[unit>>4&0xf], digits[unit&0xf])
}

func appendShortOrHex(dst []byte, unit uint16, digits string) []byte {
	switch unit {
	case '\b':
		return append(dst, `\b`...)
	case '\f':
		return append(dst, `\f`...)
	case '\n':
		return append(dst, `\n`...)
	case '\r':
		return append(dst, `\r`...)
	case '\t':
		return append(dst, `\t`...)
	}
	return appendHex(dst, unit, digits)
}
