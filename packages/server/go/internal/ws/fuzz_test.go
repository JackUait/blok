package ws

import (
	"bufio"
	"bytes"
	"net"
	"testing"
	"time"
)

// discardConn takes every write and has nothing to read; the fuzz input
// arrives through the bufio.Reader instead.
type discardConn struct{}

func (discardConn) Read([]byte) (int, error)         { return 0, net.ErrClosed }
func (discardConn) Write(b []byte) (int, error)      { return len(b), nil }
func (discardConn) Close() error                     { return nil }
func (discardConn) LocalAddr() net.Addr              { return &net.TCPAddr{} }
func (discardConn) RemoteAddr() net.Addr             { return &net.TCPAddr{} }
func (discardConn) SetDeadline(time.Time) error      { return nil }
func (discardConn) SetReadDeadline(time.Time) error  { return nil }
func (discardConn) SetWriteDeadline(time.Time) error { return nil }

func FuzzReceive(f *testing.F) {
	f.Add(frame(0x82, []byte{0, 0, 1, 0}), 16)
	f.Add(append(frame(0x02, nil), frame(0x80, []byte("ab"))...), 1)
	f.Add(append(frame(0x89, []byte("hi")), frame(0x88, []byte{3, 232, 'o', 'k'})...), 4)
	f.Add(frame(0x81, []byte{0xe2, 0x82, 0xac}), 2)
	f.Add([]byte{0x82, 0xff, 0, 0, 0, 0, 0, 0, 0, 9, 1, 2, 3, 4}, 8)
	f.Fuzz(func(t *testing.T, data []byte, size int) {
		size = size&0x3fff + 1
		c := NewServerConn(discardConn{}, bufio.NewReader(bytes.NewReader(data)), Options{})
		buf := make([]byte, size)
		// Every receive either consumes input or ends the loop, so the
		// count is bounded by the input length plus the close.
		for range len(data) + 2 {
			n, kind, end, err := c.Receive(buf)
			if err != nil {
				return
			}
			if n < 0 || n > len(buf) {
				t.Fatalf("n=%d with a %d-byte buffer", n, len(buf))
			}
			if kind == MessageClose {
				if !end || n != 0 {
					t.Fatalf("close receive: n=%d end=%v", n, end)
				}
				return
			}
		}
		t.Fatalf("%d receives and no end of input", len(data)+2)
	})
}
