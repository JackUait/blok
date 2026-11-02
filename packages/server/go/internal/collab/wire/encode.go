package wire

import (
	"errors"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// ErrNotEncodable is SyncWire.Encode's ArgumentException.
var ErrNotEncodable = errors.New("wire: message cannot be put on the wire")

func notEncodable(why string) error { return errors.Join(ErrNotEncodable, errors.New(why)) }

// Encode is SyncWire.Encode: one frame per message. Payloads must not be
// empty, ids must be lineage-shaped, and an Unknown has no bytes.
func Encode(message Message) ([]byte, error) {
	var b []byte
	switch m := message.(type) {
	case SyncStep1:
		return encodeSync(SyncStep1Type, m.StateVector)
	case SyncStep2:
		return encodeSync(syncStep2Type, m.Update)
	case SyncUpdate:
		return encodeSync(syncUpdate, m.Update)
	case Awareness:
		if len(m.Update) == 0 {
			return nil, notEncodable("collab: sync payloads must not be empty.")
		}
		b = appendVarBytes(appendVarUint(b, MessageAwareness), m.Update)
	case QueryAwareness:
		b = appendVarUint(b, MessageQueryAwareness)
	case PermissionDenied:
		b = appendVarUint(appendVarUint(b, MessageAuth), authPermissionDenied)
		b = appendVarBytes(b, []byte(m.Reason))
	case BlokControl:
		if !m.Tag.IsAnnounceable() {
			return nil, notEncodable("collab: the tag is not encodable.")
		}
		// Key order is pinned: the client writes {epoch, format, lineage}.
		json := []byte(`{"epoch":` + strconv.FormatInt(m.Tag.Epoch, 10) +
			`,"format":` + strconv.Itoa(int(m.Tag.Format)) + `,"lineage":`)
		json = append(quote(json, m.Tag.Lineage), '}')
		b = appendVarBytes(appendVarUint(b, MessageBlokControl), json)
	case BlokLimits:
		if m.MaxMessageBytes <= 0 {
			return nil, notEncodable("collab: the limit is not encodable.")
		}
		json := `{"maxMessageBytes":` + strconv.FormatInt(m.MaxMessageBytes, 10) + `}`
		b = appendVarBytes(appendVarUint(b, MessageBlokLimits), []byte(json))
	case Operation:
		json, err := idsJSON(m.Lineage, m.OperationID)
		if err != nil {
			return nil, err
		}
		if len(m.Update) == 0 {
			return nil, notEncodable("collab: operation updates must not be empty.")
		}
		b = appendVarBytes(appendVarUint(b, MessageOperation), append(json, '}'))
		b = appendVarBytes(b, m.Update)
	case Acknowledgement:
		json, err := idsJSON(m.Lineage, m.OperationID)
		if err != nil {
			return nil, err
		}
		if m.ServerSequence == 0 {
			return nil, notEncodable("collab: an acknowledgement cannot carry serverSequence 0.")
		}
		json = append(json, `,"serverSequence":"`+strconv.FormatUint(m.ServerSequence, 10)+`"}`...)
		b = appendVarBytes(appendVarUint(b, MessageAcknowledgement), json)
	case Rejection:
		json, err := idsJSON(m.Lineage, m.OperationID)
		if err != nil {
			return nil, err
		}
		if !isRejectionCode(m.Code) {
			return nil, notEncodable("collab: the rejection code is not encodable.")
		}
		json = append(json, `,"code":"`+m.Code+`"}`...)
		b = appendVarBytes(appendVarUint(b, MessageRejection), json)
	case Activity:
		b = appendVarUint(b, MessageActivity)
	case Identities:
		json := []byte(`{"identities":[`)
		for i, identity := range m.Identities {
			if identity.ActorID == "" {
				return nil, notEncodable("collab: an identity needs a non-empty ActorId.")
			}
			if i > 0 {
				json = append(json, ',')
			}
			json = append(json, `{"clientId":`+strconv.FormatUint(identity.ClientID, 10)+`,"actorId":`...)
			json = append(quote(json, identity.ActorID), '}')
		}
		b = appendVarBytes(appendVarUint(b, MessageIdentities), append(json, "]}"...))
	default:
		return nil, notEncodable("collab: this message cannot be put on the wire.")
	}
	return b, nil
}

// quote is Utf8JsonWriter.WriteString with the default encoder.
func quote(dst []byte, s string) []byte { return jsjson.AppendQuoted(dst, jsjson.FromString(s)) }

// idsJSON opens {"lineage":"…","operationId":"…" for the v2 frames; the
// caller closes it. Ids are plain hex, so no escaping is needed.
func idsJSON(lineage, operationID string) ([]byte, error) {
	if !IsLineage(lineage) || !IsLineage(operationID) {
		return nil, notEncodable("collab: the id is not 32 lowercase-hex characters.")
	}
	return []byte(`{"lineage":"` + lineage + `","operationId":"` + operationID + `"`), nil
}

func encodeSync(subType uint64, payload []byte) ([]byte, error) {
	if len(payload) == 0 {
		return nil, notEncodable("collab: sync payloads must not be empty.")
	}
	b := appendVarUint(appendVarUint(nil, MessageSync), subType)
	return appendVarBytes(b, payload), nil
}
