# @bloklabs/server

Blok's shared server is written in C#. It handles file uploads, link previews and live collaboration, and it converts saved documents. Use it inside an ASP.NET Core app, or run the same routes as a standalone npm binary or Docker image.

Your documents stay yours. Your own app saves and loads them through a small endpoint, and that endpoint stays the record. With live collaboration on, the service keeps only a working copy of each open document. The copy lives in storage you point it at. Every few seconds, the service writes what people type back to your endpoint.

Register an operation journal and that changes. The document keeps no working copy. The journal is where an edit becomes durable. Your endpoint's record is refreshed from a published checkpoint, on eviction and on drain, rather than on a timer. The packages include no database-block or MySQL integration; those follow this delivery migration.

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

`Blok.Server` embeds Blok's own serializer as a JavaScript bundle and runs it in this process. A document therefore converts through the editor's implementation, not a port of it. A port has to be taught every block Blok gains, and it silently drops the ones nobody remembered.

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
| `ToHtmlAsync(doc, pages, pageHref)` / `ToMarkdownAsync(doc, pages, pageHref)` | the same, with page titles, icons and links from your `BlokPageInfo` map: a `null` value shows "Page not found", `NoAccess` shows "No access", an id left out shows "Page"; `pageHref` is called only for allowed pages |
| `ToPlainTextAsync` | the document's readable text; `includeHiddenText: true` also emits an image's alt, a video/file url, an embed source, an audio title/artist/url and a bookmark description/url |
| `FromMarkdownAsync` | the saved document, plus what Markdown could not carry into it; rich text fields are segments |
| `FromHtmlAsync` | the saved document parsed out of HTML, plus what the HTML could not carry into it; rich text fields are segments |
| `ExtractTextsAsync` / `InjectTextsAsync` | the document's translatable strings, and the document with them put back |
| `GetPageIndexAsync` | the pages a document owns, the pages it links to, and each block's searchable text: the same rows as `pageIndex` in Node; raise the timeout for very large documents |
| `RemapPageDocumentAsync` | a copy of a page document under new block and page ids, to import next to the original; throws `ArgumentException` naming every block id your map misses |
| `GetVersionAsync` | the `version` the editor stamps into a saved document |
| `GetSchemaAsync` | the saved format as JSON Schema (draft 2020-12) |

### Import HTML

`FromHtmlAsync` is the inverse of `ToHtmlAsync`. It takes a fragment or a whole
document and parses the structural subset a document body is made of: headings,
paragraphs, lists (nested, ordered, checklists), tables (merged cells included),
images, links and inline marks, code, blockquotes, toggles and dividers. Tabs
written by `ToHtmlAsync` come back as tabs, with each tab's title, icon and
content. Other layout containers are unwrapped and their children converted in
place.

```csharp
var import = await blok.FromHtmlAsync(html, ct);

foreach (var warning in import.Warnings)
{
  // e.g. construct "iframe", action "dropped", detail "<iframe> and its contents are dropped…"
  logger.LogInformation("{Construct} {Action}: {Detail}", warning.Construct, warning.Action, warning.Detail);
}

await Store(import.DocumentJson, ct);
```

Read the warnings. Blok has no block for an embedded video, a form control or a
tag nobody has heard of, and every one of them comes back naming the tag rather
than disappearing. Storing the document without reading the report is how an
import loses content quietly.

### Translate a document without handing a model its JSON

A model asked to translate a document's JSON breaks the structure. It drops
ids, reorders blocks, and invents fields. Take the strings out instead,
translate the list, and put it back. The model never sees the structure, so it
cannot break it.

```csharp
var texts = await blok.ExtractTextsAsync(documentJson, cancellationToken: ct);
var translated = await TranslateAsync(texts, ct);       // your own model call
var document = await blok.InjectTextsAsync(documentJson, translated, cancellationToken: ct);
```

The list is in document order and skips empty values. It holds no URLs, and no
file's name either, since the name is what the reader downloads rather than
prose. Code blocks are out by default; pass `includeCode: true` to both calls
if you want them. A list whose length does not match the document is an
`ArgumentException` rather than a silently misplaced translation. A block too
malformed to read is carried through untouched. The result of `InjectTextsAsync`
is what you store.

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

Markdown cannot express every block. A callout becomes a blockquote, columns flatten, and a spacer disappears. Both directions therefore report what changed. A caller handing the result to something that cannot ask a follow-up question, such as an export or a model, should read that report rather than assume the round trip was lossless.

An instance holds a pool of engines and is expensive to construct. Every engine parses the embedded bundle, about a second in total. Register one for the lifetime of the process. `AddBlokDocuments` builds it at startup rather than during the first request. Pass `warmUp: false` where a host starts often and converts rarely, such as a test host. The pool size bounds how many documents convert at once; further callers wait. A conversion is bounded by a timeout, a per-call allocation budget and a stack guard, so a pathological document fails rather than wedging the process.

`allocationBudgetBytes` is allocation churn for ONE conversion, not resident memory. The runtime counts every allocation a call makes rather than what it still holds, and nothing is reserved. It defaults to 512 MiB because that is what a long article carrying inline markup, or one holding a large inline base64 image, was measured to need. A 700 KB article with a third of its fields marked up exhausted the old 64 MiB in every reader. Lower it only to bound a hostile document.

