package yjs

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

func TestHeadIDNamesTheItemHoldingTheValue(t *testing.T) {
	id := uint32(7)
	doc := NewDoc(Options{ClientID: &id})
	page := doc.GetMap(jsjson.FromString("page"))
	doc.Transact(func(tx *Transaction) { page.Set(tx, jsjson.FromString("a"), 1.0) })
	doc.Transact(func(tx *Transaction) { page.Set(tx, jsjson.FromString("a"), 2.0) })
	got, ok := page.HeadID(jsjson.FromString("a"))
	if !ok || got != (ID{Client: 7, Clock: 1}) {
		t.Fatalf("HeadID = %v, %v; want {7 1}", got, ok)
	}
	doc.Transact(func(tx *Transaction) { page.Delete(tx, jsjson.FromString("a")) })
	if _, ok := page.HeadID(jsjson.FromString("a")); ok {
		t.Fatal("a deleted key still has a head")
	}
	if _, ok := page.HeadID(jsjson.FromString("b")); ok {
		t.Fatal("an absent key has a head")
	}
}
