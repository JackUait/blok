package blokserver

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// Captured from BlokServerOptions.Validate by OptionsValidateFixtureTests.
const optionsFixture = "../../../../test/unit/server-conformance/fixtures/options-validate.json"

type optionsCase struct {
	Name            string                     `json:"name"`
	Options         map[string]json.RawMessage `json:"options"`
	Error           string                     `json:"error"`
	LocalPublicPath string                     `json:"localPublicPath"`
}

// fromCSharp applies options named as the C# properties.
func fromCSharp(t *testing.T, spec map[string]json.RawMessage) Options {
	t.Helper()
	o := DefaultOptions()
	read := func(raw json.RawMessage, into any) {
		if err := json.Unmarshal(raw, into); err != nil {
			t.Fatal(err)
		}
	}
	for name, raw := range spec {
		switch name {
		case "ListenAddress":
			read(raw, &o.ListenAddress)
		case "Auth":
			read(raw, &o.Auth)
		case "Secret":
			read(raw, &o.Secret)
		case "AllowedOrigins":
			read(raw, &o.AllowedOrigins)
		case "StorageDirectory":
			read(raw, &o.StorageDirectory)
		case "PublicUrl":
			read(raw, &o.PublicURL)
		case "MaxUploadBytes":
			read(raw, &o.MaxUploadBytes)
		case "RateLimitPerMinute":
			read(raw, &o.RateLimitPerMinute)
		case "UnfurlDisabled":
			var disabled bool
			read(raw, &disabled)
			o.UnfurlEnabled = !disabled
		case "S3Endpoint":
			read(raw, &o.S3Endpoint)
		case "S3Region":
			read(raw, &o.S3Region)
		case "S3Bucket":
			read(raw, &o.S3Bucket)
		case "S3BucketUrl":
			read(raw, &o.S3BucketURL)
		case "S3Addressing":
			read(raw, &o.S3Addressing)
		case "S3AccessKey":
			read(raw, &o.S3AccessKey)
		case "S3SecretKey":
			read(raw, &o.S3SecretKey)
		case "CollabEnabled":
			read(raw, &o.CollabEnabled)
		case "DocEndpoint":
			read(raw, &o.DocEndpoint)
		case "DocEndpointAuth":
			read(raw, &o.DocEndpointAuth)
		case "CollabDirectory":
			read(raw, &o.CollabDirectory)
		case "CollabS3Prefix":
			read(raw, &o.CollabS3Prefix)
		case "CollabJournal":
			read(raw, &o.CollabJournal)
		case "CollabMaxConnectionsPerUserPerDoc":
			read(raw, &o.CollabMaxConnectionsPerUserPerDoc)
		case "CollabMaxConnections":
			read(raw, &o.CollabMaxConnections)
		case "CollabMaxMessageBytes":
			read(raw, &o.CollabMaxMessageBytes)
		case "CollabKeepAliveIntervalMs":
			var ms int64
			read(raw, &ms)
			o.CollabKeepAliveInterval = time.Duration(ms) * time.Millisecond
		case "CollabInboundFramesPerSecond":
			read(raw, &o.CollabInboundFramesPerSecond)
		case "CollabInboundBurstFrames":
			read(raw, &o.CollabInboundBurstFrames)
		case "CollabInboundResyncsPerMinute":
			read(raw, &o.CollabInboundResyncsPerMinute)
		case "CollabInboundAwarenessBytesPerSecond":
			read(raw, &o.CollabInboundAwarenessBytesPerSecond)
		case "RichTextFields":
			read(raw, &o.RichTextFields)
		default:
			t.Fatalf("no Go mapping for option %s", name)
		}
	}
	return o
}

func TestValidateMatchesTheCSharpFixture(t *testing.T) {
	data, err := os.ReadFile(optionsFixture)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Cases []optionsCase }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Cases {
		o := fromCSharp(t, c.Options)
		path, err := o.validate()
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.Error || path != c.LocalPublicPath {
			t.Errorf("%s:\n got %q %q\nwant %q %q", c.Name, got, path, c.Error, c.LocalPublicPath)
		}
	}
}

// C# UnfurlDisabled defaults to true; the Go field is inverted so the zero
// value is the same closed state.
func TestZeroOptionsKeepOutboundRoutesClosed(t *testing.T) {
	if (Options{}).UnfurlEnabled || DefaultOptions().UnfurlEnabled {
		t.Fatal("outbound routes open by default")
	}
}

func TestFormatTimeSpanMatchesDotnet(t *testing.T) {
	if got := formatTimeSpan(-1500 * time.Millisecond); got != "-00:00:01.5000000" {
		t.Fatal(got)
	}
	if !strings.HasPrefix(formatTimeSpan(-26*time.Hour), "-1.02:00:00") {
		t.Fatal(formatTimeSpan(-26 * time.Hour))
	}
}
