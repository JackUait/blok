# Page blocks on an ASP.NET Core backend

This guide wires Blok's `page` block to an ASP.NET Core app that hosts the Blok server in process (`Blok.Server.AspNetCore`). It builds on the language-neutral page docs next to it:

- `page-host-integration.md`: page records, titles and compare-and-swap.
- `page-index-integration.md`: the owner, search and reference index.
- `page-transfer-host.md` and `page-archive-host.md`: moving, copying and exporting page trees.

The docs site already states four rules this guide relies on. Read them on https://blokeditor.com/server, under "Read this before you deploy". This guide points at them by title instead of restating them:

- `collab-new-documents`: "A brand-new document must answer with nothing, not 404".
- `collab-reset`: "Changing a document from outside: two calls, and when to use which".
- `collab-rollback-boundary`: "Turning the operation journal off is not a rollback".
- `collab-access-lifecycle`: "Access, trash and permanent deletion belong to your app".

The C# below compiles as one project against `Blok.Server.AspNetCore`. Its routes were run once in both collaboration profiles: signed out, create, resolve, rename, stale writes, events, trash, delete, duplicate and export. It keeps state in memory so it runs; a real host keeps the same rows in its database. The TypeScript was type-checked only, not run in a browser.

## What a page is on the server

- A `page` block saves only `{ "pageId": "…" }` in its parent document.
- The page body is a separate Blok document. Its collaboration document id **is** the page id.
- Title, icon, access and trash state live in your page record. Never read a title from the pointer.
- Page ids become a URL path segment twice: in `/sync/{doc}` and in `{DocEndpoint}/{docId}`. Keep them to `[A-Za-z0-9_-]`. Blok mints 10-character ids from that set.

A host keeps three tables:

```
pages(page_id PK, title, icon_json, version, owner_id, trashed_at)
page_acl(page_id, user_id, access)              -- 'read' | 'write'
page_bodies(page_id PK FK, body_json, version, lineage, sequence)
```

Plus a tombstone list of deleted page ids. A deleted id is never reused.

**This sample assumes every collaborative document in your app is a page.** The server has one `IBlokAuthorization` and one `DocEndpoint` for all documents. If your app has other collaborative documents, the places marked `OtherDocuments` must fall through to your existing rules for them. `create` must also refuse an id that already names any document.

## Wiring: `Program.cs`

```csharp
// File: Program.cs
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using PageHost;

var builder = WebApplication.CreateBuilder(args);

// The doc routes are guarded by this secret alone, so it must be set.
var docAuth = builder.Configuration["Blok:DocEndpointAuth"]
  ?? throw new InvalidOperationException("Blok:DocEndpointAuth is not set");

// Where the rooms reach this app's doc routes. Plain HTTP is accepted only for
// loopback, so this must be a loopback address Kestrel really listens on.
// A wrong port fails every first open with 4503.
var selfUrl = builder.Configuration["Blok:SelfUrl"]
  ?? throw new InvalidOperationException("Blok:SelfUrl is not set");

builder.Services.AddSingleton<PageStore>();
builder.Services.AddSingleton<OtherDocuments>();
builder.Services.AddSingleton<PageEvents>();
builder.Services.AddHostedService<DrainOnStop>();

// Before AddBlokServer: it registers the converter with TryAdd, so a call
// after it is silently ignored. The longer timeout is for pageIndex.
builder.Services.AddBlokDocuments(timeout: TimeSpan.FromSeconds(30));
builder.Services
  .AddBlokServer(options =>
  {
    options.CollabEnabled = true;
    options.CollabJournal = builder.Configuration.GetValue<bool>("Blok:Journal");
    options.CollabDirectory = builder.Configuration["Blok:CollabDirectory"] ?? "./blok-collab";
    options.DocEndpoint = $"{selfUrl}/internal/blok-docs";
    options.DocEndpointAuth = docAuth;
  })
  .UseAuthorization<PageRules>();

// Your sign-in. The page routes, MapBlokServer and PageRules read the user's
// NameIdentifier claim from it.
builder.Services
  .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
  .AddCookie(options =>
  {
    // A login redirect reaches fetch() as a followed 404, and the page tool
    // would show "Page not found" for an expired session. Answer /api/* with
    // a status instead.
    options.Events.OnRedirectToLogin = context => ApiStatus(context, StatusCodes.Status401Unauthorized);
    options.Events.OnRedirectToAccessDenied = context => ApiStatus(context, StatusCodes.Status403Forbidden);
  });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();
app.UseWebSockets();

app.MapBlokServer("/api/blok").RequireAuthorization();
app.MapPages("/api/pages");
app.MapPageDocuments("/internal/blok-docs", docAuth);

app.Run();

static Task ApiStatus(RedirectContext<CookieAuthenticationOptions> context, int status)
{
  if (context.Request.Path.StartsWithSegments("/api"))
  {
    context.Response.StatusCode = status;
  }
  else
  {
    context.Response.Redirect(context.RedirectUri);
  }

  return Task.CompletedTask;
}
```

## Page store and access: `Pages.cs`

