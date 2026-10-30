package blob

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/mediatype"
)

const (
	s3RequestTimeout        = 5 * time.Minute
	s3ResponseHeaderTimeout = 60 * time.Second
	s3ConnectTimeout        = 10 * time.Second
	s3ErrorBodyLimit        = 512
)

// S3 is S3BlobStore: SigV4-signed requests to the operator's endpoint. It
// is the one client exempt from the outbound guard, because it reaches only
// the configured endpoint, never a URL a caller chose.
type S3 struct {
	Endpoint, Region, Bucket, AccessKey, SecretKey, PublicURL, Addressing string
	// MaxSpoolBytes caps a body that has to be spooled to learn its length.
	MaxSpoolBytes int64
	TempDir       string
	Now           func() time.Time
	client        *http.Client
}

// NewS3 checks the target the way S3TargetResolver does and builds the client.
func NewS3(s *S3) (*S3, error) {
	if _, _, err := s.target("validation"); err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: s3ConnectTimeout}
	s.client = &http.Client{
		Transport: &http.Transport{
			// SocketsHttpHandler's default: the system proxy. Which proxy
			// settings .NET reads on each OS is UNVERIFIED.
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           dialer.DialContext,
			ResponseHeaderTimeout: s3ResponseHeaderTimeout,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return s, nil
}

// target is S3TargetResolver.Resolve: the object URL and the Host value.
func (s *S3) target(key string) (*dotnet.URI, string, error) {
	if s.Bucket == "" {
		return nil, "", errors.New("blobstore: s3 needs a bucket")
	}
	for i := 0; i < len(s.Bucket); i++ {
		c := s.Bucket[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || c == '-' || c == '.' || c == '_') {
			return nil, "", fmt.Errorf("blobstore: s3 bucket %q may only contain letters, digits, dots, dashes and underscores", s.Bucket)
		}
	}
	if s.Addressing != "" && s.Addressing != "path" && s.Addressing != "virtual" {
		return nil, "", fmt.Errorf("blobstore: s3 addressing style must be \"path\" or \"virtual\" (got %q)", s.Addressing)
	}
	if s.Addressing == "virtual" && !dnsCompatibleBucket(s.Bucket) {
		return nil, "", fmt.Errorf("blobstore: s3 bucket %q is not valid for virtual-hosted addressing", s.Bucket)
	}
	endpoint, ok := dotnet.ParseAbsoluteURI(s.Endpoint)
	if !ok || !endpoint.IsHTTP() || endpoint.Host == "" {
		return nil, "", fmt.Errorf("blobstore: s3 endpoint %q has no usable host", s.Endpoint)
	}
	authorityStart := strings.Index(s.Endpoint, "://") + 3
	authority := s.Endpoint[authorityStart:]
	if end := strings.IndexAny(authority, "/?#"); end >= 0 {
		authority = authority[:end]
	}
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		authority = authority[at+1:]
	}
	for i := 0; i < len(authority); i++ {
		if authority[i] < 0x20 || authority[i] > 0x7e {
			return nil, "", fmt.Errorf("blobstore: s3 endpoint host %q must be ASCII", endpoint.Host)
		}
	}
	if path := endpointPath(s.Endpoint, authorityStart); strings.Trim(dotnet.UnescapeDataString(path), "/") != "" {
		return nil, "", fmt.Errorf("blobstore: s3 endpoint %q must have no path", s.Endpoint)
	}
	host, path := endpoint.Host, "/"+s.Bucket+"/"+key
	if s.virtual(endpoint.Host) {
		host, path = s.Bucket+"."+endpoint.Host, "/"+key
	}
	defaultPort := endpoint.Scheme == "http" && endpoint.Port == 80 || endpoint.Scheme == "https" && endpoint.Port == 443
	authorityText := host
	if !defaultPort {
		authorityText += ":" + strconv.Itoa(endpoint.Port)
	}
	url, ok := dotnet.ParseAbsoluteURI(endpoint.Scheme + "://" + authorityText + path)
	if !ok {
		return nil, "", fmt.Errorf("blobstore: s3 endpoint %q has no usable host", s.Endpoint)
	}
	return url, authorityText, nil
}