A conversion that fails throws `BlokDocumentConversionException`. Read its `Reason` rather than its message: `InvalidDocument` (not JSON, or JSON with no `blocks`), `TimedOut`, `DocumentTooLarge` (the allocation budget), `Unknown` (everything else). Nothing about the JavaScript engine reaches a caller, so explaining the failure to your own users needs no reference to it. Your own cancelled `CancellationToken` still arrives as `OperationCanceledException`, never as this.

A degradation report's `Action` is one of `BlokDegradationActions.Dropped` / `BlokDegradationActions.Degraded`. It stays an open string, so a Blok release naming a new outcome cannot fail deserialization in an app already deployed. Compare against the constants, and treat anything else as news.

## Standalone

Run the self-contained host through npm:

```bash
npx @bloklabs/server --listen 127.0.0.1:4000
```

The npm package is a small wrapper. On first run it downloads the C# host for macOS, Windows or Linux (including Alpine/musl), verifies it against `checksums.txt`, and caches it. Both x64 and arm64 are published. The host is fully managed. Every archive and the NuGet package are built from managed code alone, with no native library. There is no extraction directory, and nothing to set for a service account with no home.

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

`--collab` turns the sync routes on. `--doc-endpoint` names the routes in your own app that the service loads a document from and writes it back to. `BLOK_DOC_ENDPOINT_AUTH` holds the header value those routes expect, sent verbatim on every call. It has to be a single line: a value carrying a carriage return or newline refuses to start rather than losing the header on every call. `--collab-dir` (or `--collab-s3-prefix`) is where the working copy lives. It holds document content, so it must not be publicly readable, and it may not sit inside `--storage-dir`, where everything is served. In-process, the same switches are `options.CollabEnabled` and `options.DocEndpoint`, and the app must call `app.UseWebSockets()`.