```csharp
// File: Pages.cs
using System.Security.Claims;
using System.Text.Json.Nodes;
using Blok.Server.AspNetCore;
using Blok.Server.Documents;

namespace PageHost;

public sealed record PageIcon(string Type, string? Value, string? Url);

public sealed record PageRecord(
    string PageId, string Title, PageIcon? Icon, long Version, DateTimeOffset? TrashedAt = null);

public enum PageAccess { None, Read, Write }

public enum SaveOutcome { Saved, Conflict, Gone }

// In memory so the sample runs. Each lock below is one transaction in a real store.
public sealed class PageStore
{
  private readonly Lock gate = new();
  private readonly Dictionary<string, PageRecord> pages = new(StringComparer.Ordinal);
  private readonly Dictionary<string, Dictionary<string, PageAccess>> acl = new(StringComparer.Ordinal);
  private readonly Dictionary<string, (JsonNode Body, long Version)> bodies = new(StringComparer.Ordinal);
  private readonly Dictionary<string, (long Revision, BlokPageIndex Facts)> indexes = new(StringComparer.Ordinal);
  private readonly Dictionary<string, string> creators = new(StringComparer.Ordinal);
  private readonly Dictionary<string, string> tombstones = new(StringComparer.Ordinal);
  private long revisions;

  public PageRecord? Find(string pageId)
  {
    lock (gate)
    {
      return pages.GetValueOrDefault(pageId);
    }
  }

  public bool IsTombstoned(string pageId)
  {
    lock (gate)
    {
      return tombstones.ContainsKey(pageId);
    }
  }

  public string? CreatorOf(string pageId)
  {
    lock (gate)
    {
      return creators.GetValueOrDefault(pageId);
    }
  }

  public PageAccess AccessOf(string pageId, string userId)
  {
    lock (gate)
    {
      return pages.ContainsKey(pageId) &&
          acl.TryGetValue(pageId, out var entries) &&
          entries.TryGetValue(userId, out var access)
        ? access
        : PageAccess.None;
    }
  }

  // Everyone who ever had an ACL row. A change event goes to them, so a user
  // who just lost access still hears about it and re-resolves.
  public IReadOnlyList<string> Audience(string pageId)
  {
    lock (gate)
    {
      return acl.TryGetValue(pageId, out var entries) ? [.. entries.Keys] : [];
    }
  }

  // Idempotent: a retried create for the same id returns the page it made.
  // Null: the id is deleted and may never be used again.
  public (PageRecord Record, bool Created)? Create(string pageId, string ownerId)
  {
    lock (gate)
    {
      if (tombstones.ContainsKey(pageId))
      {
        return null;
      }

      if (pages.TryGetValue(pageId, out var existing))
      {
        return (existing, false);
      }

      var record = new PageRecord(pageId, "", null, 1);
      pages[pageId] = record;
      creators[pageId] = ownerId;
      acl[pageId] = new(StringComparer.Ordinal) { [ownerId] = PageAccess.Write };

      return (record, true);
    }
  }

  // Compare-and-swap on the page record. A null record means the page is gone.
  public (PageRecord? Record, bool Conflict) Update(
      string pageId, long expectedVersion, Func<PageRecord, PageRecord> change)
  {
    lock (gate)
    {
      if (!pages.TryGetValue(pageId, out var current))
      {
        return (null, false);
      }

      if (current.Version != expectedVersion)
      {
        return (current, true);
      }

      var next = change(current) with { Version = current.Version + 1 };
      pages[pageId] = next;

      return (next, false);
    }
  }

  public void SetAccess(string pageId, string userId, PageAccess access)
  {
    lock (gate)
    {
      var entries = acl.TryGetValue(pageId, out var found) ? found : acl[pageId] = new(StringComparer.Ordinal);
      entries[userId] = access;
    }
  }

  public (JsonNode Body, long Version)? Body(string pageId)
  {
    lock (gate)
    {
      return pages.ContainsKey(pageId) && bodies.TryGetValue(pageId, out var body)
        ? (body.Body.DeepClone(), body.Version)
        : null;
    }
  }

  // Blok's write-back. The version check and the write are ONE step; in SQL:
  //   UPDATE page_bodies SET body_json = @body WHERE page_id = @id AND version = @sent
  // plus an INSERT when no row exists yet. A null sentVersion skips the check.
  // It never bumps the version: if it did, a PUT whose answer was lost would
  // leave the room holding the old one, and every retry would get 409.
  // The revision only orders index writes.
  public (SaveOutcome Outcome, long Version, long Revision) SaveBody(
      string pageId, JsonNode body, long? sentVersion)
  {
    lock (gate)
    {
      if (!pages.ContainsKey(pageId))
      {
        return (SaveOutcome.Gone, 0, 0);
      }

      var current = bodies.TryGetValue(pageId, out var old) ? old.Version : 0;

      if (sentVersion is { } sent && sent != current)
      {
        return (SaveOutcome.Conflict, current, 0);
      }

      bodies[pageId] = (body, current);

      return (SaveOutcome.Saved, current, ++revisions);
    }
  }

  // Your OWN write (import, migration, support fix). It bumps the version, so
  // a write-back already in flight gets 409. Call POST /sync/{doc}/reset after
  // it, or that 409 never clears.
  public long ReplaceBodyByHost(string pageId, JsonNode body)
  {
    lock (gate)
    {
      var version = (bodies.TryGetValue(pageId, out var old) ? old.Version : 0) + 1;
      bodies[pageId] = (body, version);

      return version;
    }
  }

  // Replace, never append. An older revision never overwrites a newer one.
  public void ReplaceIndex(string pageId, long revision, BlokPageIndex facts)
  {
    lock (gate)
    {
      if (pages.ContainsKey(pageId) &&
          (!indexes.TryGetValue(pageId, out var stored) || stored.Revision < revision))
      {
        indexes[pageId] = (revision, facts);
      }
    }
  }

  // Step 1 of a permanent delete: from here on, every rule denies the id.
  public void Tombstone(string pageId, string deletedBy)
  {
    lock (gate)
    {
      tombstones.TryAdd(pageId, deletedBy);
      pages.Remove(pageId);
    }
  }

  public string? DeletedBy(string pageId)
  {
    lock (gate)
    {
      return tombstones.GetValueOrDefault(pageId);
    }
  }

  // The last step of a permanent delete. The tombstone stays.
  public void RemoveRows(string pageId)
  {
    lock (gate)
    {
      acl.Remove(pageId);
      bodies.Remove(pageId);
      indexes.Remove(pageId);
      creators.Remove(pageId);
    }
  }
}

// Your rules for collaborative documents that are not pages. This stub has none.
public sealed class OtherDocuments
{
  public bool Exists(string documentId) => false;

  public bool CanRead(ClaimsPrincipal user, string documentId) => false;

  public bool CanWrite(ClaimsPrincipal user, string documentId) => false;
}

// Who may open which page body, over /sync, /state, /edit and /reset.
// A singleton (UseAuthorization registers it as one). With a scoped DbContext,
// take IDbContextFactory<T> or IServiceScopeFactory instead of the context.
public sealed class PageRules(PageStore store, OtherDocuments others) : IBlokAuthorization
{
  public ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    => ValueTask.FromResult(Decide(user, documentId, write: false));

  public ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    => ValueTask.FromResult(Decide(user, documentId, write: true));

  private bool Decide(ClaimsPrincipal user, string documentId, bool write)
  {
    // A deleted page stays closed. Under a journal this is the ONLY gate:
    // a reopened room serves from the journal even when GET answers 404.
    if (store.IsTombstoned(documentId))
    {
      return false;
    }

    var page = store.Find(documentId);

    if (page is null)
    {
      return write ? others.CanWrite(user, documentId) : others.CanRead(user, documentId);
    }

    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
    var access = userId is null ? PageAccess.None : store.AccessOf(documentId, userId);

    // A trashed page is read-only until it is restored.
    return write
      ? access == PageAccess.Write && page.TrashedAt is null
      : access >= PageAccess.Read;
  }
}
```

