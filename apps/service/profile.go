package cloud

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"net/http"
	"strings"
	"unicode/utf8"
)

// A self-service endpoint: the account always comes from the authenticated session.
func (s *Service) updateProfile(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 450000)
	var in map[string]json.RawMessage
	if !body(w, r, &in) {
		return
	}
	if len(in) == 0 {
		problem(w, 400, "Empty profile update")
		return
	}
	for key := range in {
		if key != "name" && key != "avatarUrl" {
			problem(w, 400, "Unknown profile field")
			return
		}
	}
	var name, avatar *string
	if raw, exists := in["name"]; exists {
		var value string
		if string(raw) == "null" || json.Unmarshal(raw, &value) != nil || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 80 {
			problem(w, 400, "Invalid display name")
			return
		}
		value = strings.TrimSpace(value)
		name = &value
	}
	if raw, exists := in["avatarUrl"]; exists {
		value := ""
		if string(raw) != "null" {
			if json.Unmarshal(raw, &value) != nil || len(value) > 400000 || !strings.HasPrefix(value, "data:image/png;base64,") {
				problem(w, 400, "Invalid profile photo")
				return
			}
			data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, "data:image/png;base64,"))
			if err != nil {
				problem(w, 400, "Invalid profile photo")
				return
			}
			config, err := png.DecodeConfig(bytes.NewReader(data))
			if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 256 || config.Height > 256 {
				problem(w, 400, "Photo must fit within 256 pixels")
				return
			}
			image, err := png.Decode(bytes.NewReader(data))
			if err != nil {
				problem(w, 400, "Invalid profile photo")
				return
			}
			var clean bytes.Buffer
			if err = png.Encode(&clean, image); err != nil {
				problem(w, 400, "Invalid profile photo")
				return
			}
			value = "data:image/png;base64," + base64.StdEncoding.EncodeToString(clean.Bytes())
		}
		avatar = &value
	}
	if err := s.DB.QueryRow(r.Context(), `UPDATE users SET name=COALESCE($2,name),avatar_url=COALESCE($3,avatar_url) WHERE id=$1 RETURNING name,avatar_url`, u.ID, name, avatar).Scan(&u.Name, &u.AvatarURL); err != nil {
		problem(w, 503, "Profile could not be saved")
		return
	}
	jsonOut(w, 200, u.User)
}