func endpointPath(endpoint string, authorityStart int) string {
	rest := endpoint[authorityStart:]
	suffix := strings.IndexAny(rest, "?#")
	slash := strings.IndexByte(rest, '/')
	if slash < 0 || suffix >= 0 && slash > suffix {
		return ""
	}
	path := rest[slash:]
	if end := strings.IndexAny(path, "?#"); end >= 0 {
		path = path[:end]
	}
	return path
}

func (s *S3) virtual(host string) bool {
	switch s.Addressing {
	case "path":
		return false
	case "virtual":
		return true
	}
	lower := strings.ToLower(host)
	return (lower == "amazonaws.com" || strings.HasSuffix(lower, ".amazonaws.com")) &&
		!strings.Contains(s.Bucket, ".") && dnsCompatibleBucket(s.Bucket)
}

func dnsCompatibleBucket(bucket string) bool {
	if len(bucket) < 3 || len(bucket) > 63 {
		return false
	}
	for i := 0; i < len(bucket); i++ {
		c := bucket[i]
		if 'a' <= c && c <= 'z' || '0' <= c && c <= '9' {
			continue
		}
		if c == '.' && i > 0 && i < len(bucket)-1 && bucket[i-1] != '.' {
			continue
		}
		if c != '-' || i == 0 || i == len(bucket)-1 || bucket[i-1] == '.' || bucket[i+1] == '.' {
			return false
		}
	}
	return true
}

// Put spools content to learn its length and hash, then PUTs it.
func (s *S3) Put(ctx context.Context, extension, mimeType string, content io.Reader) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	key := NewKey(extension)
	spool, length, hash, err := s.spool(ctx, content)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = spool.Close()
		_ = os.Remove(spool.Name())
	}()
	if _, err := s.send(ctx, http.MethodPut, key, sanitizeS3MediaType(mimeType), spool, length, hash, false, false); err != nil {
		return "", err
	}
	return strings.TrimRight(s.PublicURL, "/") + "/" + key, nil
}

func (s *S3) spool(ctx context.Context, content io.Reader) (*os.File, int64, string, error) {
	var random [16]byte
	_, _ = rand.Read(random[:])
	dir := s.TempDir
	if dir == "" {
		dir = os.TempDir()
	}
	file, err := os.OpenFile(filepath.Join(dir, "blok-s3-"+hex.EncodeToString(random[:])+".tmp"), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, 0, "", err
	}
	hash := sha256.New()
	limited := io.LimitReader(content, s.MaxSpoolBytes+1)
	length, err := io.Copy(io.MultiWriter(file, hash), readerWithContext{ctx, limited})
	if err == nil && length > s.MaxSpoolBytes {
		err = errors.New("blobstore: s3 upload body is over the spool cap")
	}
	if err == nil {
		_, err = file.Seek(0, io.SeekStart)
	}
	if err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return nil, 0, "", err
	}
	return file, length, hex.EncodeToString(hash.Sum(nil)), nil
}

// Delete removes the object behind a URL this store issued.
func (s *S3) Delete(ctx context.Context, url string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	key, ok := KeyFromPublicURL(s.PublicURL, url)
	if !ok {
		return ErrForeign
	}
	_, err := s.send(ctx, http.MethodDelete, key, "", nil, 0, emptyHash, false, false)
	return err
}

// GetObject reads a raw key for the collab working set. A 404 is nil, nil;
// a 403 stays an error, since S3 answers 403 for a missing key when the
// credentials cannot list the bucket.
func (s *S3) GetObject(ctx context.Context, key string) ([]byte, error) {
	if key == "" {
		return nil, errors.New("blobstore: s3 key is empty")
	}
	return s.send(ctx, http.MethodGet, key, "", nil, 0, emptyHash, true, true)
}

