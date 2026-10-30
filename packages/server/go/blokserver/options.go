// Package blokserver is the Blok server as a Go library: the analogue of the
// C# AddBlokServer and MapBlokServer. A host builds Options, calls New, and
// mounts Handler.
package blokserver

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// MinimumSecretLength is the shortest ticket secret, in UTF-16 code units.
const MinimumSecretLength = 32

// maxRemoteUpload is .NET's Array.MaxLength: the by-url path buffers the
// fetched body in one array.
const maxRemoteUpload = 2147483591

// Options configure the server. Field meanings and refusals follow the C#
// BlokServerOptions; DefaultOptions returns its defaults.
type Options struct {
	Version        string
	ListenAddress  string
	Auth           string
	Secret         string
	AllowedOrigins []string

	StorageDirectory string
	PublicURL        string
	MaxUploadBytes   int64
	// RateLimitPerMinute is requests a minute per caller; 0 is off.
	RateLimitPerMinute int64

	// UnfurlEnabled opens GET /unfurl and POST /upload-by-url. Both make the
	// server fetch a URL the caller chose, so the zero value keeps them
	// closed, like C#'s UnfurlDisabled = true.
	UnfurlEnabled bool

	S3Endpoint   string
	S3Region     string
	S3Bucket     string
	S3BucketURL  string
	S3Addressing string
	S3AccessKey  string
	S3SecretKey  string

	CollabEnabled   bool
	DocEndpoint     string
	DocEndpointAuth string
	CollabDirectory string
	CollabS3Prefix  string
	CollabJournal   bool

	CollabMaxConnectionsPerUserPerDoc    int
	CollabMaxConnections                 int64
	CollabMaxMessageBytes                int
	CollabKeepAliveInterval              time.Duration
	CollabInboundFramesPerSecond         int
	CollabInboundBurstFrames             int
	CollabInboundResyncsPerMinute        int
	CollabInboundAwarenessBytesPerSecond int

	// RichTextFields lists custom tools' rich text fields by block type.
	RichTextFields map[string][]string

	// Authorization narrows document access. Nil allows what the ticket
	// allows.
	Authorization Authorization
}

// DefaultOptions returns the C# BlokServerOptions defaults.
func DefaultOptions() Options {
	return Options{
		Version:                              "dev",
		ListenAddress:                        "127.0.0.1:4000",
		Auth:                                 "none",
		MaxUploadBytes:                       32 << 20,
		CollabMaxConnectionsPerUserPerDoc:    8,
		CollabMaxMessageBytes:                1 << 20,
		CollabKeepAliveInterval:              15 * time.Second,
		CollabInboundFramesPerSecond:         50,
		CollabInboundBurstFrames:             100,
		CollabInboundResyncsPerMinute:        60,
		CollabInboundAwarenessBytesPerSecond: 128 << 10,
	}
}

func (o *Options) hasStorage() bool { return o.StorageDirectory != "" || o.S3Bucket != "" }

// Validate returns an error unless the options work together. The messages
// match BlokServerOptions.Validate byte for byte.
func (o *Options) Validate() error {
	_, err := o.validate()
	return err
}

