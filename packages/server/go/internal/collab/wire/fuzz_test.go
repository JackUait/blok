package wire

import (
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
)

func seedFromFixtures(f *testing.F) {
	var fixture wireFixture
	readFixture(f, "sync-wire-decode.json", &fixture)
	for _, c := range fixture.Decode {
		b, _ := hex.DecodeString(c.FrameHex)
		f.Add(b)
	}
	for _, c := range fixture.Awareness {
		b, _ := hex.DecodeString(c.PayloadHex)
		f.Add(append([]byte{1}, appendVarBytes(nil, b)...))
	}
}

// Decode never panics, and anything it accepts (bar Unknown) encodes and
// decodes back to the same message.
func FuzzDecode(f *testing.F) {
	seedFromFixtures(f)
	f.Fuzz(func(t *testing.T, frame []byte) {
		m, err := Decode(frame)
		if err != nil {
			if m != nil || err.Reason == "" {
				t.Fatalf("a refusal carries a message or no reason: %#v %#v", m, err)
			}
			return
		}
		if _, unknown := m.(Unknown); unknown {
			return
		}
		again, encodeErr := Encode(m)
		if encodeErr != nil {
			t.Fatalf("decoded %#v but cannot encode it: %v", m, encodeErr)
		}
		back, decodeErr := Decode(again)
		if decodeErr != nil || !reflect.DeepEqual(normal(back), normal(m)) {
			t.Fatalf("round trip changed %#v into %#v (%v)", m, back, decodeErr)
		}
		if awareness, ok := m.(Awareness); ok {
			var entries []AwarenessEntry
			ValidateAwarenessUpdate(awareness.Update, 1<<20, &entries)
		}
	})
}

// normal makes an empty identity list compare equal to a nil one.
func normal(m Message) Message {
	if identities, ok := m.(Identities); ok && len(identities.Identities) == 0 {
		return Identities{}
	}
	return m
}

// The reader is the grammar encoding/json checks, cut at depth 64 and with
// no UTF-8 check: on input Go calls valid, it must agree but for depth.
func FuzzJSONReader(f *testing.F) {
	for _, seed := range []string{`{}`, `[1,2]`, `{"a":[{"b":null}]}`, `"\ud800"`, `1e5`, ` 0 `, `[[[]]]`, `-0.5E-3`, `{"a":1,}`, "\"\x1f\""} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, text []byte) {
		got := isJSONDocument(text)
		if !json.Valid(text) {
			if got {
				t.Fatalf("%q: accepted, but it is not JSON", text)
			}
			return
		}
		if want := nesting(text) <= maxDepth; got != want {
			t.Fatalf("%q: got %v, want %v (depth %d)", text, got, want, nesting(text))
		}
	})
}

// nesting is the deepest container level of valid JSON.
func nesting(text []byte) int {
	depth, deepest, inString := 0, 0, false
	for i := 0; i < len(text); i++ {
		c := text[i]
		switch {
		case inString && c == '\\':
			i++
		case c == '"':
			inString = !inString
		case inString:
		case c == '{' || c == '[':
			depth++
			deepest = max(deepest, depth)
		case c == '}' || c == ']':
			depth--
		}
	}
	return deepest
}
