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

builder.Services
  .AddBlokServer()
  .UseAuthorization<MyBlokAuthorization>();

var app = builder.Build();

app.MapBlokServer("/api/blok");
app.Run();
```

`MyBlokAuthorization` implements `IBlokAuthorization`, so access stays tied to the users already signed in to your app. `AddBlokServer(options => { ... })` also accepts the same storage, origin, upload-limit, and unfurl settings used by the standalone host.

## Standalone

Run the self-contained host through npm:

```bash
npx @bloklabs/server --listen 127.0.0.1:4000
```

The npm package is a small wrapper. On first run it downloads the C# host for your platform from the matching GitHub release, verifies it against `checksums.txt`, and caches it.

The same host is available at the existing image name. This loopback example uses the host network so the service is not exposed directly to the internet:

```bash
docker run --network host ghcr.io/jackuait/blok-server \
  --listen 127.0.0.1:4000 \
  --auth proxy
```

For an internet-facing deployment, use `--auth ticket`, set `BLOK_SECRET`, and provide `--allow-origin`. The process refuses unsafe public configurations instead of starting with a warning.

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
| `POST /upload-by-url` | Fetches and stores a remote file |

Upload routes exist only when local or S3-compatible storage is configured. Consumer-supplied URLs pass through one guarded outbound client that blocks private and cloud-metadata addresses.

## Docs

Full configuration and deployment guidance: [https://blokeditor.com/docs](https://blokeditor.com/docs)
