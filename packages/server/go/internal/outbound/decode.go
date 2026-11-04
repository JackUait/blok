package outbound

import (
	"bufio"
	"compress/gzip"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"

	"github.com/andybalholm/brotli"
)

// .NET decodes without strict validation (the UseStrictValidation switch is
// off): a body cut short ends quietly with what was decoded so far. A bad
// header or checksum still fails. outbound-encodings.json pins the cases.

// decoder returns the reader for one Content-Encoding, already lower case.
func decoder(encoding string, raw io.Reader) (io.Reader, bool) {
	switch encoding {
	case "gzip":
		return &gzipMembers{in: bufio.NewReader(raw)}, true
	case "br":
		return brotliReader{quietEnd{brotli.NewReader(raw)}}, true
	case "deflate":
		return &lazyZlib{raw: raw}, true
	}
	return nil, false
}

func quiet(err error) error {
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return io.EOF
	}
	return err
}

type quietEnd struct{ r io.Reader }

func (q quietEnd) Read(p []byte) (int, error) {
	n, err := q.r.Read(p)
	return n, quiet(err)
}

// brotliReader is BrotliStream, which ignores bytes after the stream ends.
// andybalholm/brotli v1.2.7 reports them as this unexported error.
type brotliReader struct{ r io.Reader }

func (b brotliReader) Read(p []byte) (int, error) {
	n, err := b.r.Read(p)
	if err != nil && err.Error() == "brotli: excessive input" {
		err = io.EOF
	}
	return n, err
}

// lazyZlib is ZLibStream: an empty body is an empty result.
type lazyZlib struct {
	raw io.Reader
	z   io.Reader
}

func (l *lazyZlib) Read(p []byte) (int, error) {
	if l.z == nil {
		z, err := zlib.NewReader(l.raw)
		if err != nil {
			return 0, quiet(err)
		}
		l.z = quietEnd{z}
	}
	return l.z.Read(p)
}

// gzipMembers is GZipStream. After a member, .NET's Inflater starts another
// only if the leftover bytes begin 1f 8b (ResetStreamForLeftoverInput), so
// zero padding or other trailing bytes end the body and are ignored.
type gzipMembers struct {
	in     *bufio.Reader
	member *gzip.Reader
	err    error
}

func (g *gzipMembers) Read(p []byte) (int, error) {
	for g.err == nil {
		if g.member == nil {
			head, err := readGzipHeader(g.in)
			if err != nil {
				g.err = err
				break
			}
			member, err := gzip.NewReader(&prefixed{head, g.in})
			if err != nil {
				g.err = quiet(err)
				break
			}
			member.Multistream(false)
			g.member = member
		}
		n, err := g.member.Read(p)
		if err == io.EOF {
			g.member = nil
			if magic, _ := g.in.Peek(2); len(magic) < 2 || magic[0] != 0x1f || magic[1] != 0x8b {
				g.err = io.EOF
			}
		} else if err != nil {
			g.err = quiet(err)
		}
		if n > 0 {
			return n, nil
		}
	}
	return 0, g.err
}

// checkGzipHeader fails on the header bytes zlib's inflate rejects as soon
// as it sees them; gzip.NewReader first waits for all ten, so a short bad
// header would otherwise read as a truncated, quiet end.
func checkGzipHeader(in *bufio.Reader) error {
	b, _ := in.Peek(4)
	if len(b) > 0 && b[0] != 0x1f || len(b) > 1 && b[1] != 0x8b || len(b) > 2 && b[2] != 8 || len(b) > 3 && b[3]&0xe0 != 0 {
		return gzip.ErrHeader
	}
	return nil
}

// readGzipHeader reads a member header the way zlib's inflate does: a name
// or comment may be any length, where compress/gzip refuses one over 511
// bytes. It returns the fixed ten bytes with the optional fields' flags
// cleared, for compress/gzip to read the rest of the member.
func readGzipHeader(in *bufio.Reader) ([]byte, error) {
	if err := checkGzipHeader(in); err != nil {
		return nil, err
	}
	head := make([]byte, 10)
	if _, err := io.ReadFull(in, head); err != nil {
		return nil, quiet(err)
	}
	sum := crc32.ChecksumIEEE(head)
	read := func(b []byte) error {
		_, err := io.ReadFull(in, b)
		sum = crc32.Update(sum, crc32.IEEETable, b)
		return quiet(err)
	}
	flags := head[3]
	if flags&0x04 != 0 {
		size := make([]byte, 2)
		if err := read(size); err != nil {
			return nil, err
		}
		if err := read(make([]byte, binary.LittleEndian.Uint16(size))); err != nil {
			return nil, err
		}
	}
	for _, field := range []byte{0x08, 0x10} {
		if flags&field == 0 {
			continue
		}
		for b := byte(1); b != 0; {
			var err error
			if b, err = in.ReadByte(); err != nil {
				return nil, quiet(err)
			}
			sum = crc32.Update(sum, crc32.IEEETable, []byte{b})
		}
	}
	if flags&0x02 != 0 {
		want := make([]byte, 2)
		if _, err := io.ReadFull(in, want); err != nil {
			return nil, quiet(err)
		}
		if binary.LittleEndian.Uint16(want) != uint16(sum) {
			return nil, gzip.ErrHeader
		}
	}
	head[3] = 0
	return head, nil
}

// prefixed is a flate.Reader, so compress/gzip reads in through it without
// a buffer of its own that would swallow the next member's bytes.
type prefixed struct {
	head []byte
	in   *bufio.Reader
}

func (p *prefixed) Read(b []byte) (int, error) {
	if len(p.head) > 0 {
		n := copy(b, p.head)
		p.head = p.head[n:]
		return n, nil
	}
	return p.in.Read(b)
}

func (p *prefixed) ReadByte() (byte, error) {
	if len(p.head) > 0 {
		b := p.head[0]
		p.head = p.head[1:]
		return b, nil
	}
	return p.in.ReadByte()
}
