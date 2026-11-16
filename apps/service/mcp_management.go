package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Only a checked MCP call can supply this context value. HTTP bearer tokens
// remain session-only on /api: no new authentication mechanism is exposed.
type mcpManagementIdentityKey struct{}

type managementOperation struct {
	name, description, method string
	handler                   http.HandlerFunc
	path                      map[string]string
	// Map input names to handler path parameters; these are never interpolated in URLs.
	params     map[string]string
	properties map[string]any
	required   []string
	query      bool
}

func stringField() map[string]any { return map[string]any{"type": "string", "minLength": 1} }
func enumField(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}
func managementFields(names ...string) map[string]any {
	fields := map[string]any{}
	for _, name := range names {
		fields[name] = stringField()
		if name == "workspace" {
			fields[name] = map[string]any{"type": "string", "minLength": 1, "description": "Workspace slug or ID from blok_list_workspaces. Prefer the slug for compatibility with document listing tools."}
		}
	}
	return fields
}

func (s *Service) managementOperations() []managementOperation {
	wsParams := map[string]string{"workspace": "slug"}
	tsParams := map[string]string{"workspace": "slug", "teamspaceId": "id"}
	tsMemberParams := map[string]string{"workspace": "slug", "teamspaceId": "id", "userId": "target"}
	wsMemberParams := map[string]string{"workspace": "slug", "userId": "id"}
	teamspaces := map[string]string{"resource": "teamspaces"}
	identityFields := func(base ...string) map[string]any {
		f := managementFields(base...)
		f["name"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 120}
		f["icon"] = map[string]any{"type": []string{"string", "null"}, "description": "Emoji; null clears the icon."}
		return f
	}
	tsIdentity := identityFields("workspace", "teamspaceId")
	tsIdentity["description"] = map[string]any{"type": "string", "maxLength": 2000}
	createTS := identityFields("workspace")
	createTS["description"] = tsIdentity["description"]
	createTS["mode"] = enumField("closed")
	memberRole := managementFields("workspace", "teamspaceId", "userId")
	memberRole["role"] = enumField("owner", "member")
	wsRole := managementFields("workspace", "userId")
	wsRole["role"] = enumField("admin", "member", "viewer")
	bind := managementFields("workspace", "pageId")
	bind["teamspaceId"] = map[string]any{"type": []string{"string", "null"}, "minLength": 1, "description": "Target teamspace ID, or null to detach. Private pages remain private."}
	invite := managementFields("workspace", "email")
	invite["role"] = enumField("member", "viewer")
	invite["message"] = map[string]any{"type": "string", "maxLength": 2000}
	join := managementFields("workspace", "requestId")
	join["role"] = enumField("member", "viewer")
	settings := map[string]any{
		"name": map[string]any{"type": "string"}, "signupPolicy": enumField("open", "invite", "domain"),
		"signupDomains": map[string]any{"type": "array", "items": stringField()}, "workspaceCreation": enumField("anyone", "admins_only", "disabled"),
		"defaultWorkspaceId": map[string]any{"type": []string{"string", "null"}},
	}
	userPatch := managementFields("userId")
	userPatch["name"] = map[string]any{"type": "string", "maxLength": 120}
	userPatch["instanceAdmin"] = map[string]any{"type": "boolean"}
	userCreate := managementFields("email")
	userCreate["name"] = userPatch["name"]
	paging := map[string]any{"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}, "offset": map[string]any{"type": "integer", "minimum": 0}}
	wsRequired, tsRequired := []string{"workspace"}, []string{"workspace", "teamspaceId"}
	pageParams := map[string]string{"workspace": "slug", "pageId": "id"}
	pageRequired := []string{"workspace", "pageId"}
	move := managementFields("workspace", "pageId")
	move["parentId"] = map[string]any{"type": []string{"string", "null"}, "minLength": 1, "description": "Destination parent page ID, or null to move to the root of the current teamspace/workspace."}
	move["teamspaceId"] = map[string]any{"type": []string{"string", "null"}, "minLength": 1, "description": "Optional, only with parentId:null: destination teamspace ID, or null for the workspace root. Omit to keep the current teamspace."}
	visibility := managementFields("workspace", "pageId")
	visibility["visibility"] = enumField("private", "workspace", "inherit")
	share := managementFields("workspace", "pageId", "userId")
	share["level"] = enumField("view", "edit", "full")
	emoji := managementFields("workspace", "name")
	emoji["dataUrl"] = map[string]any{"type": "string", "description": "PNG/JPEG/GIF/WebP base64 data URL, up to 2 MiB. Provide this OR url."}
	emoji["url"] = map[string]any{"type": "string", "description": "An existing /files/ image owned by this workspace (not a private page asset), or an external HTTPS image URL. Never store an expiring signed URL."}
	return []managementOperation{
		{"blok_move_page", "Move an existing page and its subtree without recreating content or changing IDs. Requires full access to every page in the subtree and edit access to the destination parent. Preserves explicit visibility and direct shares; inherited access follows the destination, with full access retained for the mover. Cross-teamspace moves also require source teamspace management and destination membership/write access. Rejects cycles, trashed destinations and excessive depth. Returns id, parentId, teamspaceId and revision; repeating the same move is a no-op.", "POST", s.workspaceResource, map[string]string{"resource": "pages", "action": "move"}, pageParams, move, []string{"workspace", "pageId", "parentId"}, false},
		{"blok_list_custom_emojis", "List this workspace's custom emoji registry: IDs, names and persistent image URLs. Members including viewers may read it. Uploaded images remain private.", "GET", s.workspaceResource, map[string]string{"resource": "emojis"}, wsParams, managementFields("workspace"), wsRequired, false},
		{"blok_create_custom_emoji", "Register a named custom emoji from dataUrl OR url. Requires workspace member/admin. Names normalize to lowercase; duplicates conflict. Uploads up to 2 MiB; no SVG. Returns a permanent URL for page.icon={type:'image',url}; 401 on an unauthenticated fetch is not proof of rendering.", "POST", s.workspaceResource, map[string]string{"resource": "emojis"}, wsParams, emoji, []string{"workspace", "name"}, false},
		{"blok_rename_custom_emoji", "Rename an emoji registry entry while preserving its ID, image and existing page icons. Requires its creator with workspace edit rights or a workspace admin.", "PATCH", s.workspaceResource, map[string]string{"resource": "emojis"}, map[string]string{"workspace": "slug", "emojiId": "id"}, managementFields("workspace", "emojiId", "name"), []string{"workspace", "emojiId", "name"}, false},
		{"blok_delete_custom_emoji", "Remove an emoji from the workspace picker. Requires creator with edit rights or admin. Preserves uploaded image files used by existing icons and history.", "DELETE", s.workspaceResource, map[string]string{"resource": "emojis"}, map[string]string{"workspace": "slug", "emojiId": "id"}, managementFields("workspace", "emojiId"), []string{"workspace", "emojiId"}, false},
		{"blok_delete_page", "Move a page and all its descendants to the workspace trash. Recoverable: preserves content, files, shares and parent links. Requires edit access to every page in the subtree; refuses the entire operation otherwise. Repeating the call on an already trashed subtree makes no further change. Returns id, trashed, affectedPages and revision.", "DELETE", s.workspaceResource, map[string]string{"resource": "pages"}, pageParams, managementFields("workspace", "pageId"), pageRequired, false},
		{"blok_get_page_access", "Read page visibility, effective level and shares. Requires page access; admins cannot inspect private pages implicitly.", "GET", s.workspaceResource, map[string]string{"resource": "pages", "action": "access"}, pageParams, managementFields("workspace", "pageId"), pageRequired, false},
		{"blok_set_page_visibility", "Change page visibility (private, workspace or inherited). Requires full access. Workspace visibility inside a teamspace is limited to its members; may affect descendants.", "PUT", s.workspaceResource, map[string]string{"resource": "pages", "action": "access"}, pageParams, visibility, []string{"workspace", "pageId", "visibility"}, false},
		{"blok_set_page_share", "Grant or change a workspace member's page access (view, edit, full). Requires full access; does not bypass teamspace membership.", "PUT", s.workspaceResource, map[string]string{"resource": "pages", "action": "shares"}, map[string]string{"workspace": "slug", "pageId": "id", "userId": "target"}, share, []string{"workspace", "pageId", "userId", "level"}, false},
		{"blok_remove_page_share", "Remove a direct page share. Requires full access; inherited permissions can still grant access. Protects the last full-access holder.", "DELETE", s.workspaceResource, map[string]string{"resource": "pages", "action": "shares"}, map[string]string{"workspace": "slug", "pageId": "id", "userId": "target"}, managementFields("workspace", "pageId", "userId"), []string{"workspace", "pageId", "userId"}, false},
		{"blok_get_teamspace", "Read teamspace identity and your role. Discovery does not grant access to its content.", "GET", s.workspaceResource, teamspaces, tsParams, managementFields("workspace", "teamspaceId"), tsRequired, false},
		{"blok_create_teamspace", "Create a closed teamspace. Requires workspace admin; creator becomes owner. Does not create a workspace.", "POST", s.workspaceResource, teamspaces, wsParams, createTS, []string{"workspace", "name"}, false},
		{"blok_update_teamspace", "Change teamspace name, emoji or description. Requires teamspace owner or workspace admin; omitted fields are preserved.", "PATCH", s.workspaceResource, teamspaces, tsParams, tsIdentity, tsRequired, false},
		{"blok_archive_teamspace", "Archive a teamspace, revoking access to its pages until restored. Preserves content. Requires owner or workspace admin.", "POST", s.workspaceResource, map[string]string{"resource": "teamspaces", "action": "archive"}, tsParams, managementFields("workspace", "teamspaceId"), tsRequired, false},
		{"blok_restore_teamspace", "Restore an archived teamspace and its previous memberships and page permissions. Requires owner or workspace admin.", "POST", s.workspaceResource, map[string]string{"resource": "teamspaces", "action": "restore"}, tsParams, managementFields("workspace", "teamspaceId"), tsRequired, false},
		{"blok_list_teamspace_members", "List teamspace members and roles. Requires teamspace membership or workspace admin.", "GET", s.workspaceResource, map[string]string{"resource": "teamspaces", "action": "members"}, tsParams, managementFields("workspace", "teamspaceId"), tsRequired, false},
		{"blok_set_teamspace_member", "Add an existing workspace member to a teamspace or change their role. Requires owner/admin. Protects the last owner; workspace viewers cannot own teams.", "PUT", s.workspaceResource, map[string]string{"resource": "teamspaces", "action": "members"}, tsMemberParams, memberRole, []string{"workspace", "teamspaceId", "userId", "role"}, false},
		{"blok_remove_teamspace_member", "Remove teamspace membership and revoke content access. Requires owner/admin; last owner is protected.", "DELETE", s.workspaceResource, map[string]string{"resource": "teamspaces", "action": "members"}, tsMemberParams, managementFields("workspace", "teamspaceId", "userId"), []string{"workspace", "teamspaceId", "userId"}, false},
		{"blok_set_page_teamspace", "Assign or detach a root page and its descendants. Requires full access to the entire subtree, source teamspace management and target membership. Never converts private visibility.", "PUT", s.workspaceResource, map[string]string{"resource": "pages", "action": "teamspace"}, map[string]string{"workspace": "slug", "pageId": "id"}, bind, []string{"workspace", "pageId", "teamspaceId"}, false},
		{"blok_update_workspace", "Update workspace name or emoji. Requires workspace admin. ID, slug and page links remain unchanged.", "PATCH", s.workspace, nil, wsParams, identityFields("workspace"), wsRequired, false},
		{"blok_list_workspace_members", "List existing workspace member IDs, emails and roles for membership management.", "GET", s.workspaceResource, map[string]string{"resource": "members"}, wsParams, managementFields("workspace"), wsRequired, false},
		{"blok_set_workspace_member_role", "Change an existing member's workspace role. Requires workspace admin. Protects the last admin and teamspace owner. Does not grant instance administration.", "PATCH", s.workspaceResource, map[string]string{"resource": "members"}, wsMemberParams, wsRole, []string{"workspace", "userId", "role"}, false},
		{"blok_remove_workspace_member", "Remove a workspace member and their page shares. Requires workspace admin; last admin/teamspace owner protected.", "DELETE", s.workspaceResource, map[string]string{"resource": "members"}, wsMemberParams, managementFields("workspace", "userId"), []string{"workspace", "userId"}, false},
		{"blok_list_workspace_invites", "List workspace invitations and delivery status. Requires workspace admin.", "GET", s.workspaceResource, map[string]string{"resource": "invites"}, wsParams, managementFields("workspace"), wsRequired, false},
		{"blok_invite_workspace_member", "Invite someone by email. SENDS an invitation email, valid for 7 days. Requires workspace admin. Use only when the user requests an invitation.", "POST", s.workspaceResource, map[string]string{"resource": "invites"}, wsParams, invite, []string{"workspace", "email"}, false},
		{"blok_revoke_workspace_invite", "Revoke a pending workspace invitation. Requires workspace admin.", "DELETE", s.workspaceResource, map[string]string{"resource": "invites"}, map[string]string{"workspace": "slug", "inviteId": "id"}, managementFields("workspace", "inviteId"), []string{"workspace", "inviteId"}, false},
		{"blok_list_join_requests", "List workspace join requests. Requires workspace admin.", "GET", s.workspaceResource, map[string]string{"resource": "join-requests"}, wsParams, managementFields("workspace"), wsRequired, false},
		{"blok_approve_join_request", "Approve a pending request with member or viewer role (default member). Requires workspace admin.", "POST", s.workspaceResource, map[string]string{"resource": "join-requests", "action": "approve"}, map[string]string{"workspace": "slug", "requestId": "id"}, join, []string{"workspace", "requestId"}, false},
		{"blok_reject_join_request", "Reject a pending workspace join request. Requires workspace admin.", "POST", s.workspaceResource, map[string]string{"resource": "join-requests", "action": "reject"}, map[string]string{"workspace": "slug", "requestId": "id"}, managementFields("workspace", "requestId"), []string{"workspace", "requestId"}, false},
		{"blok_get_instance_settings", "Read server-wide settings. Requires instance admin, not just workspace admin.", "GET", s.getAdminSettings, nil, nil, map[string]any{}, nil, false},
		{"blok_update_instance_settings", "Update server name, signup rules, workspace creation policy or default workspace. Requires instance admin. Omitted fields are preserved; null clears defaultWorkspaceId.", "PATCH", s.patchAdminSettings, nil, nil, settings, nil, false},
		{"blok_list_instance_users", "List server accounts, roles and workspace counts (paginated). Requires instance admin.", "GET", s.listAdminUsers, nil, nil, paging, nil, true},
		{"blok_create_instance_user", "Create a server account without emailing or adding workspace membership. Requires instance admin.", "POST", s.createAdminUser, nil, nil, userCreate, []string{"email"}, false},
		{"blok_update_instance_user", "Update account name or grant/revoke instance administrator status. Requires instance admin; protects the last admin.", "PATCH", s.patchAdminUser, nil, map[string]string{"userId": "id"}, userPatch, []string{"userId"}, false},
		{"blok_delete_instance_user", "PERMANENTLY delete a server account and revoke its access. Requires instance admin; protects last administrators/owners. Use only for an explicit account deletion request.", "DELETE", s.deleteAdminUser, nil, map[string]string{"userId": "id"}, managementFields("userId"), []string{"userId"}, false},
		{"blok_list_instance_workspaces", "List all server workspaces and member counts (paginated), without access to their private content. Requires instance admin.", "GET", s.listAdminWorkspaces, nil, nil, paging, nil, true},
		{"blok_create_workspace", "Create a workspace and become its admin. Obeys server creation policy; instance admins can create even when normal creation is disabled.", "POST", s.mcpCreateWorkspaceHTTP, nil, nil, managementFields("name", "slug"), []string{"name", "slug"}, false},
	}
}

func (s *Service) mcpCreateWorkspaceHTTP(w http.ResponseWriter, r *http.Request) {
	u, ok := s.require(w, r)
	if !ok {
		return
	}
	if u.InstanceAdmin {
		s.createAdminWorkspace(w, r)
	} else {
		s.createWorkspace(w, r)
	}
}

func (s *Service) registerMCPManagement(server *mcp.Server) {
	for _, op := range s.managementOperations() {
		required := op.required
		if required == nil {
			required = []string{}
		}
		schema := map[string]any{"type": "object", "properties": op.properties, "required": required, "additionalProperties": false}
		readOnly := op.method == "GET"
		destructive := !readOnly && op.name != "blok_create_teamspace" && op.name != "blok_create_workspace" && op.name != "blok_create_instance_user" && op.name != "blok_create_custom_emoji" && op.name != "blok_invite_workspace_member"
		openWorld := op.name == "blok_invite_workspace_member"
		server.AddTool(&mcp.Tool{Name: op.name, Description: op.description, InputSchema: schema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly, DestructiveHint: &destructive, OpenWorldHint: &openWorld}}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return s.callManagement(ctx, req, op), nil
		})
	}
	server.AddTool(&mcp.Tool{Name: "blok_capabilities", Description: "Start here: identify your account, instance/workspace roles, management tools and document workflow. Roles are not blanket access to private pages.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, s.mcpCapabilities)
}

// Capture existing HTTP business handlers in-process. This shares their validation,
// transactions, last-owner protections, rate limits and live socket revocation.
// No user-supplied URL, cookie or arbitrary REST route is accepted.
type managementResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *managementResponse) Header() http.Header { return r.header }
func (r *managementResponse) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}
func (r *managementResponse) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	return r.body.Write(b)
}