`IBlokAuthorization` runs before a room loads, on `/sync`, `/state`, `/edit` and `/reset`. So an id with no page record is refused with 403, or 4403 on the socket, before the doc endpoint is asked.

## The document endpoint: `DocEndpoint.cs`

The rooms call these routes over HTTP even when Blok runs in this process: the client is internal and takes only a URL (`BlokServerOptions.DocEndpoint`). No user cookie arrives, only the `DocEndpointAuth` value, sent verbatim as `Authorization`.

| Call | Request | Answer |
| --- | --- | --- |
| `GET {DocEndpoint}/{docId}` | `Authorization` | `200` with JSON `null`, or `{"data": null, "version": "0"}`, for a page never saved: the room opens it empty. `200` with `{"data": {…}, "version": "…"}`, or the bare document, otherwise. |
| `PUT {DocEndpoint}/{docId}` | `Authorization`; body: the bare document; `Blok-Doc-Version`: the last version you answered, absent until you answer one; `Blok-Doc-Lineage` and `Blok-Doc-Sequence`: only under a journal | `2xx`. A JSON body with `version` becomes the next `Blok-Doc-Version`; an empty body keeps the old one. |

The traps:

- **On a first seed, 404, 204, an empty 200 and any non-2xx all fail closed.** The socket closes with 4503, and `/state` answers 503. MVC turns a handler returning `null` into 204, so write the JSON yourself.
- **On a journal reopen, the GET is only a version read.** A failure there is logged, and the room serves from the journal. So 404 does not keep a deleted page closed under a journal; `IBlokAuthorization` does.
- **PUT is an upsert, and the header is optional.** Under a journal, every reopen owes one PUT of the current document, even if nobody typed. It is sent at the reopened room's next checkpoint, eviction or drain, not on the reopen itself. For a page never saved, that PUT is `{"blocks":[]}` with lineage, sequence `0` and no `Blok-Doc-Version`, so it must create the row. A `/state` read of an unseen id seeds the journal the same way.
- **A refused PUT is retried with backoff, and the room is never evicted while it owes one.** A 404 on PUT pins the room in memory until the process stops. That includes a body over Kestrel's request size limit, which Kestrel answers 413 (a 40 MiB PUT was refused by default). Raise the limit on this route above your largest document.
- **Never bump the version on Blok's own write-back.** Echo the current one. If you bumped it, one lost answer would leave the room holding the old version, and every retry would get 409.
- **Bump it only on your own out-of-band write**, then call `POST /sync/{doc}/reset`. Only that write may lead to a 409. See `collab-reset`.

