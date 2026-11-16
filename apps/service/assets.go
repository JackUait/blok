package cloud

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

func (s *Service) blokHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Blok independently checks cryptographic ticket validity. Gate every service
		// route too: upload/delete/unfurl do not call document Authorization hooks.
		claims, ok := s.documentTicket(r)
		if !ok {
			problem(w, 401, "Valid document ticket required")
			return
		}
		session, doc, write := claims.session, claims.doc, claims.write
		r = r.WithContext(context.WithValue(r.Context(), documentTicketKey{}, claims))
		isWrite := r.Method != "GET" && r.Method != "HEAD"
		can, e := s.authorizeDoc(r.Context(), session, doc, isWrite)
		if e != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		if !can || (isWrite && !write) {
			problem(w, 403, "Document access refused")
			return
		}
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			forget := s.observeDocument(doc)
			defer forget()
		}
		if strings.HasSuffix(r.URL.Path, "/delete") {
			problem(w, 405, "Assets are retained for document history")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/upload") || strings.HasSuffix(r.URL.Path, "/upload-by-url") {
			rec := httptest.NewRecorder()
			next.ServeHTTP(rec, r)
			if rec.Code >= 200 && rec.Code < 300 {
				var uploaded struct {
					URL string `json:"url"`
				}
				if json.Unmarshal(rec.Body.Bytes(), &uploaded) == nil && uploaded.URL != "" {
					parsed, e := url.Parse(uploaded.URL)
					if e != nil {
						problem(w, 500, "Invalid upload response")
						return
					}
					name := path.Base(parsed.Path)
					tag, e := s.DB.Exec(r.Context(), `INSERT INTO assets(name,workspace_id,document_id) SELECT $1,workspace_id,id FROM pages WHERE id=$2 AND NOT deleted`, name, doc)
					if e != nil || tag.RowsAffected() != 1 {
						problem(w, 500, "Could not register private upload")
						return
					}
				}
			}
			for k, vs := range rec.Header() {
				w.Header()[k] = vs
			}
			w.WriteHeader(rec.Code)
			w.Write(rec.Body.Bytes())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Un fichier rattaché à une page suit les permissions de cette page : masquer une
// page ne protège rien si l'URL de son image reste servie à tout l'espace. Un
// fichier sans page — emoji, couverture d'espace — reste commun aux membres.
func (s *Service) assetAllowed(r *http.Request, session, name string) bool {
	var document *string
	var member bool
	e := s.DB.QueryRow(r.Context(), `SELECT a.document_id, EXISTS(SELECT 1 FROM memberships m JOIN sessions s ON s.user_id=m.user_id WHERE m.workspace_id=a.workspace_id AND s.id=$2 AND s.expires_at>now()) FROM assets a WHERE a.name=$1`, name, session).Scan(&document, &member)
	if e != nil || !member {
		return false
	}
	if document == nil {
		return true
	}
	granted, e := s.effectiveLevelForSession(r.Context(), s.DB, session, *document)
	return e == nil && granted >= levelView
}
func (s *Service) grant(session, name, expires string) string {
	mac := hmac.New(sha256.New, []byte(s.Config.InternalSecret))
	mac.Write([]byte(session + "\n" + name + "\n" + expires))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) assetURL(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	raw := r.URL.Query().Get("url")
	parsed, e := url.Parse(raw)
	if e != nil {
		problem(w, 400, "Invalid asset URL")
		return
	}
	pub, _ := url.Parse(s.Config.PublicURL)
	if parsed.Host != "" && parsed.Host != pub.Host {
		problem(w, 400, "Asset must belong to this server")
		return
	}
	name := path.Base(parsed.Path)
	if !strings.HasPrefix(parsed.Path, "/files/") || !s.assetAllowed(r, u.Session, name) {
		problem(w, 403, "Asset access refused")
		return
	}
	expiry := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	signed := strings.TrimRight(s.Config.PublicURL, "/") + "/files/" + url.PathEscape(name) + "?session=" + url.QueryEscape(u.Session) + "&expires=" + expiry + "&grant=" + url.QueryEscape(s.grant(u.Session, name, expiry))
	jsonOut(w, 200, map[string]string{"url": signed})
}
func (s *Service) file(w http.ResponseWriter, r *http.Request, next http.Handler) {
	if r.Method != "GET" && r.Method != "HEAD" {
		problem(w, 405, "Method not allowed")
		return
	}
	name := path.Base(r.URL.Path)
	session := ""
	if u, e := s.session(r); e == nil {
		session = u.Session
	} else {
		q := r.URL.Query()
		expiry, e := strconv.ParseInt(q.Get("expires"), 10, 64)
		if e != nil || expiry < time.Now().Unix() || expiry > time.Now().Add(time.Minute).Unix()+5 {
			problem(w, 401, "Asset authorization required")
			return
		}
		session = q.Get("session")
		actual, err := base64.RawURLEncoding.DecodeString(q.Get("grant"))
		expected, _ := base64.RawURLEncoding.DecodeString(s.grant(session, name, q.Get("expires")))
		if err != nil || !hmac.Equal(actual, expected) {
			problem(w, 401, "Invalid asset grant")
			return
		}
	}
	if !s.assetAllowed(r, session, name) {
		problem(w, 403, "Asset access refused")
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "sandbox")
	next.ServeHTTP(w, r)
}
