// Package workingset is a document's persisted Yjs update log for a room with
// no journal (C# CollabWorkingSet*.cs, LocalCollabStore.cs, S3CollabStore.cs).
// The blob bytes are the same as C# writes.
package workingset

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
)

// HeaderLength is "BKW2", int32 format, int64 epoch, 16 lineage bytes.
const HeaderLength = 32

const (
	framePrefixLength = 4
	lineageOffset     = 16
)

// "BKWS" was the pre-lineage header; it now reads as unreadable. It never shipped.
var magic = []byte("BKW2")

// DocKey is the lower-hex SHA-256 of the UTF-8 doc id: it names every file and S3 key.
func DocKey(docID string) string {
	if docID == "" {
		panic("collab: an empty doc id has no key")
	}
	sum := sha256.Sum256([]byte(docID))
	return hex.EncodeToString(sum[:])
}

// EncodeDocument writes the header, then the frame section as it is.
func EncodeDocument(tag Tag, frameSection []byte) ([]byte, error) {
	if !tag.IsAnnounceable() {
		return nil, fmt.Errorf("collab: the tag %v is not encodable", tag)
	}
	if !ValidateFrames(frameSection) {
		return nil, errors.New("collab: the frame section is not a valid update log")
	}
	document := make([]byte, HeaderLength+len(frameSection))
	copy(document, magic)
	binary.LittleEndian.PutUint32(document[4:], uint32(tag.Format))
	binary.LittleEndian.PutUint64(document[8:], uint64(tag.Epoch))
	if _, err := hex.Decode(document[lineageOffset:HeaderLength], []byte(tag.Lineage)); err != nil {
		return nil, err
	}
	copy(document[HeaderLength:], frameSection)
	return document, nil
}

// DecodeHeader reads just the header; the message is C#'s for a refusal.
func DecodeHeader(header []byte) (Tag, string, bool) {
	if len(header) < HeaderLength {
		return Tag{}, "the header is truncated", false
	}
	if !bytes.Equal(header[:len(magic)], magic) {
		return Tag{}, "the magic bytes do not match", false
	}
	format := int32(binary.LittleEndian.Uint32(header[4:]))
	epoch := int64(binary.LittleEndian.Uint64(header[8:]))
	if format < 1 || epoch < 0 {
		return Tag{}, fmt.Sprintf("the tag (%d, %d) is invalid", format, epoch), false
	}
	return Tag{Format: format, Epoch: epoch, Lineage: hex.EncodeToString(header[lineageOffset:HeaderLength])}, "", true
}

// DecodeDocument returns the tag and a copy of the frame section.
func DecodeDocument(document []byte) (Tag, []byte, string, bool) {
	tag, message, ok := DecodeHeader(document)
	if !ok {
		return Tag{}, nil, message, false
	}
	if !ValidateFrames(document[HeaderLength:]) {
		return Tag{}, nil, "an update frame is empty or truncated", false
	}
	return tag, bytes.Clone(document[HeaderLength:]), "", true
}

// EncodeFrames writes each update with its int32 length prefix.
func EncodeFrames(updates [][]byte) ([]byte, error) {
	var section bytes.Buffer
	for _, update := range updates {
		if len(update) == 0 {
			return nil, errors.New("collab: update frames must not be empty")
		}
	}
	for _, update := range updates {
		AppendFrame(&section, update)
	}
	return section.Bytes(), nil
}

// AppendFrame writes one length-prefixed frame: the room's log uses the same writer.
func AppendFrame(buffer *bytes.Buffer, update []byte) {
	var prefix [framePrefixLength]byte
	binary.LittleEndian.PutUint32(prefix[:], uint32(len(update)))
	buffer.Write(prefix[:])
	buffer.Write(update)
}

// ValidateFrames walks the section without copying.
func ValidateFrames(section []byte) bool {
	_, ok := walkFrames(section, false)
	return ok
}

// DecodeFrames returns a copy of each update.
func DecodeFrames(section []byte) ([][]byte, bool) {
	return walkFrames(section, true)
}

func walkFrames(section []byte, collect bool) ([][]byte, bool) {
	var updates [][]byte
	for len(section) > 0 {
		if len(section) < framePrefixLength {
			return nil, false
		}
		length := int32(binary.LittleEndian.Uint32(section))
		if length < 1 || int(length) > len(section)-framePrefixLength {
			return nil, false
		}
		if collect {
			updates = append(updates, bytes.Clone(section[framePrefixLength:framePrefixLength+int(length)]))
		}
		section = section[framePrefixLength+int(length):]
	}
	return updates, true
}