```csharp
// File: DocEndpoint.cs
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Documents;
using Microsoft.AspNetCore.Http.Features;

namespace PageHost;

public static class DocEndpoint
{
  // Above your largest page body. Kestrel's own default refuses bigger PUTs,
  // and a refused PUT pins the room.
  private const long MaxBodyBytes = 64L * 1024 * 1024;

  public static void MapPageDocuments(this IEndpointRouteBuilder app, string prefix, string expectedAuth)
  {
    // An empty secret would match an empty header: anyone could read and
    // overwrite every page body.
    ArgumentException.ThrowIfNullOrWhiteSpace(expectedAuth);

    // Only the secret guards this group. Also keep it off the public listener:
    // a loopback-only Kestrel endpoint, RequireHost(...) or an IP filter.
    var group = app.MapGroup(prefix).AllowAnonymous();

    group.MapGet("/{docId}", async (HttpContext context, string docId, PageStore store) =>
    {
      if (!Authorized(context, expectedAuth))
      {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
      }

      // No page record: deleted, never created, or not a page. OtherDocuments:
      // answer a non-page document from your existing store here.
      if (store.Find(docId) is null)
      {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
      }

      var body = store.Body(docId);
      var envelope = new JsonObject
      {
        // data: null is "nothing saved yet": the room opens an empty page.
        ["data"] = body?.Body,
        ["version"] = (body?.Version ?? 0).ToString(CultureInfo.InvariantCulture),
      };

      context.Response.StatusCode = StatusCodes.Status200OK;
      context.Response.ContentType = "application/json; charset=utf-8";
      await context.Response.WriteAsync(envelope.ToJsonString());
    });

    group.MapPut("/{docId}", async (
        HttpContext context, string docId, PageStore store, IBlokDocumentConverter blok,
        ILogger<PageStore> logger) =>
    {
      if (!Authorized(context, expectedAuth))
      {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
      }

      if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
      {
        limit.MaxRequestBodySize = MaxBodyBytes;
      }

      var header = context.Request.Headers["Blok-Doc-Version"].ToString();
      long? sent = null;

      if (header != "")
      {
        if (!long.TryParse(header, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed))
        {
          // Not a version this endpoint ever answered.
          context.Response.StatusCode = StatusCodes.Status409Conflict;
          return;
        }

        sent = parsed;
      }

      if (await JsonNode.ParseAsync(context.Request.Body) is not JsonObject body)
      {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
      }

      // Check and write in one step, so a host write in between is never lost.
      var (outcome, version, revision) = store.SaveBody(docId, body, sent);

      if (outcome == SaveOutcome.Gone)
      {
        // Deleted pages are purged before their rows go, so no room is left
        // to retry this.
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
      }

      if (outcome == SaveOutcome.Conflict)
      {
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        return;
      }

      // Reindex after the save commits, never inside it: a pageIndex timeout
      // must not fail the save. A missed reindex is retried by your own job.
      try
      {
        store.ReplaceIndex(docId, revision, await blok.GetPageIndexAsync(body.ToJsonString()));
      }
      catch (BlokDocumentConversionException error)
      {
        logger.LogWarning(error, "page {PageId}: reindex failed, retry it later", docId);
      }

      context.Response.ContentType = "application/json; charset=utf-8";
      await context.Response.WriteAsync(
          new JsonObject { ["version"] = version.ToString(CultureInfo.InvariantCulture) }.ToJsonString());
    });
  }

  private static bool Authorized(HttpContext context, string expected)
  {
    var sent = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());

    return CryptographicOperations.FixedTimeEquals(sent, Encoding.UTF8.GetBytes(expected));
  }
}
```

### Search, tree and backlinks

`IBlokDocumentConverter.GetPageIndexAsync` returns the same `owners`, `text` and `references` rows as `pageIndex` in Node. Replace a page's rows with them on every save; `page-index-integration.md` says how to use them.

That doc puts the save and the reindex in one host transaction. On .NET that makes the user's save fail whenever `GetPageIndexAsync` times out, and it costs about twice `ToPlainTextAsync`. A very large page can pass the ten-second default. Pick one:

- **Reindex after the save commits**, as above, and retry a failed reindex from a job. The `revision` stops an old reindex from overwriting a newer one.
- **Keep one transaction and raise the timeout.** Call `AddBlokDocuments(timeout: …)` **before** `AddBlokServer`. `AddBlokServer` registers the converter with `TryAdd`, so a later call is silently ignored.

## Browser-facing page routes: `PageRoutes.cs`

```csharp
// File: PageRoutes.cs
using System.Security.Claims;
using Blok.Server.Collab;

namespace PageHost;

public sealed record CreatePageRequest(string PageId);
public sealed record TitleRequest(string Title, long ExpectedVersion);
public sealed record IconRequest(PageIcon? Icon, long ExpectedVersion);
public sealed record TrashRequest(bool Trashed, long ExpectedVersion);
public sealed record AclRequest(string User, PageAccess Access);

public static partial class PageRoutes
{
  public static RouteGroupBuilder MapPages(this IEndpointRouteBuilder app, string prefix)
  {
    var group = app.MapGroup(prefix).RequireAuthorization();

    // config.create -> POST. Idempotent per pageId, so a retry cannot fork.
    group.MapPost("/", (CreatePageRequest request, ClaimsPrincipal user, PageStore store,
        OtherDocuments others, PageEvents events) =>
    {
      if (UserId(user) is not { } userId)
      {
        return Results.Forbid();
      }

      if (!IsPageId(request.PageId) || others.Exists(request.PageId))
      {
        return Results.BadRequest();
      }

      if (store.Create(request.PageId, userId) is not var (record, created))
      {
        return Results.Conflict();
      }

      // A retry by the creator gets its page back. Anyone else naming an
      // existing id would get a second owning pointer to someone's page.
      if (!created && store.CreatorOf(record.PageId) != userId)
      {
        return Results.Conflict();
      }

      events.Publish(record.PageId, [userId]);

      return created ? Results.Created($"{prefix}/{record.PageId}", record) : Results.Ok(record);
    });

    // config.resolve -> GET. 404 = null ("Page not found"); access: 'none' = "No access".
    group.MapGet("/{pageId}", (string pageId, ClaimsPrincipal user, PageStore store) =>
    {
      if (UserId(user) is not { } userId)
      {
        return Results.Forbid();
      }

      var record = store.Find(pageId);

      if (record is null)
      {
        return Results.NotFound();
      }

      return store.AccessOf(pageId, userId) == PageAccess.None
        ? Results.Ok(new { pageId, access = "none" })
        : Results.Ok(record);
    });

    // config.rename and config.setIcon -> PUT with the version the client last saw.
    group.MapPut("/{pageId}/title", (string pageId, TitleRequest request, ClaimsPrincipal user,
        PageStore store, PageEvents events) =>
        Write(pageId, user, store, events, request.ExpectedVersion, record => record with { Title = request.Title }));

    group.MapPut("/{pageId}/icon", (string pageId, IconRequest request, ClaimsPrincipal user,
        PageStore store, PageEvents events) =>
        Write(pageId, user, store, events, request.ExpectedVersion, record => record with { Icon = request.Icon }));

    // Trash keeps the record, body and journal, so write-backs keep landing.
    // PageRules makes it read-only; the recheck closes live writers, and
    // they come back read-only.
    group.MapPut("/{pageId}/trash", async (string pageId, TrashRequest request, ClaimsPrincipal user,
        PageStore store, PageEvents events, ICollabRoomManager rooms, CancellationToken ct) =>
    {
      var result = Write(pageId, user, store, events, request.ExpectedVersion,
          record => record with { TrashedAt = request.Trashed ? DateTimeOffset.UtcNow : null });
      await rooms.RecheckAccessAsync(pageId, ct);

      return result;
    });

    // An ACL change: commit it, then close live sockets that lost access.
    // Call RecheckAccessAsync on EVERY instance that serves the page.
    group.MapPut("/{pageId}/acl", async (string pageId, AclRequest request, ClaimsPrincipal user,
        PageStore store, PageEvents events, ICollabRoomManager rooms, CancellationToken ct) =>
    {
      if (store.Find(pageId) is null)
      {
        return Results.NotFound();
      }

      // Your own sharing rule goes here; this one lets writers share.
      if (UserId(user) is not { } userId || store.AccessOf(pageId, userId) != PageAccess.Write)
      {
        return Results.Forbid();
      }

      store.SetAccess(pageId, request.User, request.Access);
      await rooms.RecheckAccessAsync(pageId, ct);
      events.Publish(pageId, store.Audience(pageId));

      return Results.NoContent();
    });

    group.MapPageEvents();
    group.MapPageDelete();
    group.MapPageCopies();
    group.MapPageTickets();

    return group;
  }

  private static IResult Write(
      string pageId, ClaimsPrincipal user, PageStore store, PageEvents events, long expectedVersion,
      Func<PageRecord, PageRecord> change)
  {
    if (UserId(user) is not { } userId || store.AccessOf(pageId, userId) != PageAccess.Write)
    {
      return Results.Forbid();
    }

    var (record, conflict) = store.Update(pageId, expectedVersion, change);

    if (record is null)
    {
      return Results.NotFound();
    }

    if (conflict)
    {
      return Results.Conflict(record);
    }

    events.Publish(pageId, store.Audience(pageId));

    return Results.Ok(record);
  }

  // A principal with no NameIdentifier is refused. Owner "" would make every
  // such principal the creator of every page they create.
  internal static string? UserId(ClaimsPrincipal user) =>
      user.FindFirstValue(ClaimTypes.NameIdentifier) is { Length: > 0 } id ? id : null;

  // The page id becomes a /sync/{doc} segment and a doc-endpoint segment.
  // "events" and "ticket" are routes of their own in this group.
  internal static bool IsPageId(string? id) =>
      !string.IsNullOrEmpty(id) && id.Length <= 128 && id is not "events" and not "ticket" &&
      id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}
```

