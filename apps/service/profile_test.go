package cloud

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestAccountProfile(t *testing.T) {
	w := newReadsWorld(t)
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	photo := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	path := "/api/profile"
	w.send(t, "PATCH", "", path, map[string]any{"name": "Nobody"}, 401)
	got := w.send(t, "PATCH", tokenAlice, path, map[string]any{"name": "  Camille  ", "avatarUrl": photo}, 200)
	if got["id"] != "alice" || got["name"] != "Camille" || got["email"] != "alice@example.test" || got["avatarUrl"] != photo {
		t.Fatal(got)
	}
	session := w.send(t, "GET", tokenAlice, "/api/session", nil, 200)["user"].(map[string]any)
	if session["name"] != "Camille" || session["avatarUrl"] != photo {
		t.Fatal(session)
	}
	other := w.send(t, "GET", tokenBob, "/api/session", nil, 200)["user"].(map[string]any)
	if other["name"] == "Camille" || other["avatarUrl"] != nil {
		t.Fatal("profile leaked into another account", other)
	}
	for _, payload := range []map[string]any{
		{"name": strings.Repeat("a", 81)}, {"name": nil}, {"name": 4},
		{"avatarUrl": "https://external.test/photo.png"}, {"avatarUrl": "data:image/svg+xml;base64,PHN2Zy8+"},
		{"avatarUrl": "data:image/png;base64,ZmFrZQ=="}, {"id": "bob", "name": "Hacked"},
	} {
		w.send(t, "PATCH", tokenAlice, path, payload, 400)
	}
	w.send(t, "PATCH", tokenAlice, path, map[string]any{"avatarUrl": nil}, 200)
	session = w.send(t, "GET", tokenAlice, "/api/session", nil, 200)["user"].(map[string]any)
	if session["avatarUrl"] != nil || session["name"] != "Camille" {
		t.Fatal(session)
	}
	cfg := w.service.Config
	cfg.DataDirectory = t.TempDir()
	restarted, err := New(w.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	var name string
	if err = restarted.DB.QueryRow(w.ctx, "SELECT name FROM users WHERE id='alice'").Scan(&name); err != nil || name != "Camille" {
		t.Fatalf("restart %s %v", name, err)
	}
}
