package jsjson

import (
	"errors"
	"fmt"
	"slices"
	"unicode/utf16"
	"unicode/utf8"
)

// Errors, in the kinds C# tells apart. Wrapped errors carry the position.
var (
	// ErrInvalid is text that is not JSON (JsonReaderException).
	ErrInvalid = errors.New("jsjson: invalid JSON")
	// ErrDepth is nesting past Options.MaxDepth (JsonReaderException).
	ErrDepth = errors.New("jsjson: maximum depth exceeded")
	// ErrDuplicate is a repeated key: at parse with RefuseDuplicates
	// (JsonException), or when the canonical writer reads the object
	// (ArgumentException).
	ErrDuplicate = errors.New("jsjson: duplicate property")
	// ErrLoneSurrogate is a \ud800-style escape with no partner, met when
	// .NET reads the string (InvalidOperationException). Parse accepts it.
	ErrLoneSurrogate = errors.New("jsjson: lone surrogate escape")
	// ErrInvalidUTF8 is a key with invalid UTF-8, met when .NET reads it
	// as a string (InvalidOperationException). Writing replaces it.
	ErrInvalidUTF8 = errors.New("jsjson: invalid UTF-8")
)

// Options are the JsonDocumentOptions C# passes.
type Options struct {
	// MaxDepth limits nested arrays and objects. 0 means 64, .NET's default.
	MaxDepth int
	// RefuseDuplicates is AllowDuplicateProperties = false.
	RefuseDuplicates bool
}

// Kind is a JSON token kind.
type Kind uint8

// The kinds of Node.
const (
	KindNull Kind = iota
	KindFalse
	KindTrue
	KindNumber
	KindString
	KindArray
	KindObject
)

// Node is JSON read the System.Text.Json way: keys keep their order and
// repeats, numbers keep their text, and strings stay undecoded until read
// or written, so a lone-surrogate escape fails late, as in C#.
type Node struct {
	Kind    Kind
	raw     []byte
	Items   []*Node
	Members []NodeMember
}

// NodeMember is one object member.
type NodeMember struct {
	raw   []byte
	Value *Node
}

// Raw is a number's literal text, or a string's text between its quotes
// with escapes intact.
func (n *Node) Raw() []byte { return n.raw }

// Text reads a string like JsonNode.GetValue<string>().
func (n *Node) Text() (Str, error) { return decodeStrict(n.raw) }

// Key reads a member name like JsonObject enumeration does.
func (m NodeMember) Key() (Str, error) { return decodeStrict(m.raw) }

// ParseNode reads one JSON value like JsonNode.Parse(bytes, documentOptions).
func ParseNode(data []byte, options Options) (*Node, error) {
	p := parser{data: data, maxDepth: options.MaxDepth}
	if p.maxDepth == 0 {
		p.maxDepth = 64
	}
	p.skipSpace()
	node, err := p.value(0)
	if err != nil {
		return nil, err
	}
	p.skipSpace()
	if p.pos != len(data) {
		return nil, p.fail(ErrInvalid, "data after the value")
	}
	// .NET checks repeats only once the whole text is valid JSON.
	if options.RefuseDuplicates {
		if err := node.checkDuplicates(); err != nil {
			return nil, err
		}
	}
	return node, nil
}

// checkDuplicates walks in document order. .NET compares unescaped UTF-8
// bytes, so invalid bytes compare raw and a lone escape fails.
func (n *Node) checkDuplicates() error {
	for _, item := range n.Items {
		if err := item.checkDuplicates(); err != nil {
			return err
		}
	}
	var seen map[string]struct{}
	for _, member := range n.Members {
		name, err := unescapeBytes(member.raw)
		if err != nil {
			return err
		}
		if seen == nil {
			seen = map[string]struct{}{}
		}
		if _, dup := seen[string(name)]; dup {
			return fmt.Errorf("%w: property %q", ErrDuplicate, name)
		}
		seen[string(name)] = struct{}{}
		if err := member.Value.checkDuplicates(); err != nil {
			return err
		}
	}
	return nil
}

type parser struct {
	data     []byte
	pos      int
	maxDepth int
}

func (p *parser) fail(kind error, what string) error {
	return fmt.Errorf("%w: %s at byte %d", kind, what, p.pos)
}

