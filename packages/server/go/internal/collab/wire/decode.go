package wire

import (
	"strconv"
	"unicode/utf8"
)

// DecodeError is a refused frame. Rule is the blok-sync.v2 section-5 rule
// (1-12) a type 102-104 frame broke, or 1 for a missing type; 0 otherwise.
type DecodeError struct {
	Reason string
	Rule   int
}

func (e *DecodeError) Error() string { return e.Reason }

func refuse(reason string) *DecodeError { return &DecodeError{Reason: reason} }

func refuseRule(rule int, reason string) *DecodeError {
	return &DecodeError{Reason: reason, Rule: rule}
}

// Decode is SyncWire.TryDecode. An unknown outer type is not an error.
func Decode(frame []byte) (Message, *DecodeError) {
	messageType, frame, ok := ReadVarUint(frame)
	if !ok {
		return nil, refuseRule(1, "the message type is missing or malformed")
	}
	var message Message
	switch messageType {
	case MessageSync:
		return decodeSync(frame)
	case MessageAwareness:
		update, rest, err := readPayload(frame)
		if err != nil {
			return nil, err
		}
		message, frame = Awareness{Update: update}, rest
	case MessageAuth:
		return decodeAuth(frame)
	case MessageQueryAwareness:
		message = QueryAwareness{}
	case MessageBlokControl:
		json, rest, ok := readVarBytes(frame)
		if !ok {
			return nil, refuse("the control payload is missing or truncated")
		}
		tag, err := decodeControl(json)
		if err != nil {
			return nil, err
		}
		message, frame = BlokControl{Tag: tag}, rest
	case MessageBlokLimits:
		json, rest, ok := readVarBytes(frame)
		if !ok {
			return nil, refuse("the limits payload is missing or truncated")
		}
		limit, err := decodeLimits(json)
		if err != nil {
			return nil, err
		}
		message, frame = BlokLimits{MaxMessageBytes: limit}, rest
	case MessageOperation:
		return decodeOperation(frame)
	case MessageAcknowledgement:
		return decodeAcknowledgement(frame)
	case MessageRejection:
		return decodeRejection(frame)
	case MessageActivity:
		message = Activity{}
	case MessageIdentities:
		json, rest, ok := readVarBytes(frame)
		if !ok {
			return nil, refuse("the identities payload is missing or truncated")
		}
		identities, err := decodeIdentities(json)
		if err != nil {
			return nil, err
		}
		message, frame = Identities{Identities: identities}, rest
	default:
		return Unknown{MessageType: messageType}, nil
	}
	if err := requireEnd(frame); err != nil {
		return nil, err
	}
	return message, nil
}

func requireEnd(rest []byte) *DecodeError {
	if len(rest) == 0 {
		return nil
	}
	return refuse(strconv.Itoa(len(rest)) + " trailing byte(s) after the message")
}

func readPayload(input []byte) ([]byte, []byte, *DecodeError) {
	b, rest, ok := readVarBytes(input)
	if !ok {
		return nil, input, refuse("the payload is missing or truncated")
	}
	if len(b) == 0 {
		return nil, input, refuse("the payload is empty")
	}
	return clone(b), rest, nil
}

func clone(b []byte) []byte { return append([]byte{}, b...) }

func decodeSync(input []byte) (Message, *DecodeError) {
	subType, input, ok := ReadVarUint(input)
	if !ok {
		return nil, refuse("the sync sub-type is missing or malformed")
	}
	if subType > syncUpdate {
		return nil, refuse("unknown sync sub-type " + strconv.FormatUint(subType, 10))
	}
	payload, input, err := readPayload(input)
	if err != nil {
		return nil, err
	}
	var message Message
	switch subType {
	case SyncStep1Type:
		message = SyncStep1{StateVector: payload}
	case syncStep2Type:
		message = SyncStep2{Update: payload}
	default:
		message = SyncUpdate{Update: payload}
	}
	if err := requireEnd(input); err != nil {
		return nil, err
	}
	return message, nil
}

