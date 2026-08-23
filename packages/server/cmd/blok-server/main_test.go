package main

import (
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/config"
)

func noEnv(string) string { return "" }

func parse(t *testing.T, args []string, getenv func(string) string) serverConfig {
	t.Helper()

	cfg, err := parseArgs(args, getenv)
	if err != nil {
		t.Fatalf("parseArgs(%v): %v", args, err)
	}

	return cfg
}

func TestDefaults(t *testing.T) {
	cfg := parse(t, nil, noEnv)

	// The editor's own file tool refuses anything over 30 MiB by default
	// (src/tools/file/constants.ts), and multipart framing puts the request
	// body a little over the file. A cap below this refuses files the editor
	// itself would have sent.
	if cfg.MaxUploadBytes != 32<<20 {
		t.Fatalf("MaxUploadBytes = %d, want %d", cfg.MaxUploadBytes, 32<<20)
	}
	if cfg.PublicURL != "http://127.0.0.1:4000/files" {
		t.Fatalf("PublicURL = %q, want it derived from --listen", cfg.PublicURL)
	}
	if cfg.RateLimitPerMinute != 0 {
		t.Fatalf("RateLimitPerMinute = %d, want 0 on a loopback bind", cfg.RateLimitPerMinute)
	}
	if cfg.Auth != config.AuthNone || cfg.Listen != "127.0.0.1:4000" {
		t.Fatalf("cfg = %+v, want the loopback development defaults", cfg)
	}
}

func TestThePublicURLFollowsTheListenAddress(t *testing.T) {
	for _, tc := range []struct{ listen, want string }{
		{"127.0.0.1:4000", "http://127.0.0.1:4000/files"},
		{"localhost:8080", "http://localhost:8080/files"},
		// An unspecified bind names no reachable host, so the default falls
		// back to loopback rather than handing out "http://0.0.0.0/...".
		{"0.0.0.0:8080", "http://127.0.0.1:8080/files"},
		{":8080", "http://127.0.0.1:8080/files"},
	} {
		cfg := parse(t, []string{"--listen", tc.listen, "--auth", "ticket"}, noEnv)
		if cfg.PublicURL != tc.want {
			t.Fatalf("--listen %s: PublicURL = %q, want %q", tc.listen, cfg.PublicURL, tc.want)
		}
	}

	cfg := parse(t, []string{"--public-url", "https://cdn.example.com/blok/"}, noEnv)
	if cfg.PublicURL != "https://cdn.example.com/blok/" {
		t.Fatalf("PublicURL = %q, want the flag verbatim", cfg.PublicURL)
	}
}

func TestTheSecretCanComeFromTheEnvironment(t *testing.T) {
	env := func(name string) string {
		if name == "BLOK_SECRET" {
			return testSecret
		}

		return ""
	}

	cfg := parse(t, nil, env)
	if cfg.Secret != testSecret {
		t.Fatalf("Secret = %q, want the value of BLOK_SECRET", cfg.Secret)
	}
	if cfg.secretFromFlag {
		t.Fatal("secretFromFlag is set for an environment secret")
	}

	// A secret on the command line is visible in `ps`, so it is the fallback,
	// not the recommendation — but an operator who passes it explicitly means it.
	cfg = parse(t, []string{"--secret", "flag-secret-at-least-32-chars-long!!"}, env)
	if cfg.Secret != "flag-secret-at-least-32-chars-long!!" {
		t.Fatalf("Secret = %q, want the flag to win over the environment", cfg.Secret)
	}
	if !cfg.secretFromFlag {
		t.Fatal("secretFromFlag is not set for a flag secret")
	}
}