Documents written to your endpoint carry rich text fields as segments, the shape the editor's `save()` returns. A document your endpoint returns may hold HTML strings or segments. A custom block tool's rich fields go in `--rich-text-fields` (or `BLOK_RICH_TEXT_FIELDS`; the flag wins), as JSON keyed by block type: `--rich-text-fields '{"callout":["title"]}'`. In-process, the same list is `options.RichTextFields`. List exactly the fields the tool declares in `static richTextFields` on the client, or the two write the field in different shapes. The built-in paragraph, header, quote, toggle and list `text` fields need no entry. See [Rich text is segments](#rich-text-is-segments).

Collaboration rooms are stored in format 2. Upgrade the service and the editor together. An older editor reads the format 2 room and ends its own session with `unsupported-format`. A room stored in format 1 is converted the first time it opens, and offline edits made in format 1 are not replayed.

Add `--collab-journal` (or set `BLOK_COLLAB_JOURNAL=true`) to keep an operation journal under `--collab-dir`. This turns on the acknowledged profile described below. It needs `--collab`. It is refused with `--collab-s3-prefix`: the journal is on this machine's disk, so a second instance sharing the bucket would not see it. In-process, the switch is `options.CollabJournal`. A store registered with `UseCollabOperationStore<T>()` replaces it. The first open of each document adopts its working copy as the journal's starting point, then deletes it, so nothing the working copy held is lost. Turning it off again is not a restart: follow [Going back to the working-copy profile](#going-back-to-the-working-copy-profile) first, or documents edited under the journal reopen as they were on the day you switched.

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

A pass is a plain HS256 JWT carrying `user`, `doc`, `write` and `exp`, signed with the secret the service runs with (at least 32 characters). A .NET backend mints one with `BlokTicket.Create` from the `Blok.Server` package:

```csharp
using Blok.Server.Tickets;

var ticket = BlokTicket.Create(secret, new BlokTicketClaims { User = userId, Doc = docId, Write = true });
```

`Blok.Server` also brings in Jint, AngleSharp and BouncyCastle, even when you only mint passes.

Any other backend can sign a pass with its own JWT library. The header must be exactly `{"alg":"HS256","typ":"JWT"}`, keys in that order and nothing added, because the server compares it byte for byte.

Passes are needed whenever the routes run with `Auth = "ticket"`, including routes mapped inside your own ASP.NET app. With `Auth` set to `none` or `proxy`, the routes never read a pass.

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
| `GET /sync/{doc}/state` | Returns the live document as JSON, with the journal head it reflects when there is a journal |
| `GET /sync/{doc}/history` | Lists the document's past versions as points; needs an operation journal |
| `GET /sync/{doc}/history/{lineage}/{sequence}` | Returns the document as it was at one point |
| `GET /sync/{doc}/history/{lineage}/{sequence}/changes` | Lists the edits inside one version, one row per journal record |
| `POST /sync/{doc}/history/{lineage}/{sequence}/restore` | Makes the live document match one point, as a forward edit; requires an idempotency key |
| `DELETE /sync/{doc}/history/{lineage}` | Deletes one lineage that is not current |

On a journal-backed service, `POST /sync/{doc}/reset` first adopts a working copy the journal does not hold yet and writes it back to your endpoint, so the reset rebaselines from a record that includes it. It then retires that working copy before it resets. If the retire fails, the reset answers 503 and changes nothing; retry it.

`POST /sync/{doc}/edit` needs one `Blok-Idempotency-Key` header with 1 to 128 printable ASCII characters. With an operation journal, retrying the same key returns the first result without applying it again; reusing it for different work receives 409. A 204 then means the edit is durable, and the response carries `Blok-Doc-Lineage` and `Blok-Doc-Sequence`. A working-copy-only service answers 204 without those headers and without that promise. If that journal cannot commit, the endpoint returns 503 without relaying the edit. A working-copy-only service does not deduplicate the key or make reuse a 409: requests have ordinary retry behavior, and its 204 starts the existing write-back retry path.

A rich text field in an edit may be an HTML string or segments. The service reads the HTML into segments before it applies anything. A rich text field is the `text` of a paragraph, header, quote, toggle or list block, plus every field in `--rich-text-fields`.

- If reading that HTML runs past the runtime's timeout, the edit answers 503 with `Retry-After` (2 seconds by default) and applies nothing. Retry with the same key.
- If that HTML runs out of the runtime's memory budget, the edit answers 413 and applies nothing. The budget is per request, so the same body fails every time. Do not retry it; send less rich text.
- HTML the reader refuses answers 422.

With a journal, an edit that changes nothing also answers 204. That covers the same data sent again, and rich text spelled differently, such as `<b>` for `<strong>` or `&nbsp;` for a space.

- Nothing is journalled. `Blok-Doc-Sequence` names the current head, not a new sequence.
- Nothing is recorded under the key. A retry with that key runs the edit again. If someone edited in between, the retry applies to the new document. A different body under the same key is not a 409.
- Send `If-Match` on every edit you may retry. Then a retry after the document moved answers 412 instead of applying.

A working-copy-only service never deduplicates, so there every retry runs again, and `If-Match` answers 428.

An edit may also send `If-Match: "<lineage>:<sequence>"`. It is one quoted tag, built from the `Blok-Doc-Lineage` and `Blok-Doc-Sequence` values exactly as the service prints them.

- With a journal, the edit applies only if the document is still at that head. Otherwise it answers 412 and applies nothing. The 412 carries the current `Blok-Doc-Lineage` and `Blok-Doc-Sequence`.
- A key that is already committed still returns its first result, even if its `If-Match` is now stale.
- A working-copy-only service has no head to check, so any `If-Match` answers 428 and applies nothing.
- A list, `*`, a weak tag, or any other shape answers 400, with or without a journal.
- A 412 commits nothing, so you may retry the same key with a fresh tag.

`GET /sync/{doc}/state` returns the live document as `application/json`, in the same shape your document endpoint receives, with rich text fields as segments. It includes edits made a moment ago. With a journal, it also sends `Blok-Doc-Lineage`, `Blok-Doc-Sequence` and `ETag: "<lineage>:<sequence>"`, naming the exact head the body reflects. Send that `ETag` back as `If-Match` to edit only if nothing changed in between. A working-copy-only service sends the body without those three headers. A purged document answers 403. A document that cannot be loaded, is held by another process, or is on a service that is shutting down answers 503. An export that ran past the runtime's timeout or allocation budget also answers 503, with `Retry-After` (2 seconds by default). A document the service cannot write as JSON answers 500.

`edit`, `state` and the history `restore` add `Blok-Doc-Lineage`, `Blok-Doc-Sequence` and `ETag` to `Access-Control-Expose-Headers` for an allowed origin, so a browser page can read them. Headers your app already exposes are kept.

Upload routes exist only when local or S3-compatible storage is configured. Consumer-supplied URLs pass through one guarded outbound client that blocks private and cloud-metadata addresses. Send `POST /upload-by-url` a `{"url":"..."}` body with an `application/json` media type; parameters such as `charset=utf-8` are allowed, but JSON suffix types are not.

A request that carries `Origin` must match an allowed origin in every auth mode. In `none` and `proxy`, a genuinely originless backend request remains allowed, but an originless browser request carrying `Sec-Fetch-Site: cross-site` is rejected. `ticket` always requires an allowed `Origin`.

A ticket with `write: false` may call `GET /unfurl`, `GET /sync/{doc}/state`, the three `GET` history routes and open `GET /sync/{doc}` read-only; both upload routes, `reset`, `edit`, the history `DELETE` and `restore` require `write: true`. The `doc` claim scopes the collaboration routes: `/sync/{doc}`, its `reset`, its `edit`, its `state` and its history routes are refused when the pass names no document or a different one. `state` and the three history reads ask your `IBlokAuthorization` for read access only. A collaboration pass must also name its `user`: `GET /sync/{doc}` closes one with an empty `user` as 4401 `pass names no user`, because the per-user connection cap and rate window key on that name. The upload and unfurl routes ignore it, so a pass minted for one page works for every upload and preview that page can make.

### Version history

A journal-backed document keeps its past. Five routes list it, read one version, list the edits inside one, restore one and delete old history. Blok ships the data and the routes. Your app builds the history UI.

A version is a point, the pair `(lineage, sequence)`. A lineage is one unbroken run of the journal. A reset, a first seed or the format migration starts a new one. Sequence 0 is the state the lineage started from. Store points in your own records, never positions in the list: the newest version keeps growing while people edit.

| Route | Access | Answer |
| --- | --- | --- |
| `GET /sync/{doc}/history` | read | `200 { lineages, versions }` |
| `GET /sync/{doc}/history/{lineage}/{sequence}` | read | `200 { time?, blocks }` with `Blok-History-Lineage` and `Blok-History-Sequence` |
| `GET /sync/{doc}/history/{lineage}/{sequence}/changes?since=` | read | `200 { changes, truncated? }` with `Blok-History-Lineage` and `Blok-History-Sequence` |
| `POST /sync/{doc}/history/{lineage}/{sequence}/restore` | read and write | As `edit`: `204` with the new `Blok-Doc-Lineage` and `Blok-Doc-Sequence` |
| `DELETE /sync/{doc}/history/{lineage}` | read and write | `204`; `404` for an unknown lineage; `409` for the current one |

The list looks like this:

```json
{
  "lineages": [{ "lineage": "…", "epoch": 2, "format": 2, "createdAt": 1760000000000, "current": true }],
  "versions": [{ "lineage": "…", "sequence": 41, "startedAt": 1760000000000, "savedAt": 1760000300000, "actors": ["u1"] }]
}
```

- Each lineage's baseline is a version at sequence 0.
- The records after it are grouped by time. A new group starts after a gap of more than 2 minutes, or once a group spans 10 minutes. A group's `sequence` is its last record, and `actors` lists the distinct actor ids in the order they first appear.
- `?group=1`, `?group=15` or `?group=60` sets both limits to that many minutes. A new group then starts after a gap of more than that window, or once a group spans it. Any other value answers 400, and so do an empty, signed or repeated `group`. The JSON shape does not change.
- Versions come newest first.
- Times are Unix milliseconds. An unknown time is `null`, and the point read leaves `time` out.

The point read's headers are deliberately not `Blok-Doc-*`. Those name the live head and feed `If-Match`. The point read and the changes read send no `ETag`. Both add `Blok-History-Lineage` and `Blok-History-Sequence` to `Access-Control-Expose-Headers` for an allowed origin. On the changes read they name the point in the path. Every answer from the history handlers sends `Cache-Control: no-store`. Guard refusals, 405 answers and preflights come from the route shell all routes share.

The changes read lists the edits inside one version. Pass `since` as the sequence of the next older version in the list you show. Only your app knows which grouping that list uses. The answer covers the records after `since`, up to and including `sequence`, oldest first. Without `since` it starts after 0.

```json
{
  "changes": [
    {
      "sequence": 12,
      "committedAt": 1760000000000,
      "actor": "u1",
      "blocks": [
        {
          "id": "a",
          "type": "paragraph",
          "kind": "changed",
          "before": { "id": "a", "type": "paragraph", "data": { "text": [{ "text": "one" }] } },
          "after": { "id": "a", "type": "paragraph", "data": { "text": [{ "text": "two" }] } }
        }
      ]
    },
    { "sequence": 13, "committedAt": 1760000004000, "actor": null, "blocks": [], "page": ["title", "values.k"] }
  ]
}
```

- Each journal record gets one row, even one with no visible edit. Its `blocks` is then empty.
- `actor` is always there. It is `null` when the record has none.
- A block's `kind` is `added`, `removed`, `changed` or `moved`. `before` is left out for `added`, and `after` for `removed`. Blocks have the same shape as in the point read.
- `changed` means the `type`, `data` or `tunes` differ. It wins over `moved`.
- `moved` means a new parent, or a place outside the largest set of its siblings that kept their relative order. It is the same move test `diffOutputData` uses. A changed block still counts toward that order.
- `page` lists the changed keys of the `page` map, such as `title` and `icon`. Then it lists changed tracked values as `values.<key>`. It is left out when nothing there changed.
- One answer holds at most 200 rows. Past that, it holds the newest 200 and adds `"truncated": true`. The key is left out otherwise.
- Sequence 0, or a `since` equal to the sequence, answers `{"changes":[]}`.

Restore is a forward edit, not a rewind. It runs inside the room, through the same path as `edit`, so every open tab sees it and the old versions stay listed.

- It needs a `Blok-Idempotency-Key`. A retry with the same key returns the first receipt. A missing or malformed key answers 400.
- It takes an optional `If-Match`, checked as for `edit`. A malformed tag answers 400. A stale tag answers 412 and changes nothing, even when the point no longer exists.
- A restore that changes nothing answers 204 at the current head.
- A restore whose update would not fit one sync frame answers 413 and changes nothing. The limit is `CollabMaxMessageBytes`. On the built-in journal it is also never above that journal's 1 MiB update limit.
- A planned change the converter refuses answers 422 and changes nothing.
- A block whose `type` or `tunes` changed is removed and inserted again.
- It also makes the `page` map (the built-in title and icon) and the `values` map (`history.track`) match the point. A key whose value differs is set to a copy. A key the point lacks is removed.
- That map patch is part of the same edit. It lands in the same single journal record and counts toward the 413 limit.
- A key whose value at the point is not plain JSON, such as a nested Yjs type, is left as it is.

The history routes can also answer the statuses below. The list has no lineage or sequence in its path, so it never answers 404.

| Status | When |
| --- | --- |
| 400 | The sequence is not an unsigned 64-bit whole number. Or the list's `group` is not 1, 15 or 60. Or the changes read's `since` is not a whole number, or is above the sequence. |
| 403 | The document was purged. |
| 404 | The lineage is unknown or is not 32 lowercase hex characters, or the sequence is past its durable head. |
| 500 | A stored manifest, ledger or journal could not be decoded, on the list too. Or a replay failed, or the export after it. The server logs it. |
| 501 | `history needs a journal that keeps it`: there is no journal, or your store does not keep history. |
| 503 with `Retry-After` | The converter failed for a moment, as on `state`. |

History needs a journal that keeps it. `--collab-journal` does. A store you register keeps history only if it also implements `ICollabOperationHistoryStore` (`Blok.Server.Collab`). The service finds it by a type check on your `ICollabOperationStore`, which does not change. The interface lists lineages, reads a baseline, streams record headers and records, and deletes a lineage. Its reads take no fence and no document lock, because a live room keeps writing while history is read. It also has `IsPurgedAsync`, which you must implement. It must answer without a lock, and it must still report a purge after a restart. Lineage values come from requests, so compare them and never build paths from them.

History starts at this release. The built-in journal never stored the lineage, epoch and format of the generations it finished before, so it cannot list them. Its oldest listed lineage is the one current when this release first touches the document.

Blok has no retention policy, and it never deletes history by itself. A lineage is kept whole or deleted whole. To trim, call `POST /sync/{doc}/reset`, then `DELETE` the lineage that was current before it. On the built-in journal, deleting the lineage just before the current one also gives up its fallback copy, which only matters after disk corruption.

## Rich text is segments

**Breaking.** Rich text fields leave the service as segments, not HTML. This covers the write-back `PUT` to your document endpoint and `GET /sync/{doc}/state`. Before, `data.text` was a string:

```json
{ "id": "p1", "type": "paragraph", "data": { "text": "a <b>bold</b> word" } }
```

Now it is a list of segments:

```json
{ "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "a " }, { "text": "bold", "marks": { "bold": true } }, { "text": " word" }] } }
```

What to change in your app:

- Your document endpoint must accept segments in rich text fields.
- It may keep serving HTML. The service reads HTML on the way in, from your endpoint and from `POST /sync/{doc}/edit`, and writes segments back.
- List your custom tools' rich text fields with `--rich-text-fields` or `options.RichTextFields`, the same list as each tool's `richTextFields`. A field missing from the list keeps the shape the service was handed: HTML sent to the service for it stays an HTML string.
- Upgrade the service and the editor together. Rooms are now format 2. An editor from before this change sees the new service announce format 2 and ends its own session with `unsupported-format`. The new editor does the same with an old service.

The first time the service opens a document stored in format 1, it moves it to format 2 once:

- every rich text field becomes formatted text, with every character and mark kept;
- the room gets a new lineage and `epoch + 1`;
- edits a format-1 editor saved offline are quarantined on that editor, not replayed.

If that move fails, the document stays in format 1. The service then holds the document off for a while (2 s at first, doubling up to 60 s). In that window, joins, edits and `/state` answer 503. The next open after the window tries again.

### Your own sync server

If you run your own server against Blok's sync protocol, it must speak format 2 too. See [blok-sync-v2.md](protocol/blok-sync-v2.md), type 100.

- Announce `"format":2` in the type-100 control frame. The editor closes a session that names any other format.
- Store each rich text field as a formatted `Y.XmlText`, one Yjs attribute per mark. A plain `Y.Text` in a rich field is read as format-1 HTML.
- When you move a room from format 1, mint a new `lineage` and announce `epoch + 1`. Keeping the old lineage would let format-1 offline edits replay into the format-2 room.
- `test/unit/server-conformance/blok-client-contract.test.ts` drives Blok's own collaboration provider against a server and expects format 2.

## Live collaboration profiles

`--collab` (or `options.CollabEnabled`) gives you the working-copy profile: the service keeps a working copy of every open document and writes it back to your document endpoint. Nothing keeps a record of the individual changes that produced it, so `POST /sync/{doc}/edit` cannot tell a retry from new work, and a socket gets no per-change receipt.

Registering an operation store, or `--collab-journal`, turns on the acknowledged profile. The journal becomes the record. Every accepted change is appended to it before it is broadcast. The edit route deduplicates its `Blok-Idempotency-Key`, and answers 409 for a key reused for different work. A socket that negotiated `blok-sync.v2` receives one acknowledgement per operation, naming the sequence it committed at. The standalone host's `--collab-journal` puts the built-in local journal under `--collab-dir`. It serves one instance only. The working set under `--collab-dir` or `--collab-s3-prefix` is not a journal. An app that runs more than one instance registers its own store. The store's own bodies are elided below. Writing them is the work, and the laws further down are what they have to keep; the registration is complete as written:

```csharp
using Blok.Server.AspNetCore;
using Blok.Server.Collab;

// One method on the store; the session it hands back carries the reads and
// every write, so nothing can be written without holding the document's fence.
public sealed class SqlCollabOperationStore(IConfiguration configuration) : ICollabOperationStore
{
  public ValueTask<CollabDocumentOpen> OpenAsync(
      string documentId,
      CancellationToken cancellationToken = default)
  {
    // Take the document's fence in one transaction, read its head, checkpoint
    // and journal tail back, and hand out a session that holds the lease.
  }
}

builder.Services
  .AddBlokServer(options =>
  {
    options.CollabEnabled = true;
    options.CollabDirectory = "./blok-collab";
    options.DocEndpoint = "https://myapp.com/api/documents";
  })
  .UseCollabOperationStore<SqlCollabOperationStore>();

var app = builder.Build();

app.UseWebSockets();
app.MapBlokServer("/api/blok").RequireAuthorization();
app.Run();
```

The store is resolved as a singleton and is used for several documents at once. A relational implementation is one document-head row plus an operations table with unique `(document, lineage, operationId)` and `(document, lineage, serverSequence)`.

What the service requires of it:

- **One live writer per document.** `OpenAsync` returns `CollabDocumentOpen.DocumentOpenElsewhere` while a live process holds the document, and it must be able to reclaim the fence of a holder that has died. Refusing whenever a holder record exists satisfies the first half, and locks the document forever the first time a process is killed. How liveness is decided is yours. An exclusive file the kernel releases when the process ends does it, and a store over SQL needs a lease with an expiry it renews.
- **The fence is re-verified on every call.** A session that has lost it throws `CollabOperationFenceLostException` from every method rather than writing, or answering, as if it still owned the document. An open may throw it too: reading a document back is not instantaneous, and another process may take the document meanwhile.
- **The read-back is linearizable.** An open observes every operation, checkpoint and reset committed under any earlier fence, including one committed microseconds before the previous holder died. A read that may lag its own writes hands back a stale head, and the room then reassigns a sequence that is already taken.
- **Durable means durable.** When `AppendAsync` completes with `Committed`, the record survives the process dying immediately afterwards. The room broadcasts the update and reports the save on the strength of that completion.
- **The id check and the sequence assignment are one atomic step.** No two operations receive the same sequence on one lineage, and no id is committed twice.
- **`FindCommittedAsync` answers from the durable index**, never from a memo of what this session appended. An append that threw may still have committed, and that retry is the one lookup a memo gets wrong. Its answer must match what `AppendAsync` would give for the same id.
- **A failure is thrown, not swallowed.** That includes an outcome the store cannot determine. The room then broadcasts nothing, acknowledges nothing, closes every member with `4503 commit unavailable, retry` and reloads from committed data; the producer retries the same operation id, and the duplicate check settles the unknown outcome.
- **`WriteCheckpointAsync` never touches history.** A `Through` that is not a committed sequence, or is below one already published, is `ArgumentOutOfRangeException`. Republishing at the sequence already published succeeds and changes nothing. That is both the retry after an unknown outcome, and what a periodic checkpointer does when nothing has advanced.
- **`ResetAsync` replaces the document atomically** with a new epoch, lineage and sequence-zero baseline, and is also how a document that has never been seeded is seeded. The caller owns the epoch law; a store may refuse a regression but never invents an epoch of its own.
- **Cancellation belongs to the caller.** A store-side timeout or abort surfaces as some other exception, because the caller reads a cancellation it did not ask for as its own shutdown.
- **Disposal releases the fence, unless it is already gone.** `DisposeAsync` lets another process open the document, and never throws because the fence was already lost; every method throws `ObjectDisposedException` afterwards. A session that HAS lost the fence releases nothing. The fence it would release now belongs to somebody else, so a `DisposeAsync` that unconditionally drops its lock row hands a third writer the document while the second is mid-write.

A backend that is not .NET implements the wire protocol instead of this interface. `packages/server/protocol/blok-sync-v2.md` is a normative spec written so a server outside this repository can be built from it alone, and the frame vectors it pins live in `test/unit/server-conformance/fixtures/sync-frames.json`. This repository's conformance runner builds and drives the C# host only (`node scripts/test-server-conformance.mjs --target csharp`). Another backend runs those vectors in its own harness, along with the same durability scenarios: restart the process, fail the next append, inspect history.

Stock `y-websocket` never offers `blok-sync.v2`, so it negotiates v1 and is compatible with the working-copy profile alone: ordinary y-protocol sync, no acknowledgement, no durability claim. On a journal-backed document a v1 write is still journaled before it is relayed; it earns no receipt. The same holds for any client that offers only v1.

S3 stays v1-only. `--collab-s3-prefix` puts the working set in your bucket, and there is no S3 operation store, so an S3-configured service runs the working-copy profile unless it also registers one. `--collab-journal` is refused next to `--collab-s3-prefix`.

### Going back to the working-copy profile

Registering an operation store is close to one-way per document. A journal-backed document is written to the journal and nowhere else: it gets no working-set blob at all. The whole-JSON projection your document endpoint holds is refreshed by a published checkpoint, by an eviction and by a drain, not once per edit window. Read that as a ceiling rather than a promise: step 3 below is what tells you how fresh the record actually is. Between those moments the journal is ahead of everything a build without your store can read.

A build without your store does not read the journal. Unregistering the store, or rolling back to a binary that never had it, lands each document on whatever else it has:

- **Journal-backed from the start.** There is no blob, so the room seeds from your document endpoint and comes back as the last projection that endpoint accepted. Every operation acknowledged since then is still in your journal and nothing serves it.
- **Working set from before the switch.** The first open under the journal adopts a document's blob as the journal's baseline, keeping its lineage, and then retires it. Every later open retires any blob it finds beside the journal; a failed retire is logged and tried again on the next open. A journal-backed room never writes one. So a blob survives only for a document that has not been opened since you registered the store, or one journalled by an earlier Blok build and not reopened since.
- **Unreadable working set.** Retiring removes only a blob that reads back. A damaged one is kept for repair: under `--collab-dir` it is moved aside as `<key>.unreadable-<time>`, and an S3 object is left where it is. The room then seeds from your endpoint. Only a purge deletes quarantined bytes. A blob with any frame in it is authoritative on open. The endpoint is never consulted, so that document comes back as it was on the day you switched. There is no error, and nothing in the log.

Blok does not keep a second whole-document copy beside the journal to make the switch back instant. The journal is the record; the JSON is a projection of it. Buying instant rollback with a hidden dual write would mean two records that can disagree, and the second one carries no fence.

Run this drill before you roll back.

1. **Stop admission and drain.** The standalone host drains on a graceful stop: new upgrades get 503, every open room flushes its projection, and members close 1001. An in-process app calls `ICollabRoomManager.DrainAsync` before it stops Kestrel. A document nobody had open was already flushed when its room was evicted. The exception is a process that crashed while holding one, which is what step 3 catches.
2. **Read what the drain said.** `warning: collab: the shutdown drain did not complete` on stderr means the shutdown timeout cut the drain short, so at least one projection did not land. `could not export during flush` names one room whose PUT failed. `cannot export its document` is the converter refusing that document. No wait produces that projection, and the room evicts without one.
3. **Compare per document, not per room.** For each document in your store, the last write-back your endpoint accepted carries `Blok-Doc-Lineage` and `Blok-Doc-Sequence`. `Blok-Doc-Sequence` must equal the head's `DurableThrough` on that lineage. Anything short of it is exactly what the rollback drops, and it is the only place that gap is visible. For every document the comparison flags, open it once on the new build (a read-only join is enough), and then re-run steps 1 to 3. Loading a journal-backed room marks its projection owed, and the room is not evicted until that PUT lands, so the next drain publishes it. A document whose process crashed with a projection owed has no room for step 1 to drain. Opening it is the only thing that gives it one.
4. **Start the old build with clients still held off.** The block you put up in step 1 stays up through step 5. A legacy room hydrated from a working set carries no document version yet, so its first write-back goes out with no `Blok-Doc-Version` and your endpoint has nothing to answer 409 on. One character typed by one user before the reset lands writes the day-of-switch document over the record you just verified, and step 5 then seeds from what it wrote.
5. **Clear the blobs left from before the switch.** For every document that had a working set before you registered the store, call `POST /sync/{doc}/reset` once on the old build. It rewrites the working set to an empty log, so the next open seeds from your endpoint instead of from the day you switched. A document that was only ever journal-backed has no blob and needs nothing here. Let clients back in after the last reset has returned, not before.

Rolling forward again is not symmetric either. With the store registered, the journal wins the open, so whatever was typed while the old build was serving is not in it.

## Pages

A `page` block saves only its `pageId`. The page body is its own collaborative document, and its document id is the page id. So each page body loads and saves through your document endpoint, like any other document.

| Call | What the service sends | What you answer |
| --- | --- | --- |
| `GET {DocEndpoint}/{docId}` | `Authorization`: your `DocEndpointAuth` value | `200` with the JSON literal `null`, or `{"data": null, "version": "0"}`, for a document you never saved; it opens empty. Otherwise `200` with `{"data": <document>, "version": "<v>"}`, or the bare document. |
| `PUT {DocEndpoint}/{docId}` | The bare document. `Blok-Doc-Version`: the last version you answered, absent until you answer one. `Blok-Doc-Lineage` and `Blok-Doc-Sequence`: with a journal only. | Any `2xx`. A JSON body with `version` sets the next `Blok-Doc-Version`; an empty body keeps it. |

- A first open fails on 404, 204, an empty 200 or any other non-2xx. The socket closes with 4503. Never answer those for a new page.
- PUT is an upsert, and the version header is optional. With a journal, every reopen owes one PUT, even if nobody typed. It goes out at the room's next checkpoint, eviction or drain. For a page never saved, it carries `{"blocks":[]}` and no version, so it must create the row.
- Keep the version on the service's own PUT. Bump it only for your own write, answer a stale PUT with 409, and call `POST /sync/{doc}/reset`.
- A refused PUT is retried, and its room stays loaded until it lands. So delete a page in this order: commit a tombstone that your `IBlokAuthorization` and both routes refuse, purge it with `ICollabDocumentPurger`, then delete its rows. The guide below handles the purge's `UnauthorizedAccessException` and `DocumentOpenElsewhere`.

Who may open which page goes through `IBlokAuthorization`. It runs before a room loads, on `/sync`, `/state`, `/edit` and `/reset`. It is registered as a singleton:

```csharp
builder.Services
  .AddBlokServer(options =>
  {
    options.CollabEnabled = true;
    options.DocEndpoint = "http://127.0.0.1:5080/internal/blok-docs";
    options.DocEndpointAuth = docEndpointSecret;
  })
  .UseAuthorization<PageRules>();
```

The full walkthrough, with the page store, the document endpoint, delete, duplicate, export and drain: [Page blocks on an ASP.NET Core backend](https://github.com/JackUait/blok/blob/main/docs/maintainers/page-csharp-host.md).

## Who was in a document, and when

The service can tell your app when a person was in a document, including people
who have already left. Blok stores none of it. The room reports and forgets; you
decide where the records live, how long you keep them, and who may read them.
Not registering an observer is how you opt out. With none, the room makes no
calls and the feature costs nothing.

```csharp
using Blok.Server.AspNetCore;
using Blok.Server.Collab;

public sealed class SqlCollabActivityObserver(IConfiguration configuration) : ICollabActivityObserver
{
  public ValueTask RecordAsync(
      string documentId,
      string actorId,
      DateTimeOffset at,
      CollabActivityKind kind,
      CancellationToken cancellationToken = default)
  {
    // Upsert one row per (document, actor) — or append, if you want history.
  }
}

builder.Services
  .AddBlokServer(options =>
  {
    options.CollabEnabled = true;
    options.DocEndpoint = "https://myapp.com/api/documents";
  })
  .UseCollabActivityObserver<SqlCollabActivityObserver>();
```

It is resolved as a singleton and is used for several documents at once.

Four kinds arrive:

| Kind | When |
| --- | --- |
| `Joined` | A connection joined the document's room |
| `Active` | The editor said this person is still there — opening the document counts, and so does typing, without anything being written |
| `Edited` | A write from this person was journalled |
| `Left` | The connection left, was closed by the room, or was still held when the room drained |

What the service promises about them:

- **`actorId` is the server's, never the client's.** It is what the connection was verified as at its handshake, from your ticket's user claim or the signed-in principal. **A connection with no verified identity produces no call at all**, of any kind: an unknown person stays unknown rather than getting a fabricated key. That is the same rule the operation journal applies to an author.
- **`at` is the server's clock.** Nothing a client sends supplies it.
- **`Edited` needs an operation store.** It is raised where a committed operation is journalled, so a working-copy-only service never emits it. An editing person still surfaces there as `Active`, about once a minute.
- **`Active` and `Edited` are deduplicated** to at most one call per 55 seconds per document-and-actor pair, so your implementation does not have to rate-limit them. The window is deliberately shorter than the editor's own 60-second send cadence: the two are measured on different clocks, and equal thresholds would drop every other heartbeat. `Joined` and `Left` are never suppressed. They are the boundaries of a session, and you may want to store them as such. Every `Joined` is paired: an expel, a drain and a room that closes on a commit failure all report `Left` for the members they still held.
- **A reader who never types is still a session.** "Opened the document and read for two minutes" produces `Joined` and `Left` with no `Edited` between them, which is the case the feature exists for.
- **This is best-effort telemetry, not the journal.** An observer that throws or never completes is logged and dropped. It never closes a room and never refuses an edit, which is the opposite of what a failed journal append does. Calls are made off the room's lane, so a slow implementation costs you your own latency and nobody else's. One room's calls are serialized and arrive in the order it made them. A room that gets more than 256 records ahead of a stalled observer drops its oldest heartbeats first, keeping the session boundaries.
- **Blok draws nothing from this.** There is no built-in activity UI, no retention policy and no idle threshold; the editor's `collaboration:status` event carries the live half separately.

A backend that is not .NET implements the wire side instead. Frame 106 is the client's activity signal. Frame 107 is the verified-identity map, and it lets you key live presence the way you key your stored records. Both are in `packages/server/protocol/blok-sync-v2.md`.

## Quality gates

The .NET solution keeps three test layers: `Blok.Server.Tests` for core behavior, `Blok.Server.AspNetCore.Tests` for in-process integration, and `Blok.Server.Host.Tests` for real-process end-to-end behavior. CI also runs the cross-runtime conformance and package smoke tests.

```bash
dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes
dotnet restore packages/server/dotnet/Blok.Server.slnx
```

CI collects merged production coverage and requires at least 80% line and 80% branch coverage. It also runs the SDK analyzers with warnings as errors, and audits all direct and transitive NuGet packages. It scans committed secrets with Gitleaks, scans the server tree and built image with Trivy, and analyzes C# with CodeQL. Dependabot keeps NuGet, Docker, and GitHub Actions dependencies current.

## Docs

Full configuration and deployment guidance: [https://blokeditor.com/docs](https://blokeditor.com/docs)
