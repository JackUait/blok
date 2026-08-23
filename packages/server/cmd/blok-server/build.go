package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/internal/blobstore"
	"github.com/JackUait/blok/packages/server/internal/fetchguard"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

const (
	// unfurlTimeout bounds one link preview. A person who just pasted a link is
	// waiting on it, and a preview that fails degrades to a plain link rather
	// than to an error, so waiting longer buys little.
	unfurlTimeout = 10 * time.Second

	// unfurlMaxBytes bounds one page. fetchguard REFUSES a body over the cap
	// rather than truncating it, so this is not "how much of the <head> the
	// parser needs" — it is "how large a page may be and still get a card at
	// all". Most HTML is well under 200 kB; 2 MiB covers the long tail while
	// keeping what one in-flight request can hold small.
	unfurlMaxBytes = 2 << 20

	// mediaFetchTimeout bounds a whole re-host, transfer included. Both ends
	// are servers here, so this is generous rather than tight: at the 32 MiB
	// default cap it leaves a floor of roughly 280 KB/s.
	mediaFetchTimeout = 2 * time.Minute

	// maxRedirects bounds the chain, not the checking: every hop is re-dialed
	// and re-checked by the address filter whatever this is. http → https →
	// www → canonical is an ordinary chain, so a smaller number costs real
	// previews.
	maxRedirects = 5
)

// storage is where uploads go and, when this process serves them itself, how
// they are reached.
type storage struct {
	store blobstore.BlobStore

	// prefix is the path this process serves the blobs under, taken from the
	// public URL so the two cannot drift. Empty means nothing is mounted.
	prefix string
	files  http.Handler
}

// buildServer is the whole wiring: everything main knows, turned into the
// handler it serves. It exists as a function with a signature so the wiring can
// be tested — a bare main() is what let a nil Fetcher and an unwired ticket
// mode survive.
func buildServer(cfg serverConfig, version string) (http.Handler, error) {
	// handleUpload reads a zero cap as a MISSING one and refuses every upload,
	// which is the right runtime behaviour and a terrible startup one: the
	// operator learns about it from a user whose file "is too large".
	if cfg.MaxUploadBytes <= 0 {
		return nil, fmt.Errorf("--max-upload must be a positive number of bytes (got %d): a zero cap refuses every upload", cfg.MaxUploadBytes)
	}

	st, err := newStorage(cfg)
	if err != nil {
		return nil, err
	}

	opts := httpapi.Options{
		Version:            version,
		Store:              st.store,
		MaxUploadBytes:     cfg.MaxUploadBytes,
		Auth:               cfg.Auth,
		Secret:             cfg.Secret,
		AllowedOrigins:     cfg.AllowedOrigins,
		RateLimitPerMinute: cfg.RateLimitPerMinute,
		UnfurlDisabled:     cfg.UnfurlDisabled,
	}

	// --no-unfurl is the emergency lever for a reported filter bypass, and the
	// bypass would be in the guard BOTH outbound routes share. Leaving no
	// fetcher at all is therefore what it means: /unfurl is unregistered by
	// UnfurlDisabled and /upload-by-url by the nil MediaFetcher, so no part of
	// the fetch path is reachable. Plain /upload is untouched.
	if !cfg.UnfurlDisabled {
		opts.Fetcher = fetchguard.New(fetchguard.Config{
			Timeout:      unfurlTimeout,
			MaxBytes:     unfurlMaxBytes,
			MaxRedirects: maxRedirects,
		})
		// A second INSTANCE of the same guard, never a second path. Its cap is
		// the upload cap: re-hosting a real file through the page-sized cap
		// above would refuse everything but the smallest images.
		opts.MediaFetcher = fetchguard.New(fetchguard.Config{
			Timeout:      mediaFetchTimeout,
			MaxBytes:     cfg.MaxUploadBytes,
			MaxRedirects: maxRedirects,
		})
	}

	api := httpapi.New(opts)
	if st.files == nil {
		return api, nil
	}

	mux := http.NewServeMux()
	mux.Handle("/", api)
	mux.Handle(st.prefix+"/", st.files)

	return mux, nil
}

