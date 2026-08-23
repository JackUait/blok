package blobstore

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Addressing styles. Path style puts the bucket in the URL (/bucket/key);
// virtual-hosted style puts it in the hostname (bucket.endpoint/key).
const (
	// AddressingAuto picks virtual-hosted style for AWS and path style for
	// everything else. See virtualHosted for why that is the right default.
	AddressingAuto    = ""
	AddressingPath    = "path"
	AddressingVirtual = "virtual"
)

const (
	// defaultS3Timeout bounds one whole request, upload included. It is
	// generous on purpose: the transport's stall timeouts are what kill a dead
	// connection, and a large upload over a slow link is not a stall.
	defaultS3Timeout = 5 * time.Minute

	maxMediaTypeLen = 255

	// errorBodyLimit bounds how much of an endpoint's refusal is quoted back.
	// S3 explains itself in XML and a bare status code is not debuggable.
	errorBodyLimit = 512
)

type S3Config struct {
	Endpoint  string // e.g. https://s3.eu-central-1.amazonaws.com or an R2/MinIO endpoint
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	PublicURL string

	// AddressingStyle is AddressingAuto, AddressingPath or AddressingVirtual.
	AddressingStyle string

	// Timeout bounds one request. Zero means defaultS3Timeout.
	Timeout time.Duration
}

type S3 struct {
	cfg S3Config
	// This client talks to the operator's OWN configured endpoint, never to a
	// consumer-supplied URL, so it is the one exemption from the fetchguard law.
	// Adding a second outbound client anywhere else in this service reopens the
	// SSRF hole fetchguard exists to close.
	http *http.Client
}

var _ BlobStore = (*S3)(nil)

func NewS3(cfg S3Config) *S3 {
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultS3Timeout
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 60 * time.Second

	// Deliberately no http.Client.Timeout: it would cap the transfer itself,
	// and a 100 MB upload on a slow link would die at the cap even while it is
	// making progress. do() puts the overall bound on the context instead, so
	// a caller that gives up early still cancels the request.
	return &S3{cfg: cfg, http: &http.Client{Transport: transport}}
}

func (s *S3) Put(ctx context.Context, name, mimeType string, r io.Reader) (string, error) {
	key, err := newStoredName(name)
	if err != nil {
		return "", err
	}

	body, err := newPayload(r)
	if err != nil {
		return "", err
	}
	defer body.close()

	if err := s.do(ctx, http.MethodPut, key, mimeType, body); err != nil {
		return "", err
	}

	return strings.TrimRight(s.cfg.PublicURL, "/") + "/" + key, nil
}

func (s *S3) Delete(ctx context.Context, rawURL string) error {
	key, err := keyFromPublicURL(s.cfg.PublicURL, rawURL)
	if err != nil {
		return err
	}

	return s.do(ctx, http.MethodDelete, key, "", emptyPayload())
}

func (s *S3) do(ctx context.Context, method, key, mimeType string, body payload) error {
	target, err := resolveTarget(s.cfg, key)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, s.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, method, target.url.String(), body.reader)
	if err != nil {
		return err
	}
	// net/http infers "length unknown" from any body type it does not
	// recognise and falls back to chunked transfer encoding, which S3 answers
	// with 501 unless the request also carries streaming-signature headers.
	// The length has to be stated.
	req.ContentLength = body.size

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	// One list feeds both the request and the canonical request, in the
	// lowercase-sorted order SigV4 requires — content-type sorts before host.
	// A header sent but absent here is merely unsigned, which S3 permits for
	// everything except host and x-amz-*; a header named here but not sent, or
	// named out of order, invalidates every signature.
	headers := make([][2]string, 0, 4)
	if mediaType := sanitizeMediaType(mimeType); mediaType != "" {
		headers = append(headers, [2]string{"content-type", mediaType})
	}
	headers = append(headers,
		[2]string{"host", target.host},
		[2]string{"x-amz-content-sha256", body.sha256},
		[2]string{"x-amz-date", amzDate},
	)

	var canonicalHeaders, signedHeaders strings.Builder
	for i, h := range headers {
		if h[0] == "host" {
			// net/http discards Header["Host"] entirely — Request.Host is the
			// only field that reaches the wire. Setting it anywhere else signs
			// a host that was never sent, and every signature is then wrong
			// against a real endpoint while an httptest server validates
			// nothing.
			req.Host = h[1]
		} else {
			req.Header.Set(h[0], h[1])
		}

		canonicalHeaders.WriteString(h[0] + ":" + canonicalHeaderValue(h[1]) + "\n")
		if i > 0 {
			signedHeaders.WriteString(";")
		}
		signedHeaders.WriteString(h[0])
	}

	canonicalRequest := strings.Join([]string{
		method,
		target.url.EscapedPath(),
		"", // no query string is ever sent
		canonicalHeaders.String(),
		signedHeaders.String(),
		body.sha256,
	}, "\n")

	scope := dateStamp + "/" + s.cfg.Region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := hmacSHA256(
		hmacSHA256(
			hmacSHA256(
				hmacSHA256([]byte("AWS4"+s.cfg.SecretKey), []byte(dateStamp)),
				[]byte(s.cfg.Region)),
			[]byte("s3")),
		[]byte("aws4_request"))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.cfg.AccessKey, scope, signedHeaders.String(),
		hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))))

	resp, err := s.http.Do(req)
	if err != nil {
		return fmt.Errorf("blobstore: s3 %s: %w", method, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		reason, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit))

		return fmt.Errorf("blobstore: s3 %s returned %d: %s", method, resp.StatusCode, strings.TrimSpace(string(reason)))
	}
	// Drain what little a PUT or DELETE answers with so the connection can be
	// reused rather than torn down.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, errorBodyLimit))

	return nil
}