// validate also returns the public path local files are served under.
func (o *Options) validate() (string, error) {
	fail := func(format string, args ...any) (string, error) {
		return "", errors.New(fmt.Sprintf(format, args...))
	}
	switch {
	case o.Auth == "none" && !isLoopbackListen(o.ListenAddress):
		return fail("--auth none serves anyone who can reach %s%s; it may only bind loopback — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service",
			quote(o.ListenAddress), bindScope(o.ListenAddress))
	case o.Auth == "proxy" && !isLoopbackListen(o.ListenAddress):
		return fail("--auth proxy trusts every caller, so it may only bind loopback, not %s%s — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service",
			quote(o.ListenAddress), bindScope(o.ListenAddress))
	case o.Auth == "ticket" && utf16Length(o.Secret) < MinimumSecretLength:
		return fail("--secret must be at least %d characters (got %d)", MinimumSecretLength, utf16Length(o.Secret))
	case o.Auth == "ticket" && len(o.AllowedOrigins) == 0:
		return fail("a public service needs --allow-origin: without it anyone who finds this address can drive requests at third-party sites from your IP")
	case o.Auth != "none" && o.Auth != "proxy" && o.Auth != "ticket":
		return fail("--auth must be none, proxy, or ticket (got %s)", quote(o.Auth))
	}
	if err := validateListen(o.ListenAddress); err != nil {
		return "", err
	}
	if o.MaxUploadBytes <= 0 {
		return fail("--max-upload must be a positive number of bytes (got %d): a zero cap refuses every upload", o.MaxUploadBytes)
	}
	if o.hasStorage() && o.UnfurlEnabled && o.MaxUploadBytes > maxRemoteUpload {
		return fail("--max-upload must be no greater than %d bytes when remote URL upload is enabled (got %d)", maxRemoteUpload, o.MaxUploadBytes)
	}
	if o.RateLimitPerMinute < 0 {
		return fail("--rate-limit must be zero or greater (got %d)", o.RateLimitPerMinute)
	}
	if err := o.validateCollab(); err != nil {
		return "", err
	}
	publicPath := ""
	if o.StorageDirectory != "" && o.S3Bucket == "" {
		path, err := o.localPublicPath()
		if err != nil {
			return "", err
		}
		publicPath = path
	}
	if o.S3Bucket == "" {
		return publicPath, nil
	}
	if o.S3Endpoint == "" {
		return fail("--s3-bucket needs --s3-endpoint, e.g. https://s3.eu-central-1.amazonaws.com")
	}
	endpoint, ok := dotnet.ParseAbsoluteURI(o.S3Endpoint)
	if !ok || !endpoint.IsHTTP() || endpoint.Host == "" || endpoint.UserInfo != "" || endpoint.Query != "" ||
		endpoint.Fragment != "" || strings.Trim(endpoint.AbsolutePath, "/") != "" {
		return fail("--s3-endpoint must be a full HTTP(S) origin without credentials, a path, a query or a fragment (got %s)", quote(o.S3Endpoint))
	}
	if endpoint.Scheme == "http" && !endpoint.Loopback {
		return fail("--s3-endpoint must use HTTPS unless it targets loopback for local development (got %s)", quote(o.S3Endpoint))
	}
	if o.S3Region == "" {
		return fail("--s3-bucket needs --s3-region: an empty region is signed into every request and fails only at the first upload")
	}
	if o.S3BucketURL == "" {
		return fail("--s3-bucket needs --s3-bucket-url: it is the prefix stored URLs are built from, and the only prefix a delete is recognised under")
	}
	if strings.ContainsAny(o.S3BucketURL, "?#") {
		return fail("--s3-bucket-url must not contain a query or fragment (got %s)", quote(o.S3BucketURL))
	}
	if hasMalformedPercentEscape(o.S3BucketURL) || parseHTTPURL(o.S3BucketURL) == nil {
		return fail("--s3-bucket-url must be a full HTTP(S) URL (got %s)", quote(o.S3BucketURL))
	}
	if o.S3AccessKey == "" || o.S3SecretKey == "" {
		return fail("--s3-bucket needs credentials in the BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY environment variables (they are deliberately not flags: a flag lands in this machine's process list)")
	}
	if o.S3Addressing != "" && o.S3Addressing != "path" && o.S3Addressing != "virtual" {
		return fail("--s3-addressing must be \"path\" or \"virtual\", or empty to choose automatically (got %s)", quote(o.S3Addressing))
	}
	return publicPath, nil
}

