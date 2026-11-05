package journal

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

func TestEncodesEveryLedgerEntryToTheBytesCSharpWrites(t *testing.T) {
	fixture := load(t)
	if len(fixture.Ledger.Encode) == 0 {
		t.Fatal("no ledger cases")
	}
	for _, c := range fixture.Ledger.Encode {
		entry := LineageEntry{
			Kind:            LineageEntryKind(c.Kind),
			Generation:      u64(t, c.Generation),
			GenerationFence: u64(t, c.GenerationFence),
			Lineage:         c.Lineage,
			Epoch:           i64(t, c.Epoch),
			Format:          int32(c.Format),
		}
		if c.Ticks != nil {
			at := dotnet.TimeFromTicks(i64(t, *c.Ticks))
			entry.CreatedAt = &at
		}
		if got := hex.EncodeToString(EncodeLineageEntry(entry)); got != c.Hex {
			t.Fatalf("generation %s:\n got %s\nwant %s", c.Generation, got, c.Hex)
		}
		decoded, ok := DecodeLineageEntry(collabtest.Hex(t, c.Hex))
		if !ok {
			t.Fatalf("generation %s: not decoded", c.Generation)
		}
		if decoded.Kind != entry.Kind || decoded.Generation != entry.Generation ||
			decoded.GenerationFence != entry.GenerationFence || decoded.Lineage != entry.Lineage ||
			decoded.Epoch != entry.Epoch || decoded.Format != entry.Format ||
			(decoded.CreatedAt == nil) != (entry.CreatedAt == nil) ||
			(entry.CreatedAt != nil && !decoded.CreatedAt.Equal(*entry.CreatedAt)) {
			t.Fatalf("generation %s: decoded %+v", c.Generation, decoded)
		}
	}
}

func TestRefusesEveryBadLedgerEntryLikeCSharp(t *testing.T) {
	for _, c := range load(t).Ledger.Refused {
		if _, ok := DecodeLineageEntry(collabtest.Hex(t, c.Hex)); ok {
			t.Errorf("%s: decoded", c.Name)
		}
	}
}

func TestReadsALedgerFileLikeCSharp(t *testing.T) {
	file := load(t).Ledger.File
	path := filepath.Join(t.TempDir(), LedgerFileName)
	if err := os.WriteFile(path, collabtest.Hex(t, file.Hex), 0o600); err != nil {
		t.Fatal(err)
	}
	var warnings []string
	entries, err := ReadLedger(path, func(message string) {
		warnings = append(warnings, strings.ReplaceAll(message, path, "{path}"))
	})
	if err != nil {
		t.Fatal(err)
	}
	var generations []string
	for _, entry := range entries {
		generations = append(generations, strconv.FormatUint(entry.Generation, 10))
	}
	if !reflect.DeepEqual(generations, file.Generations) || !reflect.DeepEqual(warnings, file.Warnings) {
		t.Fatalf("got %v %q, want %v %q", generations, warnings, file.Generations, file.Warnings)
	}
}

func TestAMissingLedgerIsEmpty(t *testing.T) {
	entries, err := ReadLedger(filepath.Join(t.TempDir(), "nope", LedgerFileName), nil)
	if err != nil || len(entries) != 0 {
		t.Fatalf("%v %v", entries, err)
	}
}
