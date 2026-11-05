package convert

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// Twins of C# YDocConverterTextDiffTests: a host's /edit on a custom tool's
// plain text merges with a peer's concurrent edit as the client's does.

func tdQuote(t *testing.T, text string) string {
	t.Helper()
	quoted, err := json.Marshal(text)
	if err != nil {
		t.Fatal(err)
	}
	return string(quoted)
}

func tdSeeded(t *testing.T, text string) *yjs.Doc {
	return agSeeded(t, `[{ "id": "p", "type": "note", "data": { "text": `+tdQuote(t, text)+` } }]`)
}

func tdUpdate(t *testing.T, doc *yjs.Doc, text string) {
	t.Helper()
	rowApply(t, doc, `{ "op": "update", "id": "p", "data": { "text": `+tdQuote(t, text)+` } }`)
}

func tdText(t *testing.T, doc *yjs.Doc) *yjs.Text {
	t.Helper()
	text, ok := rowEntry(t, rowData(t, doc, "p"), "text").(*yjs.Text)
	if !ok {
		t.Fatal("text is not a YText")
	}
	return text
}

func tdTextOf(t *testing.T, doc *yjs.Doc) string { return tdText(t, doc).String() }

// tdSetText types into the peer's own YText the way a person does.
func tdSetText(t *testing.T, doc *yjs.Doc, next string) {
	t.Helper()
	text := tdText(t, doc)
	edits := Diff(text.Units(), str(next), true)
	doc.Transact(func(tx *yjs.Transaction) {
		for _, edit := range slices.Backward(edits) {
			if edit.Remove > 0 {
				text.Delete(tx, edit.Index, edit.Remove)
			}
			if len(edit.Insert) > 0 {
				text.Insert(tx, edit.Index, edit.Insert, nil)
			}
		}
	})
	if got := text.String(); got != next {
		t.Fatalf("typed %q, want %q", got, next)
	}
}

// tdWellFormed checks the UTF-16 units: no U+FFFD and no lone surrogate.
func tdWellFormed(t *testing.T, doc *yjs.Doc) {
	t.Helper()
	units := tdText(t, doc).Units()
	for i := 0; i < len(units); i++ {
		switch unit := rune(units[i]); {
		case unit == 0xFFFD:
			t.Fatalf("U+FFFD at %d", i)
		case utf16.IsSurrogate(unit) && unit < 0xDC00:
			if i+1 >= len(units) || units[i+1] < 0xDC00 || units[i+1] > 0xDFFF {
				t.Fatalf("lone high surrogate at %d", i)
			}
			i++
		case utf16.IsSurrogate(unit):
			t.Fatalf("lone low surrogate at %d", i)
		}
	}
}

func tdOnce(t *testing.T, merged string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if n := strings.Count(merged, needle); n != 1 {
			t.Fatalf("%q appears %d times in %q", needle, n, merged)
		}
	}
}

// tdConcurrent runs the peer's typing and the host's edit at once, then
// syncs both ways and returns the merged text, the same on both sides.
func tdConcurrent(t *testing.T, seed, peerText, hostText string) (*yjs.Doc, string) {
	t.Helper()
	server := tdSeeded(t, seed)
	peer := rowPeer(t, server)
	tdSetText(t, peer, peerText)
	tdUpdate(t, server, hostText)
	rowExchange(t, server, peer)
	merged := tdTextOf(t, server)
	if other := tdTextOf(t, peer); other != merged {
		t.Fatalf("server %q, peer %q", merged, other)
	}
	return server, merged
}

func TestTwoPeersWrappingOverlappingPhrasesKeepEveryWordOnce(t *testing.T) {
	_, merged := tdConcurrent(t, "the quick brown fox", "the <b>quick brown</b> fox", "the quick <i>brown fox</i>")
	tdOnce(t, merged, "quick", "brown", "fox")
}

func TestTwoPeersWrappingTheSamePhraseDoNotDuplicateIt(t *testing.T) {
	_, merged := tdConcurrent(t, "the quick brown fox", "the <b>quick brown</b> fox", "the <i>quick brown</i> fox")
	tdOnce(t, merged, "quick brown", "the ", " fox")
}

func TestAPeersWordInsideTheRewrittenPhraseIsNotDuplicated(t *testing.T) {
	_, merged := tdConcurrent(t, "one two three four", "one two THREE four", "one <b>two three</b> four")
	tdOnce(t, merged, "two", "four")
}

func TestConcurrentEditsAroundAnEmojiKeepItWellFormed(t *testing.T) {
	server, merged := tdConcurrent(t, "a \U0001F44D b", "a \U0001F44D b!", "A \U0001F44D b")
	tdWellFormed(t, server)
	tdOnce(t, merged, "\U0001F44D")
}

func TestASingleWriterEditLandsWhole(t *testing.T) {
	family := "\U0001F468‍\U0001F469‍\U0001F467‍\U0001F466"
	for _, row := range []struct{ name, before, after string }{
		{"AppendingKeepsTheExistingCharacters", "hello", "hello world"},
		{"AnEditBesideAFamilyEmojiLeavesItWhole", "hi " + family + " there", "hi " + family + " you"},
		{"SwappingOneFlagForAnotherKeepsBothWellFormed", "from \U0001F1FA\U0001F1F8 today", "from \U0001F1EB\U0001F1F7 today"},
		{"ChangingASkinToneKeepsTheEmojiWellFormed", "nice \U0001F44D\U0001F3FD!", "nice \U0001F44D\U0001F3FF!"},
		{"DeletingAWordKeepsTheRest", "one two three", "one three"},
		{"AWholeStringRewritePastTheCapStillLands", strings.Repeat("a", 200), strings.Repeat("b", 200)},
		// Past the cap the one changed region sets the boundaries, and it must
		// roll back off a surrogate pair.
		{"AnEmojiRewritePastTheCapStaysWellFormed", strings.Repeat("\U0001F44D", 40) + " tail", strings.Repeat("\U0001F44E", 40) + " tail"},
	} {
		t.Run(row.name, func(t *testing.T) {
			doc := tdSeeded(t, row.before)
			tdUpdate(t, doc, row.after)
			tdWellFormed(t, doc)
			if got := tdTextOf(t, doc); got != row.after {
				t.Fatalf("%q, want %q", got, row.after)
			}
		})
	}
}