func (o *Options) validateCollab() error {
	fail := func(format string, args ...any) error { return errors.New(fmt.Sprintf(format, args...)) }
	switch {
	case o.CollabMaxConnectionsPerUserPerDoc <= 0:
		return fail("CollabMaxConnectionsPerUserPerDoc must be a positive number (got %d): a zero cap refuses every sync connection", o.CollabMaxConnectionsPerUserPerDoc)
	case o.CollabMaxConnections < 0:
		return fail("CollabMaxConnections must be zero (no ceiling) or greater (got %d)", o.CollabMaxConnections)
	case o.CollabMaxMessageBytes <= 0:
		return fail("CollabMaxMessageBytes must be a positive number of bytes (got %d): a zero cap closes every sync connection on its first frame", o.CollabMaxMessageBytes)
	case o.CollabKeepAliveInterval < 0:
		return fail("CollabKeepAliveInterval must be zero (off) or greater (got %s)", formatTimeSpan(o.CollabKeepAliveInterval))
	case o.CollabInboundFramesPerSecond < 0:
		return fail("CollabInboundFramesPerSecond must be zero (off) or greater (got %d)", o.CollabInboundFramesPerSecond)
	case o.CollabInboundBurstFrames <= 0:
		return fail("CollabInboundBurstFrames must be a positive number of frames (got %d): a zero burst closes every connection on its first frame", o.CollabInboundBurstFrames)
	}
	if err := checkRichTextFields(o.RichTextFields); err != nil {
		return fail("RichTextFields: %s", err)
	}
	switch {
	case o.CollabInboundResyncsPerMinute < 0:
		return fail("CollabInboundResyncsPerMinute must be zero (off) or greater (got %d)", o.CollabInboundResyncsPerMinute)
	case o.CollabInboundAwarenessBytesPerSecond < 0:
		return fail("CollabInboundAwarenessBytesPerSecond must be zero (off) or greater (got %d)", o.CollabInboundAwarenessBytesPerSecond)
	}
	if !o.CollabEnabled {
		switch {
		case o.DocEndpoint != "":
			return fail("--doc-endpoint needs --collab: without it no sync room ever runs and the endpoint would be silently ignored")
		case o.CollabS3Prefix != "":
			return fail("--collab-s3-prefix needs --collab: without it no working set is ever written and the prefix would be silently ignored")
		case o.CollabJournal:
			return fail("--collab-journal needs --collab: without it no sync room ever runs and the journal would be silently ignored")
		}
		return nil
	}
	if o.CollabJournal && o.CollabS3Prefix != "" {
		return fail("--collab-journal cannot be used with --collab-s3-prefix: the journal is kept on this machine's disk, so a second instance sharing the bucket would not see it and would accept edits the journal never holds")
	}
	if o.DocEndpoint == "" {
		return fail("--collab needs --doc-endpoint: sync rooms seed documents from it and export them back to it, e.g. https://app.example.com/api/blok-docs")
	}
	endpoint, ok := dotnet.ParseAbsoluteURI(o.DocEndpoint)
	if !ok || !endpoint.IsHTTP() || endpoint.Host == "" || endpoint.UserInfo != "" || endpoint.Query != "" || endpoint.Fragment != "" {
		return fail("--doc-endpoint must be a full HTTP(S) URL without credentials, a query or a fragment (got %s)", quote(o.DocEndpoint))
	}
	if endpoint.Scheme == "http" && !endpoint.Loopback {
		return fail("--doc-endpoint must use HTTPS unless it targets loopback for local development (got %s)", quote(o.DocEndpoint))
	}
	if strings.ContainsAny(o.DocEndpointAuth, "\r\n") {
		return fail("--doc-endpoint-auth must not contain a line break (a trailing newline from `echo` or a file is the usual cause): the header would be silently dropped from every doc-endpoint request")
	}
	if o.CollabS3Prefix != "" && o.S3Bucket == "" {
		return fail("--collab-s3-prefix needs --s3-bucket: the collaboration working set can only live in the bucket this server is configured for")
	}
	if o.CollabDirectory == "" || o.StorageDirectory == "" {
		return nil
	}
	collabPath := trimEndingSeparator(fullPath(o.CollabDirectory))
	storagePath := trimEndingSeparator(fullPath(o.StorageDirectory))
	// Lexical only, like C#: symlinks can still alias the two.
	if collabPath == storagePath || strings.HasPrefix(collabPath, storagePath+string(filepath.Separator)) {
		return fail("--collab-dir must not resolve inside --storage-dir (%s is under %s): uploaded files are served publicly and the collaboration working set would be downloadable by anyone",
			quote(o.CollabDirectory), quote(o.StorageDirectory))
	}
	return nil
}

// fullPath is Path.GetFullPath: absolute and lexically cleaned, keeping a
// trailing separator.
func fullPath(path string) string {
	trailing := strings.HasSuffix(path, string(filepath.Separator))
	if !filepath.IsAbs(path) {
		wd, _ := os.Getwd()
		path = filepath.Join(wd, path)
	}
	path = filepath.Clean(path)
	if trailing && path != string(filepath.Separator) {
		path += string(filepath.Separator)
	}
	return path
}

func trimEndingSeparator(path string) string {
	if len(path) > 1 && strings.HasSuffix(path, string(filepath.Separator)) {
		return path[:len(path)-1]
	}
	return path
}

func checkRichTextFields(fields map[string][]string) error {
	check := func(name, what string) error {
		if name == "" || strings.Contains(name, "\x00") {
			return fmt.Errorf("rich text fields: a %s name is empty or holds a NUL.", what)
		}
		return nil
	}
	types := make([]string, 0, len(fields))
	for t := range fields {
		types = append(types, t)
	}
	sort.Strings(types)
	for _, t := range types {
		if err := check(t, "block type"); err != nil {
			return err
		}
		for _, field := range fields[t] {
			if err := check(field, "field of "+quote(t)); err != nil {
				return err
			}
		}
	}
	return nil
}

