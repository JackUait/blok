using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// The version history kept by the operation journal:
/// <c>GET /sync/{doc}/history</c>, <c>GET /sync/{doc}/history/{lineage}/{sequence}</c>,
/// <c>DELETE /sync/{doc}/history/{lineage}</c>,
/// <c>POST /sync/{doc}/history/{lineage}/{sequence}/restore</c> and
/// <c>GET /sync/{doc}/history/{lineage}/{sequence}/changes</c>.
///
/// Same door as the edit endpoint: the HTTP guard checks origin, ticket and
/// rate limit, and these handlers add the ticket's doc claim and the
/// application's gates — read for the GETs, read and write for the rest.
/// </summary>
internal static class HistoryEndpoint
{
  private const string LineageHeader = "Blok-History-Lineage";
  private const string SequenceHeader = "Blok-History-Sequence";
  private const string NoSuchVersion = "no such version\n";

  // The standalone host forwards only this category to stderr.
  private const string LogCategory = "Blok.Server.Collab";

  private static readonly Action<ILogger, string, Exception?> LogCorrupt =
      LoggerMessage.Define<string>(
          LogLevel.Error,
          new EventId(3, "CollabHistoryCorrupt"),
          "collab: a stored version of \"{Document}\" could not be read");

  public static async Task ListAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: false) is not { } admitted)
    {
      return;
    }

    if (!TryQueryNumber(context, "group", out var minutes) || minutes is not (null or 1 or 15 or 60))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, "group must be 1, 15 or 60\n");

      return;
    }

    var result = await admitted.Rooms.HistoryAsync(
        admitted.Doc,
        minutes is { } window ? TimeSpan.FromMinutes(window) : null,
        context.RequestAborted);

    if (result.Status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.Status);

      return;
    }

    var body = new JsonObject
    {
      ["lineages"] = new JsonArray([.. result.Lineages.Select(lineage => (JsonNode)new JsonObject
      {
        ["lineage"] = lineage.Lineage,
        ["epoch"] = lineage.Epoch,
        ["format"] = lineage.Format,
        ["createdAt"] = UnixMilliseconds(lineage.CreatedAt),
        ["current"] = lineage.Current,
      })]),
      ["versions"] = new JsonArray([.. result.Versions.Select(version => (JsonNode)new JsonObject
      {
        ["lineage"] = version.Lineage,
        ["sequence"] = version.Sequence,
        ["startedAt"] = UnixMilliseconds(version.StartedAt),
        ["savedAt"] = UnixMilliseconds(version.SavedAt),
        ["actors"] = new JsonArray([.. version.Actors.Select(actor => (JsonNode)actor)]),
      })]),
    };

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync(body.ToJsonString(), context.RequestAborted);
  }

  public static async Task ReadAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: false) is not { } admitted ||
        await PointAsync(context) is not { } point)
    {
      return;
    }

    var result = await admitted.Rooms.ReadVersionAsync(
        admitted.Doc,
        point.Lineage,
        point.Sequence,
        context.RequestAborted);

    if (result.Status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.Status);

      return;
    }

    WriteHistoryHead(context, point.Lineage, point.Sequence);
    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";
    await context.Response.Body.WriteAsync(result.Json, context.RequestAborted);
  }

  /// <summary>
  /// The edits of each record in (since, sequence]. Only the client knows
  /// which grouping it shows, so it names the previous version's sequence.
  /// </summary>
  public static async Task ChangesAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: false) is not { } admitted ||
        await PointAsync(context) is not { } point)
    {
      return;
    }

    if (!TryQueryNumber(context, "since", out var since) || since > point.Sequence)
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          "since must be a whole number no greater than the sequence\n");

      return;
    }

    var result = await admitted.Rooms.ChangesAsync(
        admitted.Doc,
        point.Lineage,
        point.Sequence,
        since ?? 0,
        cancellationToken: context.RequestAborted);

    if (result.Status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.Status);

      return;
    }

    var body = new JsonObject
    {
      ["changes"] = new JsonArray([.. result.Changes.Select(record =>
      {
        var entry = new JsonObject
        {
          ["sequence"] = record.Sequence,
          ["committedAt"] = record.CommittedAt.ToUnixTimeMilliseconds(),
          ["actor"] = record.ActorId,
          ["blocks"] = new JsonArray([.. record.Blocks.Select(BlockChange)]),
        };

        if (record.Page.Count > 0)
        {
          entry["page"] = new JsonArray([.. record.Page.Select(key => (JsonNode)key)]);
        }

        return (JsonNode)entry;
      })]),
    };

    if (result.Truncated)
    {
      body["truncated"] = true;
    }

    WriteHistoryHead(context, point.Lineage, point.Sequence);
    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync(body.ToJsonString(), context.RequestAborted);
  }

  public static async Task DeleteAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: true) is not { } admitted ||
        await LineageAsync(context) is not { } lineage)
    {
      return;
    }

    var (status, outcome) = await admitted.Rooms.DeleteLineageAsync(
        admitted.Doc,
        lineage,
        context.RequestAborted);

    if (status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, status);

      return;
    }

    switch (outcome)
    {
      case CollabLineageDeleteOutcome.Deleted:
        context.Response.StatusCode = StatusCodes.Status204NoContent;

        return;

      case CollabLineageDeleteOutcome.Current:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status409Conflict,
            "the document is on this lineage; it cannot be deleted\n");

        return;

      case CollabLineageDeleteOutcome.Purged:
        await RefuseAsync(context, admitted, CollabHistoryStatus.Purged);

        return;

      default:
        await RefuseAsync(context, admitted, CollabHistoryStatus.NotFound);

        return;
    }
  }

  public static async Task RestoreAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: true) is not { } admitted ||
        await PointAsync(context) is not { } point)
    {
      return;
    }

    var header = EditEndpoint.IdempotencyKeyHeader;

    if (!context.Request.Headers.TryGetValue(header, out var keys) ||
        keys.Count != 1 ||
        !CollabEditOps.TryNormalizeIdempotencyKey(keys[0], out var operationId))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          $"a valid {header} header is required\n");

      return;
    }

    CollabEditPrecondition? expect = null;

    if (context.Request.Headers.ContainsKey(HeaderNames.IfMatch) &&
        !EditEndpoint.TryParseEntityTag(context.Request.Headers.IfMatch, out expect))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n");

      return;
    }

    var result = await admitted.Rooms.RestoreAsync(
        admitted.Doc,
        point.Lineage,
        point.Sequence,
        operationId,
        SyncHandshake.DeriveActor(admitted.TicketUser, admitted.User),
        expect,
        context.RequestAborted);

    if (result.History != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.History);

      return;
    }

    var edit = result.Edit ?? throw new UnreachableException("a ready restore carries its edit");

    await EditEndpoint.WriteResultAsync(context, edit, admitted.Rooms.RetryAfter);
  }

  /// <summary>
  /// The checks every route shares, in the edit endpoint's order. Answers
  /// null once it has refused.
  /// </summary>
  private static async Task<Admitted?> AdmitAsync(HttpContext context, bool requireWrite)
  {
    // Versions are document content behind an access check: no shared cache may keep any answer.
    context.Response.Headers.CacheControl = "no-store";

    var doc = SyncEndpoint.RouteDoc(context);

    if (!SyncEndpoint.IsSingleSegment(doc))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          $"{SyncClose.BadDocument.Reason}\n");

      return null;
    }

    var claims = context.Features.Get<TicketClaimsFeature>()?.Claims;

    if (claims is { } ticket &&
        !string.Equals(ticket.Document, doc, StringComparison.Ordinal))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status403Forbidden,
          "pass is for another document\n");

      return null;
    }

    var authorization = context.RequestServices.GetService<IBlokAuthorization>();
    // In ticket mode the pass is the identity; context.User is empty there.
    var user = claims is null ? context.User : TicketPrincipal.For(claims.Value);

    if (authorization is not null &&
        (!await authorization.CanReadDocumentAsync(user, doc, context.RequestAborted) ||
         (requireWrite && !await authorization.CanWriteDocumentAsync(user, doc, context.RequestAborted))))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

      return null;
    }

    return new Admitted(
        doc,
        user,
        claims is { } actorTicket ? actorTicket.User : "",
        context.RequestServices.GetRequiredService<CollabRoomManager>());
  }

  /// <summary>The route's lineage and sequence; a sequence that is not a plain ulong is refused.</summary>
  private static async Task<(string Lineage, ulong Sequence)?> PointAsync(HttpContext context)
  {
    if (await LineageAsync(context) is not { } lineage)
    {
      return null;
    }

    var digits = context.Request.RouteValues["sequence"] as string ?? "";

    // NumberStyles.None: the default would take "+1" and surrounding spaces.
    if (!ulong.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          "the sequence must be a whole number\n");

      return null;
    }

    return (lineage, sequence);
  }

  /// <summary>
  /// An optional query number, parsed like the route's sequence. Absent is
  /// null; a repeated, empty or signed value is false.
  /// </summary>
  private static bool TryQueryNumber(HttpContext context, string name, out ulong? value)
  {
    value = null;

    if (!context.Request.Query.TryGetValue(name, out var values))
    {
      return true;
    }

    // NumberStyles.None: the default would take "+1" and surrounding spaces.
    if (values.Count != 1 ||
        !ulong.TryParse(values[0], NumberStyles.None, CultureInfo.InvariantCulture, out var number))
    {
      return false;
    }

    value = number;

    return true;
  }

  /// <summary>The route's lineage. Anything not shaped like one is a 404 and never reaches the store.</summary>
  private static async Task<string?> LineageAsync(HttpContext context)
  {
    var lineage = context.Request.RouteValues["lineage"] as string;

    if (CollabWorkingSetTag.IsLineage(lineage))
    {
      return lineage;
    }

    await SyncEndpoint.RefuseAsync(context, StatusCodes.Status404NotFound, NoSuchVersion);

    return null;
  }

  /// <summary>Not Blok-Doc-*: those name the live head and feed If-Match.</summary>
  private static void WriteHistoryHead(HttpContext context, string lineage, ulong sequence)
  {
    context.Response.Headers[LineageHeader] = lineage;
    context.Response.Headers[SequenceHeader] = sequence.ToString(CultureInfo.InvariantCulture);
    EditEndpoint.Expose(context, LineageHeader, SequenceHeader);
  }

  /// <summary>Cloned: a block can be one record's after and the next one's before.</summary>
  private static JsonNode BlockChange(CollabBlockChange change)
  {
    var entry = new JsonObject
    {
      ["id"] = change.Id,
      ["type"] = change.Type,
      ["kind"] = change.Kind switch
      {
        CollabBlockChangeKind.Added => "added",
        CollabBlockChangeKind.Removed => "removed",
        CollabBlockChangeKind.Changed => "changed",
        _ => "moved",
      },
    };

    if (change.Before is { } before)
    {
      entry["before"] = before.DeepClone();
    }

    if (change.After is { } after)
    {
      entry["after"] = after.DeepClone();
    }

    return entry;
  }

  private static JsonValue? UnixMilliseconds(DateTimeOffset? at)
  {
    return at is { } value ? JsonValue.Create(value.ToUnixTimeMilliseconds()) : null;
  }

  private static Task RefuseAsync(HttpContext context, Admitted admitted, CollabHistoryStatus status)
  {
    switch (status)
    {
      case CollabHistoryStatus.NoHistory:
        return SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status501NotImplemented,
            "history needs a journal that keeps it\n");

      case CollabHistoryStatus.NotFound:
        return SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status404NotFound,
            NoSuchVersion);

      case CollabHistoryStatus.Purged:
        return SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

      // As /state: a converter limit a retry may pass is a 503, a version it
      // can never write is a 500.
      case CollabHistoryStatus.Unavailable:
        return SyncEndpoint.RefuseRetryLaterAsync(
            context,
            admitted.Rooms.RetryAfter,
            "the server ran past its limits exporting this version, retry\n");

      case CollabHistoryStatus.ExportFailed:
        return SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status500InternalServerError,
            "the version could not be exported\n");

      case CollabHistoryStatus.Corrupt:
        var logger = context.RequestServices.GetService<ILoggerFactory>()?.CreateLogger(LogCategory);

        if (logger is not null)
        {
          LogCorrupt(logger, admitted.Doc, null);
        }

        return SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status500InternalServerError,
            "a stored version could not be read\n");

      default:
        throw new UnreachableException($"history status {status} is not a refusal");
    }
  }

  private sealed record Admitted(
      string Doc,
      ClaimsPrincipal User,
      string TicketUser,
      CollabRoomManager Rooms);
}
