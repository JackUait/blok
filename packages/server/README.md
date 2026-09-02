# @bloklabs/server

Blok's shared C# server handles file uploads, link previews and live collaboration. Use it inside an ASP.NET Core app, or run the same routes as a standalone npm binary or Docker image.

Documents stay yours: saving and loading them is a small endpoint in your own app, and that endpoint remains the record. With live collaboration on, the service keeps only a working copy of each open document, in storage you point it at, and writes what people type back to your endpoint every few seconds. The packages include no database-block or MySQL integration; those follow this delivery migration.

## ASP.NET Core

Install the public integration package. NuGet brings in `Blok.Server` transitively.

```bash
dotnet add package Blok.Server.AspNetCore
```

Register the services, use your application's authorization policy, and map the routes under one prefix:

```csharp
using Blok.Server.AspNetCore;

builder.Services.AddBlokServer(options =>
{
  options.StorageDirectory = "./blok-uploads";
  options.PublicUrl = "https://uploads.example.com/files";
  options.UnfurlDisabled = false;
});

var app = builder.Build();

app.MapBlokServer("/api/blok").RequireAuthorization();
app.Run();
```

The mapped group uses your ASP.NET Core authorization policy for upload and unfurl routes. Health and validated CORS preflight remain anonymous.

In-process defaults expose health only. Storage and outbound routes must be enabled explicitly, and local storage requires an explicit valid `PublicUrl`. `AddBlokServer(options => { ... })` also accepts the origin, upload-limit, and S3 settings used by the standalone host.

## Standalone

Run the self-contained host through npm:

```bash
npx @bloklabs/server --listen 127.0.0.1:4000
```

The npm package is a small wrapper. On first run it downloads the C# host for macOS, Windows or Linux (including Alpine/musl), verifies it against `checksums.txt`, and caches it. Both x64 and arm64 are published.

The same host is available at the existing image name. In proxy mode it must stay on loopback, so this example uses the host network. The named volume keeps uploads in the image's writable `/data` directory:

```bash
docker run --rm \
  --network host \
  --mount type=volume,source=blok-server-data,target=/data \
  ghcr.io/jackuait/blok-server \
  --listen 127.0.0.1:4000 \
  --auth proxy \
  --storage-dir /data \
  --public-url https://uploads.example.com/files
```

For an internet-facing deployment, use ticket authentication and publish the container port only on loopback for the local reverse proxy:

```bash
docker run --rm \
  -p 127.0.0.1:4000:4000 \
  --mount type=volume,source=blok-server-data,target=/data \
  -e BLOK_SECRET \
  ghcr.io/jackuait/blok-server \
  --listen 0.0.0.0:4000 \
  --auth ticket \
  --allow-origin https://myapp.com \
  --storage-dir /data \
  --public-url https://uploads.example.com/files
```

Set `BLOK_SECRET` to a random value of at least 32 characters. Put the service behind a reverse proxy or hosting platform that terminates TLS before forwarding plain HTTP to it; the host does not manage certificates. The process refuses unsafe public configurations instead of starting with a warning.

The same service, with live collaboration:

```bash
docker run \
  -p 127.0.0.1:4000:4000 \
  --mount type=volume,source=blok-server-data,target=/data \
  --mount type=volume,source=blok-collab,target=/collab \
  -e BLOK_SECRET \
  -e BLOK_DOC_ENDPOINT_AUTH \
  ghcr.io/jackuait/blok-server \
  --listen 0.0.0.0:4000 \
  --auth ticket \
  --allow-origin https://myapp.com \
  --storage-dir /data \
  --public-url https://blok.myapp.com/files \
  --collab \
  --collab-dir /collab \
  --doc-endpoint https://myapp.com/api/documents
```

`--collab` turns the sync routes on. `--doc-endpoint` names the routes in your own app the service loads a document from and writes it back to; `BLOK_DOC_ENDPOINT_AUTH` holds the header value those routes expect, sent verbatim on every call. `--collab-dir` (or `--collab-s3-prefix`) is where the working copy lives; it holds document content, so it must not be publicly readable and may not sit inside `--storage-dir`, where everything is served. In-process, the same switches are `options.CollabEnabled` and `options.DocEndpoint`, and the app must call `app.UseWebSockets()` before `MapBlokServer`.

