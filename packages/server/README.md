# @bloklabs/server

Blok's shared C# server handles file uploads and link previews. Use it inside an ASP.NET Core app, or run the same routes as a standalone npm binary or Docker image.

The current packages store no documents and include no database-block or MySQL integration. Those features follow this delivery migration.

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

## Point the editor at it

```ts
import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  uploader: {
    async uploadByFile(file) {
      const body = new FormData();

      body.append('file', file);

      const response = await fetch('/api/blok/upload', {
        method: 'POST',
        body,
      });

      return response.json();
    },
  },
});
```

The standalone host uses routes at the root. An ASP.NET Core app uses the prefix passed to `MapBlokServer`.

## Routes

| Route | What it does |
| --- | --- |
| `GET /health` | Reports liveness and the running version |
| `GET /unfurl?url=…` | Reads title, description, and image metadata |
| `POST /upload` | Stores an uploaded file |
| `POST /upload-by-url` | Fetches and stores a remote file; the request media type must be `application/json` |

Upload routes exist only when local or S3-compatible storage is configured. Consumer-supplied URLs pass through one guarded outbound client that blocks private and cloud-metadata addresses. Send `POST /upload-by-url` a `{"url":"..."}` body with an `application/json` media type; parameters such as `charset=utf-8` are allowed, but JSON suffix types are not.

A request that carries `Origin` must match an allowed origin in every auth mode. In `none` and `proxy`, a genuinely originless backend request remains allowed, but an originless browser request carrying `Sec-Fetch-Site: cross-site` is rejected. `ticket` always requires an allowed `Origin`. A ticket with `write: false` may call `GET /unfurl`; both upload routes require `write: true`. The `doc` claim is reserved for future document-scoped routes and does not scope today’s file or unfurl routes.

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
