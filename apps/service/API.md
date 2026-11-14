# Cloud API contract
All paths relative to configured HTTPS API origin. JSON errors `{error:string}`. Web uses HttpOnly SameSite=Lax cookie; native uses `Authorization: Bearer <token>` in OS secure storage. Send `client:"desktop"` only for native code verification. Mutating web requests require same origin (Origin checked). IDs opaque strings. Workspace route identifier is slug. Roles `admin`, `member`, `viewer`.

- GET `/api/instance` → `{name,setupRequired,signupPolicy,workspaceCreation,defaultWorkspace:null|{slug,name}}`. Anonymous. Does not expose administrators. A setting changed by another process takes effect in under ten seconds.
- POST `/api/setup/claim` `{token,email,name,instanceName?,workspace?:{slug,name},signupPolicy?,workspaceCreation?}` → `{ok:true}`. One-time first-run claim (token from `DATA_DIRECTORY/setup-token`). Creates the instance administrator and optional first workspace, persists signup/workspace-creation policies (defaults `invite` / `admins_only`), then sends a normal login code — **no session**. `workspaceCreation:disabled` requires a first workspace. 403 invalid token · 409 already claimed · 429 rate limited.
- POST `/api/setup/email-test` `{token,email}` → `{ok:true,backend}` or 503 `{error,backend}`. Token-gated deliverability probe while setup is open; refused once setup is completed.
- POST `/api/auth/request-code` `{email}` → `{ok:true}` for every syntactically valid address that passes rate limits. A login code is mailed only when signup is allowed under the instance policy (existing account, pending invite, `open`, or `domain` exact match after `@`); otherwise the response is still `{ok:true}` with no `login_codes` row and no mail. Code expires in 10 minutes. Verify refuses a code if policy no longer allows that address (`401 Invalid or expired code`).
- POST `/api/auth/verify-code` `{email,code,client?:"desktop"}` → `{user:{id,email,name,instanceAdmin},workspaces:Workspace[],token?:string}`. Desktop token returned only for desktop, web cookie otherwise.
- GET `/api/session` → `{user:{id,email,name,instanceAdmin},workspaces}`; 401 when logged out.
- GET `/api/admin/settings` → instance settings (instance administrator).
- PATCH `/api/admin/settings` `{name?,signupPolicy?,signupDomains?,workspaceCreation?,defaultWorkspaceId?}` → updated settings. Absent fields are unchanged. Instance administrator only.
- GET `/api/admin/users?limit&offset` → `{users:[{id,email,name,createdAt,workspaceCount,instanceAdmin}],total,limit,offset}`. Metadata only — never page ids or titles. Instance administrator only.
- POST `/api/admin/users` `{email,name?}` → created user (201). Creates an account with no workspace membership or invite. 409 if the email is already used. Instance administrator only.
- PATCH `/api/admin/users/:id` `{instanceAdmin?,name?}` → updated user. Demoting or deleting the last instance administrator answers 409 `"Keep at least one instance administrator"`. Instance administrator only.
- DELETE `/api/admin/users/:id` → `{ok:true}`. Transactional: sessions, MCP tokens, memberships, join requests, page shares owned by the user, and AI credentials are removed; `page_shares.granted_by` and `workspace_emojis.created_by` are reassigned to the deleting administrator. Same last-admin 409. Instance administrator only.
- GET `/api/admin/workspaces` → `{workspaces:[{id,slug,name,memberCount,createdAt}]}`. Metadata only — no `pageCount`, page ids or titles (permissions law). Instance administrator only.
- POST `/api/admin/workspaces` `{name,slug}` → Workspace (creator admin). Instance administrator only. Never governed by `workspaceCreation` — a disabled instance can still get a first workspace here.
- POST `/api/admin/email-test` `{email}` → `{ok:true,backend}` or 503 `{error,backend}`. Instance administrator; rate limit 10/hour per account. `backend` is `injected` | `development` | `smtp` | `resend` | `""` and mirrors `send()` selection (SMTP wins over a residual Resend key).
- POST `/api/auth/logout` → `{ok:true}` revokes current session.
- GET `/api/workspaces` → `{workspaces:Workspace[]}` (signed in memberships).
- POST `/api/workspaces` `{name,slug}` → Workspace (creator admin). Subject to instance `workspaceCreation`: `anyone` (any signed-in user), `admins_only` (instance administrator; 403 otherwise), or `disabled` (403 for everyone, including instance administrators — use `POST /api/admin/workspaces` instead). Rate limit 10/hour per account.
- GET `/api/workspaces/:slug` → `{id,slug,name,role:null|Role,joinStatus:null|"pending"|"approved"|"rejected"}`. Anonymous permitted.
- POST `/api/workspaces/:slug/join-requests` `{message?:string}` → `{ok:true,status:"pending"}`.
- GET `/api/workspaces/:slug/members` → `{members:[{id,email,role}]}` (members).
- PATCH `/api/workspaces/:slug/members/:userID` `{role}` → `{ok:true}` (admin; last admin protected).
- DELETE `/api/workspaces/:slug/members/:userID` → `{ok:true}` (admin; last admin protected).
- GET `/api/workspaces/:slug/join-requests` → `{requests:[{id,userId,email,message,status,createdAt}]}` (admin).
- POST `/api/workspaces/:slug/join-requests/:requestID/approve` `{role?:"member"|"viewer"}` → `{ok:true}` (admin).
- POST `/api/workspaces/:slug/join-requests/:requestID/reject` `{}` → `{ok:true}` (admin).
- GET `/api/workspaces/:slug/invites` → `{invites:[{id,email,role,status,expiresAt}]}` (admin).
- POST `/api/workspaces/:slug/invites` `{email,role?:"member"|"viewer",message?:string}` → `{ok:true}`. The optional message is a plain-text delivery note limited to 2,000 Unicode characters; it is included in the email and is not retained in the invitation record. Sends invitation email containing app link; verified email's pending invitations auto-accept on login. No token in URL.
- DELETE `/api/workspaces/:slug/invites/:inviteID` → `{ok:true}` (admin revoke).
- GET `/api/workspaces/:slug/index` → `{pages:DesktopPage[],trash:DesktopPage[],revision:number,access:Record<pageID,{level:"view"|"edit"|"full",sharedRoot?:true}>}`. Only pages the caller may view are listed. A listed page whose parent is not visible is returned with `parentId:null` and `access[id].sharedRoot=true`; it is detached for display only and keeps its real parent server side.
- PUT `/api/workspaces/:slug/index` `{pages,trash,revision}` → `{revision:number}` (CAS; 409 on stale revision; member/admin). Page IDs unique across service. New IDs create empty documents. The body is partial by construction — a caller can only send what they can see — so an omitted page is tombstoned **only** when the caller resolves to `edit` or above on it; anything else keeps its content and its relative rank. Naming a known page the caller cannot view answers 403. A page returned detached by GET (`sharedRoot`) keeps its real parent unless the body names a different one, which stays a deliberate move. A new page is created `workspace` at the root and `inherit` under a parent; the index never rewrites an existing page's visibility. Content goes through Blok collaboration, not this API.
- GET `/api/workspaces/:slug/pages/:pageID` → OutputData or null (read projected checkpoint; current live state via Blok `/state`). A page the caller may not view answers 404, never 403: a 403 would confirm that the page exists.
- GET `/api/workspaces/:slug/ticket?doc=:pageID` → `{ticket:string}`. Write is scoped per page, not per workspace role: the ticket grants writing when the caller resolves to `edit` or above on that page. A page the caller may not view answers 404. Ticket valid 60 seconds; session and permissions rechecked by Blok authorization.