`Results.Forbid()` goes through the cookie handler's access-denied path. The `OnRedirectToAccessDenied` event in `Program.cs` turns it into a plain 403 for `/api/*`.

## Page events: `PageEvents.cs`

`config.subscribe` needs to hear when a title, icon, access or trash state changes, including from other tabs. This sends page ids only, and only to users on that page's ACL. Each tab then asks `resolve` again and gets its own access-checked answer.

```csharp
// File: PageEvents.cs
using System.Text.Json;
using System.Threading.Channels;

namespace PageHost;

public sealed class PageListener
{
  private int missed;

  public PageListener(string userId)
  {
    UserId = userId;
    // A slow tab loses its oldest ids, never the newest, and is told to
    // re-resolve everything instead of silently going stale.
    Channel = System.Threading.Channels.Channel.CreateBounded<string>(
        new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropOldest },
        _ => Interlocked.Exchange(ref missed, 1));
  }

  public string UserId { get; }

  public Channel<string> Channel { get; }

  public bool TakeMissed() => Interlocked.Exchange(ref missed, 0) == 1;
}

public sealed class PageEvents
{
  private readonly Lock gate = new();
  private readonly List<PageListener> listeners = [];

  public void Publish(string pageId, IReadOnlyCollection<string> audience)
  {
    lock (gate)
    {
      foreach (var listener in listeners)
      {
        if (audience.Contains(listener.UserId))
        {
          listener.Channel.Writer.TryWrite(pageId);
        }
      }
    }
  }

  public PageListener Listen(string userId)
  {
    var listener = new PageListener(userId);

    lock (gate)
    {
      listeners.Add(listener);
    }

    return listener;
  }

  public void Stop(PageListener listener)
  {
    lock (gate)
    {
      listeners.Remove(listener);
    }
  }
}

public static partial class PageRoutes
{
  // config.subscribe -> one EventSource per tab.
  internal static void MapPageEvents(this RouteGroupBuilder group)
  {
    group.MapGet("/events", async (HttpContext context, PageEvents events) =>
    {
      if (UserId(context.User) is not { } userId)
      {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
      }

      context.Response.ContentType = "text/event-stream";
      context.Response.Headers.CacheControl = "no-store";
      var listener = events.Listen(userId);

      try
      {
        await foreach (var pageId in listener.Channel.Reader.ReadAllAsync(context.RequestAborted))
        {
          if (listener.TakeMissed())
          {
            await context.Response.WriteAsync("event: resync\ndata: {}\n\n", context.RequestAborted);
          }

          await context.Response.WriteAsync(
              $"data: {JsonSerializer.Serialize(new { pageId })}\n\n", context.RequestAborted);
          await context.Response.Body.FlushAsync(context.RequestAborted);
        }
      }
      catch (OperationCanceledException)
      {
        // The tab went away.
      }
      finally
      {
        events.Stop(listener);
      }
    });
  }
}
```

## Permanent delete: `PageDelete.cs`

Trash is not deletion: it keeps the id, body, working set and journal, and restore changes only your record. A permanent delete runs in this order (`collab-access-lifecycle`):