func (p *parser) skipSpace() {
	for p.pos < len(p.data) {
		switch p.data[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func (p *parser) value(depth int) (*Node, error) {
	if p.pos >= len(p.data) {
		return nil, p.fail(ErrInvalid, "missing value")
	}
	switch c := p.data[p.pos]; {
	case c == '{' || c == '[':
		if depth+1 > p.maxDepth {
			return nil, p.fail(ErrDepth, fmt.Sprintf("depth over %d", p.maxDepth))
		}
		if c == '[' {
			return p.array(depth + 1)
		}
		return p.object(depth + 1)
	case c == '"':
		raw, err := p.string()
		if err != nil {
			return nil, err
		}
		return &Node{Kind: KindString, raw: raw}, nil
	case c == 't':
		return p.literal("true", KindTrue)
	case c == 'f':
		return p.literal("false", KindFalse)
	case c == 'n':
		return p.literal("null", KindNull)
	}
	return p.number()
}

func (p *parser) literal(word string, kind Kind) (*Node, error) {
	if len(p.data)-p.pos < len(word) || string(p.data[p.pos:p.pos+len(word)]) != word {
		return nil, p.fail(ErrInvalid, "bad literal")
	}
	p.pos += len(word)
	return &Node{Kind: kind}, nil
}

func (p *parser) digits() int {
	start := p.pos
	for p.pos < len(p.data) && p.data[p.pos] >= '0' && p.data[p.pos] <= '9' {
		p.pos++
	}
	return p.pos - start
}

func (p *parser) number() (*Node, error) {
	start := p.pos
	if p.data[p.pos] == '-' {
		p.pos++
	}
	if p.pos < len(p.data) && p.data[p.pos] == '0' {
		p.pos++
		if p.pos < len(p.data) && p.data[p.pos] >= '0' && p.data[p.pos] <= '9' {
			return nil, p.fail(ErrInvalid, "leading zero")
		}
	} else if p.digits() == 0 {
		return nil, p.fail(ErrInvalid, "not a value")
	}
	if p.pos < len(p.data) && p.data[p.pos] == '.' {
		p.pos++
		if p.digits() == 0 {
			return nil, p.fail(ErrInvalid, "no digits after the point")
		}
	}
	if p.pos < len(p.data) && (p.data[p.pos] == 'e' || p.data[p.pos] == 'E') {
		p.pos++
		if p.pos < len(p.data) && (p.data[p.pos] == '+' || p.data[p.pos] == '-') {
			p.pos++
		}
		if p.digits() == 0 {
			return nil, p.fail(ErrInvalid, "no exponent digits")
		}
	}
	return &Node{Kind: KindNumber, raw: p.data[start:p.pos]}, nil
}

func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// string returns the text between the quotes. Bytes of 0x80 and up are not
// checked here: .NET accepts invalid UTF-8 inside a string.
func (p *parser) string() ([]byte, error) {
	p.pos++
	start := p.pos
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		switch {
		case c == '"':
			raw := p.data[start:p.pos]
			p.pos++
			return raw, nil
		case c < 0x20:
			return nil, p.fail(ErrInvalid, "control character in a string")
		case c == '\\':
			p.pos++
			if p.pos >= len(p.data) {
				return nil, p.fail(ErrInvalid, "unfinished escape")
			}
			switch p.data[p.pos] {
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
				p.pos++
			case 'u':
				if len(p.data)-p.pos < 5 || !isHexDigit(p.data[p.pos+1]) || !isHexDigit(p.data[p.pos+2]) ||
					!isHexDigit(p.data[p.pos+3]) || !isHexDigit(p.data[p.pos+4]) {
					return nil, p.fail(ErrInvalid, "bad \\u escape")
				}
				p.pos += 5
			default:
				return nil, p.fail(ErrInvalid, "bad escape")
			}
		default:
			p.pos++
		}
	}
	return nil, p.fail(ErrInvalid, "unfinished string")
}

func (p *parser) array(depth int) (*Node, error) {
	node := &Node{Kind: KindArray}
	p.pos++
	p.skipSpace()
	if p.pos < len(p.data) && p.data[p.pos] == ']' {
		p.pos++
		return node, nil
	}
	for {
		p.skipSpace()
		item, err := p.value(depth)
		if err != nil {
			return nil, err
		}
		node.Items = append(node.Items, item)
		p.skipSpace()
		if p.pos >= len(p.data) {
			return nil, p.fail(ErrInvalid, "unfinished array")
		}
		switch p.data[p.pos] {
		case ',':
			p.pos++
		case ']':
			p.pos++
			return node, nil
		default:
			return nil, p.fail(ErrInvalid, "expected , or ]")
		}
	}
}

func (p *parser) object(depth int) (*Node, error) {
	node := &Node{Kind: KindObject}
	p.pos++
	p.skipSpace()
	if p.pos < len(p.data) && p.data[p.pos] == '}' {
		p.pos++
		return node, nil
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.data) || p.data[p.pos] != '"' {
			return nil, p.fail(ErrInvalid, "expected a property name")
		}
		raw, err := p.string()
		if err != nil {
			return nil, err
		}
		p.skipSpace()
		if p.pos >= len(p.data) || p.data[p.pos] != ':' {
			return nil, p.fail(ErrInvalid, "expected :")
		}
		p.pos++
		p.skipSpace()
		value, err := p.value(depth)
		if err != nil {
			return nil, err
		}
		node.Members = append(node.Members, NodeMember{raw: raw, Value: value})
		p.skipSpace()
		if p.pos >= len(p.data) {
			return nil, p.fail(ErrInvalid, "unfinished object")
		}
		switch p.data[p.pos] {
		case ',':
			p.pos++
		case '}':
			p.pos++
			return node, nil
		default:
			return nil, p.fail(ErrInvalid, "expected , or }")
		}
	}
}

func hexValue(b []byte) uint16 {
	var v uint16
	for _, c := range b {
		switch {
		case c >= 'a':
			c -= 'a' - 10
		case c >= 'A':
			c -= 'A' - 10
		default:
			c -= '0'
		}
		v = v<<4 | uint16(c)
	}
	return v
}

func shortEscape(c byte) uint16 {
	switch c {
	case 'b':
		return '\b'
	case 'f':
		return '\f'
	case 'n':
		return '\n'
	case 'r':
		return '\r'
	case 't':
		return '\t'
	}
	return uint16(c)
}

// decodeJS reads a validated string the JS way: escapes become units (a lone
// surrogate stays one) and invalid UTF-8 becomes U+FFFD.
func decodeJS(raw []byte) (Str, bool) {
	units := make(Str, 0, len(raw))
	invalid := false
	for i := 0; i < len(raw); {
		if raw[i] != '\\' {
			end := i
			for end < len(raw) && raw[end] != '\\' {
				end++
			}
			var bad bool
			units, bad = appendUTF8(units, raw[i:end])
			invalid = invalid || bad
			i = end
			continue
		}
		if raw[i+1] == 'u' {
			units = append(units, hexValue(raw[i+2:i+6]))
			i += 6
			continue
		}
		units = append(units, shortEscape(raw[i+1]))
		i += 2
	}
	return units, invalid
}

// decodeStrict reads a string the way .NET materialises one.
func decodeStrict(raw []byte) (Str, error) {
	units, invalid := decodeJS(raw)
	if hasLone(units) {
		return nil, ErrLoneSurrogate
	}
	if invalid {
		return nil, ErrInvalidUTF8
	}
	return units, nil
}

// decodeForWrite reads a string the way .NET writes one: a lone escape
// fails, invalid UTF-8 is replaced.
func decodeForWrite(raw []byte) (Str, error) {
	units, _ := decodeJS(raw)
	if hasLone(units) {
		return nil, ErrLoneSurrogate
	}
	return units, nil
}

// unescapeBytes turns escapes into UTF-8 and leaves other bytes as they are.
func unescapeBytes(raw []byte) ([]byte, error) {
	out := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); {
		if raw[i] != '\\' {
			out = append(out, raw[i])
			i++
			continue
		}
		if raw[i+1] != 'u' {
			out = append(out, byte(shortEscape(raw[i+1])))
			i += 2
			continue
		}
		unit := hexValue(raw[i+2 : i+6])
		i += 6
		switch {
		case isHigh(unit) && i+6 <= len(raw) && raw[i] == '\\' && raw[i+1] == 'u' && isLow(hexValue(raw[i+2:i+6])):
			out = utf8.AppendRune(out, utf16.DecodeRune(rune(unit), rune(hexValue(raw[i+2:i+6]))))
			i += 6
		case isHigh(unit) || isLow(unit):
			return nil, ErrLoneSurrogate
		default:
			out = utf8.AppendRune(out, rune(unit))
		}
	}
	return out, nil
}

