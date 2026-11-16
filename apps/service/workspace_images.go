package cloud

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const maxWorkspaceImage = 5 << 20
const maxEmojiImage = 2 << 20

var emojiNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

type workspaceEmoji struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

// Images are decoded locally, never fetched by the server. Disallow SVG and
// arbitrary data URLs so uploaded images cannot introduce active content.
func decodeWorkspaceImage(raw string, limit int) ([]byte, string, error) {
	if len(raw) > base64.StdEncoding.EncodedLen(limit)+128 {
		return nil, "", errors.New("image too large")
	}
	header, encoded, ok := strings.Cut(raw, ",")
	if !ok || !strings.HasPrefix(header, "data:image/") || !strings.HasSuffix(header, ";base64") {
		return nil, "", errors.New("expected a base64 image")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data) > limit {
		return nil, "", errors.New("invalid or oversized image")
	}
	extensions := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
	mime := http.DetectContentType(data)
	ext, ok := extensions[mime]
	if !ok || header != "data:"+mime+";base64" {
		return nil, "", errors.New("use PNG, JPEG, GIF or WebP")
	}
	return data, ext, nil
}

func validRemoteImage(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && len(raw) <= 4096 && u.Scheme == "https" && u.Hostname() != "" && u.User == nil
}

func (s *Service) storeWorkspaceImage(ctx context.Context, ws Workspace, raw string, limit int) (string, error) {
	data, extension, err := decodeWorkspaceImage(raw, limit)
	if err != nil {
		return "", err
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		return "", err
	}
	name := hex.EncodeToString(random) + extension
	directory := filepath.Join(s.Config.DataDirectory, "uploads")
	if err = os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	filename := filepath.Join(directory, name)
	if err = os.WriteFile(filename, data, 0600); err != nil {
		return "", err
	}
	if _, err = s.DB.Exec(ctx, "INSERT INTO assets(name,workspace_id) VALUES($1,$2)", name, ws.ID); err != nil {
		os.Remove(filename)
		return "", err
	}
	return "/files/" + name, nil
}

func (s *Service) workspaceImage(w http.ResponseWriter, r *http.Request, ws Workspace, id string) {
	if r.Method != "POST" || id != "" {
		problem(w, 405, "Method not allowed")
		return
	}
	if ws.Role == "viewer" {
		problem(w, 403, "Workspace editing permission required")
		return
	}
	var in struct {
		DataURL string `json:"dataUrl"`
	}
	if !body(w, r, &in) {
		return
	}
	if _, _, err := decodeWorkspaceImage(in.DataURL, maxWorkspaceImage); err != nil {
		problem(w, 400, "Use a PNG, JPEG, GIF or WebP image up to 5 MiB")
		return
	}
	imageURL, err := s.storeWorkspaceImage(r.Context(), ws, in.DataURL, maxWorkspaceImage)
	if err != nil {
		problem(w, 500, "Could not save image")
		return
	}
	jsonOut(w, 201, map[string]string{"url": imageURL})
}

