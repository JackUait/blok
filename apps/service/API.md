# Cloud API contract
All paths relative to configured HTTPS API origin. JSON errors `{error:string}`. Web uses HttpOnly SameSite=Lax cookie; native uses `Authorization: Bearer <token>` in OS secure storage. Send `client:"desktop"` only for native code verification. Mutating web requests require same origin (Origin checked). IDs opaque strings. Workspace route identifier is slug. Roles `admin`, `member`, `viewer`.

- POST `/api/auth/request-code` `{email}` → `{ok:true}`; SMTP delivery; code expires in 10 minutes.
- POST `/api/auth/verify-code` `{email,code,client?:"desktop"}` → `{user:{id,email},workspaces:Workspace[],token?:string}`. Desktop token returned only for desktop, web cookie otherwise.
- GET `/api/session` → `{user,workspaces}`; 401 when logged out.
- POST `/api/auth/logout` → `{ok:true}` revokes current session.
- GET `/api/workspaces` → `{workspaces:Workspace[]}` (signed in memberships).
- POST `/api/workspaces` `{name,slug}` → Workspace (creator admin).
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
- GET `/api/workspaces/:slug/index` → `{pages:DesktopPage[],trash:DesktopPage[],revision:number}`.
- PUT `/api/workspaces/:slug/index` `{pages,trash,revision}` → `{revision:number}` (CAS; 409 on stale revision; member/admin). Page IDs unique across service. New IDs create empty documents; omitted pages kept inaccessible (tombstoned). Content goes through Blok collaboration, not this API.
- GET `/api/workspaces/:slug/pages/:pageID` → OutputData or null (read projected checkpoint; current live state via Blok `/state`).
- GET `/api/workspaces/:slug/ticket?doc=:pageID` → `{ticket:string}` (read/member write scoped). Ticket valid 60 seconds; session and membership rechecked by Blok authorization.

Workspace = `{id,slug,name,role}`. Default slug `tousambassadeurs`.

## Hosted MCP

`blok_upload_image` accepts `{workspace:slug,dataUrl}` for PNG, JPEG, GIF or WebP images up to 5 MiB. It requires workspace write access, stores the image in the existing persistent private asset volume, and returns `{url:"/files/..."}` for use in document content. Remote URLs and SVG are refused; the host never fetches the source.

`POST /mcp` is a stateless Streamable HTTP MCP endpoint on the same HTTPS origin. Each caller must send `Authorization: Bearer <personal MCP token>`; browser cookies, native session tokens and cross-origin browser requests do not authorize MCP calls. A signed-in user creates and revokes dedicated tokens in **Mon compte → Accès MCP**. Tokens are displayed only at creation, hashed in PostgreSQL and expire after 90 days. Treat them as passwords. The MCP server checks the user's current workspace membership and role on each request and document operation.

- GET `/api/mcp/tokens` → `{tokens:[{id,label,createdAt,expiresAt,lastUsedAt}]}`. The token secret is never returned.
- POST `/api/mcp/tokens` `{label}` → `{id,label,token,createdAt,expiresAt}`. Requires an authenticated web or native session; maximum 10 active tokens per account and 10 creations per hour.
- DELETE `/api/mcp/tokens/:id` → `{ok:true}`. Only the owner may revoke a token; revocation takes effect on the next MCP request.
- POST `/api/mcp/tokens/:id/rotate` → `{id,label,token,createdAt,expiresAt}`. Atomically invalidates the old token and returns a fresh one, shown only once. Only the owner may rotate it.

Alongside Blok's document editing tools, the host serves `blok_list_workspaces`, `blok_list_pages` (`{workspace:slug}`), and `blok_create_page` (`{workspace:slug,title,parentId?:pageID}`). Creating a page updates its workspace index and creates an empty document atomically. Viewers may list/read but cannot create or edit; nonmembers cannot list pages. The MCP endpoint is served by the existing Go app and reverse proxy, with no additional published port.

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