- GET `/api/workspaces/:slug/pages/:pageID/access` → `{visibility,effectiveVisibility,myLevel,shares:[{userId,email,level}],inherited:[{userId,email,level,from:pageID}]}`. Needs `view`; a page the caller cannot see answers 404. Own shares are removable here; inherited ones only on the page named by `from`.
- PUT `/api/workspaces/:slug/pages/:pageID/access` `{visibility:"inherit"|"private"|"workspace"}` → `{ok:true}`. Needs `full`.
- PUT `/api/workspaces/:slug/pages/:pageID/shares/:userID` `{level:"view"|"edit"|"full"}` → `{ok:true}`. Needs `full`; the target must already be a workspace member, else 404.
- DELETE `/api/workspaces/:slug/pages/:pageID/shares/:userID` → `{ok:true}`. Needs `full`. Removing the last `full` on a page that is not open to the workspace answers 409: nobody, administrators included, could govern it afterwards.

Every one of these rechecks live document access, so an open collaboration session closes on revocation rather than waiting for a reload. Removing a member deletes their page shares in the same transaction.

Writing. Duplicating needs `view` on the source **and** `edit` on the target parent, both answered as 404. Seeding needs `edit` on the page, 404 when it is not even visible. Creating a page — through the index, `blok_create_page` or duplication — grants its author `full` on it, so sharing is not an administrator's privilege; it does not make the page private, which still follows the visibility rules below.

