package outbound

import (
	"bufio"
	"compress/gzip"
	"compress/zlib"
	"errors"
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
// andybalholm/brotli v1.2.6 reports them as this unexported error.
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
			if err := checkGzipHeader(g.in); err != nil {
				g.err = err
				break
			}
			member, err := gzip.NewReader(g.in)
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