// s3Target is one request's destination. host is the value that goes on the
// wire AND into the signature; keeping them one field is what stops them
// disagreeing.
type s3Target struct {
	url  *url.URL
	host string
}

func resolveTarget(cfg S3Config, key string) (s3Target, error) {
	if cfg.Bucket == "" {
		return s3Target{}, fmt.Errorf("blobstore: s3 needs a bucket")
	}
	if !isBucketName(cfg.Bucket) {
		return s3Target{}, fmt.Errorf("blobstore: s3 bucket %q may only contain letters, digits, dots, dashes and underscores", cfg.Bucket)
	}
	if cfg.AddressingStyle != AddressingAuto && cfg.AddressingStyle != AddressingPath && cfg.AddressingStyle != AddressingVirtual {
		return s3Target{}, fmt.Errorf("blobstore: s3 addressing style must be %q or %q (got %q)", AddressingPath, AddressingVirtual, cfg.AddressingStyle)
	}

	endpoint, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return s3Target{}, fmt.Errorf("blobstore: s3 endpoint %q: %w", cfg.Endpoint, err)
	}
	if endpoint.Host == "" {
		return s3Target{}, fmt.Errorf("blobstore: s3 endpoint %q has no host", cfg.Endpoint)
	}
	// The bucket and key take the whole path, so a prefix on the endpoint would
	// be silently dropped and every request would go somewhere else. Say so.
	if strings.Trim(endpoint.Path, "/") != "" {
		return s3Target{}, fmt.Errorf("blobstore: s3 endpoint %q must have no path", cfg.Endpoint)
	}
	// net/http punycodes the Host header it writes, so a non-ASCII host would
	// be signed as one string and sent as another and every signature would be
	// refused. Refuse the endpoint instead of signing what is not sent.
	if !isASCII(endpoint.Host) {
		return s3Target{}, fmt.Errorf("blobstore: s3 endpoint host %q must be ASCII — use its punycode form", endpoint.Host)
	}

	host := hostWithoutDefaultPort(endpoint)
	target := *endpoint
	target.RawQuery = ""
	target.Fragment = ""
	target.RawFragment = ""
	target.RawPath = ""

	if virtualHosted(cfg, endpoint) {
		host = cfg.Bucket + "." + host
		target.Path = "/" + key
	} else {
		target.Path = "/" + cfg.Bucket + "/" + key
	}
	target.Host = host

	return s3Target{url: &target, host: host}, nil
}

// virtualHosted decides where the bucket goes when the operator did not say.
//
// Path style is the default because it is what every self-hosted and
// S3-compatible endpoint accepts, and the only style an endpoint without
// wildcard DNS — a MinIO on an IP, a gateway on an internal name — can serve
// at all. AWS is the one provider that refuses path style for buckets created
// after 2020-09-30, so an AWS endpoint is the one case that moves.
func virtualHosted(cfg S3Config, endpoint *url.URL) bool {
	switch cfg.AddressingStyle {
	case AddressingPath:
		return false
	case AddressingVirtual:
		return true
	}

	host := strings.ToLower(endpoint.Hostname())
	if host != "amazonaws.com" && !strings.HasSuffix(host, ".amazonaws.com") {
		return false
	}

	return isDNSCompatibleBucket(cfg.Bucket)
}

