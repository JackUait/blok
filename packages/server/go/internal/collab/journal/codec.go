// Package journal is the per-document operation journal: the record codec,
// the lineage ledger and the local store (C# CollabJournalCodec.cs,
// CollabLineageLedger.cs, LocalCollabOperationStore.cs). The bytes are the
// same as C# writes, so either server can open the other's directory.
package journal

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"unicode/utf8"

	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Status is how one record decoded.
type Status int

const (
	// StatusOK means both checksums verified.
	StatusOK Status = iota
	// StatusIncomplete is a torn tail: a header or body not fully present.
	StatusIncomplete
	// StatusInvalid is corruption: the bytes were altered after being written.
	StatusInvalid
)

func (s Status) String() string {
	switch s {
	case StatusOK:
		return "Ok"
	case StatusIncomplete:
		return "Incomplete"
	}
	return "Invalid"
}

const (
	CurrentVersion = 1

	// MaxUpdateLength is a disk-side backstop, not the wire limit.
	MaxUpdateLength = 32 * 1024 * 1024

	maxActorIDLength  = 4 * 1024
	headerContentSize = 4 + 1 + 1
	headerSize        = headerContentSize + sha256.Size
	// operationId + sequence + ticks + actor length + digest + update length
	fixedBodySize = 16 + 8 + 8 + 4 + sha256.Size + 4
	minBodyLength = fixedBodySize + 1 + sha256.Size
	MaxBodyLength = fixedBodySize + maxActorIDLength + MaxUpdateLength + sha256.Size
)

// EncodeRecord writes one record. It refuses what C# refuses with an ArgumentException.
func EncodeRecord(record operation.Record) ([]byte, error) {
	if !workingset.IsLineage(record.OperationID) {
		return nil, argumentf("collab: the operation id %s is not 32 lowercase-hex characters.", record.OperationID)
	}
	if record.Sequence < 1 {
		return nil, argumentf("collab: server sequence 0 means nothing has been committed; a record must be at least 1.")
	}
	if !record.Source.Defined() {
		return nil, argumentf("collab: %v is not a known operation source.", record.Source)
	}
	if len(record.Digest) != sha256.Size {
		return nil, argumentf("collab: the digest must be %d bytes (SHA-256).", sha256.Size)
	}
	if len(record.Update) == 0 || len(record.Update) > MaxUpdateLength {
		return nil, argumentf("collab: the update must be 1..%d bytes.", MaxUpdateLength)
	}
	actorLength := int32(-1)
	var actor []byte
	if record.ActorID != nil {
		// .NET's strict encoder throws on a string that is not valid UTF-16.
		if !utf8.ValidString(*record.ActorID) {
			return nil, argumentf("collab: the actor id is not valid UTF-8.")
		}
		actor = []byte(*record.ActorID)
		if len(actor) > maxActorIDLength {
			return nil, argumentf("collab: the actor id exceeds %d bytes.", maxActorIDLength)
		}
		actorLength = int32(len(actor))
	}
	bodyContent := fixedBodySize + len(actor) + len(record.Update)
	bodyLength := bodyContent + sha256.Size
	buffer := make([]byte, headerSize+bodyLength)
	binary.LittleEndian.PutUint32(buffer, uint32(bodyLength))
	buffer[4] = CurrentVersion
	buffer[5] = byte(record.Source)
	headerSum := sha256.Sum256(buffer[:headerContentSize])
	copy(buffer[headerContentSize:], headerSum[:])

	body := buffer[headerSize:]
	if _, err := hex.Decode(body[:16], []byte(record.OperationID)); err != nil {
		return nil, err
	}
	binary.LittleEndian.PutUint64(body[16:], record.Sequence)
	binary.LittleEndian.PutUint64(body[24:], uint64(dotnet.Ticks(record.CommittedAt)))
	binary.LittleEndian.PutUint32(body[32:], uint32(actorLength))
	offset := 36
	offset += copy(body[offset:], actor)
	offset += copy(body[offset:], record.Digest)
	binary.LittleEndian.PutUint32(body[offset:], uint32(len(record.Update)))
	offset += 4
	offset += copy(body[offset:], record.Update)
	bodySum := sha256.Sum256(body[:offset])
	copy(body[offset:], bodySum[:])
	return buffer, nil
}

