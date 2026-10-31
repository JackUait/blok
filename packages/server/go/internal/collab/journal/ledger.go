package journal

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// LedgerFileName is the lineage ledger inside a document's journal directory.
const LedgerFileName = "lineages"

// LineageEntryKind is what one ledger entry records.
type LineageEntryKind byte

const (
	LineagePublished LineageEntryKind = 1
	LineageDeleted   LineageEntryKind = 2
)

// LineageEntry is one ledger entry. CreatedAt is nil for a lineage that began
// before the ledger existed.
type LineageEntry struct {
	Kind            LineageEntryKind
	Generation      uint64
	GenerationFence uint64
	Lineage         string
	Epoch           int64
	Format          int32
	CreatedAt       *time.Time
}

const (
	// LedgerEntrySize: every entry is the same size, so a reader steps over a bad one.
	LedgerEntrySize    = ledgerContentSize + ledgerChecksumSize
	ledgerContentSize  = 53
	ledgerChecksumSize = 8
	unknownTicks       = math.MinInt64
)

// EncodeLineageEntry writes kind, generation, fence, lineage, epoch, format and
// ticks, then the first 8 bytes of a SHA-256 over them.
func EncodeLineageEntry(entry LineageEntry) []byte {
	slot := make([]byte, LedgerEntrySize)
	slot[0] = byte(entry.Kind)
	binary.LittleEndian.PutUint64(slot[1:], entry.Generation)
	binary.LittleEndian.PutUint64(slot[9:], entry.GenerationFence)
	if _, err := hex.Decode(slot[17:33], []byte(entry.Lineage)); err != nil {
		panic(fmt.Sprintf("collab: lineage %q is not hex", entry.Lineage))
	}
	binary.LittleEndian.PutUint64(slot[33:], uint64(entry.Epoch))
	binary.LittleEndian.PutUint32(slot[41:], uint32(entry.Format))
	ticks := int64(unknownTicks)
	if entry.CreatedAt != nil {
		ticks = dotnet.Ticks(*entry.CreatedAt)
	}
	binary.LittleEndian.PutUint64(slot[45:], uint64(ticks))
	sum := sha256.Sum256(slot[:ledgerContentSize])
	copy(slot[ledgerContentSize:], sum[:ledgerChecksumSize])
	return slot
}

// DecodeLineageEntry reads one slot; false for a wrong size, checksum, kind or time.
func DecodeLineageEntry(slot []byte) (LineageEntry, bool) {
	if len(slot) != LedgerEntrySize {
		return LineageEntry{}, false
	}
	sum := sha256.Sum256(slot[:ledgerContentSize])
	if !bytes.Equal(sum[:ledgerChecksumSize], slot[ledgerContentSize:]) {
		return LineageEntry{}, false
	}
	kind := LineageEntryKind(slot[0])
	if kind != LineagePublished && kind != LineageDeleted {
		return LineageEntry{}, false
	}
	ticks := int64(binary.LittleEndian.Uint64(slot[45:]))
	if ticks != unknownTicks && (ticks < 0 || ticks > dotnet.MaxTicks) {
		return LineageEntry{}, false
	}
	entry := LineageEntry{
		Kind:            kind,
		Generation:      binary.LittleEndian.Uint64(slot[1:]),
		GenerationFence: binary.LittleEndian.Uint64(slot[9:]),
		Lineage:         hex.EncodeToString(slot[17:33]),
		Epoch:           int64(binary.LittleEndian.Uint64(slot[33:])),
		Format:          int32(binary.LittleEndian.Uint32(slot[41:])),
	}
	if ticks != unknownTicks {
		at := dotnet.TimeFromTicks(ticks)
		entry.CreatedAt = &at
	}
	return entry, true
}

// ReadLedger returns every entry that decodes, in file order. A missing file is empty.
func ReadLedger(path string, warn func(string)) ([]LineageEntry, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []LineageEntry
	offset := 0
	for ; offset+LedgerEntrySize <= len(data); offset += LedgerEntrySize {
		if entry, ok := DecodeLineageEntry(data[offset : offset+LedgerEntrySize]); ok {
			entries = append(entries, entry)
		} else if warn != nil {
			warn(fmt.Sprintf("collab: skipped a bad entry at byte %d of %s.", offset, path))
		}
	}
	if offset < len(data) && warn != nil {
		warn(fmt.Sprintf("collab: skipped a torn entry at byte %d of %s.", offset, path))
	}
	return entries, nil
}
