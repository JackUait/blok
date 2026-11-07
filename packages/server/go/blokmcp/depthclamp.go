package blokmcp

// messageDepthLimit is how deep a message may nest before clampDepth cuts it.
// Arguments start at depth 3 (4 in an HTTP batch), so clamped arguments still
// nest past the shared 48-level rule and the bundle refuses them in Node's
// words; and the engine, which fails past 64, never sees them deeper.
// test/unit/server-conformance/fixtures/mcp-depth-clamp.json holds it too.
const messageDepthLimit = 51

// maxJSONDepth is the shared bundle's MAX_JSON_DEPTH (src/shared/mcp/wire-json.ts).
const maxJSONDepth = 48

// textNestsDeeperThan is wire-json.ts's: brackets inside strings do not
// count, and the text need not be valid JSON.
func textNestsDeeperThan(text string, limit int) bool {
	depth := 0
	inString := false
	for at := 0; at < len(text); at++ {
		char := text[at]
		switch {
		case inString:
			if char == '\\' {
				at++
			} else if char == '"' {
				inString = false
			}
		case char == '"':
			inString = true
		case char == '{' || char == '[':
			depth++
		case char == '}' || char == ']':
			depth--
		}
		if depth > limit {
			return true
		}
	}
	return false
}

// clampDepth turns every object or array that opens deeper than limit into
// [], so no parser here recurses past it. Node parses any depth; what it
// would read past the limit is only ever refused or ignored. A dropped part
// that is not valid JSON cuts the text there and appends "!", so the message
// stays invalid, as it is for Node. Text that fits comes back unchanged.
func clampDepth(text []byte, limit int) []byte {
	depth := 0
	inString := false
	var out []byte
	from := 0
	for at := 0; at < len(text); at++ {
		char := text[at]
		if inString {
			if char == '\\' {
				at++
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '}', ']':
			depth--
		case '{', '[':
			if depth < limit {
				depth++
				continue
			}
			out = append(out, text[from:at]...)
			end, ok := skipValue(text, at)
			if !ok {
				return append(out, '!')
			}
			out = append(out, '[', ']')
			from = end
			at = end - 1
		}
	}
	if out == nil {
		return text
	}
	return append(out, text[from:]...)
}

// skipValue checks the object or array at start as JSON.parse would, with a
// stack instead of recursion, and returns the index just past it.
func skipValue(text []byte, start int) (int, bool) {
	const (
		value = iota
		valueOrClose
		key
		keyOrClose
		colon
		commaOrClose
	)
	var stack []byte
	state := value
	at := start
	for {
		for at < len(text) && (text[at] == ' ' || text[at] == '\t' || text[at] == '\n' || text[at] == '\r') {
			at++
		}
		if at >= len(text) {
			return 0, false
		}
		char := text[at]
		closed := false
		switch state {
		case keyOrClose, key:
			if char == '}' && state == keyOrClose {
				stack = stack[:len(stack)-1]
				at++
				closed = true
				break
			}
			if char != '"' {
				return 0, false
			}
			end, ok := skipString(text, at)
			if !ok {
				return 0, false
			}
			at = end
			state = colon
		case colon:
			if char != ':' {
				return 0, false
			}
			at++
			state = value
		case commaOrClose:
			top := stack[len(stack)-1]
			switch {
			case char == ',' && top == '{':
				at++
				state = key
			case char == ',':
				at++
				state = value
			case (char == '}' && top == '{') || (char == ']' && top == '['):
				stack = stack[:len(stack)-1]
				at++
				closed = true
			default:
				return 0, false
			}
		case valueOrClose, value:
			if char == ']' && state == valueOrClose {
				stack = stack[:len(stack)-1]
				at++
				closed = true
				break
			}
			switch {
			case char == '{':
				stack = append(stack, '{')
				at++
				state = keyOrClose
				continue
			case char == '[':
				stack = append(stack, '[')
				at++
				state = valueOrClose
				continue
			case char == '"':
				end, ok := skipString(text, at)
				if !ok {
					return 0, false
				}
				at = end
			default:
				end, ok := skipScalar(text, at)
				if !ok {
					return 0, false
				}
				at = end
			}
			closed = true
		}
		if closed {
			if len(stack) == 0 {
				return at, true
			}
			state = commaOrClose
		}
	}
}

func skipString(text []byte, at int) (int, bool) {
	for at++; at < len(text); at++ {
		switch char := text[at]; {
		case char == '"':
			return at + 1, true
		case char < 0x20:
			return 0, false
		case char == '\\':
			at++
			if at >= len(text) {
				return 0, false
			}
			switch text[at] {
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
			case 'u':
				for range 4 {
					at++
					if at >= len(text) || !isHex(text[at]) {
						return 0, false
					}
				}
			default:
				return 0, false
			}
		}
	}
	return 0, false
}

func isHex(char byte) bool {
	return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
}

// skipScalar reads true, false, null or a JSON number.
func skipScalar(text []byte, at int) (int, bool) {
	for _, literal := range []string{"true", "false", "null"} {
		if len(text)-at >= len(literal) && string(text[at:at+len(literal)]) == literal {
			return at + len(literal), true
		}
	}
	digits := func() bool {
		begin := at
		for at < len(text) && text[at] >= '0' && text[at] <= '9' {
			at++
		}
		return at > begin
	}
	if at < len(text) && text[at] == '-' {
		at++
	}
	if at < len(text) && text[at] == '0' {
		at++
	} else if !digits() {
		return 0, false
	}
	if at < len(text) && text[at] == '.' {
		at++
		if !digits() {
			return 0, false
		}
	}
	if at < len(text) && (text[at] == 'e' || text[at] == 'E') {
		at++
		if at < len(text) && (text[at] == '+' || text[at] == '-') {
			at++
		}
		if !digits() {
			return 0, false
		}
	}
	return at, true
}
