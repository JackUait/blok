package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
	"github.com/jackc/pgx/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpUserKey struct{}

func mcpText(v any) *mcp.CallToolResult {
	b, _ := json.Marshal(v)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}
}

func mcpError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
}

func (s *Service) initMCP() error {
	rooms, err := s.Blok.AgentExecutor()
	if err != nil {
		return err
	}
	attached, err := blokmcp.Embed(blokmcp.Options{
		Rooms:     rooms,
		Authorize: s.authorizeMCPDocument,
	}, blokmcp.EmbedOptions{Caller: func(ctx context.Context, _ *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error) {
		u, ok := ctx.Value(mcpUserKey{}).(identity)
		if !ok {
			return nil, nil
		}
		return &blokmcp.CallerIdentity{Principal: u.ID}, nil
	}})
	if err != nil {
		return err
	}
	s.MCP = attached
	sdk := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		server := mcp.NewServer(&mcp.Implementation{Name: "blok-cloud", Version: "1.0.0"}, &mcp.ServerOptions{Instructions: "Workspace pages are listed and created with workspace tools. Document content is edited with blok_open, blok_read and blok_execute.\n\n" + attached.Instructions()})
		server.AddTool(&mcp.Tool{Name: "blok_list_workspaces", Description: "List workspaces available to the signed-in user.", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}, s.mcpListWorkspaces)
		server.AddTool(&mcp.Tool{Name: "blok_list_pages", Description: "List pages in a workspace by slug.", InputSchema: json.RawMessage(`{"type":"object","properties":{"workspace":{"type":"string"}},"required":["workspace"]}`)}, s.mcpListPages)
		server.AddTool(&mcp.Tool{Name: "blok_create_page", Description: "Create a page in a workspace. Members and admins may create pages.", InputSchema: json.RawMessage(`{"type":"object","properties":{"workspace":{"type":"string"},"title":{"type":"string"},"parentId":{"type":"string"}},"required":["workspace","title"]}`)}, s.mcpCreatePage)
		server.AddTool(&mcp.Tool{Name: "blok_upload_image", Description: "Upload a private workspace image (PNG, JPEG, GIF or WebP, up to 5 MiB). Returns a persistent /files/ URL to use in document content. Requires workspace write access.", InputSchema: json.RawMessage(`{"type":"object","properties":{"workspace":{"type":"string"},"dataUrl":{"type":"string"}},"required":["workspace","dataUrl"],"additionalProperties":false}`)}, s.mcpUploadImage)
		if err := attached.Attach(server); err != nil {
			return nil
		}
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true, DisableLocalhostProtection: true})
	s.mcpHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// MCP uses explicit bearer credentials. A browser cookie cannot grant an agent access.
		if r.Header.Get("Origin") != "" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || len(r.Header.Get("Authorization")) <= len("Bearer ") {
			problem(w, http.StatusUnauthorized, "Bearer token required")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		u, err := s.mcpIdentity(r)
		if err != nil {
			problem(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		sdk.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), mcpUserKey{}, u)))
	})
	return nil
}

// La porte des outils d'édition MCP. Elle est distincte de celle du temps réel
// et de celle des routes HTTP, et doit répondre comme elles : un jeton MCP porte
// l'identité de son propriétaire, jamais davantage.
func (s *Service) authorizeMCPDocument(ctx context.Context, principal, documentID string, write bool) (bool, error) {
	var trashed bool
	e := s.DB.QueryRow(ctx, `SELECT trashed FROM pages WHERE id=$1 AND NOT deleted`, documentID).Scan(&trashed)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil || trashed {
		return false, e
	}
	granted, e := s.effectiveLevel(ctx, s.DB, principal, documentID)
	if e != nil {
		return false, e
	}
	if write {
		return granted >= levelEdit, nil
	}
	return granted >= levelView, nil
}

func (s *Service) mcpIdentity(r *http.Request) (identity, error) {
	var u identity
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	u.Session = hash(token)
	err := s.DB.QueryRow(r.Context(), `SELECT u.id,u.email FROM mcp_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=$1 AND t.expires_at>now()`, u.Session).Scan(&u.ID, &u.Email)
	if err == nil {
		_, _ = s.DB.Exec(r.Context(), `UPDATE mcp_tokens SET last_used_at=now() WHERE id=$1`, u.Session)
	}
	return u, err
}