// isDNSCompatibleBucket reports whether the bucket can be a hostname label.
// A dot is the one to watch: "my.bucket.s3.amazonaws.com" is not covered by
// the "*.s3.amazonaws.com" certificate, so a bucket with a dot must keep path
// style or every TLS handshake fails.
func isDNSCompatibleBucket(bucket string) bool {
	if len(bucket) < 3 || len(bucket) > 63 {
		return false
	}

	for i := range len(bucket) {
		switch c := bucket[i]; {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case c == '-' && i > 0 && i < len(bucket)-1:
		default:
			return false
		}
	}

	return true
}

func isBucketName(bucket string) bool {
	for i := range len(bucket) {
		switch c := bucket[i]; {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-', c == '.', c == '_':
		default:
			return false
		}
	}

	return true
}

// hostWithoutDefaultPort drops an explicit :443 or :80. net/http keeps such a
// port in the Host header verbatim, so signing the stripped form only works
// because do() assigns this same string to Request.Host.
func hostWithoutDefaultPort(u *url.URL) string {
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		host := u.Hostname()
		if strings.Contains(host, ":") {
			return "[" + host + "]"
		}

		return host
	}

	return u.Host
}

func isASCII(s string) bool {
	for i := range len(s) {
		if s[i] > 0x7e || s[i] < 0x20 {
			return false
		}
	}

	return true
}

// payload is a request body whose length and SHA-256 are known before the
// first byte goes out, which is what SigV4 requires and a plain stream cannot
// give.
type payload struct {
	reader io.Reader
	size   int64
	sha256 string
	close  func()
}

func emptyPayload() payload {
	return payload{sha256: sha256Hex(nil), close: func() {}}
}

// newPayload hashes r without holding it in memory. A seekable reader — which
// is what multipart.File always is — is hashed where it lies; anything else is
// spooled to a temp file. Reading the whole blob into a []byte instead would
// cost one full upload of resident memory per concurrent request, which at a
// 100 MB cap is 100 MB each.
func newPayload(r io.Reader) (payload, error) {
	if seeker, ok := r.(io.ReadSeeker); ok {
		// Probe before trusting the interface: os.Stdin and pipes have a Seek
		// method that fails at runtime. Seeking to the current position
		// consumes nothing, so falling through to the spool loses no bytes.
		if start, err := seeker.Seek(0, io.SeekCurrent); err == nil {
			return seekablePayload(seeker, start)
		}
	}

	return spooledPayload(r)
}

func seekablePayload(r io.ReadSeeker, start int64) (payload, error) {
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return payload{}, err
	}
	if _, err := r.Seek(start, io.SeekStart); err != nil {
		return payload{}, err
	}

	sum := sha256.New()
	if _, err := io.Copy(sum, r); err != nil {
		return payload{}, err
	}
	if _, err := r.Seek(start, io.SeekStart); err != nil {
		return payload{}, err
	}

	return payload{
		reader: r,
		size:   end - start,
		sha256: hex.EncodeToString(sum.Sum(nil)),
		close:  func() {},
	}, nil
}

func spooledPayload(r io.Reader) (payload, error) {
	f, err := os.CreateTemp("", "blok-s3-*")
	if err != nil {
		return payload{}, err
	}

	cleanup := func() {
		f.Close()
		os.Remove(f.Name())
	}

	sum := sha256.New()
	size, err := io.Copy(io.MultiWriter(f, sum), r)
	if err == nil {
		_, err = f.Seek(0, io.SeekStart)
	}
	if err != nil {
		cleanup()

		return payload{}, err
	}

	return payload{
		reader: f,
		size:   size,
		sha256: hex.EncodeToString(sum.Sum(nil)),
		close:  cleanup,
	}, nil
}

// sanitizeMediaType drops anything that is not a plain ASCII media type. The
// MIME type arrives from the browser next to the filename and is exactly as
// untrusted: net/http refuses some values outright at write time, and a value
// this signs but S3 canonicalizes differently comes back as a signature error
// that looks nothing like its cause.
func sanitizeMediaType(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > maxMediaTypeLen || !isASCII(v) {
		return ""
	}
	if _, _, err := mime.ParseMediaType(v); err != nil {
		return ""
	}

	return v
}

// canonicalHeaderValue trims a header value and collapses internal runs of
// whitespace, which is what SigV4 canonicalization asks for. The value on the
// wire stays untouched: S3 applies this same rule to what it received, so the
// two agree without the sent bytes having to be normalized.
func canonicalHeaderValue(v string) string {
	return strings.Join(strings.Fields(v), " ")
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)

	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)

	return h.Sum(nil)
}