func decodeAuth(input []byte) (Message, *DecodeError) {
	subType, input, ok := ReadVarUint(input)
	if !ok {
		return nil, refuse("the auth sub-type is missing or malformed")
	}
	if subType != authPermissionDenied {
		return nil, refuse("unknown auth sub-type " + strconv.FormatUint(subType, 10))
	}
	reason, input, ok := readVarBytes(input)
	if !ok {
		return nil, refuse("the auth reason is missing or truncated")
	}
	if !utf8.Valid(reason) {
		return nil, refuse("the auth reason is not valid UTF-8")
	}
	if err := requireEnd(input); err != nil {
		return nil, err
	}
	return PermissionDenied{Reason: string(reason)}, nil
}

type sectionRead uint8

const (
	sectionOK sectionRead = iota
	sectionMissing
	sectionExceeds
)

// readBoundedSection tells "nothing left" (rule 3) from "a length that is
// unreadable or larger than what remains" (rule 2).
func readBoundedSection(input []byte) ([]byte, []byte, sectionRead) {
	if len(input) == 0 {
		return nil, input, sectionMissing
	}
	b, rest, ok := readVarBytes(input)
	if !ok {
		return nil, input, sectionExceeds
	}
	return b, rest, sectionOK
}

// readSections reads the varstring metadata (and, for an operation, the
// update) under framing rules 2-5, before any byte is read as JSON.
func readSections(input []byte, name string, withUpdate bool) (metadata, update []byte, err *DecodeError) {
	metadata, input, read := readBoundedSection(input)
	switch read {
	case sectionMissing:
		return nil, nil, refuseRule(3, "the "+name+" metadata section is missing")
	case sectionExceeds:
		return nil, nil, refuseRule(2, "the "+name+" metadata length exceeds the remaining bytes")
	}
	if withUpdate {
		update, input, read = readBoundedSection(input)
		switch read {
		case sectionMissing:
			return nil, nil, refuseRule(3, "the "+name+" update section is missing")
		case sectionExceeds:
			return nil, nil, refuseRule(2, "the "+name+" update length exceeds the remaining bytes")
		}
		if len(update) == 0 {
			return nil, nil, refuseRule(4, "the "+name+" update must not be empty")
		}
	}
	if len(input) != 0 {
		return nil, nil, refuseRule(5, strconv.Itoa(len(input))+" trailing byte(s) after the "+name+" frame")
	}
	return metadata, update, nil
}

func decodeOperation(input []byte) (Message, *DecodeError) {
	metadata, update, err := readSections(input, "operation", true)
	if err != nil {
		return nil, err
	}
	properties, err := readMetadataObject(metadata)
	if err != nil {
		return nil, err
	}
	if hasKeySetViolation(properties, "lineage", "operationId") {
		return nil, refuseRule(11, "the operation metadata needs exactly lineage and operationId, each once")
	}
	lineage, lineageOK := metadataValue(properties, "lineage")
	operationID, operationOK := metadataValue(properties, "operationId")
	if !lineageOK || !operationOK || !IsLineage(lineage) || !IsLineage(operationID) {
		return nil, refuseRule(12, "the operation metadata has an ill-shaped lineage or operationId")
	}
	return Operation{Lineage: lineage, OperationID: operationID, Update: clone(update)}, nil
}

func decodeAcknowledgement(input []byte) (Message, *DecodeError) {
	metadata, _, err := readSections(input, "acknowledgement", false)
	if err != nil {
		return nil, err
	}
	properties, err := readMetadataObject(metadata)
	if err != nil {
		return nil, err
	}
	if hasKeySetViolation(properties, "lineage", "operationId", "serverSequence") {
		return nil, refuseRule(11, "the acknowledgement metadata needs exactly lineage, operationId and serverSequence, each once")
	}
	lineage, lineageOK := metadataValue(properties, "lineage")
	operationID, operationOK := metadataValue(properties, "operationId")
	sequenceText, sequenceOK := metadataValue(properties, "serverSequence")
	sequence, parsed := parseServerSequence(sequenceText)
	// 0 means "nothing committed yet", which an acknowledgement never says.
	if !lineageOK || !operationOK || !sequenceOK || !IsLineage(lineage) || !IsLineage(operationID) || !parsed || sequence == 0 {
		return nil, refuseRule(12, "the acknowledgement metadata has an ill-shaped field")
	}
	return Acknowledgement{Lineage: lineage, OperationID: operationID, ServerSequence: sequence}, nil
}

