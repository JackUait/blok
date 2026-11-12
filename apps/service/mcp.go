package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
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
		Rooms: rooms,
		Authorize: func(ctx context.Context, principal, documentID string, write bool) (bool, error) {
			var allowed bool
			err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pages p JOIN memberships m ON m.workspace_id=p.workspace_id WHERE p.id=$1 AND m.user_id=$2 AND NOT p.deleted AND NOT p.trashed AND (NOT $3 OR m.role IN ('admin','member')))`, documentID, principal, write).Scan(&allowed)
			return allowed, err
		},
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
		u, err := s.session(r)
		if err != nil {
			problem(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		sdk.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), mcpUserKey{}, u)))
	})
	return nil
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
	rows, err := s.DB.Query(ctx, `SELECT metadata FROM pages WHERE workspace_id=$1 AND NOT deleted AND NOT trashed ORDER BY (metadata->>'position')::numeric NULLS LAST,id`, ws.ID)
	if err != nil {
		return mcpError("Could not list pages"), nil
	}
	defer rows.Close()
	pages := []json.RawMessage{}
	for rows.Next() {
		var raw json.RawMessage
		if rows.Scan(&raw) != nil {
			return mcpError("Could not list pages"), nil
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
	if _, err = tx.Exec(ctx, `INSERT INTO pages(id,workspace_id,metadata,content) VALUES($1,$2,$3,$4)`, pageID, ws.ID, meta, []byte(`{"blocks":[]}`)); err != nil {
		return mcpError("Could not create page"), nil
	}
	if _, err = tx.Exec(ctx, `UPDATE workspaces SET revision=revision+1 WHERE id=$1`, ws.ID); err != nil || tx.Commit(ctx) != nil {
		return mcpError("Could not create page"), nil
	}
	return mcpText(map[string]any{"id": pageID, "title": args.Title, "workspace": ws.Slug, "revision": revision + 1}), nil
}
