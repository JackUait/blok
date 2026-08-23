package blobstore

import (
	"strings"
	"testing"
)

// Addressing style cannot be exercised end-to-end: a virtual-hosted request
// dials "bucket.<endpoint>", which no test server can be reached at. The
// mapping itself is what has to be right, so it is checked directly.
func TestResolveTargetPicksTheAddressingStyle(t *testing.T) {
	cases := []struct {
		name     string
		cfg      S3Config
		wantURL  string
		wantHost string
	}{
		{
			name:     "a self-hosted endpoint gets path style",
			cfg:      S3Config{Endpoint: "http://127.0.0.1:9000", Bucket: "media"},
			wantURL:  "http://127.0.0.1:9000/media/key.png",
			wantHost: "127.0.0.1:9000",
		},
		{
			name:     "a named MinIO endpoint gets path style",
			cfg:      S3Config{Endpoint: "https://minio.internal:9000", Bucket: "media"},
			wantURL:  "https://minio.internal:9000/media/key.png",
			wantHost: "minio.internal:9000",
		},
		{
			name:     "an R2 endpoint gets path style",
			cfg:      S3Config{Endpoint: "https://abc123.r2.cloudflarestorage.com", Bucket: "media"},
			wantURL:  "https://abc123.r2.cloudflarestorage.com/media/key.png",
			wantHost: "abc123.r2.cloudflarestorage.com",
		},
		{
			name:     "AWS gets virtual-hosted style",
			cfg:      S3Config{Endpoint: "https://s3.eu-central-1.amazonaws.com", Bucket: "media"},
			wantURL:  "https://media.s3.eu-central-1.amazonaws.com/key.png",
			wantHost: "media.s3.eu-central-1.amazonaws.com",
		},
		{
			name:     "a bucket with a dot stays path style even on AWS",
			cfg:      S3Config{Endpoint: "https://s3.eu-central-1.amazonaws.com", Bucket: "my.media"},
			wantURL:  "https://s3.eu-central-1.amazonaws.com/my.media/key.png",
			wantHost: "s3.eu-central-1.amazonaws.com",
		},
		{
			name:     "an uppercase bucket stays path style even on AWS",
			cfg:      S3Config{Endpoint: "https://s3.amazonaws.com", Bucket: "Media"},
			wantURL:  "https://s3.amazonaws.com/Media/key.png",
			wantHost: "s3.amazonaws.com",
		},
		{
			name:     "path style can be forced on AWS",
			cfg:      S3Config{Endpoint: "https://s3.amazonaws.com", Bucket: "media", AddressingStyle: AddressingPath},
			wantURL:  "https://s3.amazonaws.com/media/key.png",
			wantHost: "s3.amazonaws.com",
		},
		{
			name:     "virtual-hosted style can be forced elsewhere",
			cfg:      S3Config{Endpoint: "https://minio.internal:9000", Bucket: "media", AddressingStyle: AddressingVirtual},
			wantURL:  "https://media.minio.internal:9000/key.png",
			wantHost: "media.minio.internal:9000",
		},
		{
			name:     "an explicit default port is dropped from the signed host",
			cfg:      S3Config{Endpoint: "https://s3.example.com:443", Bucket: "media"},
			wantURL:  "https://s3.example.com/media/key.png",
			wantHost: "s3.example.com",
		},
		{
			name:     "a query string on the endpoint is discarded",
			cfg:      S3Config{Endpoint: "https://s3.example.com/?debug=1", Bucket: "media"},
			wantURL:  "https://s3.example.com/media/key.png",
			wantHost: "s3.example.com",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveTarget(tc.cfg, "key.png")
			if err != nil {
				t.Fatalf("resolveTarget: %v", err)
			}
			if got.url.String() != tc.wantURL {
				t.Fatalf("url = %q, want %q", got.url.String(), tc.wantURL)
			}
			if got.host != tc.wantHost {
				t.Fatalf("host = %q, want %q", got.host, tc.wantHost)
			}
		})
	}
}

func TestResolveTargetRefusesAnUnusableEndpoint(t *testing.T) {
	cases := map[string]S3Config{
		"no endpoint":           {Bucket: "media"},
		"no host":               {Endpoint: "/just/a/path", Bucket: "media"},
		"no bucket":             {Endpoint: "https://s3.example.com"},
		"unparseable":           {Endpoint: "https://s3.example.com/%zz", Bucket: "media"},
		"a bucket with a slash": {Endpoint: "https://s3.example.com", Bucket: "media/../secrets"},
		// net/http punycodes the Host header it writes, so a non-ASCII host
		// would be signed as one string and sent as another.
		"a non-ascii host": {Endpoint: "https://ünïcode.example.com", Bucket: "media"},
		"an unknown style": {Endpoint: "https://s3.example.com", Bucket: "media", AddressingStyle: "dns"},
		// The bucket and key take the whole path, so a prefix here would be
		// dropped and every request would go somewhere else.
		"an endpoint with a path prefix": {Endpoint: "https://gateway.example.com/s3", Bucket: "media"},
	}

	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := resolveTarget(cfg, "key.png"); err == nil {
				t.Fatal("err = nil, want a refusal")
			}
		})
	}
}

func TestStoredNameRoundTripsThroughThePublicURL(t *testing.T) {
	stored, err := newStoredName("photo.PNG")
	if err != nil {
		t.Fatalf("newStoredName: %v", err)
	}
	if !strings.HasSuffix(stored, ".png") || len(stored) != 32+4 {
		t.Fatalf("stored = %q", stored)
	}

	key, err := keyFromPublicURL("https://cdn.example.com/files/", "https://cdn.example.com/files/"+stored)
	if err != nil {
		t.Fatalf("keyFromPublicURL: %v", err)
	}
	if key != stored {
		t.Fatalf("key = %q, want %q", key, stored)
	}
}
