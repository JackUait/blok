package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const aiMaxInputBytes = 64 << 10
const aiMaxOutputBytes = 64 << 10
const aiMaxUpstreamBytes = 2 << 20
const aiMaxOutputTokens = 4096

var aiModelID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$`)

type aiCredential struct {
	Scope, Owner, Model string
	Encrypted           []byte
}
type aiCredentialState struct {
	Configured bool   `json:"configured"`
	Model      string `json:"model"`
}

func newAIClient(transport http.RoundTripper) *http.Client {
	if transport == nil {
		transport = &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 60 * time.Second, ForceAttemptHTTP2: true, IdleConnTimeout: 90 * time.Second, MaxIdleConns: 20, MaxConnsPerHost: 20, MaxResponseHeaderBytes: 32 << 10}
	}
	return &http.Client{Transport: transport, Timeout: 65 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("OpenAI redirect refused") }}
}
func (s *Service) aiCredential(ctx context.Context, scope, owner string) (aiCredential, error) {
	out := aiCredential{Scope: scope, Owner: owner}
	e := s.DB.QueryRow(ctx, "SELECT encrypted_key,model FROM ai_credentials WHERE scope=$1 AND owner_id=$2", scope, owner).Scan(&out.Encrypted, &out.Model)
	if errors.Is(e, pgx.ErrNoRows) {
		e = nil
	}
	return out, e
}
func (s *Service) aiCredentials(ctx context.Context, u identity, ws Workspace) (aiCredential, aiCredential, error) {
	personal, e := s.aiCredential(ctx, "personal", u.ID)
	if e != nil {
		return personal, aiCredential{}, e
	}
	shared, e := s.aiCredential(ctx, "workspace", ws.ID)
	return personal, shared, e
}
func effectiveAI(personal, workspace aiCredential) aiCredential {
	if len(personal.Encrypted) > 0 {
		return personal
	}
	if len(workspace.Encrypted) > 0 {
		return workspace
	}
	return aiCredential{Scope: "none"}
}
func aiState(c aiCredential) aiCredentialState {
	return aiCredentialState{len(c.Encrypted) > 0, c.Model}
}
func (s *Service) ai(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, action string) {
	if r.PathValue("action") != "" {
		problem(w, 404, "Introuvable")
		return
	}
	switch action {
	case "":
		if r.Method != "GET" {
			problem(w, 405, "Méthode non autorisée")
			return
		}
		personal, shared, e := s.aiCredentials(r.Context(), u, ws)
		if e != nil {
			problem(w, 503, "La configuration IA est indisponible")
			return
		}
		effective := effectiveAI(personal, shared)
		jsonOut(w, 200, map[string]any{"personal": aiState(personal), "workspace": aiState(shared), "effective": map[string]string{"source": effective.Scope, "model": effective.Model}, "canManageWorkspace": ws.Role == "admin"})
	case "credentials":
		s.aiManage(w, r, u, ws)
	case "models":
		s.aiModels(w, r, u, ws)
	case "respond":
		s.aiRespond(w, r, u, ws)
	default:
		problem(w, 404, "Introuvable")
	}
}
func (s *Service) aiOwner(w http.ResponseWriter, scope string, u identity, ws Workspace) (string, bool) {
	switch scope {
	case "personal":
		return u.ID, true
	case "workspace":
		if ws.Role != "admin" {
			problem(w, 403, "Seul un administrateur peut gérer la clé IA partagée")
			return "", false
		}
		return ws.ID, true
	default:
		problem(w, 400, "La portée doit être personal ou workspace")
		return "", false
	}
}
func (s *Service) aiManage(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method == "DELETE" {
		scope := r.URL.Query().Get("scope")
		owner, ok := s.aiOwner(w, scope, u, ws)
		if !ok {
			return
		}
		if _, e := s.DB.Exec(r.Context(), "DELETE FROM ai_credentials WHERE scope=$1 AND owner_id=$2", scope, owner); e != nil {
			problem(w, 503, "Impossible de supprimer les identifiants IA")
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.Method != "PUT" {
		problem(w, 405, "Méthode non autorisée")
		return
	}
	var in struct {
		Scope  string  `json:"scope"`
		APIKey *string `json:"apiKey"`
		Model  *string `json:"model"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if !body(w, r, &in) {
		return
	}
	owner, ok := s.aiOwner(w, in.Scope, u, ws)
	if !ok {
		return
	}
	if in.APIKey == nil && in.Model == nil {
		problem(w, 400, "Indiquez une clé ou un modèle")
		return
	}
	var encrypted []byte
	var e error
	if in.APIKey != nil {
		key := strings.TrimSpace(*in.APIKey)
		if len(key) < 8 || len(key) > 4096 || strings.ContainsAny(key, "\r\n\x00 \t") {
			problem(w, 400, "Clé API invalide ; utilisez Supprimer pour retirer vos identifiants")
			return
		}
		encrypted, e = s.encryptAI(key, in.Scope+":"+owner)
		if e != nil {
			problem(w, 500, "Impossible de chiffrer les identifiants IA")
			return
		}
	}
	if in.Model != nil && *in.Model != "" && !aiModelID.MatchString(*in.Model) {
		problem(w, 400, "Identifiant de modèle invalide")
		return
	}
	// Database-side preservation makes simultaneous key/model-only updates atomic.
	_, e = s.DB.Exec(r.Context(), `INSERT INTO ai_credentials(scope,owner_id,encrypted_key,model) VALUES($1,$2,$3,coalesce($4,'')) ON CONFLICT(scope,owner_id) DO UPDATE SET encrypted_key=CASE WHEN $5 THEN excluded.encrypted_key ELSE ai_credentials.encrypted_key END,model=CASE WHEN $6 THEN excluded.model ELSE ai_credentials.model END,updated_at=now()`, in.Scope, owner, encrypted, in.Model, in.APIKey != nil, in.Model != nil)
	if e != nil {
		problem(w, 503, "Impossible d’enregistrer les identifiants IA")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Service) aiSelected(w http.ResponseWriter, r *http.Request, u identity, ws Workspace, scope string) (aiCredential, bool) {
	personal, shared, e := s.aiCredentials(r.Context(), u, ws)
	if e != nil {
		problem(w, 503, "La configuration IA est indisponible")
		return aiCredential{}, false
	}
	credential := effectiveAI(personal, shared)
	if scope != "" {
		if _, ok := s.aiOwner(w, scope, u, ws); !ok {
			return aiCredential{}, false
		}
		if scope == "personal" {
			credential = personal
		} else {
			credential = shared
		}
	}
	if len(credential.Encrypted) == 0 {
		problem(w, 409, "Ajoutez d’abord une clé API OpenAI")
		return aiCredential{}, false
	}
	return credential, true
}
func (s *Service) aiBudget(ctx context.Context, user string, max int) bool {
	var count int
	e := s.DB.QueryRow(ctx, `INSERT INTO email_rate_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN email_rate_limits.window_start<now()-interval '1 minute' THEN 1 ELSE email_rate_limits.count+1 END,window_start=CASE WHEN email_rate_limits.window_start<now()-interval '1 minute' THEN now() ELSE email_rate_limits.window_start END RETURNING count`, "ai:"+user).Scan(&count)
	return e == nil && count <= max
}
func (s *Service) aiUpstream(ctx context.Context, credential aiCredential, method, path string, payload any) ([]byte, int) {
	key, e := s.decryptAI(credential.Encrypted, credential.Scope+":"+credential.Owner)
	if e != nil {
		return nil, 503
	}
	var encoded []byte
	if payload != nil {
		encoded, e = json.Marshal(payload)
		if e != nil {
			return nil, 502
		}
	}
	req, e := http.NewRequestWithContext(ctx, method, "https://api.openai.com/v1/"+path, bytes.NewReader(encoded))
	if e != nil {
		return nil, 502
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, e := s.aiClient.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return nil, 504
		}
		return nil, 502
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		switch resp.StatusCode {
		case 401, 403:
			return nil, 422
		case 429:
			return nil, 429
		case 400, 404:
			return nil, 422
		default:
			return nil, 502
		}
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, aiMaxUpstreamBytes+1))
	if e != nil || len(raw) > aiMaxUpstreamBytes {
		if ctx.Err() != nil {
			return nil, 504
		}
		return nil, 502
	}
	return raw, 200
}
func aiFailure(w http.ResponseWriter, status int) {
	message := "La requête OpenAI a échoué. Réessayez plus tard"
	switch status {
	case 422:
		message = "OpenAI a refusé la clé, le modèle ou la demande. Vérifiez vos paramètres"
	case 429:
		message = "La limite d’utilisation OpenAI est atteinte. Réessayez plus tard"
	case 503:
		message = "Impossible de déchiffrer les identifiants IA. Contactez l’administrateur du serveur"
	case 504:
		message = "La requête OpenAI a expiré ou a été annulée"
	}
	problem(w, status, message)
}
func (s *Service) aiModels(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method != "GET" {
		problem(w, 405, "Méthode non autorisée")
		return
	}
	credential, ok := s.aiSelected(w, r, u, ws, r.URL.Query().Get("scope"))
	if !ok {
		return
	}
	if !s.aiBudget(r.Context(), u.ID, 30) {
		problem(w, 429, "La limite IA de 30 requêtes par minute est atteinte. Réessayez plus tard")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	raw, status := s.aiUpstream(ctx, credential, "GET", "models", nil)
	if status != 200 {
		aiFailure(w, status)
		return
	}
	var upstream struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &upstream) != nil || upstream.Data == nil {
		aiFailure(w, 502)
		return
	}
	models := []map[string]string{}
	seen := map[string]bool{}
	for _, m := range upstream.Data {
		if availableTextAIModel(m.ID) && !seen[m.ID] {
			models = append(models, map[string]string{"id": m.ID})
			seen[m.ID] = true
			if len(models) >= 500 {
				break
			}
		}
	}
	sort.Slice(models, func(i, j int) bool { return models[i]["id"] < models[j]["id"] })
	jsonOut(w, 200, map[string]any{"models": models, "source": credential.Scope})
}
func (s *Service) aiRespond(w http.ResponseWriter, r *http.Request, u identity, ws Workspace) {
	if r.Method != "POST" {
		problem(w, 405, "Méthode non autorisée")
		return
	}
	var in struct {
		Model    string `json:"model"`
		System   string `json:"system"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
	if !body(w, r, &in) {
		return
	}
	if len(in.Messages) < 1 || len(in.Messages) > 32 || len(in.System) > 16<<10 {
		problem(w, 400, "L’historique IA dépasse la limite de 32 messages ou les instructions dépassent 16 Kio")
		return
	}
	size := len(in.System)
	for _, m := range in.Messages {
		if (m.Role != "user" && m.Role != "assistant") || !utf8.ValidString(m.Content) || m.Content == "" {
			problem(w, 400, "Les messages doivent contenir du texte utilisateur ou assistant")
			return
		}
		size += len(m.Content)
	}
	if size > aiMaxInputBytes {
		problem(w, 400, "La demande IA dépasse 64 Kio. Réduisez le contexte")
		return
	}
	credential, ok := s.aiSelected(w, r, u, ws, "")
	if !ok {
		return
	}
	model := in.Model
	if model == "" {
		model = credential.Model
	}
	if !aiModelID.MatchString(model) {
		problem(w, 400, "Choisissez d’abord un modèle OpenAI")
		return
	}
	if !s.aiBudget(r.Context(), u.ID, 30) {
		problem(w, 429, "La limite IA de 30 requêtes par minute est atteinte. Réessayez plus tard")
		return
	}
	s.aiMu.Lock()
	if s.aiInFlight[u.ID] >= 2 {
		s.aiMu.Unlock()
		problem(w, 429, "Attendez la fin de vos requêtes IA en cours")
		return
	}
	s.aiInFlight[u.ID]++
	s.aiMu.Unlock()
	defer func() {
		s.aiMu.Lock()
		s.aiInFlight[u.ID]--
		if s.aiInFlight[u.ID] <= 0 {
			delete(s.aiInFlight, u.ID)
		}
		s.aiMu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	raw, status := s.aiUpstream(ctx, credential, "POST", "responses", map[string]any{"model": model, "instructions": in.System, "input": in.Messages, "store": false, "max_output_tokens": aiMaxOutputTokens})
	if status != 200 {
		aiFailure(w, status)
		return
	}
	var out struct {
		Status            string          `json:"status"`
		Model             string          `json:"model"`
		Error             json.RawMessage `json:"error"`
		IncompleteDetails struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if json.Unmarshal(raw, &out) != nil {
		aiFailure(w, 502)
		return
	}
	if out.Status == "incomplete" {
		if out.IncompleteDetails.Reason == "max_output_tokens" {
			problem(w, 502, "La réponse a atteint la limite de génération. Essayez une demande plus courte ou réessayez")
		} else {
			problem(w, 502, "OpenAI n’a pas terminé la réponse. Essayez une autre formulation")
		}
		return
	}
	if out.Status != "completed" {
		aiFailure(w, 502)
		return
	}
	var text strings.Builder
	for _, item := range out.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" {
				if text.Len()+len(part.Text) > aiMaxOutputBytes {
					aiFailure(w, 502)
					return
				}
				text.WriteString(part.Text)
			}
		}
	}
	if text.Len() == 0 {
		aiFailure(w, 502)
		return
	}
	actual := out.Model
	if !aiModelID.MatchString(actual) {
		actual = model
	}
	jsonOut(w, 200, map[string]any{"text": text.String(), "model": actual, "source": credential.Scope})
}

// The provider catalog includes non-text products. This conservative filter
// keeps text-family identifiers; access does not guarantee Responses support.
func availableTextAIModel(id string) bool {
	if !aiModelID.MatchString(id) {
		return false
	}
	base := id
	if strings.HasPrefix(base, "ft:") {
		parts := strings.Split(base, ":")
		if len(parts) > 1 {
			base = parts[1]
		}
	}
	family := strings.HasPrefix(base, "gpt-") || (len(base) > 1 && base[0] == 'o' && base[1] >= '1' && base[1] <= '9')
	if !family {
		return false
	}
	for _, term := range []string{"embedding", "tts", "audio", "whisper", "image", "dall-e", "realtime", "transcrib", "transcrip", "moderation", "sora"} {
		if strings.Contains(strings.ToLower(id), term) {
			return false
		}
	}
	return true
}
