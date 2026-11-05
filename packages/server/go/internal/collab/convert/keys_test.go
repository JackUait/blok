package convert

import (
	"fmt"
	"slices"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
)

// fixtures/converter-keys.json is shared with the client tests and C#
// ConverterKeysFixtureTests; each side checks its own copy against it.
func TestTheKeySetsAndConjunctTablesMatchTheSharedFixture(t *testing.T) {
	var fixture struct {
		DiffableTextKeys   []string `json:"diffableTextKeys"`
		OrderedIDArrayKeys []string `json:"orderedIdArrayKeys"`
		ConjunctLinkers    []string `json:"conjunctLinkers"`
		ConjunctConsonants []string `json:"conjunctConsonants"`
		ConjunctBreakers   []string `json:"conjunctBreakers"`
	}
	collabtest.Read(t, "converter-keys.json", &fixture)
	if !slices.Equal(diffableTextKeys, fixture.DiffableTextKeys) {
		t.Errorf("diffableTextKeys %v, want %v", diffableTextKeys, fixture.DiffableTextKeys)
	}
	if !slices.Equal(orderedIDArrayKeys, fixture.OrderedIDArrayKeys) {
		t.Errorf("orderedIDArrayKeys %v, want %v", orderedIDArrayKeys, fixture.OrderedIDArrayKeys)
	}
	for name, pair := range map[string]struct {
		table []rune
		want  []string
	}{
		"conjunctLinkers":    {conjunctLinkers, fixture.ConjunctLinkers},
		"conjunctConsonants": {conjunctConsonants, fixture.ConjunctConsonants},
		"conjunctBreakers":   {conjunctBreakers, fixture.ConjunctBreakers},
	} {
		var got []string
		for at := 0; at < len(pair.table); at += 2 {
			got = append(got, fmt.Sprintf("%04X-%04X", pair.table[at], pair.table[at+1]))
		}
		if len(pair.want) == 0 || !slices.Equal(got, pair.want) {
			t.Errorf("%s differs from the fixture", name)
		}
	}
}
