package main

import (
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// The flag number grammar is strconv.ParseInt(s, 0, 64), which the C# host
// writes out in TryParseBaseZeroInt64. The cases are HostProcessTests'
// AcceptsTheFrozenBaseZeroIntegerGrammar, RefusesInvalidOrOverflowingBase
// ZeroIntegers, KeepsParseAndValidationExitCodesDistinctForSignedValues,
// AcceptsASigned64BitRateLimit, TreatsALeadingZero{Maximum,RateLimit}AsOctal
// and RejectsEveryExplicitNegativeRateLimit.

func TestFlagNumbersAcceptTheBaseZeroGrammar(t *testing.T) {
	for _, value := range []string{"16", "+16", "020", "0o20", "0x10", "0b10000", "1_6"} {
		parsed := parseHostArguments([]string{"--max-upload", value, "--rate-limit", value}, noEnv)
		if parsed.err != "" || *parsed.options.MaxUploadBytes != 16 || parsed.options.RateLimitPerMinute != 16 {
			t.Errorf("%q: %q, max-upload %d, rate-limit %d",
				value, parsed.err, parsed.options.MaxUploadBytes, parsed.options.RateLimitPerMinute)
		}
	}
}

func TestALeadingZeroIsOctal(t *testing.T) {
	parsed := parseHostArguments([]string{"--max-upload", "040000000", "--rate-limit", "010"}, noEnv)
	if parsed.err != "" || *parsed.options.MaxUploadBytes != 8<<20 || parsed.options.RateLimitPerMinute != 8 {
		t.Fatalf("%q, max-upload %d, rate-limit %d", parsed.err, parsed.options.MaxUploadBytes, parsed.options.RateLimitPerMinute)
	}
}

func TestARateLimitTakesSigned64Bits(t *testing.T) {
	parsed := parseHostArguments([]string{"--rate-limit", "0x80000000"}, noEnv)
	if parsed.err != "" || parsed.options.RateLimitPerMinute != 1<<31 {
		t.Fatalf("%q, rate-limit %d", parsed.err, parsed.options.RateLimitPerMinute)
	}
}

func TestInvalidOrOverflowingFlagNumbersAreParseErrors(t *testing.T) {
	for _, c := range [][2]string{
		{"--max-upload", "08"},
		{"--max-upload", "1__0"},
		{"--max-upload", "0x8000000000000000"},
		{"--rate-limit", "0x8000000000000000"},
	} {
		var stderr strings.Builder
		code := run(t.Context(), []string{"--listen", "0.0.0.0:0", "--storage-dir", "", c[0], c[1]}, noEnv, &stderr)
		want := `invalid value "` + c[1] + `" for flag -` + c[0][2:]
		if code != 2 || !strings.Contains(stderr.String(), want) {
			t.Errorf("%s %s: exit %d, %q", c[0], c[1], code, stderr.String())
		}
	}
}

// A signed value parses; the refusal is validation's, with exit 1.
func TestASignedMaximumIsAValidationRefusal(t *testing.T) {
	var stderr strings.Builder
	code := run(t.Context(), []string{"--listen", "127.0.0.1:0", "--storage-dir", "", "--max-upload", "-0x1"}, noEnv, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "--max-upload must be a positive number of bytes (got -1)") {
		t.Fatalf("exit %d, %q", code, stderr.String())
	}
}

func TestEveryExplicitNegativeRateLimitIsRefused(t *testing.T) {
	for _, value := range []string{"-1", "-2", "-010", "-0x1"} {
		parsed := parseHostArguments([]string{"--rate-limit", value}, noEnv)
		if parsed.err != "" {
			t.Errorf("%q: parse error %q", value, parsed.err)
			continue
		}
		if _, err := blokserver.New(parsed.options); err == nil || !strings.Contains(err.Error(), "--rate-limit") {
			t.Errorf("%q: %v", value, err)
		}
	}
}