func newStorage(cfg serverConfig) (storage, error) {
	if cfg.S3.Bucket != "" {
		// A typed nil here would satisfy the BlobStore interface and register
		// the upload routes over a store that panics on first use, so the error
		// returns before the struct is built.
		s3, err := newS3Store(cfg.S3)
		if err != nil {
			return storage{}, err
		}

		return storage{store: s3}, nil
	}

	// No destination at all. The upload routes stay unregistered, which is what
	// "this deployment does not do uploads" looks like — a preview-only service
	// is a real configuration.
	if cfg.StorageDir == "" {
		return storage{}, nil
	}

	prefix, err := servePrefix(cfg.PublicURL)
	if err != nil {
		return storage{}, err
	}

	local := blobstore.NewLocalDir(cfg.StorageDir, cfg.PublicURL)
	if prefix == "" {
		log.Printf("--public-url %q has no path, so %s is not served by this process; put a web server in front of it", cfg.PublicURL, cfg.StorageDir)

		return storage{store: local}, nil
	}

	return storage{store: local, prefix: prefix, files: newFileHandler(cfg.StorageDir, prefix)}, nil
}

func newS3Store(s s3Settings) (*blobstore.S3, error) {
	if err := checkS3Endpoint(s.Endpoint); err != nil {
		return nil, err
	}
	// blobstore.resolveTarget validates the endpoint, the bucket and the
	// addressing style, but deliberately never looks at Region — an empty one
	// signs a syntactically valid, garbage credential scope, so without this
	// check the mistake surfaces as a signature error on the first upload
	// rather than as a refusal to start.
	if s.Region == "" {
		return nil, errors.New("--s3-bucket needs --s3-region: an empty region is signed into every request and fails only at the first upload")
	}
	// Put builds a stored URL from this prefix and Delete recognises no other,
	// so an empty one hands out URLs that no delete will ever match.
	if s.PublicURL == "" {
		return nil, errors.New("--s3-bucket needs --s3-bucket-url: it is the prefix stored URLs are built from, and the only prefix a delete is recognised under")
	}
	if s.AccessKey == "" || s.SecretKey == "" {
		return nil, errors.New("--s3-bucket needs credentials in the BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY environment variables (they are deliberately not flags: a flag lands in this machine's process list)")
	}
	switch s.Addressing {
	case blobstore.AddressingAuto, blobstore.AddressingPath, blobstore.AddressingVirtual:
	default:
		return nil, fmt.Errorf("--s3-addressing must be %q or %q, or empty to choose automatically (got %q)", blobstore.AddressingPath, blobstore.AddressingVirtual, s.Addressing)
	}

	return blobstore.NewS3(blobstore.S3Config{
		Endpoint:        s.Endpoint,
		Region:          s.Region,
		Bucket:          s.Bucket,
		AccessKey:       s.AccessKey,
		SecretKey:       s.SecretKey,
		PublicURL:       s.PublicURL,
		AddressingStyle: s.Addressing,
	}), nil
}

// checkS3Endpoint refuses at startup what resolveTarget would otherwise refuse
// at the first request. A bare hostname is the common shape of the mistake:
// url.Parse reads "s3.amazonaws.com" as a PATH, leaving no host at all.
func checkS3Endpoint(endpoint string) error {
	if endpoint == "" {
		return errors.New("--s3-bucket needs --s3-endpoint, e.g. https://s3.eu-central-1.amazonaws.com")
	}

	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("--s3-endpoint must be a full URL with a scheme and a host (got %q)", endpoint)
	}

	return nil
}

// servePrefix is the path this process serves the storage directory under. It
// comes from --public-url rather than being fixed, so the URL Put hands out and
// the path this answers on cannot drift apart.
func servePrefix(publicURL string) (string, error) {
	parsed, err := url.Parse(publicURL)
	if err != nil {
		return "", fmt.Errorf("--public-url %q: %w", publicURL, err)
	}

	// Mounting at "/" would shadow every API route, so a public URL with no
	// path means the operator has something else in front serving the files.
	return strings.TrimRight(parsed.Path, "/"), nil
}

// newFileHandler serves the storage directory, and is deliberately not a bare
// http.FileServer.
//
// Content-Disposition: attachment is what stops an uploaded .html rendering as
// a page on this service's own origin — a top-level navigation downloads it
// instead — while <img>, <video> and <audio> subresources still load, so media
// keeps working. X-Content-Type-Options: nosniff stops the same file being
// sniffed into text/html when its stored extension maps to nothing. Both are
// required by internal/blobstore/localdir.go's doc comment. The complete fix is
// serving this directory from a different origin, which is a deployment
// decision this process cannot make for the operator.
//
// The prefix is NOT behind the request guard: an <img> carries neither a pass
// nor an Origin, so guarding it would 401 every image in ticket mode. What
// limits access is that blobstore names every blob with 16 random bytes — which
// is why a directory listing, which would hand all of them out at once, is
// refused here.
func newFileHandler(dir, prefix string) http.Handler {
	files := http.FileServer(http.Dir(dir))

	return http.StripPrefix(prefix, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set before anything writes, so FileServer's own responses carry them.
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", "attachment")

		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)

			return
		}

		files.ServeHTTP(w, r)
	}))
}
