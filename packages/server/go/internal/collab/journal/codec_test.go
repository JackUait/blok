package journal

import (
	"bytes"
	"encoding/hex"
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

type codecs struct {
	Journal struct {
		Encode []struct {
			OperationID string  `json:"operationId"`
			Sequence    string  `json:"sequence"`
			Ticks       string  `json:"ticks"`
			Actor       *string `json:"actor"`
			Source      int     `json:"source"`
			Update      string  `json:"update"`
			Digest      string  `json:"digest"`
			Hex         string  `json:"hex"`
		} `json:"encode"`
		Decode []struct {
			Name     string  `json:"name"`
			Hex      string  `json:"hex"`
			Status   string  `json:"status"`
			Consumed int     `json:"consumed"`
			Error    string  `json:"error"`
			Sequence *string `json:"sequence"`
		} `json:"decode"`
	} `json:"journal"`
	Ledger struct {
		Encode []struct {
			Kind            int     `json:"kind"`
			Generation      string  `json:"generation"`
			GenerationFence string  `json:"generationFence"`
			Lineage         string  `json:"lineage"`
			Epoch           string  `json:"epoch"`
			Format          int     `json:"format"`
			Ticks           *string `json:"ticks"`
			Hex             string  `json:"hex"`
		} `json:"encode"`
		Refused []struct {
			Name string `json:"name"`
			Hex  string `json:"hex"`
		} `json:"refused"`
		File struct {
			Hex         string   `json:"hex"`
			Generations []string `json:"generations"`
			Warnings    []string `json:"warnings"`
		} `json:"file"`
	} `json:"ledger"`
}

func load(t *testing.T) codecs {
	var fixture codecs
	collabtest.Read(t, "collab-disk/codecs.json", &fixture)
	return fixture
}

func u64(t *testing.T, text string) uint64 {
	value, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func i64(t *testing.T, text string) int64 {
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestEncodesEveryRecordToTheBytesCSharpWrites(t *testing.T) {
	fixture := load(t)
	if len(fixture.Journal.Encode) == 0 {
		t.Fatal("no encode cases")
	}
	for _, c := range fixture.Journal.Encode {
		record := operation.Record{
			OperationID: c.OperationID,
			Sequence:    u64(t, c.Sequence),
			CommittedAt: dotnet.TimeFromTicks(i64(t, c.Ticks)),
			ActorID:     c.Actor,
			Source:      operation.Source(c.Source),
			Update:      collabtest.Hex(t, c.Update),
			Digest:      collabtest.Hex(t, c.Digest),
		}
		encoded, err := EncodeRecord(record)
		if err != nil {
			t.Fatalf("seq %s: %v", c.Sequence, err)
		}
		if got := hex.EncodeToString(encoded); got != c.Hex {
			t.Fatalf("seq %s:\n got %s\nwant %s", c.Sequence, got, c.Hex)
		}
		status, decoded, consumed, message := DecodeRecord(encoded)
		if status != StatusOK || message != "" || consumed != len(encoded) {
			t.Fatalf("seq %s: %v %d %q", c.Sequence, status, consumed, message)
		}
		if decoded.OperationID != record.OperationID || decoded.Sequence != record.Sequence ||
			dotnet.Ticks(decoded.CommittedAt) != i64(t, c.Ticks) || decoded.Source != record.Source ||
			!bytes.Equal(decoded.Update, record.Update) || !bytes.Equal(decoded.Digest, record.Digest) {
			t.Fatalf("seq %s: decoded %+v", c.Sequence, decoded)
		}
		if (decoded.ActorID == nil) != (c.Actor == nil) || (c.Actor != nil && *decoded.ActorID != *c.Actor) {
			t.Fatalf("seq %s: actor %v, want %v", c.Sequence, decoded.ActorID, c.Actor)
		}
	}
}

func TestDecodesEveryBrokenRecordLikeCSharp(t *testing.T) {
	fixture := load(t)
	for _, c := range fixture.Journal.Decode {
		status, record, consumed, message := DecodeRecord(collabtest.Hex(t, c.Hex))
		if status.String() != c.Status || consumed != c.Consumed || message != c.Error {
			t.Errorf("%s: got %v %d %q, want %s %d %q", c.Name, status, consumed, message, c.Status, c.Consumed, c.Error)
			continue
		}
		if (record == nil) != (c.Sequence == nil) {
			t.Errorf("%s: record %v, want sequence %v", c.Name, record, c.Sequence)
		} else if record != nil && strconv.FormatUint(record.Sequence, 10) != *c.Sequence {
			t.Errorf("%s: sequence %d, want %s", c.Name, record.Sequence, *c.Sequence)
		}
	}
}

func TestRefusesToEncodeWhatCSharpRefuses(t *testing.T) {
	good := operation.Record{
		OperationID: "0123456789abcdef0123456789abcdef",
		Sequence:    1,
		CommittedAt: dotnet.TimeFromTicks(0),
		Source:      operation.SourceClientV2,
		Update:      []byte{1},
		Digest:      make([]byte, 32),
	}
	long := string(bytes.Repeat([]byte("a"), 4097))
	edge := string(bytes.Repeat([]byte("a"), 4096))
	cases := map[string]func(*operation.Record){
		"upper-case id":   func(r *operation.Record) { r.OperationID = "0123456789ABCDEF0123456789abcdef" },
		"short id":        func(r *operation.Record) { r.OperationID = "0123" },
		"sequence 0":      func(r *operation.Record) { r.Sequence = 0 },
		"source 3":        func(r *operation.Record) { r.Source = 3 },
		"digest 31":       func(r *operation.Record) { r.Digest = make([]byte, 31) },
		"empty update":    func(r *operation.Record) { r.Update = nil },
		"actor past 4096": func(r *operation.Record) { r.ActorID = &long },
		"update past cap": func(r *operation.Record) { r.Update = make([]byte, MaxUpdateLength+1) },
	}
	for name, change := range cases {
		record := good
		change(&record)
		if _, err := EncodeRecord(record); err == nil {
			t.Errorf("%s: encoded", name)
		}
	}
	record := good
	record.ActorID = &edge
	record.Update = make([]byte, MaxUpdateLength)
	if _, err := EncodeRecord(record); err != nil {
		t.Errorf("4096-byte actor, 32 MiB update: %v", err)
	}
}

// C# interpolates the enum, and an undefined enum prints as its number.
func TestAnUnknownSourceIsNamedByItsNumberAsCSharpDoes(t *testing.T) {
	record := operation.Record{
		OperationID: "0123456789abcdef0123456789abcdef",
		Sequence:    1,
		CommittedAt: dotnet.TimeFromTicks(0),
		Source:      3,
		Update:      []byte{1},
		Digest:      make([]byte, 32),
	}
	_, err := EncodeRecord(record)
	if err == nil || err.Error() != "collab: 3 is not a known operation source." {
		t.Fatalf("%v", err)
	}
}