func (o *Options) localPublicPath() (string, error) {
	if strings.ContainsAny(o.PublicURL, "?#") {
		return "", fmt.Errorf("PublicUrl must not contain a query or fragment (got %s)", quote(o.PublicURL))
	}
	malformed := fmt.Errorf("PublicUrl must be an HTTP(S) URL or a root-relative path (got %s)", quote(o.PublicURL))
	if o.PublicURL == "" || hasMalformedPercentEscape(o.PublicURL) {
		return "", malformed
	}
	if absolute := parseHTTPURL(o.PublicURL); absolute != nil {
		return strings.TrimRight(absolute.AbsolutePath, "/"), nil
	}
	if !strings.HasPrefix(o.PublicURL, "/") || strings.HasPrefix(o.PublicURL, "//") || strings.Contains(o.PublicURL, `\`) {
		return "", malformed
	}
	if o.PublicURL == "/" {
		return "/", nil
	}
	return strings.TrimRight(o.PublicURL, "/"), nil
}

func parseHTTPURL(value string) *dotnet.URI {
	parsed, ok := dotnet.ParseAbsoluteURI(value)
	if !ok || !parsed.IsHTTP() || parsed.Host == "" || parsed.UserInfo != "" {
		return nil
	}
	return parsed
}

func hasMalformedPercentEscape(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] != '%' {
			continue
		}
		if i+2 >= len(value) || !isHexDigit(value[i+1]) || !isHexDigit(value[i+2]) {
			return true
		}
		i += 2
	}
	return false
}

func isHexDigit(c byte) bool {
	return '0' <= c && c <= '9' || 'a' <= c && c <= 'f' || 'A' <= c && c <= 'F'
}

func validateListen(listen string) error {
	missingPort := fmt.Errorf("listen tcp: address %s: missing port in address", listen)
	var port string
	if strings.HasPrefix(listen, "[") {
		bracket := strings.IndexByte(listen, ']')
		if bracket < 0 || bracket+1 >= len(listen) || listen[bracket+1] != ':' {
			return missingPort
		}
		port = listen[bracket+2:]
	} else {
		first, last := strings.IndexByte(listen, ':'), strings.LastIndexByte(listen, ':')
		if last < 0 {
			return missingPort
		}
		if first != last {
			return fmt.Errorf("listen tcp: address %s: too many colons in address", listen)
		}
		port = listen[last+1:]
	}
	if port == "" {
		return missingPort
	}
	if !isPort(port) {
		return fmt.Errorf("listen tcp: address %s: invalid port", port)
	}
	host := listenHost(listen)
	if host != "" && host != "*" && host != "+" && !strings.EqualFold(host, "localhost") {
		if _, ok := dotnet.ParseIP(host); !ok {
			return fmt.Errorf("listen tcp: DNS host %s would bind every network interface; use an IP address, localhost, or an explicit wildcard", quote(host))
		}
	}
	return nil
}

// isPort is uint.TryParse with NumberStyles.None and a 65535 ceiling.
func isPort(port string) bool {
	var value uint64
	for i := 0; i < len(port); i++ {
		if port[i] < '0' || port[i] > '9' {
			return false
		}
		value = value*10 + uint64(port[i]-'0')
		if value > 65535 {
			return false
		}
	}
	return true
}

func isLoopbackListen(listen string) bool {
	host := listenHost(listen)
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address, ok := dotnet.ParseIP(host)
	return ok && (dotnet.IsLoopback(address) || address.Is4In6() && dotnet.IsLoopback(address.Unmap()))
}

func bindScope(listen string) string {
	host := listenHost(listen)
	if host == "" {
		return " (an address with no host binds every network interface)"
	}
	if address, ok := dotnet.ParseIP(host); ok && dotnet.IsAny(address) {
		return " (which binds every network interface)"
	}
	return ""
}

func listenHost(listen string) string {
	if strings.HasPrefix(listen, "[") {
		if bracket := strings.IndexByte(listen, ']'); bracket >= 0 {
			return listen[1:bracket]
		}
	}
	first, last := strings.IndexByte(listen, ':'), strings.LastIndexByte(listen, ':')
	if first >= 0 && first == last {
		return listen[:first]
	}
	return strings.ToLower(strings.Trim(listen, "[]"))
}

func utf16Length(s string) int { return len(jsjson.FromString(s)) }

// quote is C#'s "\"{value}\"": no escaping inside.
func quote(s string) string { return `"` + s + `"` }

// formatTimeSpan is TimeSpan.ToString() for a negative span: [-][d.]hh:mm:ss[.fffffff].
func formatTimeSpan(d time.Duration) string {
	sign := ""
	if d < 0 {
		sign, d = "-", -d
	}
	ticks := int64(d / 100)
	days := ticks / (864_000_000_000)
	rest := ticks % 864_000_000_000
	text := sign
	if days > 0 {
		text += fmt.Sprintf("%d.", days)
	}
	text += fmt.Sprintf("%02d:%02d:%02d", rest/36_000_000_000, rest/600_000_000%60, rest/10_000_000%60)
	if fraction := rest % 10_000_000; fraction != 0 {
		text += fmt.Sprintf(".%07d", fraction)
	}
	return text
}

