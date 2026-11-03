package convert

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

type digestFixture struct {
	Parse []struct {
		Name      string  `json:"name"`
		Body      *string `json:"body"`
		BodyHex   string  `json:"bodyHex"`
		Canonical *string `json:"canonical"`
		DigestHex string  `json:"digestHex"`
		Error     *string `json:"error"`
	} `json:"parse"`
	Agent []struct {
		Name             string  `json:"name"`
		LastEditedAtBits *string `json:"lastEditedAtBits"`
		Canonical        string  `json:"canonical"`
		DigestHex        string  `json:"digestHex"`
	} `json:"agent"`
	Keys []struct {
		Key         string  `json:"key"`
		OperationID *string `json:"operationId"`
	} `json:"keys"`
	Restore []struct {
		Lineage   string `json:"lineage"`
		Sequence  string `json:"sequence"`
		DigestHex string `json:"digestHex"`
	} `json:"restore"`
}

func loadDigest(t *testing.T) digestFixture {
	var fixture digestFixture
	collabtest.Read(t, "canonical-edit-digest.json", &fixture)
	if len(fixture.Parse) == 0 || len(fixture.Agent) == 0 || len(fixture.Keys) == 0 || len(fixture.Restore) == 0 {
		t.Fatal("the fixture is missing a section")
	}
	return fixture
}

func TestParsesEveryEditBodyLikeCSharp(t *testing.T) {
	for _, c := range loadDigest(t).Parse {
		body := []byte(nil)
		if c.Body != nil {
			body = []byte(*c.Body)
		} else {
			body = collabtest.Hex(t, c.BodyHex)
		}
		ops, err := ParseEditOps(body)
		if c.Error != nil {
			if err == nil || err.Error() != *c.Error {
				t.Errorf("%s: got %v, want %q", c.Name, err, *c.Error)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		canonical, err := CanonicalBody(ops)
		if err != nil || string(canonical) != *c.Canonical {
			t.Errorf("%s:\n got %s %v\nwant %s", c.Name, canonical, err, *c.Canonical)
			continue
		}
		if digest, _ := CanonicalBodyDigest(ops); hex.EncodeToString(digest) != c.DigestHex {
			t.Errorf("%s: digest differs", c.Name)
		}
	}
}

// The agent builds these ops in code; each must digest like C#.
func TestDigestsEveryAgentOpLikeCSharp(t *testing.T) {
	text := func(s string) *string { return &s }
	node := func(s string) *jsjson.Node {
		n, err := jsjson.ParseNode([]byte(s), jsjson.Options{})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	ops := map[string]EditOp{
		"move":                          Move{ID: "b1", After: text("b0"), Parent: text("p1")},
		"move to the start of the root": Move{ID: "b1"},
		"lift":                          Lift{ID: "b1"},
		"retype":                        Retype{ID: "b1", Type: "header", Data: node(`{"z":1,"a":"é","level":2.5}`)},
		"setTunes":                      SetTunes{ID: "b1", Tunes: node(`{"align":"left","anchor":null}`)},
		"setPageField":                  SetPageField{Key: "title", Value: node(`"Hi"`)},
		"setPageField null":             SetPageField{Key: "icon"},
		"setPageField object":           SetPageField{Key: "icon", Value: node(`{"value":"x","type":"emoji"}`)},
	}
	metadata := map[string]SetMetadata{
		"setMetadata":               {ID: "b1", LastEditedBy: "user-1"},
		"setMetadata with":          {ID: "b1", LastEditedBy: "u<1>", LastEditedWith: text("agent")},
		"setMetadata large":         {ID: "b1", LastEditedBy: "u"},
		"setMetadata small":         {ID: "b1", LastEditedBy: "u"},
		"setMetadata negative zero": {ID: "b1", LastEditedBy: "u"},
		"setMetadata max":           {ID: "b1", LastEditedBy: "u"},
	}
	for _, c := range loadDigest(t).Agent {
		op, ok := ops[c.Name]
		if m, isMetadata := metadata[c.Name]; isMetadata {
			bits, err := strconv.ParseInt(*c.LastEditedAtBits, 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			m.LastEditedAt = math.Float64frombits(uint64(bits))
			op, ok = m, true
		}
		if !ok {
			t.Errorf("%s: no Go op for this case", c.Name)
			continue
		}
		canonical, err := CanonicalBody([]EditOp{op})
		if err != nil || string(canonical) != c.Canonical {
			t.Errorf("%s:\n got %s %v\nwant %s", c.Name, canonical, err, c.Canonical)
			continue
		}
		sum := sha256.Sum256(canonical)
		if hex.EncodeToString(sum[:]) != c.DigestHex {
			t.Errorf("%s: digest differs", c.Name)
		}
	}
	if _, err := CanonicalBody([]EditOp{PatchMaps{}}); err == nil {
		t.Error("a map patch has no canonical body")
	}
}

func TestMapsIdempotencyKeysLikeCSharp(t *testing.T) {
	for _, c := range loadDigest(t).Keys {
		id, ok := NormalizeIdempotencyKey(c.Key)
		if (c.OperationID == nil) == ok || (ok && id != *c.OperationID) {
			t.Errorf("%q: %q %v, want %v", c.Key, id, ok, c.OperationID)
		}
	}
}

func TestDigestsARestoreLikeCSharp(t *testing.T) {
	for _, c := range loadDigest(t).Restore {
		sequence, err := strconv.ParseUint(c.Sequence, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		if got := hex.EncodeToString(RestoreDigest(c.Lineage, sequence)); got != c.DigestHex {
			t.Errorf("%s %s: %s, want %s", c.Lineage, c.Sequence, got, c.DigestHex)
		}
	}
}