// PutObject writes a raw key as application/octet-stream.
func (s *S3) PutObject(ctx context.Context, key string, content []byte) error {
	if key == "" {
		return errors.New("blobstore: s3 key is empty")
	}
	sum := sha256.Sum256(content)
	_, err := s.send(ctx, http.MethodPut, key, "application/octet-stream", bytes.NewReader(content), int64(len(content)), hex.EncodeToString(sum[:]), false, false)
	return err
}

// DeleteObject removes a raw key; a 404 is success.
func (s *S3) DeleteObject(ctx context.Context, key string) error {
	if key == "" {
		return errors.New("blobstore: s3 key is empty")
	}
	_, err := s.send(ctx, http.MethodDelete, key, "", nil, 0, emptyHash, false, true)
	return err
}

var emptyHash = func() string { sum := sha256.Sum256(nil); return hex.EncodeToString(sum[:]) }()

func (s *S3) send(ctx context.Context, method, key, mimeType string, body io.Reader, length int64, hash string, readBody, allowNotFound bool) ([]byte, error) {
	url, host, err := s.target(key)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, s3RequestTimeout)
	defer cancel()
	if body == nil {
		body = http.NoBody
	}
	request, err := http.NewRequestWithContext(ctx, method, url.AbsoluteURI, body)
	if err != nil {
		return nil, err
	}
	request.ContentLength = length
	if method == http.MethodPut {
		request.Header.Set("Content-Disposition", "attachment")
	}
	if mimeType != "" {
		request.Header.Set("Content-Type", mimeType)
	}
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	sign(request, url.AbsolutePath, host, s.Region, s.AccessKey, s.SecretKey, mimeType, hash, now())
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode <= 299 {
		if readBody {
			return io.ReadAll(response.Body)
		}
		return []byte{}, nil
	}
	if allowNotFound && response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	prefix, _ := io.ReadAll(io.LimitReader(response.Body, s3ErrorBodyLimit))
	return nil, fmt.Errorf("blobstore: s3 %s returned %d: %s", method, response.StatusCode, strings.TrimSpace(string(prefix)))
}

// sign is S3RequestSigner.Sign: SigV4 over [content-type;]host;
// x-amz-content-sha256;x-amz-date, an empty query, and the escaped path.
func sign(request *http.Request, path, host, region, accessKey, secretKey, contentType, hash string, at time.Time) {
	utc := at.UTC()
	amzDate := utc.Format("20060102T150405Z")
	dateStamp := utc.Format("20060102")
	type header struct{ name, value string }
	var headers []header
	if contentType != "" {
		headers = append(headers, header{"content-type", contentType})
	}
	headers = append(headers, header{"host", host}, header{"x-amz-content-sha256", hash}, header{"x-amz-date", amzDate})
	request.Host = host
	request.Header.Set("X-Amz-Content-Sha256", hash)
	request.Header.Set("X-Amz-Date", amzDate)
	var canonical strings.Builder
	names := make([]string, len(headers))
	for i, h := range headers {
		canonical.WriteString(h.name + ":" + strings.Join(strings.Fields(h.value), " ") + "\n")
		names[i] = h.name
	}
	signed := strings.Join(names, ";")
	canonicalRequest := strings.Join([]string{request.Method, path, "", canonical.String(), signed, hash}, "\n")
	scope := dateStamp + "/" + region + "/s3/aws4_request"
	requestHash := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, hex.EncodeToString(requestHash[:])}, "\n")
	key := hmacSHA256([]byte("AWS4"+secretKey), dateStamp)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, stringToSign))
	request.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+accessKey+"/"+scope+", SignedHeaders="+signed+", Signature="+signature)
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

// sanitizeS3MediaType is the wire rule plus printable ASCII only.
func sanitizeS3MediaType(value string) string {
	value = strings.TrimSpace(value)
	for i := 0; i < len(value); i++ {
		if value[i] < 0x20 || value[i] > 0x7e {
			return ""
		}
	}
	return mediatype.SanitizeWire(value)
}

type readerWithContext struct {
	ctx context.Context
	r   io.Reader
}

func (c readerWithContext) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}
