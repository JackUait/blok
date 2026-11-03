package workingset

import (
	"context"
	"encoding/hex"
	"errors"
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
)

type frameCase struct {
	Format  int32    `json:"format"`
	Epoch   string   `json:"epoch"`
	Lineage string   `json:"lineage"`
	Frames  []string `json:"frames"`
	Hex     string   `json:"hex"`
}

type codecs struct {
	DocKeys []struct {
		DocID string `json:"docId"`
		Key   string `json:"sha256"`
	} `json:"docKeys"`
	WorkingSet struct {
		Encode  []frameCase `json:"encode"`
		Refused []struct {
			Name  string `json:"name"`
			Hex   string `json:"hex"`
			Error string `json:"error"`
			Log   string `json:"log"`
		} `json:"refused"`
		EncodeRefusals []frameCase `json:"encodeRefusals"`
		Law            []struct {
			Stored string  `json:"stored"`
			Next   string  `json:"next"`
			Write  *string `json:"write"`
			Reset  *string `json:"reset"`
		} `json:"law"`
	} `json:"workingSet"`
}

func load(t *testing.T) codecs {
	var fixture codecs
	collabtest.Read(t, "collab-disk/codecs.json", &fixture)
	return fixture
}

func epoch(t *testing.T, text string) int64 {
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func frames(t *testing.T, texts []string) [][]byte {
	var out [][]byte
	for _, text := range texts {
		out = append(out, collabtest.Hex(t, text))
	}
	return out
}

func TestDocKeysMatchCSharp(t *testing.T) {
	fixture := load(t)
	if len(fixture.DocKeys) == 0 {
		t.Fatal("no doc keys")
	}
	for _, c := range fixture.DocKeys {
		if got := DocKey(c.DocID); got != c.Key {
			t.Errorf("%q: %s, want %s", c.DocID, got, c.Key)
		}
	}
}

func TestEncodesEveryWorkingSetToTheBytesCSharpWrites(t *testing.T) {
	for _, c := range load(t).WorkingSet.Encode {
		tag := Tag{Format: c.Format, Epoch: epoch(t, c.Epoch), Lineage: c.Lineage}
		section, err := EncodeFrames(frames(t, c.Frames))
		if err != nil {
			t.Fatal(err)
		}
		document, err := EncodeDocument(tag, section)
		if err != nil {
			t.Fatal(err)
		}
		if got := hex.EncodeToString(document); got != c.Hex {
			t.Fatalf("%v:\n got %s\nwant %s", tag, got, c.Hex)
		}
		decodedTag, decodedSection, message, ok := DecodeDocument(document)
		if !ok || decodedTag != tag || message != "" {
			t.Fatalf("%v: decoded %v %q", tag, decodedTag, message)
		}
		updates, ok := DecodeFrames(decodedSection)
		if !ok || len(updates) != len(c.Frames) {
			t.Fatalf("%v: frames %v", tag, updates)
		}
		for i, update := range updates {
			if hex.EncodeToString(update) != c.Frames[i] {
				t.Fatalf("%v: frame %d", tag, i)
			}
		}
	}
}

func TestRefusesEveryBrokenWorkingSetLikeCSharp(t *testing.T) {
	for _, c := range load(t).WorkingSet.Refused {
		document := collabtest.Hex(t, c.Hex)
		if _, _, message, ok := DecodeDocument(document); ok || message != c.Error {
			t.Errorf("%s: %v %q, want %q", c.Name, ok, message, c.Error)
		}
		var logged string
		if set := DecodeOrAbsent("doc-1", document, func(message string) { logged = message }); set != nil || logged != c.Log {
			t.Errorf("%s: logged %q, want %q", c.Name, logged, c.Log)
		}
	}
}

func TestRefusesToEncodeWhatCSharpRefuses(t *testing.T) {
	for _, c := range load(t).WorkingSet.EncodeRefusals {
		tag := Tag{Format: c.Format, Epoch: epoch(t, c.Epoch), Lineage: c.Lineage}
		section, err := EncodeFrames(frames(t, c.Frames))
		if err == nil {
			_, err = EncodeDocument(tag, section)
		}
		if err == nil {
			t.Errorf("%v frames %v: encoded", tag, c.Frames)
		}
	}
	tag := Tag{Format: 2, Epoch: 0, Lineage: NewLineage()}
	if _, err := EncodeDocument(tag, []byte{0, 0, 0, 0}); err == nil {
		t.Error("an invalid frame section encoded")
	}
}

func TestTheEpochLawMatchesCSharp(t *testing.T) {
	cases := load(t).WorkingSet.Law
	if len(cases) == 0 {
		t.Fatal("no law cases")
	}
	for _, c := range cases {
		stored := &Set{Tag: Tag{Format: 2, Epoch: epoch(t, c.Stored), Lineage: "fedcba9876543210fedcba9876543210"}}
		next := Tag{Format: 2, Epoch: epoch(t, c.Next), Lineage: stored.Tag.Lineage}
		check := func(name string, err error, want *string) {
			switch {
			case want == nil && err != nil:
				t.Errorf("%s %s->%s: %v", name, c.Stored, c.Next, err)
			case want != nil && (err == nil || err.Error() != *want):
				t.Errorf("%s %s->%s: %v, want %q", name, c.Stored, c.Next, err, *want)
			}
		}
		check("write", EnsureWriteDoesNotLowerEpoch(`doc "1"`, stored, next), c.Write)
		check("reset", EnsureResetRaisesEpoch(`doc "1"`, stored, next), c.Reset)
		if EnsureWriteDoesNotLowerEpoch("d", nil, next) != nil || EnsureResetRaisesEpoch("d", nil, next) != nil {
			t.Error("no stored set must pass")
		}
	}
}

// Port of the GuardAsync rule: a cancellation the caller did not ask for is a store failure.
func TestGuardTurnsAForeignCancellationIntoAStoreError(t *testing.T) {
	err := Guard(context.Background(), "doc-1", "read", func() error { return context.DeadlineExceeded })
	var storeErr *StoreError
	if !errors.As(err, &storeErr) || storeErr.DocID != "doc-1" || storeErr.What != "read" || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("foreign timeout: %#v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = Guard(ctx, "doc-1", "read", func() error { return context.Canceled })
	if errors.As(err, &storeErr) || !errors.Is(err, context.Canceled) {
		t.Fatalf("own cancellation must pass through: %#v", err)
	}
	plain := errors.New("disk")
	if err := Guard(context.Background(), "doc-1", "read", func() error { return plain }); err != plain {
		t.Fatalf("other errors pass through: %v", err)
	}
}
