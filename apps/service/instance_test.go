package cloud

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Une instance neuve (aucun membre) reçoit les défauts stricts du produit :
// invitation seule, création d'espaces réservée aux admins, setup encore ouvert.
func TestInstanceSettingsStrictDefaultsOnFreshDatabase(t *testing.T) {
	_, _, open := permissionsFixture(t)
	s := open()

	got := s.settings()
	if got.Name != "Blok" {
		t.Fatalf("name = %q, want Blok", got.Name)
	}
	if got.SignupPolicy != "invite" {
		t.Fatalf("signupPolicy = %q, want invite", got.SignupPolicy)
	}
	if got.WorkspaceCreation != "admins_only" {
		t.Fatalf("workspaceCreation = %q, want admins_only", got.WorkspaceCreation)
	}
	if got.SetupCompletedAt != nil {
		t.Fatalf("setupCompletedAt = %v, want nil on a fresh instance", got.SetupCompletedAt)
	}

	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	resp, e := http.Get(server.URL + "/api/instance")
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET /api/instance status %d: %s", resp.StatusCode, body)
	}
	var out map[string]any
	if e := json.NewDecoder(resp.Body).Decode(&out); e != nil {
		t.Fatal(e)
	}
	if out["setupRequired"] != true {
		t.Fatalf("setupRequired = %v, want true", out["setupRequired"])
	}
	if out["signupPolicy"] != "invite" {
		t.Fatalf("signupPolicy = %v, want invite", out["signupPolicy"])
	}
	if out["workspaceCreation"] != "admins_only" {
		t.Fatalf("workspaceCreation = %v, want admins_only", out["workspaceCreation"])
	}
	if out["name"] != "Blok" {
		t.Fatalf("name = %v, want Blok", out["name"])
	}
	// Fresh instance with no BOOTSTRAP_WORKSPACE_* has zero spaces (§5.3 / §14.3).
	if out["defaultWorkspace"] != nil {
		t.Fatalf("defaultWorkspace = %v, want null", out["defaultWorkspace"])
	}
}

// settings() lit le cache atomique : après chargement initial, fermer le pool
// ne doit pas empêcher une lecture.
func TestInstanceSettingsCacheDoesNotHitPostgres(t *testing.T) {
	_, _, open := permissionsFixture(t)
	s := open()
	before := s.settings()
	s.DB.Close()
	after := s.settings()
	if after.SignupPolicy != before.SignupPolicy || after.Name != before.Name {
		t.Fatalf("settings() after DB.Close drifted: %+v → %+v", before, after)
	}
}

// L'écrivain stocke le RETURNING dans le même chemin : l'effet est immédiat,
// pas dans dix secondes au prochain tick.
func TestInstanceSettingsWriterSeesOwnWrite(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	updated, e := s.applySettings(ctx, SettingsPatch{SignupPolicy: strPtr("open")})
	if e != nil {
		t.Fatal(e)
	}
	if updated.SignupPolicy != "open" {
		t.Fatalf("applySettings returned %q, want open", updated.SignupPolicy)
	}
	if s.settings().SignupPolicy != "open" {
		t.Fatalf("settings() still %q after write", s.settings().SignupPolicy)
	}
}

// Le rattrapage de migration 5 est gardé par NOT EXISTS(version=5) : un
// redémarrage ne doit pas écraser le choix de l'administrateur.
func TestInstanceSettingsSurviveRestart(t *testing.T) {
	ctx, _, open := permissionsFixture(t)
	s := open()
	if _, e := s.applySettings(ctx, SettingsPatch{SignupPolicy: strPtr("open"), Name: strPtr("Acme")}); e != nil {
		t.Fatal(e)
	}
	s.Close()

	restarted := open()
	got := restarted.settings()
	if got.SignupPolicy != "open" {
		t.Fatalf("after restart signupPolicy = %q, want open", got.SignupPolicy)
	}
	if got.Name != "Acme" {
		t.Fatalf("after restart name = %q, want Acme", got.Name)
	}
}

func strPtr(s string) *string { return &s }
