package blokagent

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// A port of C# JintFormulaLimitsTests: the formula caps of
// src/shared/database/formula/limits.ts as a server read sees them, with the
// same wall-clock bounds, so goja's regex engine is held to Jint's.

func computedOf(t *testing.T, expressions ...string) *jsjson.Node {
	t.Helper()
	schema := jsjson.NewArray(mustParse(t, `{"id":"t","name":"Name","type":"title","position":"a0"}`))
	for i, expression := range expressions {
		schema.Items = append(schema.Items, jsjson.NewObject(
			member("id", str("f"+strconv.Itoa(i))),
			member("name", str("F"+strconv.Itoa(i))),
			member("type", str("formula")),
			member("position", str("b"+strconv.Itoa(i))),
			member("formula", jsjson.NewObject(member("expression", str(expression)))),
		))
	}
	database := mustParse(t, `{"id":"db","type":"database","content":["r1"],"data":{"title":"Limits","activeViewId":"v1","views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}]}}`)
	setMember(lookup(database, "data"), "schema", schema)
	document, err := write(jsjson.NewObject(member("blocks", jsjson.NewArray(database,
		mustParse(t, `{"id":"r1","type":"database-row","parent":"db","data":{"position":"a0","properties":{"t":"One"}}}`)))))
	if err != nil {
		t.Fatal(err)
	}
	execution, err := sharedExecutor(t).Execute(context.Background(), document, `{"commands":[{"name":"doc.read","args":{"ids":["r1"]}}]}`, Actor{ID: "agent-cs", Name: "Server agent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	computed, ok := pointer(mustParse(t, execution.ResultJSON), "/results/0/blocks/0/computed")
	if !ok {
		t.Fatalf("no computed values: %.2000s", execution.ResultJSON)
	}
	return computed
}

func unavailableHas(t *testing.T, computed *jsjson.Node, id, want string) {
	t.Helper()
	reason, _ := stringOf(lookup(lookup(computed, id), "unavailable"))
	if !strings.Contains(reason, want) {
		t.Errorf("%s: %q does not say %q", id, reason, want)
	}
}

func isJSONTrue(t *testing.T, computed *jsjson.Node, id string) {
	t.Helper()
	if value := lookup(computed, id); value == nil || value.Kind != jsjson.KindTrue {
		t.Errorf("%s: %s, want true", id, stable(t, computed))
	}
}

func TestAFormulaNestedToTheCapReadsAndOnePastItIsACompileError(t *testing.T) {
	computed := computedOf(t,
		strings.Repeat("(", 63)+"1"+strings.Repeat(")", 63),
		strings.Join(slices.Repeat([]string{"1"}, 64), " + "),
		`"A"`+strings.Repeat(".lower()", 63),
		strings.Repeat("(", 64)+"1"+strings.Repeat(")", 64),
		strings.Repeat("(", 100000)+"1")
	for id, want := range map[string]string{"f0": "1", "f1": "64", "f2": `"a"`} {
		if got := stable(t, lookup(computed, id)); got != want {
			t.Errorf("%s = %s, want %s", id, got, want)
		}
	}
	unavailableHas(t, computed, "f3", "nest at most 64 levels deep")
	unavailableHas(t, computed, "f4", "at most 10000 characters long")
}

func TestAnEvilPatternAndAHugeRepeatReadAsUnavailableAtOnce(t *testing.T) {
	sharedExecutor(t)
	start := time.Now()
	computed := computedOf(t,
		`test("`+strings.Repeat("a", 30)+`b", "(a+)+$")`,
		`test(repeat("a", 5000) + "b", "a*a*a*$")`,
		`repeat("ab", 1000000000)`,
		`test("12-34", "^\\d+-\\d+$")`,
		`test("foobarfoo", "^(foo|bar)+$")`)
	if elapsed := time.Since(start); elapsed >= 5*time.Second {
		t.Errorf("took %v, C# allows 5 s", elapsed)
	}
	unavailableHas(t, computed, "f0", "could run too long")
	unavailableHas(t, computed, "f1", "passed a limit")
	unavailableHas(t, computed, "f2", "passed a limit")
	isJSONTrue(t, computed, "f3")
	isJSONTrue(t, computed, "f4")
}

func TestZeroWidthAndMultiCharacterEscapesReadAsUnavailableAtOnce(t *testing.T) {
	sharedExecutor(t)
	start := time.Now()
	computed := computedOf(t,
		`test("`+strings.Repeat("a", 30)+`!", "(\\B\\Ba|\\B\\Ba)+$")`,
		`test("`+strings.Repeat("a", 30)+`!", "(\\x61|\\x61)+$")`,
		`test("aaa", "(?:\\b)+")`,
		`test("foo bar", "\\bbar\\b")`)
	unavailableHas(t, computed, "f0", "passed a limit")
	unavailableHas(t, computed, "f1", "passed a limit")
	unavailableHas(t, computed, "f2", "could run too long")
	isJSONTrue(t, computed, "f3")
	if elapsed := time.Since(start); elapsed >= 10*time.Second {
		t.Errorf("took %v, C# allows 10 s", elapsed)
	}
}