// DecodeRecord reads the record at the start of input. It returns the status,
// the record when OK, the bytes it used, and C#'s message for an Invalid one.
func DecodeRecord(input []byte) (Status, *operation.Record, int, string) {
	if len(input) < headerSize {
		return StatusIncomplete, nil, 0, ""
	}
	headerSum := sha256.Sum256(input[:headerContentSize])
	// Checked before the length is trusted, so a corrupt length is never
	// mistaken for an honest one that needs more bytes.
	if !bytes.Equal(headerSum[:], input[headerContentSize:headerSize]) {
		return invalid("the header checksum does not match its content")
	}
	bodyLength := int32(binary.LittleEndian.Uint32(input))
	if version := input[4]; version != CurrentVersion {
		return invalid(fmt.Sprintf("unsupported codec version %d", version))
	}
	source := operation.Source(input[5])
	if !source.Defined() {
		return invalid(fmt.Sprintf("unknown operation source %d", input[5]))
	}
	// The ceiling first: a hostile writer can checksum any length it likes.
	if bodyLength < minBodyLength || bodyLength > MaxBodyLength {
		return invalid(fmt.Sprintf("the body length %d is out of range", bodyLength))
	}
	if len(input)-headerSize < int(bodyLength) {
		return StatusIncomplete, nil, 0, ""
	}
	body := input[headerSize : headerSize+int(bodyLength)]
	content := body[:len(body)-sha256.Size]
	bodySum := sha256.Sum256(content)
	if !bytes.Equal(bodySum[:], body[len(content):]) {
		return invalid("the body checksum does not match its content")
	}
	record := &operation.Record{Source: source}
	record.OperationID = hex.EncodeToString(content[:16])
	record.Sequence = binary.LittleEndian.Uint64(content[16:])
	if record.Sequence < 1 {
		return invalid("server sequence 0 means nothing was committed on this lineage")
	}
	ticks := int64(binary.LittleEndian.Uint64(content[24:]))
	if ticks < 0 || ticks > dotnet.MaxTicks {
		return invalid("committedAt is out of range")
	}
	record.CommittedAt = dotnet.TimeFromTicks(ticks)
	actorLength := int32(binary.LittleEndian.Uint32(content[32:]))
	offset := 36
	if actorLength < -1 || actorLength > maxActorIDLength || int(actorLength) > len(content)-offset {
		return invalid("the actor id length is invalid")
	}
	if actorLength >= 0 {
		actor := content[offset : offset+int(actorLength)]
		if !utf8.Valid(actor) {
			return invalid("the actor id is not valid UTF-8")
		}
		text := string(actor)
		record.ActorID = &text
		offset += int(actorLength)
	}
	if len(content)-offset < sha256.Size {
		return invalid("the digest is truncated")
	}
	record.Digest = bytes.Clone(content[offset : offset+sha256.Size])
	offset += sha256.Size
	if len(content)-offset < 4 {
		return invalid("the update length is missing")
	}
	updateLength := int32(binary.LittleEndian.Uint32(content[offset:]))
	offset += 4
	if updateLength < 1 || updateLength > MaxUpdateLength || int(updateLength) > len(content)-offset {
		return invalid("the update length is invalid")
	}
	record.Update = bytes.Clone(content[offset : offset+int(updateLength)])
	offset += int(updateLength)
	if offset != len(content) {
		return invalid(fmt.Sprintf("%d trailing byte(s) inside the record body", len(content)-offset))
	}
	return StatusOK, record, headerSize + int(bodyLength), ""
}

func invalid(message string) (Status, *operation.Record, int, string) {
	return StatusInvalid, nil, 0, message
}