func TestS3CredentialsComeOnlyFromTheEnvironment(t *testing.T) {
	env := map[string]string{"BLOK_S3_ACCESS_KEY": "AKIAEXAMPLE", "BLOK_S3_SECRET_KEY": "s3cret"}
	cfg := parse(t, []string{"--s3-bucket", "blok", "--s3-region", "eu-central-1"}, func(n string) string { return env[n] })

	if cfg.S3.AccessKey != "AKIAEXAMPLE" || cfg.S3.SecretKey != "s3cret" {
		t.Fatalf("S3 credentials = %+v, want them read from the environment", cfg.S3)
	}
	if cfg.S3.Bucket != "blok" || cfg.S3.Region != "eu-central-1" {
		t.Fatalf("S3 = %+v, want the flags", cfg.S3)
	}

	// Nothing may name a credential flag: a flag lands in this machine's
	// process list.
	var flags strings.Builder
	fs, _ := newFlagSet(&serverConfig{})
	fs.SetOutput(&flags)
	fs.PrintDefaults()

	for _, forbidden := range []string{"s3-access-key", "s3-secret-key"} {
		if strings.Contains(flags.String(), forbidden) {
			t.Fatalf("--%s exists: credentials must never be flags", forbidden)
		}
	}
}

func TestTheRateLimitDefaultsPerAccessMode(t *testing.T) {
	for name, tc := range map[string]struct {
		flag int
		auth config.AuthMode
		want int
	}{
		"public service":     {rateLimitAuto, config.AuthTicket, defaultTicketRateLimit},
		"loopback":           {rateLimitAuto, config.AuthNone, 0},
		"behind a proxy":     {rateLimitAuto, config.AuthProxy, 0},
		"explicit wins":      {5, config.AuthTicket, 5},
		"explicitly off":     {0, config.AuthTicket, 0},
		"explicit loopback":  {5, config.AuthNone, 5},
		"auto is not stored": {rateLimitAuto, config.AuthTicket, defaultTicketRateLimit},
	} {
		t.Run(name, func(t *testing.T) {
			if got := resolveRateLimit(tc.flag, tc.auth); got != tc.want {
				t.Fatalf("resolveRateLimit(%d, %q) = %d, want %d", tc.flag, tc.auth, got, tc.want)
			}
		})
	}

	cfg := parse(t, []string{"--auth", "ticket", "--secret", testSecret, "--allow-origin", "https://app.example.com"}, noEnv)
	if cfg.RateLimitPerMinute != defaultTicketRateLimit {
		t.Fatalf("RateLimitPerMinute = %d, want %d for a public service", cfg.RateLimitPerMinute, defaultTicketRateLimit)
	}
}

func TestOriginsAreSplitAndBlanksDropped(t *testing.T) {
	cfg := parse(t, []string{"--allow-origin", "https://a.example.com, https://b.example.com,"}, noEnv)

	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://a.example.com" || cfg.AllowedOrigins[1] != "https://b.example.com" {
		t.Fatalf("AllowedOrigins = %q, want two trimmed entries", cfg.AllowedOrigins)
	}
}

// A default http.Server has no timeouts at all, so a handful of slow
// connections hold it open indefinitely.
func TestTheListenerHasEveryTimeoutSet(t *testing.T) {
	srv := newHTTPServer(parse(t, nil, noEnv), nil)

	if srv.ReadHeaderTimeout <= 0 {
		t.Fatal("ReadHeaderTimeout is unset: a slowloris client holds a connection forever")
	}
	if srv.ReadTimeout <= 0 || srv.WriteTimeout <= 0 || srv.IdleTimeout <= 0 {
		t.Fatalf("timeouts = read %v write %v idle %v, want all set", srv.ReadTimeout, srv.WriteTimeout, srv.IdleTimeout)
	}
	// /upload-by-url fetches through the media guard and then writes to the
	// store, and the S3 driver bounds one request at 5 minutes of its own. A
	// write timeout under the sum cuts the response off mid-flight.
	if want := mediaFetchTimeout + 5*time.Minute; srv.WriteTimeout < want {
		t.Fatalf("WriteTimeout = %v, want at least %v", srv.WriteTimeout, want)
	}
	// The read timeout bounds the whole request body, so it has to be long
	// enough for the largest upload the service accepts over a slow link.
	if srv.ReadTimeout < 5*time.Minute {
		t.Fatalf("ReadTimeout = %v, too short for a %d-byte upload", srv.ReadTimeout, int64(32<<20))
	}
	if srv.Addr != "127.0.0.1:4000" {
		t.Fatalf("Addr = %q, want the listen address", srv.Addr)
	}
}