func (s *Service) emojis(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id string) {
	if r.Method == "GET" && id == "" {
		rows, err := s.DB.Query(r.Context(), "SELECT id,name,url,created_by,created_at FROM workspace_emojis WHERE workspace_id=$1 ORDER BY name", ws.ID)
		if err != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		defer rows.Close()
		out := []workspaceEmoji{}
		for rows.Next() {
			var emoji workspaceEmoji
			if rows.Scan(&emoji.ID, &emoji.Name, &emoji.URL, &emoji.CreatedBy, &emoji.CreatedAt) != nil {
				problem(w, 500, "Read failed")
				return
			}
			out = append(out, emoji)
		}
		if rows.Err() != nil {
			problem(w, 500, "Read failed")
			return
		}
		jsonOut(w, 200, map[string]any{"emojis": out})
		return
	}
	if ws.Role == "viewer" {
		problem(w, 403, "Workspace editing permission required")
		return
	}
	if r.Method == "PATCH" && id != "" {
		var in struct {
			Name string `json:"name"`
		}
		if !body(w, r, &in) {
			return
		}
		in.Name = strings.ToLower(strings.TrimSpace(strings.Trim(in.Name, ":")))
		if !emojiNamePattern.MatchString(in.Name) {
			problem(w, 400, "Emoji name must use 1–64 lowercase letters, digits, underscores or hyphens")
			return
		}
		var emoji workspaceEmoji
		err := s.DB.QueryRow(r.Context(), `UPDATE workspace_emojis e SET name=$3
			WHERE e.workspace_id=$1 AND e.id=$2 AND EXISTS (
			SELECT 1 FROM memberships m WHERE m.workspace_id=e.workspace_id AND m.user_id=$4
			AND (m.role='admin' OR (m.role='member' AND e.created_by=$4)))
			RETURNING e.id,e.name,e.url,e.created_by,e.created_at`, ws.ID, id, in.Name, u.ID).Scan(&emoji.ID, &emoji.Name, &emoji.URL, &emoji.CreatedBy, &emoji.CreatedAt)
		if err != nil {
			if isUniqueViolation(err) {
				problem(w, 409, "An emoji with this name already exists")
			} else if errors.Is(err, pgx.ErrNoRows) {
				problem(w, 404, "Emoji not found or rename refused")
			} else {
				problem(w, 500, "Could not rename emoji")
			}
			return
		}
		jsonOut(w, 200, emoji)
		return
	}
	if r.Method == "DELETE" && id != "" {
		tag, err := s.DB.Exec(r.Context(), "DELETE FROM workspace_emojis WHERE workspace_id=$1 AND id=$2 AND (created_by=$3 OR $4='admin')", ws.ID, id, u.ID, ws.Role)
		if err != nil {
			problem(w, 500, "Could not delete emoji")
			return
		}
		if tag.RowsAffected() == 0 {
			problem(w, 404, "Emoji not found or deletion refused")
			return
		}
		// Keep uploaded assets for pages and document history that still use them.
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.Method != "POST" || id != "" {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		Name    string `json:"name"`
		DataURL string `json:"dataUrl"`
		URL     string `json:"url"`
	}
	if !body(w, r, &in) {
		return
	}
	in.Name = strings.ToLower(strings.TrimSpace(strings.Trim(in.Name, ":")))
	if !emojiNamePattern.MatchString(in.Name) {
		problem(w, 400, "Emoji name must use 1–64 lowercase letters, digits, underscores or hyphens")
		return
	}
	if (in.DataURL == "") == (in.URL == "") {
		problem(w, 400, "Provide one image upload or HTTPS URL")
		return
	}
	if in.URL != "" {
		resolved, err := s.customEmojiImageURL(r.Context(), ws.ID, in.URL)
		if err != nil {
			problem(w, 400, err.Error())
			return
		}
		in.URL = resolved
	}
	if in.DataURL != "" {
		if _, _, err := decodeWorkspaceImage(in.DataURL, maxEmojiImage); err != nil {
			problem(w, 400, "Use a PNG, JPEG, GIF or WebP emoji up to 2 MiB")
			return
		}
		var err error
		in.URL, err = s.storeWorkspaceImage(r.Context(), ws, in.DataURL, maxEmojiImage)
		if err != nil {
			problem(w, 500, "Could not save emoji image")
			return
		}
	}
	emoji := workspaceEmoji{ID: opaque(), Name: in.Name, URL: in.URL, CreatedBy: u.ID}
	err := s.DB.QueryRow(r.Context(), "INSERT INTO workspace_emojis(id,workspace_id,name,url,created_by) VALUES($1,$2,$3,$4,$5) RETURNING created_at", emoji.ID, ws.ID, emoji.Name, emoji.URL, u.ID).Scan(&emoji.CreatedAt)
	if err != nil {
		var pgerr *pgconn.PgError
		if errors.As(err, &pgerr) && pgerr.Code == "23505" {
			problem(w, 409, "An emoji with this name already exists")
			return
		}
		problem(w, 500, "Could not create emoji")
		return
	}
	jsonOut(w, 201, emoji)
}

// Registry images are visible to the workspace. Never promote a page-bound or
// foreign workspace asset into that shared registry. Preserve a stable path,
// not a short-lived session grant, when reusing an upload.
func (s *Service) customEmojiImageURL(ctx context.Context, workspace, raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil {
		return "", errors.New("Invalid emoji image URL")
	}
	pub, _ := url.Parse(s.Config.PublicURL)
	if parsed.Host == "" || (pub != nil && parsed.Host == pub.Host) {
		name := strings.TrimPrefix(parsed.Path, "/files/")
		if !strings.HasPrefix(parsed.Path, "/files/") || name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") || (parsed.Scheme != "" && parsed.Scheme != "https" && (pub == nil || parsed.Scheme != pub.Scheme)) {
			return "", errors.New("Use a workspace /files/ image or an external HTTPS URL")
		}
		var owned bool
		err = s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE name=$1 AND workspace_id=$2 AND document_id IS NULL)`, name, workspace).Scan(&owned)
		if err != nil || !owned {
			return "", errors.New("Image must be a shared upload owned by this workspace")
		}
		return "/files/" + url.PathEscape(name), nil
	}
	if !validRemoteImage(raw) {
		return "", errors.New("Image URL must use HTTPS")
	}
	return raw, nil
}