func decodeRejection(input []byte) (Message, *DecodeError) {
	metadata, _, err := readSections(input, "rejection", false)
	if err != nil {
		return nil, err
	}
	properties, err := readMetadataObject(metadata)
	if err != nil {
		return nil, err
	}
	if hasKeySetViolation(properties, "lineage", "operationId", "code") {
		return nil, refuseRule(11, "the rejection metadata needs exactly lineage, operationId and code, each once")
	}
	lineage, lineageOK := metadataValue(properties, "lineage")
	operationID, operationOK := metadataValue(properties, "operationId")
	code, codeOK := metadataValue(properties, "code")
	if !lineageOK || !operationOK || !codeOK || !IsLineage(lineage) || !IsLineage(operationID) || !isRejectionCode(code) {
		return nil, refuseRule(12, "the rejection metadata has an ill-shaped field")
	}
	return Rejection{Lineage: lineage, OperationID: operationID, Code: code}, nil
}

type metadataProperty struct {
	key      string
	isString bool
	value    string
}

// readMetadataObject is rules 6-10: strict UTF-8, no backslash, no JSON
// whitespace, exactly one object. With no escapes and plain ASCII, a key
// compare on the text is exact (protocol 4.2).
func readMetadataObject(json []byte) ([]metadataProperty, *DecodeError) {
	if !utf8.Valid(json) {
		return nil, refuseRule(6, "the metadata is not valid UTF-8")
	}
	for _, c := range json {
		if c == '\\' {
			return nil, refuseRule(7, "the metadata contains a backslash")
		}
	}
	for _, c := range json {
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			return nil, refuseRule(8, "the metadata contains JSON whitespace")
		}
	}
	invalid := refuseRule(9, "the metadata is not valid JSON")
	reader := newJSONReader(json)
	read, err := reader.Read()
	if err != nil {
		return nil, invalid
	}
	if !read {
		return nil, refuseRule(9, "the metadata is empty")
	}
	if reader.token != tokenStartObject {
		if reader.token == tokenStartArray {
			if reader.Skip() != nil {
				return nil, invalid
			}
		}
		more, err := reader.Read()
		if err != nil {
			return nil, invalid
		}
		if more {
			return nil, refuseRule(9, "content follows the metadata value")
		}
		return nil, refuseRule(10, "the metadata top-level value is not an object")
	}
	var properties []metadataProperty
	for {
		read, err := reader.Read()
		if err != nil {
			return nil, invalid
		}
		if !read {
			return nil, refuseRule(9, "the metadata object is not terminated")
		}
		if reader.token == tokenEndObject {
			break
		}
		// Valid UTF-8 with no escapes, so this cannot fail.
		key, _ := reader.GetString()
		read, err = reader.Read()
		if err != nil {
			return nil, invalid
		}
		if !read {
			return nil, refuseRule(9, "a metadata property has no value")
		}
		property := metadataProperty{key: key}
		switch reader.token {
		case tokenString:
			property.isString = true
			property.value, _ = reader.GetString()
		case tokenStartObject, tokenStartArray:
			if reader.Skip() != nil {
				return nil, invalid
			}
		}
		properties = append(properties, property)
	}
	more, err := reader.Read()
	if err != nil {
		return nil, invalid
	}
	if more {
		return nil, refuseRule(9, "content follows the metadata object")
	}
	return properties, nil
}

// hasKeySetViolation is rule 11: a missing, unknown or repeated key.
func hasKeySetViolation(properties []metadataProperty, required ...string) bool {
	seen := map[string]bool{}
	for _, property := range properties {
		known := false
		for _, key := range required {
			if property.key == key {
				known = true
			}
		}
		if !known || seen[property.key] {
			return true
		}
		seen[property.key] = true
	}
	return len(seen) != len(required)
}

// metadataValue is the key's string value; ok is false when it is absent
// or not a JSON string.
func metadataValue(properties []metadataProperty, key string) (string, bool) {
	for _, property := range properties {
		if property.key == key {
			return property.value, property.isString
		}
	}
	return "", false
}

