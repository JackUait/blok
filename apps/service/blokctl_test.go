package cloud

import (
	"bytes"
	"strings"
	"testing"
)

func TestBlokctlAdminGrantAndList(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	_ = migrateThenOperate(t, ctx, cfg)

	var out, errBuf bytes.Buffer
	if e := Blokctl(ctx, cfg, []string{"admin", "grant", "cli@example.test"}, &out, &errBuf); e != nil {
		t.Fatalf("grant: %v (%s)", e, errBuf.String())
	}
	if !strings.Contains(out.String(), "cli@example.test") {
		t.Fatalf("grant output missing email: %q", out.String())
	}

	out.Reset()
	errBuf.Reset()
	if e := Blokctl(ctx, cfg, []string{"admin", "list"}, &out, &errBuf); e != nil {
		t.Fatalf("list: %v (%s)", e, errBuf.String())
	}
	if !strings.Contains(out.String(), "cli@example.test") {
		t.Fatalf("list missing granted admin: %q", out.String())
	}
}

func TestBlokctlUsageOnBadArgs(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	var out, errBuf bytes.Buffer
	e := Blokctl(ctx, cfg, []string{}, &out, &errBuf)
	if e == nil {
		t.Fatal("expected usage error")
	}
	if !strings.Contains(errBuf.String(), "blokctl") {
		t.Fatalf("usage missing from stderr: %q", errBuf.String())
	}
}

func TestBlokctlSettingsShowAndSet(t *testing.T) {
	ctx, _, cfg := opsFixture(t)
	_ = migrateThenOperate(t, ctx, cfg)

	var out, errBuf bytes.Buffer
	if e := Blokctl(ctx, cfg, []string{"settings", "set", "signup-policy=open", "workspace-creation=anyone"}, &out, &errBuf); e != nil {
		t.Fatalf("settings set: %v (%s)", e, errBuf.String())
	}
	out.Reset()
	errBuf.Reset()
	if e := Blokctl(ctx, cfg, []string{"settings", "show"}, &out, &errBuf); e != nil {
		t.Fatalf("settings show: %v (%s)", e, errBuf.String())
	}
	got := out.String()
	if !strings.Contains(got, "open") || !strings.Contains(got, "anyone") {
		t.Fatalf("settings show = %q", got)
	}
}
