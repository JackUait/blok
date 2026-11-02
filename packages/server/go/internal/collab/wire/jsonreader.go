package wire

import (
	"errors"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

// tokenType is System.Text.Json's JsonTokenType, as far as SyncWire looks.
type tokenType uint8

const (
	tokenNone tokenType = iota
	tokenStartObject
	tokenEndObject
	tokenStartArray
	tokenEndArray
	tokenPropertyName
	tokenString
	tokenNumber
	tokenTrue
	tokenFalse
	tokenNull
)

// errJSON is a JsonException: text Utf8JsonReader refuses.
var errJSON = errors.New("wire: invalid JSON")

// errText is GetString's InvalidOperationException: invalid UTF-8 or a
// lone-surrogate escape. Read accepts both.
var errText = errors.New("wire: string is not valid text")

// maxDepth is JsonReaderOptions.MaxDepth's default.
const maxDepth = 64

// jsonReader is Utf8JsonReader with default options over one final block:
// no comments, no trailing commas, depth 64, one top-level value. Read
// validates the grammar but not UTF-8 inside strings.
type jsonReader struct {
	data []byte
	pos  int
	// stack holds '{' or '[' per open container.
	stack []byte
	// needValue: a property name was read and its value is next.
	needValue bool
	// afterValue: a value ended, so ',' or a closer comes next.
	afterValue bool
	// rootDone: the top-level value is complete.
	rootDone  bool
	token     tokenType
	raw       []byte
	hasEscape bool
}

func newJSONReader(data []byte) *jsonReader { return &jsonReader{data: data} }

func (r *jsonReader) skipSpace() {
	for r.pos < len(r.data) {
		switch r.data[r.pos] {
		case ' ', '\t', '\n', '\r':
			r.pos++
		default:
			return
		}
	}
}

// Read moves to the next token. It returns false only at the end of input
// after a complete value, and an error where Read would throw.
func (r *jsonReader) Read() (bool, error) {
	r.skipSpace()
	if r.rootDone {
		if r.pos == len(r.data) {
			return false, nil
		}
		return false, errJSON
	}
	if r.pos == len(r.data) {
		return false, errJSON
	}
	c := r.data[r.pos]
	inObject := len(r.stack) > 0 && r.stack[len(r.stack)-1] == '{'
	switch {
	case r.needValue:
		r.needValue = false
		return r.value()
	case r.afterValue:
		closer := byte(']')
		if inObject {
			closer = '}'
		}
		if c == closer {
			return r.close()
		}
		if c != ',' {
			return false, errJSON
		}
		r.pos++
		r.skipSpace()
		if r.pos == len(r.data) {
			return false, errJSON
		}
		r.afterValue = false
		if inObject {
			return r.propertyName()
		}
		return r.value()
	case len(r.stack) == 0:
		return r.value()
	case inObject:
		// Just after '{': a name or '}'.
		if c == '}' {
			return r.close()
		}
		return r.propertyName()
	default:
		// Just after '[': a value or ']'.
		if c == ']' {
			return r.close()
		}
		return r.value()
	}
}

func (r *jsonReader) close() (bool, error) {
	open := r.stack[len(r.stack)-1]
	r.stack = r.stack[:len(r.stack)-1]
	r.pos++
	r.token = tokenEndArray
	if open == '{' {
		r.token = tokenEndObject
	}
	r.endValue()
	return true, nil
}

func (r *jsonReader) endValue() {
	if len(r.stack) == 0 {
		r.rootDone = true
		return
	}
	r.afterValue = true
}

func (r *jsonReader) propertyName() (bool, error) {
	if r.data[r.pos] != '"' {
		return false, errJSON
	}
	if err := r.str(); err != nil {
		return false, err
	}
	r.skipSpace()
	if r.pos == len(r.data) || r.data[r.pos] != ':' {
		return false, errJSON
	}
	r.pos++
	r.token = tokenPropertyName
	r.needValue = true
	return true, nil
}

func (r *jsonReader) value() (bool, error) {
	r.skipSpace()
	if r.pos == len(r.data) {
		return false, errJSON
	}
	switch c := r.data[r.pos]; {
	case c == '{' || c == '[':
		if len(r.stack) >= maxDepth {
			return false, errJSON
		}
		r.stack = append(r.stack, c)
		r.pos++
		r.token = tokenStartArray
		if c == '{' {
			r.token = tokenStartObject
		}
		return true, nil
	case c == '"':
		if err := r.str(); err != nil {
			return false, err
		}
		r.token = tokenString
	case c == '-' || (c >= '0' && c <= '9'):
		if err := r.number(); err != nil {
			return false, err
		}
		r.token = tokenNumber
	case c == 't':
		if err := r.literal("true"); err != nil {
			return false, err
		}
		r.token = tokenTrue
	case c == 'f':
		if err := r.literal("false"); err != nil {
			return false, err
		}
		r.token = tokenFalse
	case c == 'n':
		if err := r.literal("null"); err != nil {
			return false, err
		}
		r.token = tokenNull
	default:
		return false, errJSON
	}
	r.endValue()
	return true, nil
}

func (r *jsonReader) literal(word string) error {
	if len(r.data)-r.pos < len(word) || string(r.data[r.pos:r.pos+len(word)]) != word {
		return errJSON
	}
	r.pos += len(word)
	return r.delimiter()
}

// delimiter: a number or literal must be followed by space, a structural
// character or the end; "1x" and "truex" are refused at the token.
func (r *jsonReader) delimiter() error {
	if r.pos == len(r.data) {
		return nil
	}
	switch r.data[r.pos] {
	case ' ', '\t', '\n', '\r', ',', '}', ']':
		return nil
	}
	return errJSON
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func (r *jsonReader) number() error {
	start := r.pos
	d := r.data
	if d[r.pos] == '-' {
		r.pos++
	}
	if r.pos == len(d) || !isDigit(d[r.pos]) {
		return errJSON
	}
	if d[r.pos] == '0' {
		r.pos++
	} else {
		for r.pos < len(d) && isDigit(d[r.pos]) {
			r.pos++
		}
	}
	if r.pos < len(d) && d[r.pos] == '.' {
		r.pos++
		if r.pos == len(d) || !isDigit(d[r.pos]) {
			return errJSON
		}
		for r.pos < len(d) && isDigit(d[r.pos]) {
			r.pos++
		}
	}
	if r.pos < len(d) && (d[r.pos] == 'e' || d[r.pos] == 'E') {
		r.pos++
		if r.pos < len(d) && (d[r.pos] == '+' || d[r.pos] == '-') {
			r.pos++
		}
		if r.pos == len(d) || !isDigit(d[r.pos]) {
			return errJSON
		}
		for r.pos < len(d) && isDigit(d[r.pos]) {
			r.pos++
		}
	}
	r.raw = d[start:r.pos]
	r.hasEscape = false
	return r.delimiter()
}

func isHexDigit(c byte) bool {
	return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// str reads a quoted string: control characters and bad escapes throw,
// bytes above 0x7F pass unchecked, as in Utf8JsonReader.
func (r *jsonReader) str() error {
	d := r.data
	r.pos++
	start := r.pos
	r.hasEscape = false
	for r.pos < len(d) {
		c := d[r.pos]
		switch {
		case c == '"':
			r.raw = d[start:r.pos]
			r.pos++
			return nil
		case c < 0x20:
			return errJSON
		case c == '\\':
			r.hasEscape = true
			r.pos++
			if r.pos == len(d) {
				return errJSON
			}
			switch d[r.pos] {
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
				r.pos++
			case 'u':
				if len(d)-r.pos < 5 {
					return errJSON
				}
				for i := 1; i <= 4; i++ {
					if !isHexDigit(d[r.pos+i]) {
						return errJSON
					}
				}
				r.pos += 5
			default:
				return errJSON
			}
		default:
			r.pos++
		}
	}
	return errJSON
}

// Skip is Utf8JsonReader.Skip: on a property name or container start it
// reads past the matching value; on anything else it does nothing.
func (r *jsonReader) Skip() error {
	if r.token == tokenPropertyName {
		if _, err := r.Read(); err != nil {
			return err
		}
	}
	if r.token != tokenStartObject && r.token != tokenStartArray {
		return nil
	}
	depth := len(r.stack)
	for {
		if _, err := r.Read(); err != nil {
			return err
		}
		if (r.token == tokenEndObject || r.token == tokenEndArray) && len(r.stack) < depth {
			return nil
		}
	}
}

// unescaped returns the token's bytes with escapes resolved. A \u escape
// that is a lone surrogate comes back as errText, like GetString.
func (r *jsonReader) unescaped() ([]byte, error) {
	if !r.hasEscape {
		return r.raw, nil
	}
	raw := r.raw
	out := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if c != '\\' {
			out = append(out, c)
			continue
		}
		i++
		switch raw[i] {
		case 'b':
			out = append(out, '\b')
		case 'f':
			out = append(out, '\f')
		case 'n':
			out = append(out, '\n')
		case 'r':
			out = append(out, '\r')
		case 't':
			out = append(out, '\t')
		case 'u':
			unit := hexUnit(raw[i+1 : i+5])
			i += 4
			switch {
			case utf16.IsSurrogate(rune(unit)):
				// A high half needs a \u low half right after it.
				if unit >= 0xdc00 || i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
					return nil, errText
				}
				low := hexUnit(raw[i+3 : i+7])
				if low < 0xdc00 || low > 0xdfff {
					return nil, errText
				}
				i += 6
				out = utf8.AppendRune(out, utf16.DecodeRune(rune(unit), rune(low)))
			default:
				out = utf8.AppendRune(out, rune(unit))
			}
		default:
			out = append(out, raw[i])
		}
	}
	return out, nil
}

func hexUnit(b []byte) uint16 {
	v, _ := strconv.ParseUint(string(b), 16, 16)
	return uint16(v)
}

// GetString is Utf8JsonReader.GetString for a string or property name.
func (r *jsonReader) GetString() (string, error) {
	b, err := r.unescaped()
	if err != nil {
		return "", err
	}
	if !utf8.Valid(b) {
		return "", errText
	}
	return string(b), nil
}

// ValueTextEquals compares the unescaped token with text; a token that
// cannot be unescaped equals nothing.
func (r *jsonReader) ValueTextEquals(text string) bool {
	if r.token != tokenPropertyName && r.token != tokenString {
		return false
	}
	b, err := r.unescaped()
	return err == nil && string(b) == text
}

// The TryGet* integer reads accept only an optional '-' and digits that fit:
// "1.0", "1e2" and "-1" for unsigned all fail.
func (r *jsonReader) TryGetInt64() (int64, bool) {
	if r.token != tokenNumber || !integerText(r.raw) {
		return 0, false
	}
	v, err := strconv.ParseInt(string(r.raw), 10, 64)
	return v, err == nil
}

func (r *jsonReader) TryGetInt32() (int32, bool) {
	if r.token != tokenNumber || !integerText(r.raw) {
		return 0, false
	}
	v, err := strconv.ParseInt(string(r.raw), 10, 32)
	return int32(v), err == nil
}

func (r *jsonReader) TryGetUInt64() (uint64, bool) {
	if r.token != tokenNumber || !integerText(r.raw) || r.raw[0] == '-' {
		return 0, false
	}
	v, err := strconv.ParseUint(string(r.raw), 10, 64)
	return v, err == nil
}

func integerText(raw []byte) bool {
	for i, c := range raw {
		if !isDigit(c) && !(i == 0 && c == '-') {
			return false
		}
	}
	return true
}