// AppendJSON writes n like JsonNode.ToJsonString() with default options.
func (n *Node) AppendJSON(dst []byte) ([]byte, error) {
	return n.appendNET(dst, false)
}

// AppendCanonical writes n like CollabEditOps.WriteCanonicalNode: object
// keys sorted by UTF-16 units, everything else as AppendJSON.
func (n *Node) AppendCanonical(dst []byte) ([]byte, error) {
	return n.appendNET(dst, true)
}

func (n *Node) appendNET(dst []byte, sorted bool) ([]byte, error) {
	var err error
	switch n.Kind {
	case KindNull:
		return append(dst, "null"...), nil
	case KindTrue:
		return append(dst, "true"...), nil
	case KindFalse:
		return append(dst, "false"...), nil
	case KindNumber:
		return append(dst, n.raw...), nil
	case KindString:
		text, err := decodeForWrite(n.raw)
		if err != nil {
			return nil, err
		}
		return AppendQuoted(dst, text), nil
	case KindArray:
		dst = append(dst, '[')
		for i, item := range n.Items {
			if i > 0 {
				dst = append(dst, ',')
			}
			if dst, err = item.appendNET(dst, sorted); err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	}
	type entry struct {
		key   Str
		value *Node
	}
	entries := make([]entry, 0, len(n.Members))
	seen := map[string]struct{}{}
	for _, member := range n.Members {
		var key Str
		if sorted {
			// Enumerating a JsonObject reads every key and builds a
			// dictionary, so a bad or repeated key fails here.
			if key, err = decodeStrict(member.raw); err != nil {
				return nil, err
			}
			if _, dup := seen[keyOf(key)]; dup {
				return nil, fmt.Errorf("%w: %q", ErrDuplicate, key.String())
			}
			seen[keyOf(key)] = struct{}{}
		} else if key, err = decodeForWrite(member.raw); err != nil {
			return nil, err
		}
		entries = append(entries, entry{key, member.Value})
	}
	if sorted {
		slices.SortStableFunc(entries, func(a, b entry) int { return Compare(a.key, b.key) })
	}
	dst = append(dst, '{')
	for i, member := range entries {
		if i > 0 {
			dst = append(dst, ',')
		}
		dst = AppendQuoted(dst, member.key)
		dst = append(dst, ':')
		if dst, err = member.value.appendNET(dst, sorted); err != nil {
			return nil, err
		}
	}
	return append(dst, '}'), nil
}

// AppendQuoted writes s like Utf8JsonWriter with the default encoder: only
// printable ASCII outside "&'+<>`\ is raw; the rest is \uXXXX in uppercase,
// with \b \t \n \f \r \\ short. A lone surrogate becomes �. The output
// is pure ASCII, so its byte length is its UTF-16 length.
func AppendQuoted(dst []byte, s Str) []byte {
	dst = append(dst, '"')
	for i := 0; i < len(s); i++ {
		unit := s[i]
		switch {
		case unit == '\\':
			dst = append(dst, `\\`...)
		case unit < 0x20:
			dst = appendShortOrHex(dst, unit, upperHex)
		case unit < 0x7f && !isHTMLSensitive(unit):
			dst = append(dst, byte(unit))
		case isHigh(unit) && i+1 < len(s) && isLow(s[i+1]):
			dst = appendHex(dst, unit, upperHex)
			dst = appendHex(dst, s[i+1], upperHex)
			i++
		case isHigh(unit) || isLow(unit):
			dst = appendHex(dst, 0xfffd, upperHex)
		default:
			dst = appendHex(dst, unit, upperHex)
		}
	}
	return append(dst, '"')
}

func isHTMLSensitive(unit uint16) bool {
	switch unit {
	case '"', '&', '\'', '+', '<', '>', '`':
		return true
	}
	return false
}
