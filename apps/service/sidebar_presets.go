package cloud

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type sidebarPresetsPayload struct {
	Presets []sidebarPreset `json:"presets"`
}
type sidebarPreset struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Default bool             `json:"default"`
	Tab     sidebarPresetTab `json:"tab"`
}
type sidebarPresetTab struct {
	ID        string                  `json:"id"`
	Name      string                  `json:"name"`
	Icon      string                  `json:"icon"`
	Shortcuts []sidebarPresetShortcut `json:"shortcuts"`
	Sections  []sidebarPresetSection  `json:"sections"`
	PresetID  string                  `json:"presetId,omitempty"`
}
type sidebarPresetShortcut struct {
	ID      string  `json:"id"`
	Kind    string  `json:"kind"`
	PageID  *string `json:"pageId,omitempty"`
	Visible bool    `json:"visible"`
}
type sidebarPresetSection struct {
	ID      string `json:"id"`
	Visible bool   `json:"visible"`
	Limit   int    `json:"limit"`
	Sort    string `json:"sort"`
}

func validSidebarText(value string, max int) bool {
	return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max && strings.IndexFunc(value, unicode.IsControl) == -1
}

func validateSidebarPresets(in sidebarPresetsPayload) error {
	if len(in.Presets) < 1 || len(in.Presets) > 6 {
		return errors.New("Provide between 1 and 6 sidebar presets")
	}
	defaults := 0
	ids := map[string]bool{}
	tabIDs := map[string]bool{}
	for _, preset := range in.Presets {
		if !validSidebarText(preset.ID, 128) || ids[preset.ID] || !validSidebarText(preset.Name, 80) {
			return errors.New("Preset names and unique IDs are required (80 and 128 characters maximum)")
		}
		ids[preset.ID] = true
		if preset.Default {
			defaults++
		}
		tab := preset.Tab
		if !validSidebarText(tab.ID, 128) || tabIDs[tab.ID] || !validSidebarText(tab.Name, 80) || (tab.PresetID != "" && !validSidebarText(tab.PresetID, 128)) {
			return errors.New("Invalid sidebar tab name or ID")
		}
		tabIDs[tab.ID] = true
		switch tab.Icon {
		case "home", "message", "calendar", "book", "people":
		default:
			return errors.New("Invalid sidebar icon")
		}
		if tab.Shortcuts == nil || len(tab.Shortcuts) > 25 {
			return errors.New("Provide at most 25 sidebar shortcuts")
		}
		shortcutIDs := map[string]bool{}
		for _, shortcut := range tab.Shortcuts {
			if shortcut.Kind == "page" || shortcut.PageID != nil {
				return errors.New("Page shortcuts are personal and cannot be included in workspace presets")
			}
			if !validSidebarText(shortcut.ID, 128) || shortcutIDs[shortcut.ID] {
				return errors.New("Shortcut IDs must be unique and at most 128 characters")
			}
			shortcutIDs[shortcut.ID] = true
			switch shortcut.Kind {
			case "new-page", "new-note", "library", "assistant":
			default:
				return errors.New("Invalid sidebar shortcut")
			}
		}
		if len(tab.Sections) != 5 {
			return errors.New("Provide all five sidebar sections")
		}
		sectionIDs := map[string]bool{}
		for _, section := range tab.Sections {
			switch section.ID {
			case "recents", "favorites", "teamspaces", "shared", "private":
			default:
				return errors.New("Invalid sidebar section")
			}
			if sectionIDs[section.ID] {
				return errors.New("Sidebar sections must be unique")
			}
			sectionIDs[section.ID] = true
			switch section.Limit {
			case 0, 5, 10, 20, 50:
			default:
				return errors.New("Invalid sidebar section limit")
			}
			if section.Sort != "manual" && section.Sort != "updated" {
				return errors.New("Invalid sidebar section sort")
			}
		}
	}
	if defaults == 0 {
		return errors.New("Select at least one default sidebar preset")
	}
	return nil
}

func (s *Service) sidebarPresets(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, id, action string) {
	if id != "" || action != "" || (r.Method != "GET" && r.Method != "PUT") {
		problem(w, 405, "Method not allowed")
		return
	}
	if ws.Role != "admin" && ws.Role != "member" && ws.Role != "viewer" {
		problem(w, 403, "Workspace membership required")
		return
	}
	if r.Method == "GET" {
		var presets json.RawMessage
		err := s.DB.QueryRow(r.Context(), `SELECT w.sidebar_presets FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2`, ws.ID, u.ID).Scan(&presets)
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, 403, "Workspace membership required")
			return
		}
		if err != nil {
			problem(w, 503, "Could not load sidebar presets")
			return
		}
		jsonOut(w, 200, map[string]any{"presets": presets})
		return
	}
	if ws.Role != "admin" {
		problem(w, 403, "Administrator required")
		return
	}
	var in sidebarPresetsPayload
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		problem(w, 400, "Invalid sidebar presets JSON (maximum 64 KiB)")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		problem(w, 400, "Expected one JSON value")
		return
	}
	if err := validateSidebarPresets(in); err != nil {
		problem(w, 400, err.Error())
		return
	}
	encoded, err := json.Marshal(in.Presets)
	if err != nil {
		problem(w, 400, "Invalid sidebar presets")
		return
	}
	// Recheck admin membership in the write itself, including when the caller's
	// membership changed after workspace lookup. This only changes presentation.
	tag, err := s.DB.Exec(r.Context(), `UPDATE workspaces w SET sidebar_presets=$2::jsonb WHERE w.id=$1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=$3 AND m.role='admin')`, ws.ID, string(encoded), u.ID)
	if err != nil {
		problem(w, 503, "Could not save sidebar presets")
		return
	}
	if tag.RowsAffected() == 0 {
		problem(w, 403, "Administrator required")
		return
	}
	jsonOut(w, 200, in)
}
