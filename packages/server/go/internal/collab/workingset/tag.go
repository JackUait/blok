package workingset

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

const (
	// HTMLRichTextFormat is rich text as HTML in a plain Y.Text; a room in it is migrated on open.
	HTMLRichTextFormat int32 = 1
	// CurrentFormat is rich text as formatted Y.XmlText, the only format the server writes.
	CurrentFormat int32 = 2
	// LineageLength is the lineage length in hex characters.
	LineageLength = 32
	// NoLineage is what a room holds before it loads.
	NoLineage = ""
)

// Tag is CollabWorkingSetTag: the schema format, the reset count and the history id.
type Tag struct {
	Format  int32
	Epoch   int64
	Lineage string
}

// String matches the C# record's ToString, which refusal messages carry.
func (t Tag) String() string {
	return fmt.Sprintf("CollabWorkingSetTag { Format = %d, Epoch = %d, Lineage = %s }", t.Format, t.Epoch, t.Lineage)
}

// NewLineage mints 16 random bytes as lower hex.
func NewLineage() string {
	var raw [LineageLength / 2]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw[:])
}

// IsLineage is 32 lower-hex characters: the client compares lineages as strings.
func IsLineage(value string) bool {
	if len(value) != LineageLength {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// IsAnnounceable is a tag that may be persisted or sent to a client.
func (t Tag) IsAnnounceable() bool {
	return t.Format >= 1 && t.Epoch >= 0 && IsLineage(t.Lineage)
}
