package journal

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// File names and magics inside a document's journal directory
// (C# LocalCollabOperationStore).
const (
	ManifestFileName = "manifest"
	ManifestMagic    = "BKJM"
	BaselineMagic    = "BKJB"
	CheckpointMagic  = "BKJC"
)

const (
	manifestVersion     = 2
	ManifestSlotSize    = 128
	manifestContentSize = 96
	ManifestSize        = 2 * ManifestSlotSize
	sealedVersion       = 1
	sealedHeaderSize    = 24
	checksumSize        = 32
)

// InvalidDataError is C#'s InvalidDataException: the bytes on disk are not
// what this build writes. The message is C#'s, word for word.
type InvalidDataError struct{ Message string }

func (e *InvalidDataError) Error() string { return e.Message }

func invalidData(format string, args ...any) error {
	return &InvalidDataError{Message: fmt.Sprintf(format, args...)}
}

// Manifest is one published manifest slot.
type Manifest struct {
	WriteCounter      uint64
	Fence             uint64
	Generation        uint64
	Seeded            bool
	Format            int32
	Epoch             int64
	Lineage           string
	CheckpointThrough uint64
	GenerationFence   uint64
	CheckpointFence   uint64
}

// EncodeManifestSlot is one 128-byte slot: 96 bytes of fields, then their SHA-256.
func EncodeManifestSlot(m Manifest) []byte {
	slot := make([]byte, ManifestSlotSize)
	copy(slot, ManifestMagic)
	slot[4] = manifestVersion
	if m.Seeded {
		slot[5] = 1
	}
	binary.LittleEndian.PutUint64(slot[8:], m.WriteCounter)
	binary.LittleEndian.PutUint64(slot[16:], m.Fence)
	binary.LittleEndian.PutUint64(slot[24:], m.Generation)
	binary.LittleEndian.PutUint32(slot[32:], uint32(m.Format))
	binary.LittleEndian.PutUint64(slot[36:], uint64(m.Epoch))
	if _, err := hex.Decode(slot[44:60], []byte(m.Lineage)); err != nil {
		panic(fmt.Sprintf("collab: lineage %q is not hex", m.Lineage))
	}
	binary.LittleEndian.PutUint64(slot[60:], m.CheckpointThrough)
	binary.LittleEndian.PutUint64(slot[68:], m.GenerationFence)
	binary.LittleEndian.PutUint64(slot[76:], m.CheckpointFence)
	sum := sha256.Sum256(slot[:manifestContentSize])
	copy(slot[manifestContentSize:], sum[:])
	return slot
}

type slotStatus int

const (
	slotOK slotStatus = iota
	slotUnreadable
	slotForeign
)

func decodeManifestSlot(slot []byte) (Manifest, slotStatus) {
	if !bytes.Equal(slot[:4], []byte(ManifestMagic)) {
		return Manifest{}, slotUnreadable
	}
	// The checksum is checked before the version byte is trusted, so a flipped
	// byte reads as corruption, not as another version.
	sum := sha256.Sum256(slot[:manifestContentSize])
	if !bytes.Equal(sum[:], slot[manifestContentSize:]) {
		return Manifest{}, slotUnreadable
	}
	if slot[4] != manifestVersion {
		return Manifest{}, slotForeign
	}
	return Manifest{
		WriteCounter:      binary.LittleEndian.Uint64(slot[8:]),
		Fence:             binary.LittleEndian.Uint64(slot[16:]),
		Generation:        binary.LittleEndian.Uint64(slot[24:]),
		Seeded:            slot[5] == 1,
		Format:            int32(binary.LittleEndian.Uint32(slot[32:])),
		Epoch:             int64(binary.LittleEndian.Uint64(slot[36:])),
		Lineage:           hex.EncodeToString(slot[44:60]),
		CheckpointThrough: binary.LittleEndian.Uint64(slot[60:]),
		GenerationFence:   binary.LittleEndian.Uint64(slot[68:]),
		CheckpointFence:   binary.LittleEndian.Uint64(slot[76:]),
	}, slotOK
}

// ReadManifest is nil when the manifest does not exist yet or is empty (created,
// never published). It fails when no slot decodes, so an unreadable document
// is never handed back as a fresh one.
func ReadManifest(path, documentID string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) != ManifestSize {
		return nil, invalidData("collab: the manifest for \"%s\" is %d bytes, not %d.", documentID, len(data), ManifestSize)
	}
	var best *Manifest
	foreign := -1
	for i := range 2 {
		slot := data[i*ManifestSlotSize : (i+1)*ManifestSlotSize]
		candidate, status := decodeManifestSlot(slot)
		switch {
		case status == slotOK && (best == nil || candidate.WriteCounter > best.WriteCounter):
			best = &candidate
		case status == slotForeign:
			foreign = int(slot[4])
		}
	}
	if best != nil {
		return best, nil
	}
	if foreign >= 0 {
		return nil, invalidData("collab: the manifest for \"%s\" is version %d, and this build writes version %d.", documentID, foreign, manifestVersion)
	}
	return nil, invalidData("collab: neither manifest slot for \"%s\" decodes.", documentID)
}

// WriteSealed writes a baseline or checkpoint: magic, version, tag, length,
// the content, then a SHA-256 over all of it; fsynced before it returns.
func WriteSealed(path, magic string, tag uint64, content []byte) error {
	buffer := make([]byte, sealedHeaderSize, sealedHeaderSize+len(content)+checksumSize)
	copy(buffer, magic)
	buffer[4] = sealedVersion
	binary.LittleEndian.PutUint64(buffer[8:], tag)
	binary.LittleEndian.PutUint64(buffer[16:], uint64(len(content)))
	buffer = append(buffer, content...)
	sum := sha256.Sum256(buffer)
	buffer = append(buffer, sum[:]...)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(buffer); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

// ReadSealed returns a sealed file's content and tag, or C#'s message for why
// it cannot be trusted.
func ReadSealed(path, magic, documentID string) ([]byte, uint64, error) {
	name := filepath.Base(path)
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, 0, invalidData("collab: \"%s\" names %s, which is not there.", documentID, name)
	}
	if err != nil {
		return nil, 0, err
	}
	if len(data) < sealedHeaderSize+checksumSize || !bytes.Equal(data[:len(magic)], []byte(magic)) || data[4] != sealedVersion {
		return nil, 0, invalidData("collab: %s for \"%s\" is not a readable record.", name, documentID)
	}
	tag := binary.LittleEndian.Uint64(data[8:])
	length := int64(binary.LittleEndian.Uint64(data[16:]))
	if length < 0 || length != int64(len(data)-sealedHeaderSize-checksumSize) {
		return nil, 0, invalidData("collab: %s for \"%s\" declares %d content bytes, which is not what it holds.", name, documentID, length)
	}
	hashed := sealedHeaderSize + int(length)
	sum := sha256.Sum256(data[:hashed])
	if !bytes.Equal(sum[:], data[hashed:hashed+checksumSize]) {
		return nil, 0, invalidData("collab: %s for \"%s\" fails its checksum.", name, documentID)
	}
	return data[sealedHeaderSize:hashed], tag, nil
}