func (s *Service) mcpTokens(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		rows, err := s.DB.Query(r.Context(), `SELECT id,label,created_at,expires_at,last_used_at FROM mcp_tokens WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC`, u.ID)
		if err != nil {
			problem(w, 503, "Tokens unavailable")
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, label string
			var created, expires time.Time
			var lastUsed *time.Time
			if rows.Scan(&id, &label, &created, &expires, &lastUsed) != nil {
				problem(w, 503, "Tokens unavailable")
				return
			}
			out = append(out, map[string]any{"id": id, "label": label, "createdAt": created, "expiresAt": expires, "lastUsedAt": lastUsed})
		}
		if rows.Err() != nil {
			problem(w, 503, "Tokens unavailable")
			return
		}
		jsonOut(w, 200, map[string]any{"tokens": out})
		return
	}
	if r.Method != http.MethodPost {
		problem(w, 405, "Method not allowed")
		return
	}
	var in struct {
		Label string `json:"label"`
	}
	if !body(w, r, &in) {
		return
	}
	in.Label = strings.TrimSpace(in.Label)
	if in.Label == "" || len(in.Label) > 80 {
		problem(w, 400, "Invalid token name")
		return
	}
	if !s.rate(r.Context(), "mcp-token:"+u.ID, 10) {
		problem(w, 429, "Too many tokens created")
		return
	}
	var count int
	if s.DB.QueryRow(r.Context(), `SELECT count(*) FROM mcp_tokens WHERE user_id=$1 AND expires_at>now()`, u.ID).Scan(&count) != nil {
		problem(w, 503, "Tokens unavailable")
		return
	}
	if count >= 10 {
		problem(w, 409, "Revoke an existing token first")
		return
	}
	token := opaque()
	var created, expires time.Time
	err := s.DB.QueryRow(r.Context(), `INSERT INTO mcp_tokens(id,user_id,label,expires_at) VALUES($1,$2,$3,now()+interval '90 days') RETURNING created_at,expires_at`, hash(token), u.ID, in.Label).Scan(&created, &expires)
	if err != nil {
		problem(w, 503, "Could not create token")
		return
	}
	jsonOut(w, 201, map[string]any{"id": hash(token), "label": in.Label, "token": token, "createdAt": created, "expiresAt": expires})
}

func (s *Service) revokeMCPToken(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	tag, err := s.DB.Exec(r.Context(), `DELETE FROM mcp_tokens WHERE id=$1 AND user_id=$2`, r.PathValue("id"), u.ID)
	if err != nil {
		problem(w, 503, "Could not revoke token")
		return
	}
	if tag.RowsAffected() == 0 {
		problem(w, 404, "Token not found")
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}

func (s *Service) rotateMCPToken(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	if !s.rate(r.Context(), "mcp-token:"+u.ID, 10) {
		problem(w, 429, "Too many token changes")
		return
	}
	token := opaque()
	var label string
	var created, expires time.Time
	err := s.DB.QueryRow(r.Context(), `UPDATE mcp_tokens SET id=$1,created_at=now(),expires_at=now()+interval '90 days',last_used_at=NULL WHERE id=$2 AND user_id=$3 AND expires_at>now() RETURNING label,created_at,expires_at`, hash(token), r.PathValue("id"), u.ID).Scan(&label, &created, &expires)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, 404, "Token not found")
		} else {
			problem(w, 503, "Could not rotate token")
		}
		return
	}
	jsonOut(w, 200, map[string]any{"id": hash(token), "label": label, "token": token, "createdAt": created, "expiresAt": expires})
}

func (s *Service) mcpListWorkspaces(ctx context.Context, _ *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	u := ctx.Value(mcpUserKey{}).(identity)
	list, err := s.workspaces(ctx, u.ID)
	if err != nil {
		return mcpError("Could not list workspaces"), nil
	}
	return mcpText(map[string]any{"workspaces": list}), nil
}

func (s *Service) mcpWorkspace(ctx context.Context, slug string) (Workspace, bool) {
	u := ctx.Value(mcpUserKey{}).(identity)
	if !slugPattern.MatchString(slug) {
		return Workspace{}, false
	}
	ws, err := s.lookupWorkspace(ctx, slug, u.ID)
	return ws, err == nil && ws.Role != ""
}