1. **Commit a durable tombstone.** From then on `PageRules` and the doc endpoint's GET and PUT all refuse the id, even under a journal.
2. **Purge Blok's state** with `ICollabDocumentPurger.PurgeDocumentAsync`.
   - Its `authorize` callback runs first. When it answers `false`, the purge **throws** `UnauthorizedAccessException`; it does not return. The callback must not go through `PageRules`, which already denies the tombstoned id. Check the right to delete that you recorded with the tombstone.
   - `DocumentOpenElsewhere` means another process holds the page. Keep the tombstone and retry.
   - With no operation store, the purge deletes the working set and returns `Purged`. A registered store that does not implement `ICollabOperationPurgeStore` makes it throw `NotSupportedException`; the built-in journal implements it.
3. **Remove the rows.** Keep the tombstone: a purged id is never reused.

Without a journal, a purge in one process cannot protect another instance or a restart. Quiesce every instance, and make sure the doc endpoint refuses the tombstoned id durably.

```csharp
// File: PageDelete.cs
using Blok.Server.Collab;

namespace PageHost;

public static partial class PageRoutes
{
  internal static void MapPageDelete(this RouteGroupBuilder group)
  {
    group.MapDelete("/{pageId}", async (string pageId, HttpContext context, PageStore store,
        PageEvents events, ICollabDocumentPurger purger, CancellationToken ct) =>
    {
      if (UserId(context.User) is not { } userId)
      {
        return Results.Forbid();
      }

      // A retry after a failed purge finds the tombstone and carries on.
      if (store.DeletedBy(pageId) is null)
      {
        if (store.Find(pageId) is null)
        {
          return Results.NotFound();
        }

        // Your delete rule goes here; this one lets writers delete.
        if (store.AccessOf(pageId, userId) != PageAccess.Write)
        {
          return Results.Forbid();
        }

        var audience = store.Audience(pageId);
        store.Tombstone(pageId, userId);
        events.Publish(pageId, audience);
      }

      for (var attempt = 1; ; attempt++)
      {
        CollabDocumentPurgeOutcome outcome;

        try
        {
          outcome = await purger.PurgeDocumentAsync(
              pageId,
              _ => ValueTask.FromResult(store.DeletedBy(pageId) == userId),
              ct);
        }
        catch (UnauthorizedAccessException)
        {
          return Results.Forbid();
        }

        if (outcome == CollabDocumentPurgeOutcome.Purged)
        {
          break;
        }

        if (attempt == 3)
        {
          // Another process still holds the page. The tombstone stays; retry later.
          return Results.Conflict();
        }

        await Task.Delay(TimeSpan.FromSeconds(attempt), ct);
      }

      store.RemoveRows(pageId);

      return Results.NoContent();
    });
  }
}
```

The parent document still holds the `page` pointer. Remove it with `POST /sync/{parent}/edit` or in your own save, after your policy checks. Until then the pointer resolves to `null` and shows "Page not found".

## Duplicate and page-aware export: `PageCopies.cs`

Without `config.duplicate`, Duplicate (Cmd/Ctrl+D) and Alt-drag make a **second link to the same page**, not a copy. Copy and paste always carry a link.

With `duplicate` set, Blok mints the new page id, inserts a pointer to it, and then calls `duplicate({ sourcePageId, pageId })`. Peers see the pointer before your route commits, and it shows "Page not found" until `subscribe` reports the page. Your route creates the record, the ACL row and a copied body under that id. The body copy needs fresh block ids: `RemapPageDocumentAsync` rewrites them.

This sample copies one page. It refuses a page that owns child pages, because the copy would be a second owner of each child. Copy a subtree with `page-transfer-host.md`'s procedure instead. It copies the last body your endpoint accepted, which can trail the live document: by up to ten seconds on a working copy, and until the next checkpoint, eviction or drain under a journal.

The export route shows the page-aware `ToHtmlAsync`. A saved document holds page ids only. The export gets each title and icon from your records, filtered for the reader, through a `BlokPageInfo` map: a `null` value shows "Page not found", `NoAccess` shows "No access", and an id left out shows "Page". `ToMarkdownAsync` takes the same map.

