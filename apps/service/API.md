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
- POST `/api/workspaces/:slug/invites` `{email,role?:"member"|"viewer"}` → `{ok:true}`. Sends invitation email containing app link; verified email's pending invitations auto-accept on login. No token in URL.
- DELETE `/api/workspaces/:slug/invites/:inviteID` → `{ok:true}` (admin revoke).
- GET `/api/workspaces/:slug/index` → `{pages:DesktopPage[],trash:DesktopPage[],revision:number}`.
- PUT `/api/workspaces/:slug/index` `{pages,trash,revision}` → `{revision:number}` (CAS; 409 on stale revision; member/admin). Page IDs unique across service. New IDs create empty documents; omitted pages kept inaccessible (tombstoned). Content goes through Blok collaboration, not this API.
- GET `/api/workspaces/:slug/pages/:pageID` → OutputData or null (read projected checkpoint; current live state via Blok `/state`).
- GET `/api/workspaces/:slug/ticket?doc=:pageID` → `{ticket:string}` (read/member write scoped). Ticket valid 60 seconds; session and membership rechecked by Blok authorization.

Workspace = `{id,slug,name,role}`. Default slug `tousambassadeurs`.

- POST `/api/workspaces/:slug/pages/:pageID/seed` `{document:OutputData}` → `{ok:true}`. For new pages after adding metadata to index, before opening collaboration. Requires writer; 409 if content exists or any ticket has been issued. Await seed before opening the page; never fall back to overwriting projected JSON.
- POST `/api/workspaces/:slug/pages/:pageID/duplicate` `{id:newPageID,title,parentId:null|string}` → `{id,revision}`. Copies the live Blok `/state` snapshot and metadata into a new page atomically; caller reloads index. Does not clone child pages.
- GET `/api/assets/url?url=<stored asset URL>` → `{url}` private 60-second session-bound asset grant for native image rendering. Web asset URL uses HttpOnly cookie. Every file fetch rechecks session and workspace ACL.

`GET /api/blok-ticket?doc=:pageID` is the shared ticket endpoint. Blok services are `/api/blok`, including `/sync/:pageID/state`; HTTP services use ticket as Bearer plus allowed Origin, WebSockets use ticket in Sec-WebSocket-Protocol.
