package wire

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

const fixtures = "../../../../../../test/unit/server-conformance/fixtures/"

func readFixture(t testing.TB, name string, into any) {
	t.Helper()
	data, err := os.ReadFile(fixtures + name)
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(into); err != nil {
		t.Fatal(err)
	}
}

func unhex(t *testing.T, text string) []byte {
	t.Helper()
	b, err := hex.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// fields renders a message the way SyncWireDecodeFixtureTests does.
func fields(m Message) (string, map[string]any) {
	h := hex.EncodeToString
	u := func(v uint64) string { return strconv.FormatUint(v, 10) }
	switch m := m.(type) {
	case SyncStep1:
		return "SyncStep1Frame", map[string]any{"stateVectorHex": h(m.StateVector)}
	case SyncStep2:
		return "SyncStep2Frame", map[string]any{"updateHex": h(m.Update)}
	case SyncUpdate:
		return "SyncUpdateFrame", map[string]any{"updateHex": h(m.Update)}
	case Awareness:
		return "AwarenessFrame", map[string]any{"updateHex": h(m.Update)}
	case QueryAwareness:
		return "QueryAwarenessFrame", map[string]any{}
	case PermissionDenied:
		return "PermissionDeniedFrame", map[string]any{"reason": m.Reason}
	case BlokControl:
		return "BlokControlFrame", map[string]any{
			"epoch": strconv.FormatInt(m.Tag.Epoch, 10), "format": json.Number(strconv.Itoa(int(m.Tag.Format))), "lineage": m.Tag.Lineage,
		}
	case BlokLimits:
		return "BlokLimitsFrame", map[string]any{"maxMessageBytes": strconv.FormatInt(m.MaxMessageBytes, 10)}
	case Operation:
		return "OperationFrame", map[string]any{"lineage": m.Lineage, "operationId": m.OperationID, "updateHex": h(m.Update)}
	case Acknowledgement:
		return "AcknowledgementFrame", map[string]any{"lineage": m.Lineage, "operationId": m.OperationID, "serverSequence": u(m.ServerSequence)}
	case Rejection:
		return "RejectionFrame", map[string]any{"lineage": m.Lineage, "operationId": m.OperationID, "code": m.Code}
	case Activity:
		return "ActivityFrame", map[string]any{}
	case Identities:
		list := []any{}
		for _, identity := range m.Identities {
			list = append(list, map[string]any{"clientId": u(identity.ClientID), "actorId": identity.ActorID})
		}
		return "IdentitiesFrame", map[string]any{"identities": list}
	case Unknown:
		return "UnknownFrame", map[string]any{"messageType": u(m.MessageType)}
	}
	return "", nil
}

func encodeAnswer(m Message) any {
	frame, err := Encode(m)
	if err != nil {
		return map[string]any{"throws": "ArgumentException"}
	}
	return hex.EncodeToString(frame)
}

func decodeAnswer(frame []byte) map[string]any {
	m, err := Decode(frame)
	if err != nil {
		var rule any
		if err.Rule != 0 {
			rule = json.Number(strconv.Itoa(err.Rule))
		}
		return map[string]any{"ok": false, "error": err.Reason, "rule": rule}
	}
	kind, f := fields(m)
	return map[string]any{"ok": true, "kind": kind, "fields": f, "reencoded": encodeAnswer(m)}
}

// same compares through JSON so map order and number spelling do not matter.
func same(t *testing.T, name string, want, got any) {
	t.Helper()
	w, _ := json.Marshal(want)
	g, _ := json.Marshal(got)
	if !bytes.Equal(w, g) {
		t.Errorf("%s:\n want %s\n  got %s", name, w, g)
	}
}

type wireFixture struct {
	Decode []struct {
		Name     string
		FrameHex string
		Answer   map[string]any
	}
	Awareness []struct {
		Name       string
		PayloadHex string
		MaxClients int
		Answer     map[string]any
	}
	Removal []struct {
		Name    string
		Entries []struct{ ClientID, Clock string }
		Answer  string
	}
	Encode []struct {
		Name    string
		Message map[string]any
		Answer  any
	}
}

func TestDecodeMatchesTheCSharpAnswers(t *testing.T) {
	var fixture wireFixture
	readFixture(t, "sync-wire-decode.json", &fixture)
	if len(fixture.Decode) < 179 {
		t.Fatalf("only %d decode cases", len(fixture.Decode))
	}
	for _, c := range fixture.Decode {
		same(t, c.Name, c.Answer, decodeAnswer(unhex(t, c.FrameHex)))
	}
}

func TestAwarenessWalkMatchesTheCSharpAnswers(t *testing.T) {
	var fixture wireFixture
	readFixture(t, "sync-wire-decode.json", &fixture)
	for _, c := range fixture.Awareness {
		var entries []AwarenessEntry
		count, valid := ValidateAwarenessUpdate(unhex(t, c.PayloadHex), c.MaxClients, &entries)
		list := []any{}
		for _, e := range entries {
			list = append(list, map[string]any{
				"clientId": strconv.FormatUint(e.ClientID, 10), "clock": strconv.FormatUint(e.Clock, 10), "removed": e.Removed,
			})
		}
		same(t, c.Name, c.Answer, map[string]any{"valid": valid, "clientCount": count, "entries": list})
	}
}

func TestAwarenessRemovalMatchesTheCSharpBytes(t *testing.T) {
	var fixture wireFixture
	readFixture(t, "sync-wire-decode.json", &fixture)
	for _, c := range fixture.Removal {
		var entries []AwarenessEntry
		for _, e := range c.Entries {
			id, _ := strconv.ParseUint(e.ClientID, 10, 64)
			clock, _ := strconv.ParseUint(e.Clock, 10, 64)
			entries = append(entries, AwarenessEntry{ClientID: id, Clock: clock, Removed: true})
		}
		same(t, c.Name, c.Answer, hex.EncodeToString(EncodeAwarenessRemoval(entries)))
	}
}

func message(t *testing.T, spec map[string]any) Message {
	t.Helper()
	text := func(key string) string { return spec[key].(string) }
	bytesOf := func(key string) []byte { return unhex(t, text(key)) }
	signed := func(key string) int64 { v, _ := strconv.ParseInt(text(key), 10, 64); return v }
	unsigned := func(key string) uint64 { v, _ := strconv.ParseUint(text(key), 10, 64); return v }
	switch text("kind") {
	case "SyncStep1Frame":
		return SyncStep1{StateVector: bytesOf("stateVectorHex")}
	case "SyncStep2Frame":
		return SyncStep2{Update: bytesOf("updateHex")}
	case "SyncUpdateFrame":
		return SyncUpdate{Update: bytesOf("updateHex")}
	case "AwarenessFrame":
		return Awareness{Update: bytesOf("updateHex")}
	case "QueryAwarenessFrame":
		return QueryAwareness{}
	case "ActivityFrame":
		return Activity{}
	case "PermissionDeniedFrame":
		return PermissionDenied{Reason: text("reason")}
	case "BlokControlFrame":
		format, _ := spec["format"].(json.Number).Int64()
		return BlokControl{Tag: Tag{Format: int32(format), Epoch: signed("epoch"), Lineage: text("lineage")}}
	case "BlokLimitsFrame":
		return BlokLimits{MaxMessageBytes: signed("maxMessageBytes")}
	case "OperationFrame":
		return Operation{Lineage: text("lineage"), OperationID: text("operationId"), Update: bytesOf("updateHex")}
	case "AcknowledgementFrame":
		return Acknowledgement{Lineage: text("lineage"), OperationID: text("operationId"), ServerSequence: unsigned("serverSequence")}
	case "RejectionFrame":
		return Rejection{Lineage: text("lineage"), OperationID: text("operationId"), Code: text("code")}
	case "IdentitiesFrame":
		var list []Identity
		for _, item := range spec["identities"].([]any) {
			entry := item.(map[string]any)
			id, _ := strconv.ParseUint(entry["clientId"].(string), 10, 64)
			list = append(list, Identity{ClientID: id, ActorID: entry["actorId"].(string)})
		}
		return Identities{Identities: list}
	}
	t.Fatalf("unknown kind %v", spec["kind"])
	return nil
}

func TestEncodeMatchesTheCSharpAnswers(t *testing.T) {
	var fixture wireFixture
	readFixture(t, "sync-wire-decode.json", &fixture)
	for _, c := range fixture.Encode {
		same(t, c.Name, c.Answer, encodeAnswer(message(t, c.Message)))
	}
}

type framesFixture struct {
	Frames []struct {
		Name     string
		FrameHex string
	}
	V2 struct {
		Frames []struct {
			Name      string
			FrameHex  string
			Canonical bool
		}
		Negative []struct {
			Name     string
			FrameHex string
			Expect   string
			Rule     *int
		}
	}
}

// sync-frames.json comes from the reference JS encoders; C# reads the same
// file in SyncWireFramingTests.
func TestEverySyncFrameFixtureRoundTrips(t *testing.T) {
	var fixture framesFixture
	readFixture(t, "sync-frames.json", &fixture)
	if len(fixture.Frames) != 10 || len(fixture.V2.Frames) != 12 || len(fixture.V2.Negative) < 40 {
		t.Fatalf("fixture shrank: %d %d %d", len(fixture.Frames), len(fixture.V2.Frames), len(fixture.V2.Negative))
	}
	for _, f := range fixture.Frames {
		frame := unhex(t, f.FrameHex)
		m, err := Decode(frame)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		again, encodeErr := Encode(m)
		if encodeErr != nil || !bytes.Equal(again, frame) {
			t.Errorf("%s: re-encoded %x (%v), want %x", f.Name, again, encodeErr, frame)
		}
	}
	for _, f := range fixture.V2.Frames {
		frame := unhex(t, f.FrameHex)
		m, err := Decode(frame)
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		if !f.Canonical {
			continue
		}
		if again, _ := Encode(m); !bytes.Equal(again, frame) {
			t.Errorf("%s: re-encoded %x, want %x", f.Name, again, frame)
		}
	}
	for _, f := range fixture.V2.Negative {
		m, err := Decode(unhex(t, f.FrameHex))
		if f.Expect == "unknown" {
			if _, ok := m.(Unknown); !ok || err != nil {
				t.Errorf("%s: want an unknown frame, got %#v %v", f.Name, m, err)
			}
			continue
		}
		want := 0
		if f.Rule != nil {
			want = *f.Rule
		}
		if err == nil || err.Rule != want {
			t.Errorf("%s: want rule %v, got %v", f.Name, f.Rule, err)
		}
	}
}