## Point the editor at it

```ts
import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  server: '/api/blok',
});
```

One key fills in the uploader and the link-preview endpoint. Anything you set yourself wins, so uploading into your own storage while keeping previews here needs no extra wiring.

The standalone host uses routes at the root. An ASP.NET Core app uses the prefix passed to `MapBlokServer`.

## Access passes

A standalone host cannot see who your user is, so your own backend vouches for them with a short-lived pass:

```ts
import { blokTicket } from '@bloklabs/server/ticket';

export async function GET() {
  const session = await getSession();

  if (!session) {
    return new Response('Not signed in', { status: 401 });
  }

  return Response.json({
    ticket: blokTicket(process.env.BLOK_SECRET, { user: session.userId, write: true }),
  });
}
```

```ts
new Blok({
  holder: 'editor',
  server: 'https://blok.myapp.com',
  ticket: '/api/blok-ticket',
});
```

The editor caches the pass and replaces it ahead of expiry, and uploads and link previews share the same one.

A pass is a plain HS256 JWT carrying `user`, `doc`, `write` and `exp`, signed with the secret the service runs with (at least 32 characters). Any backend can mint one with its own JWT library — `blokTicket` exists so a JavaScript one does not have to. Routes running inside your own ASP.NET app need none of this: they already know who the caller is.

## Routes

| Route | What it does |
| --- | --- |
| `GET /health` | Reports liveness and the running version |
| `GET /unfurl?url=…` | Reads title, description, and image metadata |
| `POST /upload` | Stores an uploaded file |
| `POST /upload-by-url` | Fetches and stores a remote file; the request media type must be `application/json` |
| `GET /sync/{doc}` | WebSocket; the editor's live collaboration connection to one document (with `--collab`) |
| `POST /sync/{doc}/reset` | Drops the working copy, reloads the document from your endpoint and tells every open tab to pick it up |
| `POST /sync/{doc}/edit` | Inserts, updates or removes blocks from outside; all-or-nothing, and reaches every open tab |

Upload routes exist only when local or S3-compatible storage is configured. Consumer-supplied URLs pass through one guarded outbound client that blocks private and cloud-metadata addresses. Send `POST /upload-by-url` a `{"url":"..."}` body with an `application/json` media type; parameters such as `charset=utf-8` are allowed, but JSON suffix types are not.

A request that carries `Origin` must match an allowed origin in every auth mode. In `none` and `proxy`, a genuinely originless backend request remains allowed, but an originless browser request carrying `Sec-Fetch-Site: cross-site` is rejected. `ticket` always requires an allowed `Origin`. A ticket with `write: false` may call `GET /unfurl` and open `GET /sync/{doc}` read-only; both upload routes, `reset` and `edit` require `write: true`. The `doc` claim scopes the collaboration routes: `/sync/{doc}`, its `reset` and its `edit` are refused when the pass names no document or a different one. The upload and unfurl routes ignore it, so a pass minted for one page works for every upload and preview that page can make.

## Quality gates

The .NET solution keeps three test layers: `Blok.Server.Tests` for core behavior, `Blok.Server.AspNetCore.Tests` for in-process integration, and `Blok.Server.Host.Tests` for real-process end-to-end behavior. CI also runs the cross-runtime conformance and package smoke tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes
dotnet restore packages/server/dotnet/Blok.Server.slnx
```

CI collects merged production coverage and requires at least 80% line and 80% branch coverage. It also runs the SDK analyzers with warnings as errors, audits all direct and transitive NuGet packages, scans committed secrets with Gitleaks, scans the server tree and built image with Trivy, and analyzes C# with CodeQL. Dependabot keeps NuGet, Docker, and GitHub Actions dependencies current.

## Docs

Full configuration and deployment guidance: [https://blokeditor.com/docs](https://blokeditor.com/docs)
