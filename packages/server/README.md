# @bloklabs/server

Blok's shared C# server handles file uploads, link previews and live collaboration, and converts saved documents. Use it inside an ASP.NET Core app, or run the same routes as a standalone npm binary or Docker image.

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

## Convert documents

`Blok.Server` carries Blok's own serializer as an embedded JavaScript bundle and runs it in this process, so a document converts through the editor's implementation rather than a port of it. A port has to be taught every block Blok gains and silently drops the ones nobody remembered.

Conversion needs no storage, no outbound access and no route, so it registers on its own:

```csharp
using Blok.Server.Documents;

builder.Services.AddBlokDocuments();
```

`AddBlokServer` already includes it. Outside dependency injection, `BlokDocuments.Create()` returns the same thing.

```csharp
public sealed class ArticleExport(IBlokDocumentConverter blok, ILogger<ArticleExport> logger)
{
  public async Task<string> ToMarkdownAsync(string documentJson, CancellationToken ct)
  {
    var conversion = await blok.ToMarkdownAsync(documentJson, ct);

    foreach (var warning in conversion.Warnings)
    {
      // e.g. construct "callout", action "degraded", detail "rendered as a blockquote…"
      logger.LogInformation("{Construct} {Action}: {Detail}", warning.Construct, warning.Action, warning.Detail);
    }

    return conversion.Markdown;
  }
}
```

| Method | Returns |
|--------|---------|
| `ToMarkdownAsync` | the Markdown, plus every construct Markdown could not carry |
| `ToHtmlAsync` | the document's HTML |
| `ToPlainTextAsync` | the document's readable text |
| `FromMarkdownAsync` | the saved document, plus what Markdown could not carry into it |
| `ExtractTextsAsync` / `InjectTextsAsync` | the document's translatable strings, and the document with them put back |
| `GetVersionAsync` | the `version` the editor stamps into a saved document |
| `GetSchemaAsync` | the saved format as JSON Schema (draft 2020-12) |

### Translate a document without handing a model its JSON

A model asked to translate a document's JSON breaks the structure — it drops
ids, reorders blocks, invents fields. Take the strings out instead, translate
the list, and put it back; the model never sees the structure, so it cannot
break it.

```csharp
var texts = await blok.ExtractTextsAsync(documentJson, cancellationToken: ct);
var translated = await TranslateAsync(texts, ct);       // your own model call
var document = await blok.InjectTextsAsync(documentJson, translated, cancellationToken: ct);
```

The list is in document order, skips empty values, and holds no URLs — nor a
file's name, which is what the reader downloads rather than prose. Code blocks
are out by default; pass `includeCode: true` to both calls if you want them.
A list whose length does not match the document is an `ArgumentException`
rather than a silently misplaced translation, and a block too malformed to read
is carried through untouched — the result of `InjectTextsAsync` is what you
store.

### Stamp the version the editor stamps

`version` in a saved document is whatever wrote it. A service writing documents
outside the browser should ask rather than invent a number, or the same column
ends up holding two different answers:

```csharp
var document = new JsonObject
{
  ["time"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
  ["blocks"] = blocks,
  ["version"] = await blok.GetVersionAsync(ct),
};
```

Markdown cannot express every block — a callout becomes a blockquote, columns flatten, a spacer disappears — so both directions report what changed. A caller handing the result to something that cannot ask a follow-up question, an export or a model, should read that report rather than assume the round trip was lossless.

An instance holds a pool of engines and is expensive to construct — every engine parses the embedded bundle, about a second in total — so register one for the lifetime of the process. `AddBlokDocuments` builds it at startup rather than during the first request; pass `warmUp: false` where a host starts often and converts rarely, such as a test host. The pool size bounds how many documents convert at once; further callers wait. A conversion is bounded by a timeout and a recursion limit, so a pathological document fails rather than wedging the process.

## Standalone

Run the self-contained host through npm:

```bash
npx @bloklabs/server --listen 127.0.0.1:4000
```

The npm package is a small wrapper. On first run it downloads the C# host for macOS, Windows or Linux (including Alpine/musl), verifies it against `checksums.txt`, and caches it. Both x64 and arm64 are published. The host is fully managed: every archive and the NuGet package are built from managed code alone, with no native library, so there is no extraction directory and nothing to set for a service account with no home.

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

`--collab` turns the sync routes on. `--doc-endpoint` names the routes in your own app the service loads a document from and writes it back to; `BLOK_DOC_ENDPOINT_AUTH` holds the header value those routes expect, sent verbatim on every call, and it has to be a single line: a value carrying a carriage return or newline refuses to start rather than losing the header on every call. `--collab-dir` (or `--collab-s3-prefix`) is where the working copy lives; it holds document content, so it must not be publicly readable and may not sit inside `--storage-dir`, where everything is served. In-process, the same switches are `options.CollabEnabled` and `options.DocEndpoint`, and the app must call `app.UseWebSockets()`.

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
| `POST /sync/{doc}/edit` | Inserts, updates or removes blocks from outside; all-or-nothing, reaches every open tab, and requires an idempotency key |

`POST /sync/{doc}/edit` needs one `Blok-Idempotency-Key` header with 1 to 128 printable ASCII characters. With an operation journal, retrying the same key returns the first result without applying it again; reusing it for different work receives 409. A 204 means the edit is durable and the response carries `Blok-Doc-Lineage` and `Blok-Doc-Sequence`. If that journal cannot commit, the endpoint returns 503 without relaying the edit. A working-copy-only service does not deduplicate the key or make reuse a 409: requests have ordinary retry behavior, and its 204 starts the existing write-back retry path.

Upload routes exist only when local or S3-compatible storage is configured. Consumer-supplied URLs pass through one guarded outbound client that blocks private and cloud-metadata addresses. Send `POST /upload-by-url` a `{"url":"..."}` body with an `application/json` media type; parameters such as `charset=utf-8` are allowed, but JSON suffix types are not.

A request that carries `Origin` must match an allowed origin in every auth mode. In `none` and `proxy`, a genuinely originless backend request remains allowed, but an originless browser request carrying `Sec-Fetch-Site: cross-site` is rejected. `ticket` always requires an allowed `Origin`. A ticket with `write: false` may call `GET /unfurl` and open `GET /sync/{doc}` read-only; both upload routes, `reset` and `edit` require `write: true`. The `doc` claim scopes the collaboration routes: `/sync/{doc}`, its `reset` and its `edit` are refused when the pass names no document or a different one. A collaboration pass must also name its `user`: `GET /sync/{doc}` closes one with an empty `user` as 4401 `pass names no user`, because the per-user connection cap and rate window key on that name. The upload and unfurl routes ignore it, so a pass minted for one page works for every upload and preview that page can make.

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
