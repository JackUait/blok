package blokmcp

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"io"
	"testing"
)

// fakeWire is a server stream to read from and a sink for what the
// client writes back.
type fakeWire struct {
	in  *bytes.Reader
	out bytes.Buffer
}

func (f *fakeWire) Read(p []byte) (int, error)  { return f.in.Read(p) }
func (f *fakeWire) Write(p []byte) (int, error) { return f.out.Write(p) }
func (f *fakeWire) Close() error                { return nil }

func serverFrame(first byte, payload []byte) []byte {
	frame := []byte{first}
	switch {
	case len(payload) < 126:
		frame = append(frame, byte(len(payload)))
	case len(payload) <= 0xFFFF:
		frame = append(frame, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		frame = append(frame, 127)
		frame = binary.BigEndian.AppendUint64(frame, uint64(len(payload)))
	}
	return append(frame, payload...)
}

func readFrom(stream []byte) (*fakeWire, []byte, int, error) {
	wire := &fakeWire{in: bytes.NewReader(stream)}
	conn := &wsConn{rw: wire, reader: bufio.NewReader(wire)}
	message, code, err := conn.readMessage()
	return wire, message, code, err
}

func TestJoinsFragmentsIntoOneMessage(t *testing.T) {
	stream := append(serverFrame(0x02, []byte("ab")), serverFrame(0x80, []byte("cd"))...)
	_, message, _, err := readFrom(stream)
	if err != nil || string(message) != "abcd" {
		t.Fatalf("%q %v", message, err)
	}
}

func TestRefusesProtocolErrorsWith1002AsWsDoes(t *testing.T) {
	cases := map[string][]byte{
		"a continuation with no message": serverFrame(0x80, []byte("x")),
		"a data frame mid-message":       append(serverFrame(0x02, []byte("a")), serverFrame(0x82, []byte("b"))...),
		"a control frame without FIN":    serverFrame(0x09, nil),
		"a control frame over 125 bytes": serverFrame(0x89, bytes.Repeat([]byte("p"), 126)),
		"a close payload of one byte":    serverFrame(0x88, []byte{3}),
		"a reserved opcode":              serverFrame(0x83, nil),
		"an RSV bit with no extension":   serverFrame(0xC2, []byte("x")),
	}
	for name, stream := range cases {
		wire, _, code, err := readFrom(stream)
		if err == nil || code != 1002 {
			t.Errorf("%s: code %d, err %v", name, code, err)
			continue
		}
		// The client says why before it goes.
		if out := wire.out.Bytes(); len(out) < 4 || out[0] != 0x88 {
			t.Errorf("%s: sent no close frame (%x)", name, out)
		}
	}
}

func TestCapsTheWholeMessageAtWsMaxPayload(t *testing.T) {
	half := bytes.Repeat([]byte("x"), maxMessageBytes/2+1)
	stream := append(serverFrame(0x02, half), serverFrame(0x80, half)...)
	_, _, code, err := readFrom(stream)
	if err == nil || code != 1009 {
		t.Fatalf("code %d, err %v", code, err)
	}
	if maxMessageBytes != 100*1024*1024 {
		t.Fatalf("the cap is %d, ws's maxPayload is 100 MiB", maxMessageBytes)
	}
	_ = io.EOF
}