```csharp
// File: PageCopies.cs
using System.Text.Json.Nodes;
using Blok.Server.Documents;

namespace PageHost;

public sealed record DuplicateRequest(string PageId);

public static partial class PageRoutes
{
  internal static void MapPageCopies(this RouteGroupBuilder group)
  {
    // config.duplicate -> POST.
    group.MapPost("/{sourcePageId}/duplicate", async (string sourcePageId, DuplicateRequest request,
        HttpContext context, PageStore store, PageEvents events, IBlokDocumentConverter blok,
        CancellationToken ct) =>
    {
      if (UserId(context.User) is not { } userId)
      {
        return Results.Forbid();
      }

      if (store.Find(sourcePageId) is not { } source || store.AccessOf(sourcePageId, userId) == PageAccess.None)
      {
        return Results.NotFound();
      }

      if (!IsPageId(request.PageId))
      {
        return Results.BadRequest();
      }

      var body = store.Body(sourcePageId)?.Body.ToJsonString() ?? """{"blocks":[]}""";

      if ((await blok.GetPageIndexAsync(body, ct)).Owners.Count > 0)
      {
        return Results.UnprocessableEntity("copy a page with child pages as a subtree");
      }

      // Blok saves nested blocks flat, each with its own top-level id.
      var blockIds = new Dictionary<string, string>(StringComparer.Ordinal);

      if (JsonNode.Parse(body)?["blocks"] is JsonArray blocks)
      {
        foreach (var block in blocks)
        {
          if (block?["id"]?.GetValue<string>() is { } id)
          {
            blockIds[id] = Guid.NewGuid().ToString("N")[..10];
          }
        }
      }

      string copy;

      try
      {
        copy = await blok.RemapPageDocumentAsync(body, blockIds, new Dictionary<string, string>(), ct);
      }
      catch (ArgumentException error)
      {
        // Legacy nested blocks carry ids this walk does not see; the message names them.
        return Results.UnprocessableEntity(error.Message);
      }

      if (store.Create(request.PageId, userId) is not (_, true))
      {
        return Results.Conflict();
      }

      store.Update(request.PageId, 1, record => record with { Title = source.Title, Icon = source.Icon });
      store.ReplaceBodyByHost(request.PageId, JsonNode.Parse(copy) ?? new JsonObject());
      events.Publish(request.PageId, [userId]);

      return Results.Ok(store.Find(request.PageId));
    });

    group.MapGet("/{pageId}/export.html", async (string pageId, HttpContext context, PageStore store,
        IBlokDocumentConverter blok, CancellationToken ct) =>
    {
      if (UserId(context.User) is not { } userId || store.AccessOf(pageId, userId) == PageAccess.None)
      {
        return Results.NotFound();
      }

      var body = store.Body(pageId)?.Body.ToJsonString() ?? """{"blocks":[]}""";
      var facts = await blok.GetPageIndexAsync(body, ct);
      var pages = new Dictionary<string, BlokPageInfo?>(StringComparer.Ordinal);

      foreach (var linked in facts.Owners.Select(o => o.PageId).Concat(facts.References.Select(r => r.PageId)))
      {
        var record = store.Find(linked);

        pages[linked] = record is null
          ? null
          : store.AccessOf(linked, userId) == PageAccess.None
            ? new BlokPageInfo { NoAccess = true }
            : new BlokPageInfo { Title = record.Title, Icon = ToBlokIcon(record.Icon) };
      }

      var html = await blok.ToHtmlAsync(body, pages, id => $"/pages/{Uri.EscapeDataString(id)}", ct);

      return Results.Content(html, "text/html; charset=utf-8");
    });
  }

  private static BlokPageIcon? ToBlokIcon(PageIcon? icon) => icon switch
  {
    { Type: "emoji", Value: { } emoji } => BlokPageIcon.Emoji(emoji),
    { Type: "image", Url: { } url } => BlokPageIcon.Image(url),
    _ => null,
  };
}
```

## Standalone host: `PageTickets.cs`

The sample above maps the Blok routes inside your app, so they see the signed-in user. If you run the standalone host instead (`npx @bloklabs/server`, or the Docker image, with `--auth ticket`), it cannot see who the user is. Your app vouches for them with a short-lived pass that names one page. Set the editor's `ticket: '/api/pages/ticket'`; it appends `?doc=<pageId>` for a collaboration pass.

```csharp
// File: PageTickets.cs
using Blok.Server.Tickets;

namespace PageHost;

public static partial class PageRoutes
{
  internal static void MapPageTickets(this RouteGroupBuilder group)
  {
    group.MapGet("/ticket", (string doc, HttpContext context, PageStore store, IConfiguration configuration) =>
    {
      if (UserId(context.User) is not { } userId)
      {
        return Results.Forbid();
      }

      var access = store.AccessOf(doc, userId);

      if (access == PageAccess.None)
      {
        return Results.Forbid();
      }

      var secret = configuration["Blok:TicketSecret"]
        ?? throw new InvalidOperationException("Blok:TicketSecret is not set");
      var write = access == PageAccess.Write && store.Find(doc)?.TrashedAt is null;

      return Results.Ok(new
      {
        ticket = BlokTicket.Create(secret, new BlokTicketClaims { User = userId, Doc = doc, Write = write }),
      });
    });
  }
}
```

The standalone host has no `IBlokAuthorization`: the pass is the whole check. It lives five minutes by default, so a revoked user keeps it until it expires.

## Drain on shutdown: `DrainOnStop.cs`

`MapBlokServer` registers no drain; only the standalone host has one. Without it, a stop leaves your doc endpoint behind the rooms. A journal room writes back only on checkpoint, eviction or drain, so a page's record can stay `null` after a stop. The journal still holds the edits, but search and export read a stale record. `StoppingAsync` runs before Kestrel stops, so the rooms flush while your doc routes can still answer.

```csharp
// File: DrainOnStop.cs
using Blok.Server.Collab;

namespace PageHost;

public sealed class DrainOnStop(IServiceProvider services, ILogger<DrainOnStop> logger) : IHostedLifecycleService
{
  public async Task StoppingAsync(CancellationToken cancellationToken)
  {
    try
    {
      await services.GetRequiredService<ICollabRoomManager>().DrainAsync(cancellationToken);
    }
    catch (Exception error)
    {
      // Usually the shutdown timeout. Rooms log their own flush failures,
      // and Kestrel must still stop.
      logger.LogWarning(error, "collab: the shutdown drain did not complete");
    }
  }

  public Task StartingAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  public Task StartedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
```

Before you roll back from a journal to the working-copy profile, run the drill in `collab-rollback-boundary` and in the server README, "Going back to the working-copy profile".

## The page tool in the browser: `page-tool.ts`

`rename` and `setIcon` get no version, and `PageInfo` has none. So the adapter remembers the version of the record it last read and sends it. On a 409 it throws; Blok then asks `resolve` again and shows the host's title.

`resolve` returns `undefined` ("not known yet") for 401, 403 and any redirect, never `null`. `null` means the page is gone, and an expired session is not that.