// parseServerSequence is ^(0|[1-9][0-9]*)$ up to 2^64-1.
func parseServerSequence(text string) (uint64, bool) {
	if text == "" {
		return 0, false
	}
	if text[0] == '0' {
		return 0, len(text) == 1
	}
	for i := 0; i < len(text); i++ {
		if text[i] < '0' || text[i] > '9' {
			return 0, false
		}
	}
	value, err := strconv.ParseUint(text, 10, 64)
	return value, err == nil
}

// isRejectionCode is ^[a-z][a-z0-9-]{0,63}$.
func isRejectionCode(text string) bool {
	if len(text) == 0 || len(text) > 64 || text[0] < 'a' || text[0] > 'z' {
		return false
	}
	for i := 1; i < len(text); i++ {
		c := text[i]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

func decodeControl(json []byte) (Tag, *DecodeError) {
	var (
		epoch                              int64
		format                             int32
		lineage                            string
		haveEpoch, haveFormat, haveLineage bool
	)
	invalid := refuse("the control payload is not valid JSON")
	reader := newJSONReader(json)
	read, err := reader.Read()
	if err != nil {
		return Tag{}, invalid
	}
	if !read || reader.token != tokenStartObject {
		return Tag{}, refuse("the control payload is not a JSON object")
	}
	for {
		read, err := reader.Read()
		if err != nil {
			return Tag{}, invalid
		}
		if !read || reader.token != tokenPropertyName {
			break
		}
		isEpoch := reader.ValueTextEquals("epoch")
		isFormat := reader.ValueTextEquals("format")
		isLineage := reader.ValueTextEquals("lineage")
		read, err = reader.Read()
		if err != nil {
			return Tag{}, invalid
		}
		if !read {
			return Tag{}, refuse("a control property has no value")
		}
		ok := false
		switch {
		case isEpoch && !haveEpoch && reader.token == tokenNumber:
			epoch, ok = reader.TryGetInt64()
			haveEpoch = ok
		case isFormat && !haveFormat && reader.token == tokenNumber:
			format, ok = reader.TryGetInt32()
			haveFormat = ok
		case isLineage && !haveLineage && reader.token == tokenString:
			// A string that is not valid text is ill-typed.
			text, textErr := reader.GetString()
			lineage, ok = text, textErr == nil
			haveLineage = ok
		}
		if !ok {
			return Tag{}, refuse("the control payload has an unknown, repeated or ill-typed property")
		}
	}
	if reader.token != tokenEndObject {
		return Tag{}, refuse("the control payload has trailing content")
	}
	if more, err := reader.Read(); err != nil {
		return Tag{}, invalid
	} else if more {
		return Tag{}, refuse("the control payload has trailing content")
	}
	if !haveEpoch || !haveFormat || !haveLineage {
		return Tag{}, refuse("the control payload needs epoch, format and lineage")
	}
	tag := Tag{Format: format, Epoch: epoch, Lineage: lineage}
	if !tag.IsAnnounceable() {
		return Tag{}, refuse("the control payload needs format >= 1, epoch >= 0 and a 32-hex lineage")
	}
	return tag, nil
}

func decodeLimits(json []byte) (int64, *DecodeError) {
	var limit int64
	haveLimit := false
	invalid := refuse("the limits payload is not valid JSON")
	reader := newJSONReader(json)
	read, err := reader.Read()
	if err != nil {
		return 0, invalid
	}
	if !read || reader.token != tokenStartObject {
		return 0, refuse("the limits payload is not a JSON object")
	}
	for {
		read, err := reader.Read()
		if err != nil {
			return 0, invalid
		}
		if !read || reader.token != tokenPropertyName {
			break
		}
		isLimit := reader.ValueTextEquals("maxMessageBytes")
		read, err = reader.Read()
		if err != nil {
			return 0, invalid
		}
		if !read {
			return 0, refuse("a limits property has no value")
		}
		ok := false
		if isLimit && !haveLimit && reader.token == tokenNumber {
			limit, ok = reader.TryGetInt64()
			haveLimit = ok
		}
		if !ok {
			return 0, refuse("the limits payload has an unknown, repeated or ill-typed property")
		}
	}
	if reader.token != tokenEndObject {
		return 0, refuse("the limits payload has trailing content")
	}
	if more, err := reader.Read(); err != nil {
		return 0, invalid
	} else if more {
		return 0, refuse("the limits payload has trailing content")
	}
	if !haveLimit || limit <= 0 {
		return 0, refuse("the limits payload needs a positive maxMessageBytes")
	}
	return limit, nil
}

func decodeIdentities(json []byte) ([]Identity, *DecodeError) {
	list := []Identity{}
	sawKey := false
	invalid := refuse("the identities payload is not valid JSON")
	reader := newJSONReader(json)
	read, err := reader.Read()
	if err != nil {
		return nil, invalid
	}
	if !read || reader.token != tokenStartObject {
		return nil, refuse("the identities payload is not a JSON object")
	}
	for {
		read, err := reader.Read()
		if err != nil {
			return nil, invalid
		}
		if !read || reader.token != tokenPropertyName {
			break
		}
		isIdentities := reader.ValueTextEquals("identities")
		read, err = reader.Read()
		if err != nil {
			return nil, invalid
		}
		if !read {
			return nil, refuse("an identities property has no value")
		}
		if !isIdentities || sawKey || reader.token != tokenStartArray {
			return nil, refuse("the identities payload has an unknown, repeated or ill-typed property")
		}
		sawKey = true
		for {
			read, err := reader.Read()
			if err != nil {
				return nil, invalid
			}
			if !read {
				return nil, refuse("the identities array is not terminated")
			}
			if reader.token == tokenEndArray {
				break
			}
			entry, decodeErr, jsonErr := decodeIdentityEntry(reader)
			if jsonErr {
				return nil, invalid
			}
			if decodeErr != nil {
				return nil, decodeErr
			}
			list = append(list, entry)
		}
	}
	if reader.token != tokenEndObject {
		return nil, refuse("the identities payload has trailing content")
	}
	if more, err := reader.Read(); err != nil {
		return nil, invalid
	} else if more {
		return nil, refuse("the identities payload has trailing content")
	}
	if !sawKey {
		return nil, refuse("the identities payload needs the identities key")
	}
	return list, nil
}

// decodeIdentityEntry reads one {"clientId":N,"actorId":"..."}; jsonErr
// reports a reader throw, which the caller turns into "not valid JSON".
func decodeIdentityEntry(reader *jsonReader) (Identity, *DecodeError, bool) {
	if reader.token != tokenStartObject {
		return Identity{}, refuse("an identities entry is not a JSON object"), false
	}
	var (
		clientID              uint64
		actorID               string
		haveClient, haveActor bool
	)
	for {
		read, err := reader.Read()
		if err != nil {
			return Identity{}, nil, true
		}
		if !read || reader.token != tokenPropertyName {
			break
		}
		isClientID := reader.ValueTextEquals("clientId")
		isActorID := reader.ValueTextEquals("actorId")
		read, err = reader.Read()
		if err != nil {
			return Identity{}, nil, true
		}
		if !read {
			return Identity{}, refuse("an identities entry property has no value"), false
		}
		ok := false
		switch {
		case isClientID && !haveClient && reader.token == tokenNumber:
			if value, parsed := reader.TryGetUInt64(); parsed {
				if value > MaxAwarenessClientID {
					return Identity{}, refuse("an identities entry clientId is past the safe-integer ceiling"), false
				}
				clientID, haveClient, ok = value, true, true
			}
		case isActorID && !haveActor && reader.token == tokenString:
			if text, textErr := reader.GetString(); textErr == nil && text != "" {
				actorID, haveActor, ok = text, true, true
			}
		}
		if !ok {
			return Identity{}, refuse("an identities entry has an unknown, repeated or ill-typed property"), false
		}
	}
	if reader.token != tokenEndObject {
		return Identity{}, refuse("an identities entry is not terminated"), false
	}
	if !haveClient || !haveActor {
		return Identity{}, refuse("an identities entry needs both clientId and actorId"), false
	}
	return Identity{ClientID: clientID, ActorID: actorID}, nil, false
}