Page permissions. Each page carries a `visibility` of `inherit`, `private` or `workspace`, and may grant named people a `view`, `edit` or `full` level. A page resolves to `min(role ceiling, max(inherited workspace base, shares along its parent chain))`. The ceiling is `view` for a viewer and `full` otherwise; the workspace base is `edit` for a member and `full` for an admin. A ceiling grants nothing on its own, so an admin does not reach other people's private pages. A new page is `workspace` at the root and `inherit` under a parent. A duplicate keeps its source's visibility and grants the duplicator `full`. Private files follow their page: `/files/` and `/api/assets/url` refuse an asset whose `document_id` the caller cannot view, while an asset with no page — workspace emoji or cover — stays shared with members.

Workspace = `{id,slug,name,role}`. A fresh instance starts with zero workspaces; optional `BOOTSTRAP_WORKSPACE_SLUG` / `BOOTSTRAP_WORKSPACE_NAME` (with `BOOTSTRAP_ADMIN_EMAIL`) may seed one at startup.

## Hosted MCP

`blok_upload_image` accepts `{workspace:slug,dataUrl}` for PNG, JPEG, GIF or WebP images up to 5 MiB. It requires workspace write access, stores the image in the existing persistent private asset volume, and returns `{url:"/files/..."}` for use in document content. Remote URLs and SVG are refused; the host never fetches the source.

`POST /mcp` is a stateless Streamable HTTP MCP endpoint on the same HTTPS origin. Each caller must send `Authorization: Bearer <personal MCP token>`; browser cookies, native session tokens and cross-origin browser requests do not authorize MCP calls. A signed-in user creates and revokes dedicated tokens in **Mon compte → Accès MCP**. Tokens are displayed only at creation, hashed in PostgreSQL and expire after 90 days. Treat them as passwords. The MCP server checks the user's current workspace membership and role on each request and document operation.

- GET `/api/mcp/tokens` → `{tokens:[{id,label,createdAt,expiresAt,lastUsedAt}]}`. The token secret is never returned.
- POST `/api/mcp/tokens` `{label}` → `{id,label,token,createdAt,expiresAt}`. Requires an authenticated web or native session; maximum 10 active tokens per account and 10 creations per hour.
- DELETE `/api/mcp/tokens/:id` → `{ok:true}`. Only the owner may revoke a token; revocation takes effect on the next MCP request.
- POST `/api/mcp/tokens/:id/rotate` → `{id,label,token,createdAt,expiresAt}`. Atomically invalidates the old token and returns a fresh one, shown only once. Only the owner may rotate it.

Alongside Blok's document editing tools, the host serves `blok_list_workspaces`, `blok_list_pages` (`{workspace:slug}`), and `blok_create_page` (`{workspace:slug,title,parentId?:pageID}`). Creating a page updates its workspace index and creates an empty document atomically. Viewers may list/read but cannot create or edit; nonmembers cannot list pages. `blok_list_pages` and the document editing tools apply page permissions: a token carries its owner's access and nothing more. The MCP endpoint is served by the existing Go app and reverse proxy, with no additional published port.

- POST `/api/workspaces/:slug/pages/:pageID/seed` `{document:OutputData}` → `{ok:true}`. For new pages after adding metadata to index, before opening collaboration. Requires writer; 409 if content exists or any ticket has been issued. Await seed before opening the page; never fall back to overwriting projected JSON.
- POST `/api/workspaces/:slug/pages/:pageID/duplicate` `{id:newPageID,title,parentId:null|string}` → `{id,revision}`. Copies the live Blok `/state` snapshot and metadata into a new page atomically; caller reloads index. Does not clone child pages.
- GET `/api/assets/url?url=<stored asset URL>` → `{url}` private 60-second session-bound asset grant for native image rendering. Web asset URL uses HttpOnly cookie. Every file fetch rechecks session and workspace ACL.

`GET /api/blok-ticket?doc=:pageID` is the shared ticket endpoint. Blok services are `/api/blok`, including `/sync/:pageID/state`; HTTP services use ticket as Bearer plus allowed Origin, WebSockets use ticket in Sec-WebSocket-Protocol.

## OpenAI assistant

All AI routes require current workspace membership. Personal credentials belong to the signed-in **account across this server**, shared credentials to the current workspace. Personal credentials always take precedence. An invalid, rejected or unreadable personal key returns an error and never falls back to the shared key. Deleting the personal credential explicitly restores shared-key selection.