func (s *Service) mcpListPages(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var args struct {
		Workspace string `json:"workspace"`
	}
	if json.Unmarshal(req.Params.Arguments, &args) != nil {
		return mcpError("Invalid arguments"), nil
	}
	ws, ok := s.mcpWorkspace(ctx, args.Workspace)
	if !ok {
		return mcpError("Workspace unavailable"), nil
	}
	levels, _, err := s.workspaceLevels(ctx, s.DB, ctx.Value(mcpUserKey{}).(identity).ID, ws.ID)
	if err != nil {
		return mcpError("Could not list pages"), nil
	}
	rows, err := s.DB.Query(ctx, `SELECT id,metadata FROM pages WHERE workspace_id=$1 AND NOT deleted AND NOT trashed ORDER BY (metadata->>'position')::numeric NULLS LAST,id`, ws.ID)
	if err != nil {
		return mcpError("Could not list pages"), nil
	}
	defer rows.Close()
	pages := []json.RawMessage{}
	for rows.Next() {
		var id string
		var raw json.RawMessage
		if rows.Scan(&id, &raw) != nil {
			return mcpError("Could not list pages"), nil
		}
		if levels[id] < levelView {
			continue
		}
		pages = append(pages, raw)
	}
	if rows.Err() != nil {
		return mcpError("Could not list pages"), nil
	}
	return mcpText(map[string]any{"pages": pages}), nil
}

func (s *Service) mcpCreatePage(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var args struct{ Workspace, Title, ParentID string }
	if json.Unmarshal(req.Params.Arguments, &args) != nil || args.Title == "" || len(args.Title) > 4096 {
		return mcpError("Invalid page title or arguments"), nil
	}
	ws, ok := s.mcpWorkspace(ctx, args.Workspace)
	if !ok || ws.Role == "viewer" {
		return mcpError("Write access required"), nil
	}
	if args.ParentID != "" && !pageIDPattern.MatchString(args.ParentID) {
		return mcpError("Invalid parent page"), nil
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return mcpError("Could not create page"), nil
	}
	defer tx.Rollback(ctx)
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT revision FROM workspaces WHERE id=$1 FOR UPDATE`, ws.ID).Scan(&revision); err != nil {
		return mcpError("Could not create page"), nil
	}
	var role string
	if err = tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, ws.ID, ctx.Value(mcpUserKey{}).(identity).ID).Scan(&role); err != nil || role == "viewer" {
		return mcpError("Write access required"), nil
	}
	if args.ParentID != "" {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND workspace_id=$2 AND NOT deleted AND NOT trashed)`, args.ParentID, ws.ID).Scan(&exists); err != nil || !exists {
			return mcpError("Parent page unavailable"), nil
		}
	}
	var position int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM pages WHERE workspace_id=$1 AND NOT deleted AND NOT trashed`, ws.ID).Scan(&position); err != nil {
		return mcpError("Could not create page"), nil
	}
	pageID := opaque()
	var parent any
	if args.ParentID != "" {
		parent = args.ParentID
	}
	meta, _ := json.Marshal(map[string]any{"id": pageID, "title": args.Title, "parentId": parent, "position": position})
	visibility := visInherit
	if args.ParentID == "" {
		visibility = visWorkspace
	}
	if _, err = tx.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata,content,visibility) VALUES($1,$2,$3,$4,$5)`, pageID, ws.ID, meta, []byte(`{"blocks":[]}`), visibility); err != nil {
		return mcpError("Could not create page"), nil
	}
	if _, err = tx.Exec(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1`, ws.ID); err != nil || tx.Commit(ctx) != nil {
		return mcpError("Could not create page"), nil
	}
	return mcpText(map[string]any{"id": pageID, "title": args.Title, "workspace": ws.Slug, "revision": revision + 1}), nil
}

func (s *Service) mcpUploadImage(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var args struct {
		Workspace string `json:"workspace"`
		DataURL   string `json:"dataUrl"`
	}
	if json.Unmarshal(req.Params.Arguments, &args) != nil {
		return mcpError("Invalid arguments"), nil
	}
	ws, ok := s.mcpWorkspace(ctx, args.Workspace)
	if !ok || ws.Role == "viewer" {
		return mcpError("Write access required"), nil
	}
	if _, _, err := decodeWorkspaceImage(args.DataURL, maxWorkspaceImage); err != nil {
		return mcpError("Use a PNG, JPEG, GIF or WebP image up to 5 MiB"), nil
	}
	imageURL, err := s.storeWorkspaceImage(ctx, ws, args.DataURL, maxWorkspaceImage)
	if err != nil {
		return mcpError("Could not save image"), nil
	}
	return mcpText(map[string]string{"url": imageURL}), nil
}