```ts
// File: page-tool.ts
import { Blok } from '@bloklabs/core';
import { Page } from '@bloklabs/core/tools';
import type { PageConfig, PageIcon, PageInfo } from '@bloklabs/core/tools';

type HostIcon = { type: string; value: string | null; url: string | null };
type HostRecord = { pageId: string; title: string; icon: HostIcon | null; version: number };

const json = { 'content-type': 'application/json' };
// The CAS handle: the version of the record this tab last read.
const versions = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
let events: EventSource | null = null;

const notify = (pageId: string): void => listeners.get(pageId)?.forEach((listener) => listener());

const toIcon = (icon: HostIcon | null): PageIcon | undefined => {
  if (icon?.type === 'emoji' && icon.value !== null) {
    return { type: 'emoji', value: icon.value };
  }
  if (icon?.type === 'image' && icon.url !== null) {
    return { type: 'image', url: icon.url };
  }

  return undefined;
};

const toInfo = (record: HostRecord): PageInfo => {
  const icon = toIcon(record.icon);

  return icon === undefined ? { title: record.title } : { title: record.title, icon };
};

const write = async (pageId: string, path: 'title' | 'icon', payload: object): Promise<void> => {
  const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/${path}`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ ...payload, expectedVersion: versions.get(pageId) ?? 0 }),
  });

  if (!response.ok) {
    // 409 or 403: throw, and Blok asks resolve() again for the host's value.
    throw new Error(`page ${path} save failed: ${response.status}`);
  }
  versions.set(pageId, ((await response.json()) as HostRecord).version);
  notify(pageId);
};

export const pageConfig: PageConfig = {
  href: (pageId) => `/pages/${encodeURIComponent(pageId)}`,
  open: (pageId) => {
    window.location.assign(`/pages/${encodeURIComponent(pageId)}`);
  },
  create: async ({ pageId }) => {
    const response = await fetch('/api/pages', { method: 'POST', headers: json, body: JSON.stringify({ pageId }) });

    if (!response.ok) {
      throw new Error(`page create failed: ${response.status}`);
    }
    const record = (await response.json()) as HostRecord;

    versions.set(record.pageId, record.version);

    return { pageId: record.pageId };
  },
  resolve: async (pageId) => {
    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: 'no-store' });

    // Before the 404 check: a followed login redirect can end in a 404.
    if (response.redirected || response.status === 401 || response.status === 403) {
      return undefined;
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as HostRecord | { pageId: string; access: 'none' };

    if ('access' in body) {
      return { access: 'none' };
    }
    versions.set(pageId, body.version);

    return toInfo(body);
  },
  subscribe: (pageId, onChange) => {
    const set = listeners.get(pageId) ?? new Set<() => void>();

    set.add(onChange);
    listeners.set(pageId, set);
    if (events === null) {
      events = new EventSource('/api/pages/events');
      events.onmessage = (event: MessageEvent<string>) => notify((JSON.parse(event.data) as { pageId: string }).pageId);
      // The server dropped events for this tab: re-resolve every page.
      events.addEventListener('resync', () => listeners.forEach((_, id) => notify(id)));
    }

    return () => {
      set.delete(onChange);
    };
  },
  rename: (pageId, title) => write(pageId, 'title', { title }),
  setIcon: (pageId, icon) => write(pageId, 'icon', { icon }),
};

// The page body: its own Blok document, named by the page id.
export const openPageBody = (holder: HTMLElement, pageId: string): Blok =>
  new Blok({
    holder,
    server: '/api/blok',
    collaboration: { doc: pageId },
    tools: { page: { class: Page, config: { ...pageConfig } } },
  });
```

`config: { ...pageConfig }` is a spread on purpose: a `PageConfig` value is not assignable to the tool's `Record<string, unknown>` config type.

The version cache is per tab. A rename in another tab raises the version, and this tab's next rename gets 409 until `subscribe` makes it re-resolve. Blok then shows the host's title, so nothing is lost.

## Creating a page, step by step

| # | Who | What | Route |
| - | --- | --- | --- |
| 1 | user | picks Page in the toolbox | |
| 2 | Blok | mints an id and **awaits** `config.create({ pageId })` | |
| 3 | adapter | `create` posts it, remembers `version`, returns `{ pageId }` (the host id wins on this path) | `POST /api/pages`: 201 record; 200 on the creator's retry; 400 bad id; 409 the id exists for someone else or was deleted |
| 4 | host | inserts the page and the owner ACL row in one transaction; no body row yet | |
| 5 | Blok | inserts the block; the parent's room syncs it; the parent's next PUT carries `{ "type": "page", "data": { "pageId": … } }` | parent's `PUT {DocEndpoint}/{parentId}` |
| 6 | Blok | calls `config.open(pageId)`, then `resolve` | `GET /api/pages/{id}`: record, `access: 'none'`, or 404 (`null`) |
| 7 | Blok | `config.subscribe(pageId, onChange)` | `GET /api/pages/events` |
| 8 | app | navigates and mounts the body editor with `collaboration: { doc: pageId }` | `GET /api/blok/sync/{pageId}` (WebSocket) |
| 9 | server | `PageRules` checks read and write; an unknown id is refused here with 4403 | |
| 10 | room | `GET {DocEndpoint}/{pageId}` answers `{"data":null,"version":"0"}`: an empty page | doc endpoint GET |
| 11 | room | working copy: PUTs within 2 to 10 s of an edit. Journal: on checkpoint, eviction or drain, and once after a reopen even with no edit | doc endpoint PUT (upsert) |
| 12 | host | after the save commits: reindex owners, text and references | |

**From `blocks.insert('page')` without a `pageId`**, steps 2 and 3 differ. The block is inserted first and syncs to peers before `create` commits. A peer that opens it early gets 4403 from `PageRules`, and the block shows "Page not found" until `subscribe` reports the page. A returned id is ignored with a warning. Pass your own `pageId` to `insert` and commit the record first if you need neither.

**Commit the record before anything opens the body.** The 404 for an unknown id is this sample's choice, and it is safe only because the record exists before step 8.

**Do not poll `/state` for ids you are unsure exist.** It opens a room and asks your endpoint. Under a journal it also seeds the journal, so that page later gets the empty PUT above. Check your page record first.

## What this guide does not cover

- Moving pages between documents, and turning blocks into a page: `page-transfer-host.md`.
- Copying or exporting a page tree: `page-archive-host.md`.
- Writing your own operation store for more than one instance: the server README, "Live collaboration profiles".