- GET `/api/workspaces/:slug/ai` → `{personal:{configured:boolean,model:string},workspace:{configured:boolean,model:string},effective:{source:"personal"|"workspace"|"none",model:string},canManageWorkspace:boolean}`. Keys and encrypted values are never returned.
- PUT `/api/workspaces/:slug/ai/credentials` `{scope:"personal"|"workspace",apiKey?:string,model?:string}` → `{ok:true}`. At least one field is required. A supplied API key must be nonempty; a model-only update preserves the existing encrypted key atomically. Model may be empty to clear the model choice. Model-only records do not count as configured credentials. Workspace scope requires administrator privileges; personal scope only updates the caller's account.
- DELETE `/api/workspaces/:slug/ai/credentials?scope=personal|workspace` → `{ok:true}`. Removes the key and selected model together. Shared deletion requires administrator privileges.
- GET `/api/workspaces/:slug/ai/models?scope=personal|workspace` → `{models:[{id:string}],source:"personal"|"workspace"}`. Explicit shared scope requires an administrator. Omit scope to list the caller's effective credential's models, including shared models used by members. The catalog is sorted/deduplicated and removes obvious non-text families. Catalog access does not guarantee Responses compatibility; unsupported models produce a sanitized error.
- POST `/api/workspaces/:slug/ai/respond` `{model?:string,system:string,messages:[{role:"user"|"assistant",content:string}]}` → `{text:string,model:string,source:"personal"|"workspace"}`. Uses the effective key and its saved model unless an explicit model is provided. No default model is chosen automatically. Prompts/conversation content are not persisted by this host.

Limits: 32 messages, 16 KiB of instructions, 64 KiB total input text, 4,096 generated tokens (including reasoning), 64 KiB returned text, 60-second response timeout, two simultaneous response requests per account and 30 provider requests per minute per account (model listings included). Rate limits survive login/session changes and restarts. Incomplete generation returns an explicit French error; provider bodies, errors and keys are never echoed or logged. Error codes include 400 invalid input/model, 403 insufficient permissions, 409 no configured key, 422 provider rejection, 429 rate/usage limit, 502 provider/incomplete output and 504 timeout/cancellation.

The host calls only the fixed OpenAI [Responses endpoint](https://developers.openai.com/api/reference/resources/responses/methods/create) with `store:false` and `max_output_tokens`, and the [Models endpoint](https://developers.openai.com/api/reference/resources/models/methods/list). It accepts no provider URL, redirects, arbitrary tools or request parameters from clients. `store:false` controls response storage in that API; this host does not claim it changes all provider retention policies.

## Workspace images and custom emoji

Workspace members can read custom emoji; members and administrators can upload images and add emoji. Viewers cannot change them. Uploaded images live in the existing `DATA_DIRECTORY/uploads` volume, and asset ownership and emoji records persist in PostgreSQL. Files use the same workspace membership checks and session-bound grants as document assets.

- POST `/api/workspaces/:slug/images` `{dataUrl}` → 201 `{url}`. Upload a PNG, JPEG, GIF or WebP image up to 5 MiB for a page cover. The returned `/files/...` URL is persistent; resolve it through `/api/assets/url` for native clients, and never persist the temporary signed grant in page metadata.
- GET `/api/workspaces/:slug/emojis` → `{emojis:[{id,name,url,createdBy,createdAt}]}` ordered by name.
- POST `/api/workspaces/:slug/emojis` `{name,dataUrl}` or `{name,url}` → 201 `{id,name,url,createdBy,createdAt}`. Upload limit is 2 MiB; external image URLs must use HTTPS. The host does not fetch external URLs. Names are normalized to lowercase and use 1–64 ASCII letters, digits, underscores or hyphens; the first character must be a letter or digit. Names are unique per workspace; duplicates return 409.
- DELETE `/api/workspaces/:slug/emojis/:id` → `{ok:true}`. Only the creator or a workspace administrator can remove an emoji. Its uploaded file remains available to existing page icons and document history.

Uploads accept base64 data URLs whose declared type matches the detected PNG/JPEG/GIF/WebP bytes. SVG and other active content are rejected. Both image and emoji routes accept a workspace ID in place of its slug. Page cover metadata can retain a gallery key, an uploaded asset URL, or an HTTPS image URL.

Private page creation: a new root page in `PUT /api/workspaces/:slug/index` may include `initialVisibility: "private"`. The server atomically creates it as private and grants its author full access. This transient field is not stored and cannot change the visibility of an existing page; use the page access endpoint for existing pages.