func (s *Service) callManagement(ctx context.Context, req *mcp.CallToolRequest, op managementOperation) *mcp.CallToolResult {
	u, ok := ctx.Value(mcpUserKey{}).(identity)
	if !ok || u.ID == "" {
		return managementFailure(401, "MCP identity required")
	}
	var args map[string]json.RawMessage
	if json.Unmarshal(req.Params.Arguments, &args) != nil || args == nil {
		return managementFailure(400, "Expected an argument object")
	}
	for key := range args {
		if _, exists := op.properties[key]; !exists {
			return managementFailure(400, "Unknown argument: "+key)
		}
	}
	for _, key := range op.required {
		if _, exists := args[key]; !exists {
			return managementFailure(400, "Missing argument: "+key)
		}
	}
	paths := map[string]string{}
	for key, value := range op.path {
		paths[key] = value
	}
	for input, path := range op.params {
		var value string
		if json.Unmarshal(args[input], &value) != nil || value == "" {
			return managementFailure(400, "Invalid "+input)
		}
		paths[path] = value
		delete(args, input)
	}
	query := url.Values{}
	if op.query {
		for key, raw := range args {
			var n int
			if json.Unmarshal(raw, &n) != nil {
				return managementFailure(400, "Invalid "+key)
			}
			query.Set(key, strconv.Itoa(n))
		}
		args = map[string]json.RawMessage{}
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return managementFailure(400, "Invalid arguments")
	}
	r, err := http.NewRequestWithContext(context.WithValue(ctx, mcpManagementIdentityKey{}, u), op.method, "http://mcp.internal/?"+query.Encode(), bytes.NewReader(encoded))
	if err != nil {
		return managementFailure(400, "Invalid request")
	}
	for key, value := range paths {
		r.SetPathValue(key, value)
	}
	r.Header.Set("Content-Type", "application/json")
	response := &managementResponse{header: http.Header{}}
	op.handler(response, r)
	var out any
	if json.Unmarshal(response.body.Bytes(), &out) != nil {
		return managementFailure(500, "Invalid management response")
	}
	if response.status >= 400 {
		message := http.StatusText(response.status)
		if object, ok := out.(map[string]any); ok {
			if detail, ok := object["error"].(string); ok {
				message = detail
			}
		}
		return managementFailure(response.status, message)
	}
	return mcpText(out)
}

