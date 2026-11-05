package jsruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

type opsPart struct {
	Literal string
	Repeat  int      `json:"repeat"`
	Join    string   `json:"join"`
	Items   []string `json:"items"`
}

func (p *opsPart) UnmarshalJSON(data []byte) error {
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &p.Literal)
	}
	type plain opsPart
	return json.Unmarshal(data, (*plain)(p))
}

type opsCase struct {
	Name        string `json:"name"`
	Op          string `json:"op"`
	Input       string `json:"input"`
	InputRecipe *struct {
		Parts []opsPart `json:"parts"`
	} `json:"inputRecipe"`
	Output       *string `json:"output"`
	OutputSha256 string  `json:"outputSha256"`
	ErrorName    string  `json:"errorName"`
	NormalizeIDs bool    `json:"normalizeIds"`
}

func (c opsCase) input() string {
	if c.InputRecipe == nil {
		return c.Input
	}
	var b strings.Builder
	for _, part := range c.InputRecipe.Parts {
		if part.Items == nil {
			b.WriteString(part.Literal)
			continue
		}
		for i := range part.Repeat {
			if i > 0 {
				b.WriteString(part.Join)
			}
			b.WriteString(strings.ReplaceAll(part.Items[i%len(part.Items)], "{i}", strconv.Itoa(i)))
		}
	}
	return b.String()
}

var importIDs = regexp.MustCompile(`"(md|html)-[a-z0-9]+-`)

var surrogateEscape = regexp.MustCompile(`\\u[dD][89a-fA-F][0-9a-fA-F]{2}`)

// gojaReadsLoneSurrogates is what goja makes of node's answer: its JSON.parse
// reads a lone-surrogate escape as U+FFFD (measured), where node keeps the
// unit. The C# runner applies the same rewrite. Paired escapes stay escapes.
func gojaReadsLoneSurrogates(want string) string {
	matches := surrogateEscape.FindAllStringIndex(want, -1)
	high := func(i int) bool { return strings.ContainsAny(want[matches[i][0]+3:matches[i][0]+4], "89abAB") }
	var b strings.Builder
	last := 0
	for i := 0; i < len(matches); i++ {
		paired := high(i) && i+1 < len(matches) && matches[i+1][0] == matches[i][1] && !high(i+1)
		b.WriteString(want[last:matches[i][0]])
		if paired {
			b.WriteString(want[matches[i][0]:matches[i+1][1]])
			last = matches[i+1][1]
			i++
			continue
		}
		b.WriteRune(0xfffd)
		last = matches[i][1]
	}
	b.WriteString(want[last:])
	return b.String()
}

// Outputs are node:vm's answers (scripts/generate-documents-ops-fixture.mjs);
// C# DocumentOpsFixtureTests checks Jint against the same file.
func TestMatchesNodeOnTheDocumentOpsFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents/ops.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []opsCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 300 {
		t.Fatalf("only %d cases", len(cases))
	}
	pool, err := NewPool(Options{PoolSize: new(1)})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			big := strings.HasPrefix(c.Name, "big.")
			if big && (testing.Short() || raceEnabled) {
				t.Skip("large document: run without -short and -race")
			}
			start := time.Now()
			got, err := pool.Invoke(context.Background(), c.Op, c.input(), 5*time.Minute)
			if big {
				t.Logf("%s: %v", c.Op, time.Since(start).Round(time.Millisecond))
			}
			if c.ErrorName != "" {
				var failure *Failure
				var jsErr *JSError
				if !errors.As(err, &failure) || !errors.As(err, &jsErr) || jsErr.Name != c.ErrorName {
					t.Fatalf("err = %v, want a %s", err, c.ErrorName)
				}
				return
			}
			if err != nil {
				t.Fatalf("Invoke: %v", err)
			}
			if c.NormalizeIDs {
				got = importIDs.ReplaceAllString(got, `"$1-X-`)
			}
			if c.Output != nil {
				want := *c.Output
				if strings.HasPrefix(c.Name, "lone.") {
					want = gojaReadsLoneSurrogates(want)
				}
				if got != want {
					t.Fatalf("output differs\n got %.400q\nwant %.400q", got, want)
				}
				return
			}
			sum := sha256.Sum256([]byte(got))
			if hex.EncodeToString(sum[:]) != c.OutputSha256 {
				t.Fatalf("output sha256 differs; got %d bytes starting %.200q", len(got), got)
			}
		})
	}
}

func bigCases(t *testing.T) map[string]opsCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents/ops.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []opsCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	big := map[string]opsCase{}
	for _, c := range cases {
		if strings.HasPrefix(c.Name, "big.") {
			big[c.Name] = c
		}
	}
	return big
}

// C# (Jint) stops these big documents at a 64 MiB budget and converts the
// rest; at the default budget it converts them all (the ops fixture test).
var stoppedAt64MiB = map[string]bool{
	"big.plain.text":            false,
	"big.plain.markdown":        true,
	"big.plain.html":            false,
	"big.marked.text":           true,
	"big.marked.markdown":       true,
	"big.marked.html":           true,
	"big.marked.pageIndex":      true,
	"big.marked.extract":        false,
	"big.url.image.markdown":    true,
	"big.url.bookmark.markdown": true,
	"big.fromMarkdown":          true,
}

func TestStopsTheBigDocumentsCSharpStopsAt64MiB(t *testing.T) {
	if testing.Short() || raceEnabled {
		t.Skip("large documents: run without -short and -race")
	}
	cases := bigCases(t)
	if len(cases) != len(stoppedAt64MiB) {
		t.Fatalf("%d big cases, the table has %d", len(cases), len(stoppedAt64MiB))
	}
	pool, err := NewPool(Options{PoolSize: new(1), MemoryBudget: 64 << 20, Timeout: 5 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	for name, stopped := range stoppedAt64MiB {
		_, err := pool.Invoke(context.Background(), cases[name].Op, cases[name].input(), 0)
		var failure *Failure
		gotStopped := errors.As(err, &failure) && failure.Kind == KindDocumentTooLarge
		if gotStopped != stopped || (err != nil && !gotStopped) {
			t.Errorf("%s: err = %v, want stopped = %v", name, err, stopped)
		}
	}
}

// A 32 MiB base64 image: C# refuses Markdown at its default budget and
// converts plain text and HTML.
func TestConvertsA32MiBImageAsCSharpDoesAtTheDefaultBudget(t *testing.T) {
	if testing.Short() || raceEnabled {
		t.Skip("large documents: run without -short and -race")
	}
	input := `{"blocks":[{"id":"u1","type":"image","data":{"url":"data:image/png;base64,` +
		strings.Repeat("A", 32<<20) + `"}}]}`
	pool, err := NewPool(Options{PoolSize: new(1), Timeout: 5 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	for op, stopped := range map[string]bool{"blocksToMarkdown": true, "blocksToPlainText": false, "blocksToHtml": false} {
		_, err := pool.Invoke(context.Background(), op, input, 0)
		var failure *Failure
		gotStopped := errors.As(err, &failure) && failure.Kind == KindDocumentTooLarge
		if gotStopped != stopped || (err != nil && !gotStopped) {
			t.Errorf("%s: err = %v, want stopped = %v", op, err, stopped)
		}
	}
}
