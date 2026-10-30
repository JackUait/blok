// Package mediatype reads Content-Type values with the grammar of ASP.NET's
// MediaTypeHeaderValue, which is not mime.ParseMediaType's: it allows space
// around "/", a parameter with no value, and repeated parameters.
package mediatype

import "strings"

// Param is one parameter; Value keeps its quotes and escapes.
type Param struct {
	Name, Value string
}

// Parse is MediaTypeHeaderValue.TryParse.
func Parse(s string) (mediaType string, params []Param, ok bool) {
	p := parser{s: s}
	p.space()
	typeStart := p.i
	if !p.token() {
		return "", nil, false
	}
	p.space()
	if !p.eat('/') {
		return "", nil, false
	}
	p.space()
	if !p.token() {
		return "", nil, false
	}
	mediaType = strings.ReplaceAll(strings.ReplaceAll(s[typeStart:p.i], " ", ""), "\t", "")
	for {
		p.space()
		if p.i == len(s) {
			return mediaType, params, true
		}
		if !p.eat(';') {
			return "", nil, false
		}
		p.space()
		if p.i == len(s) {
			return mediaType, params, true
		}
		nameStart := p.i
		if !p.token() {
			return "", nil, false
		}
		param := Param{Name: s[nameStart:p.i]}
		p.space()
		if p.eat('=') {
			p.space()
			valueStart := p.i
			if p.i < len(s) && s[p.i] == '"' {
				if !p.quoted() {
					return "", nil, false
				}
			} else {
				p.token()
			}
			param.Value = s[valueStart:p.i]
		}
		params = append(params, param)
	}
}

type parser struct {
	s string
	i int
}

func (p *parser) space() {
	for p.i < len(p.s) && (p.s[p.i] == ' ' || p.s[p.i] == '\t') {
		p.i++
	}
}

func (p *parser) eat(c byte) bool {
	if p.i < len(p.s) && p.s[p.i] == c {
		p.i++
		return true
	}
	return false
}

func (p *parser) token() bool {
	start := p.i
	for p.i < len(p.s) && isTokenChar(p.s[p.i]) {
		p.i++
	}
	return p.i > start
}

func (p *parser) quoted() bool {
	p.i++
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case '\\':
			p.i += 2
		case '"':
			p.i++
			return true
		default:
			p.i++
		}
	}
	return false
}

func isTokenChar(c byte) bool {
	if c <= ' ' || c >= 0x7f {
		return false
	}
	return !strings.ContainsRune("()<>@,;:\\\"/[]?={}", rune(c))
}

// removeQuotes is HeaderUtilities.RemoveQuotes.
func removeQuotes(value string) string {
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		return value[1 : len(value)-1]
	}
	return value
}

// unquoteParameter is UploadWire.UnquoteMediaParameter: quotes off, and a
// backslash dropped only before a MIME special.
func unquoteParameter(value string) string {
	quoted := len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"'
	unquoted := removeQuotes(value)
	if !quoted || !strings.Contains(unquoted, `\`) {
		return unquoted
	}
	var b strings.Builder
	for i := 0; i < len(unquoted); i++ {
		if unquoted[i] == '\\' && i+1 < len(unquoted) && strings.IndexByte(`()<>@,;:\"/[]?=`, unquoted[i+1]) >= 0 {
			i++
		}
		b.WriteByte(unquoted[i])
	}
	return b.String()
}

// HasConflictingParameters reports a parameter named twice (any case) with
// two different unquoted values.
func HasConflictingParameters(params []Param) bool {
	seen := map[string]string{}
	for _, param := range params {
		name := strings.ToLower(param.Name)
		value := unquoteParameter(param.Value)
		if existing, ok := seen[name]; ok && existing != value {
			return true
		}
		seen[name] = value
	}
	return false
}

// SanitizeWire is UploadWire.SanitizeMediaType: the trimmed text when it
// parses and has no conflicting parameters, else "". The length counts
// UTF-16 units, as C# does.
func SanitizeWire(value string) string {
	candidate := strings.TrimSpace(value)
	length := len([]rune(candidate))
	for _, r := range candidate {
		if r > 0xffff {
			length++
		}
	}
	if length == 0 || length > 255 {
		return ""
	}
	_, params, ok := Parse(candidate)
	if !ok || HasConflictingParameters(params) {
		return ""
	}
	return candidate
}

// Boundary is the upload route's TryGetBoundary: a multipart/form-data type
// with no conflicting parameters and a non-empty boundary, quotes removed.
func Boundary(contentType string) (string, bool) {
	mediaType, params, ok := Parse(contentType)
	if !ok || !strings.EqualFold(mediaType, "multipart/form-data") || HasConflictingParameters(params) {
		return "", false
	}
	for _, param := range params {
		if strings.EqualFold(param.Name, "boundary") {
			boundary := removeQuotes(param.Value)
			return boundary, boundary != ""
		}
	}
	return "", false
}

// IsJSON is the JSON routes' check: application/json in any case with no
// conflicting parameters.
func IsJSON(contentType string) bool {
	mediaType, params, ok := Parse(contentType)
	return ok && strings.EqualFold(mediaType, "application/json") && !HasConflictingParameters(params)
}
