package jsjson

import (
	"errors"
	"testing"
)

func mustNode(t *testing.T, text string) *Node {
	t.Helper()
	node, err := ParseNode([]byte(text), Options{})
	if err != nil {
		t.Fatalf("parse %s: %v", text, err)
	}
	return node
}

func written(t *testing.T, node *Node) string {
	t.Helper()
	out, err := node.AppendJSON(nil)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	return string(out)
}

func TestBuiltNodesWriteLikeSystemTextJSON(t *testing.T) {
	object := NewObject(
		NewMember("s", NewString(FromString("é<\"🚀"))),
		NewMember("t", NewBool(true)),
		NewMember("n", NewNull()),
		NewMember("a", NewArray(NewBool(false), NewString(FromString("x")))),
	)
	want := "{\"s\":\"\\u00E9\\u003C\\u0022\\uD83D\\uDE80\",\"t\":true,\"n\":null,\"a\":[false,\"x\"]}"
	if got := written(t, object); got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
	text, err := object.Members[0].Value.Text()
	if err != nil || text.String() != "é<\"🚀" {
		t.Fatalf("text %q %v", text.String(), err)
	}
}

func TestSetReplacesInPlaceOrAppends(t *testing.T) {
	object := mustNode(t, `{"a":1,"b":2}`)
	if err := object.Set("a", NewBool(true)); err != nil {
		t.Fatal(err)
	}
	if err := object.Set("c", NewNull()); err != nil {
		t.Fatal(err)
	}
	if got := written(t, object); got != `{"a":true,"b":2,"c":null}` {
		t.Fatalf("got %s", got)
	}
	if !object.Remove("b") || object.Remove("zz") {
		t.Fatal("remove")
	}
	if got := written(t, object); got != `{"a":true,"c":null}` {
		t.Fatalf("got %s", got)
	}
}

func TestLookupFailsAsTheJsonObjectIndexerDoes(t *testing.T) {
	found, err := mustNode(t, `{"a":1,"b":2}`).Lookup("b")
	if err != nil || string(found.Raw()) != "2" {
		t.Fatalf("escaped key: %v %v", found, err)
	}
	if missing, err := mustNode(t, `{"a":1}`).Lookup("b"); missing != nil || err != nil {
		t.Fatalf("missing: %v %v", missing, err)
	}
	// Any repeat fails, even one under another name.
	if _, err := mustNode(t, `{"a":1,"x":2,"x":3}`).Lookup("a"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := mustNode(t, `{"a":1,"\ud800":2}`).Lookup("a"); !errors.Is(err, ErrLoneSurrogate) {
		t.Fatalf("lone: %v", err)
	}
	if found, err := mustNode(t, `[1]`).Lookup("a"); found != nil || err != nil {
		t.Fatalf("array: %v %v", found, err)
	}
}

func TestCloneIsDeep(t *testing.T) {
	original := mustNode(t, `{"a":[{"b":1}]}`)
	copied := original.Clone()
	inner, err := copied.Lookup("a")
	if err != nil {
		t.Fatal(err)
	}
	if err := inner.Items[0].Set("b", NewNull()); err != nil {
		t.Fatal(err)
	}
	if got := written(t, original); got != `{"a":[{"b":1}]}` {
		t.Fatalf("original changed: %s", got)
	}
	if got := written(t, copied); got != `{"a":[{"b":null}]}` {
		t.Fatalf("copy: %s", got)
	}
}

// A Go string with invalid UTF-8 stands for a .NET string holding U+FFFD.
func TestLookupReadsInvalidUTF8KeysAsReplacement(t *testing.T) {
	found, err := mustNode(t, "{\"a\xff\":1}").Lookup("a�")
	if err != nil || found == nil || string(found.Raw()) != "1" {
		t.Fatalf("got %v %v", found, err)
	}
}