func managementFailure(status int, message string) *mcp.CallToolResult {
	code := map[int]string{400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED"}[status]
	if code == "" {
		code = "SERVICE_ERROR"
	}
	result := mcpText(map[string]any{"status": status, "error": map[string]string{"code": code, "message": message}})
	result.IsError = true
	return result
}

func (s *Service) mcpCapabilities(ctx context.Context, _ *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	u, ok := ctx.Value(mcpUserKey{}).(identity)
	if !ok {
		return managementFailure(401, "MCP identity required"), nil
	}
	workspaces, err := s.workspaces(ctx, u.ID)
	if err != nil {
		return managementFailure(503, "Could not list workspaces"), nil
	}
	ops := []map[string]any{}
	for _, op := range s.managementOperations() {
		ops = append(ops, map[string]any{"tool": op.name, "description": op.description, "readOnly": op.method == "GET"})
	}
	if s.mcpTimingEnabled {
		ops = append(ops, map[string]any{"tool": "blok_debug_traces", "description": "Read your own temporary MCP timing summaries or trace detail.", "readOnly": true})
	}
	return mcpText(map[string]any{
		"user": map[string]any{"id": u.ID, "name": u.Name, "email": u.Email, "instanceAdmin": u.InstanceAdmin}, "workspaces": workspaces, "management": ops,
		"workspaceCreation":  s.settings().WorkspaceCreation,
		"canCreateWorkspace": u.InstanceAdmin || s.settings().WorkspaceCreation == "anyone",
		"pageAccessLevels":   []string{"view", "edit", "full"},
		"documentWorkflow":   []string{"List pages with blok_list_pages, or create one with blok_create_page (private by default outside teamspaces).", "Open with blok_open, inspect with blok_read and discover the available document actions before blok_execute.", "Databases, schemas, views, rows and page discussions use the document tools; do not invent REST endpoints.", "Text-anchored discussion UI is not implemented yet. General page and database discussions are available."},
		"permissions":        "Each operation rechecks current permissions. Workspace admin does not imply instance admin or private-page access. A teamspace's metadata does not grant content access.",
	}), nil
}
