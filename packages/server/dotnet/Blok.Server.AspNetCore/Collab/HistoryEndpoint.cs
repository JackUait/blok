using System.Buffers;
using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
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
/// <c>POST /sync/{doc}/history/{lineage}/{sequence}/restore</c>,
/// <c>POST /sync/{doc}/history/{lineage}/{sequence}/restore/preview</c> and
/// <c>GET /sync/{doc}/history/{lineage}/{sequence}/changes</c>.
///
/// Same door as the edit endpoint: the HTTP guard checks origin, ticket and
/// rate limit, and these handlers add the ticket's doc claim and the
/// application's gates — read for the GETs, read and write for the rest.
/// </summary>
internal static partial class HistoryEndpoint
{
  private const string LineageHeader = "Blok-History-Lineage";
  private const string SequenceHeader = "Blok-History-Sequence";
  private const string NoSuchVersion = "no such version\n";

  /// <summary>{"changes":[ and ],"truncated":true}.</summary>
  private const int ChangesEnvelopeBytes = 32;

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

    // Shipped route: any other by is ignored, as unknown keys always were.
    var byActor = context.Request.Query.TryGetValue("by", out var by) && by.Count == 1 && by[0] == "actor";

    var result = await admitted.Rooms.HistoryAsync(
        admitted.Doc,
        minutes is { } window ? TimeSpan.FromMinutes(window) : null,
        byActor,
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
      ["versions"] = new JsonArray([.. result.Versions.Select(version =>
      {
        var entry = new JsonObject
        {
          ["lineage"] = version.Lineage,
          ["sequence"] = version.Sequence,
          ["startedAt"] = UnixMilliseconds(version.StartedAt),
          ["savedAt"] = UnixMilliseconds(version.SavedAt),
          ["actors"] = new JsonArray([.. version.Actors.Select(actor => (JsonNode)actor)]),
        };

        if (version.ActorKinds is { } kinds)
        {
          entry["actorKinds"] = new JsonArray([.. kinds.Select(kind => (JsonNode)ActorKindJson(kind.Id, kind.Note))]);
        }

        return (JsonNode)entry;
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

    // v2.1.0 ignored unknown keys here, so a bad detail or block is ignored, not refused.
    var detail = TryQueryDetail(context, out var asked) && asked;
    TryQueryBlock(context, out var block);

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

    var notes = await admitted.Rooms.ReadNotesAsync(admitted.Doc, point.Lineage, context.RequestAborted);

    // Rows are measured newest first; the newest always goes out, so a reader can page.
    var rows = new List<byte[]>();
    var shown = new List<CollabRecordChanges>();

    for (var index = result.Changes.Count - 1; index >= 0; index--)
    {
      if (Narrowed(result.Changes[index], block) is { } record)
      {
        rows.Add(ChangeRow(record, detail, notes));
        shown.Add(record);
      }
    }

    // Cut by the room with every row kept, the answer ends at the oldest
    // record read, so a narrowed answer still moves its cursor.
    // Counted before the cut below: after it, every index would look like the last row.
    var rowCount = rows.Count;
    CollabRecordChanges OlderEndOf(int oldest) =>
        oldest == rowCount - 1 && result.Changes.Count > 0 ? result.Changes[0] : shown[oldest];

    var (kept, truncated) = FitAnswer(rows, result.Truncated, oldest =>
    {
      var record = OlderEndOf(oldest);

      return OlderEnd(point.Lineage, record.Sequence, record.CommittedAt).Length;
    });

    rows = rows[..kept];
    rows.Reverse();

    WriteHistoryHead(context, point.Lineage, point.Sequence);
    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";

    var body = context.Response.Body;
    var cancel = context.RequestAborted;

    await body.WriteAsync("{\"changes\":["u8.ToArray(), cancel);

    for (var index = 0; index < rows.Count; index++)
    {
      if (index > 0)
      {
        await body.WriteAsync(","u8.ToArray(), cancel);
      }

      await body.WriteAsync(rows[index], cancel);
    }

    await body.WriteAsync("]"u8.ToArray(), cancel);

    if (truncated)
    {
      var oldest = OlderEndOf(kept - 1);

      await body.WriteAsync(OlderEnd(point.Lineage, oldest.Sequence, oldest.CommittedAt), cancel);
    }

    await body.WriteAsync("}"u8.ToArray(), cancel);
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

    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var confirmed = options.CollabEnforceRestoreGuards
      ? await RestoreConfirmsAsync(context, options.CollabMaxMessageBytes)
      : null;
    var result = await admitted.Rooms.RestoreAsync(
        admitted.Doc,
        point.Lineage,
        point.Sequence,
        operationId,
        SyncHandshake.DeriveActor(admitted.TicketUser, admitted.User),
        expect,
        confirmed,
        context.RequestAborted);

    if (result.History != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.History);

      return;
    }

    if (result.Refused is { } refused)
    {
      await RefuseRestoreAsync(context, "confirmation_required", refused);

      return;
    }

    var edit = result.Edit ?? throw new UnreachableException("a ready restore carries its edit");

    await EditEndpoint.WriteResultAsync(context, edit, admitted.Rooms.RetryAfter);
  }

  /// <summary>
  /// <c>POST .../restore/preview</c>: the restore planned and measured, nothing written, no key needed.
  /// It needs write access, as the restore does. If-Match is checked as the restore would.
  /// </summary>
  public static async Task PreviewRestoreAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: true) is not { } admitted ||
        await PointAsync(context) is not { } point)
    {
      return;
    }

    var (lineage, sequence) = point;
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

    var result = await admitted.Rooms.PreviewRestoreAsync(
        admitted.Doc,
        lineage,
        sequence,
        expect,
        SyncHandshake.DeriveActor(admitted.TicketUser, admitted.User),
        context.RequestAborted);

    if (result.History != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.History);

      return;
    }

    if (result.Preview is not { } preview)
    {
      var edit = result.Edit ?? throw new UnreachableException("a preview that did not run carries its edit");

      await EditEndpoint.WriteResultAsync(context, edit, admitted.Rooms.RetryAfter);

      return;
    }

    var body = new JsonObject
    {
      ["wouldUndo"] = new JsonObject
      {
        ["blocks"] = new JsonArray([.. preview.Blocks.Select(change => (JsonNode)new JsonObject
        {
          ["id"] = change.Id,
          ["type"] = change.Type,
          ["kind"] = KindName(change.Kind),
        })]),
        ["page"] = new JsonArray([.. preview.Page.Select(key => (JsonNode)key)]),
      },
      ["guards"] = new JsonArray([.. preview.Guards.Select(guard => (JsonNode)guard.ToJson())]),
      ["fits"] = preview.FrameBytes <= preview.LimitBytes,
      ["frameBytes"] = preview.FrameBytes,
      ["limitBytes"] = preview.LimitBytes,
      ["expectRevision"] = string.Create(
          CultureInfo.InvariantCulture,
          $"{preview.Head.Tag.Lineage}:{preview.Head.ServerSequence}"),
    };

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync(body.ToJsonString(), context.RequestAborted);
  }

  private static string KindName(CollabBlockChangeKind kind) => kind switch
  {
    CollabBlockChangeKind.Added => "added",
    CollabBlockChangeKind.Removed => "removed",
    CollabBlockChangeKind.Changed => "changed",
    _ => "moved",
  };

  /// <summary>Lists the guard kinds a restore confirms; a body <c>{"confirm":[...]}</c> adds to it.</summary>
  internal const string RestoreConfirmHeader = "X-Blok-Restore-Confirm";

  /// <summary>Marks a guard's 409, which the key-reuse 409 lacks.</summary>
  internal const string RestoreRefusalHeader = "X-Blok-Restore-Refusal";

  /// <summary>
  /// The kinds from every header line and comma item, then the body's confirm list. Unknown kinds and a
  /// body that does not parse or is over the cap confirm nothing.
  /// </summary>
  private static async Task<IReadOnlySet<string>> RestoreConfirmsAsync(HttpContext context, int maxBytes)
  {
    var confirmed = new HashSet<string>(StringComparer.Ordinal);

    void Add(string? kind)
    {
      if (kind is not null && CollabRestoreGuard.Confirmable.Contains(kind))
      {
        confirmed.Add(kind);
      }
    }

    foreach (var line in context.Request.Headers[RestoreConfirmHeader])
    {
      foreach (var item in (line ?? "").Split(','))
      {
        Add(item.Trim(' ', '\t'));
      }
    }

    using var buffer = new MemoryStream();
    var chunk = new byte[8192];
    int read;

    while ((read = await context.Request.Body.ReadAsync(chunk, context.RequestAborted)) > 0)
    {
      if (buffer.Length + read > maxBytes)
      {
        return confirmed;
      }

      buffer.Write(chunk, 0, read);
    }

    try
    {
      if (buffer.Length > 0 && JsonNode.Parse(buffer.ToArray()) is JsonObject body && body["confirm"] is JsonArray list)
      {
        foreach (var item in list)
        {
          Add(item is JsonValue value && value.TryGetValue<string>(out var kind) ? kind : null);
        }
      }
    }
    catch (Exception error) when (error is JsonException or ArgumentException)
    {
      // Not JSON, or an object with a repeated key: it confirms nothing.
    }

    return confirmed;
  }

  /// <summary>The guard's 409: JSON with the refusal header, so a client never mistakes it for a reused key.</summary>
  private static async Task RefuseRestoreAsync(HttpContext context, string reason, IReadOnlyList<CollabRestoreGuard> guards)
  {
    var body = new JsonObject
    {
      ["error"] = reason,
      ["guards"] = new JsonArray([.. guards.Select(guard => (JsonNode)guard.ToJson())]),
    };

    context.Response.StatusCode = StatusCodes.Status409Conflict;
    context.Response.ContentType = "application/json";
    context.Response.Headers[RestoreRefusalHeader] = reason;
    await context.Response.WriteAsync(body.ToJsonString(), context.RequestAborted);
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

  /// <summary>
  /// One changes row as UTF-8 JSON. With <paramref name="detail"/>, a changed
  /// database or row also carries what changed inside its data.
  /// </summary>
  private static byte[] ChangeRow(
      CollabRecordChanges record,
      bool detail,
      IReadOnlyDictionary<ulong, CollabRecordNote>? notes)
  {
    var buffer = new ArrayBufferWriter<byte>();

    using (var writer = new Utf8JsonWriter(buffer))
    {
      writer.WriteStartObject();
      writer.WriteNumber("sequence", record.Sequence);
      writer.WriteNumber("committedAt", record.CommittedAt.ToUnixTimeMilliseconds());
      writer.WriteString("actor", record.ActorId);

      // With a record notes store only; a record without a note has none.
      if (notes is not null)
      {
        writer.WritePropertyName("actors");
        writer.WriteStartArray();

        if (record.ActorId is { } actor && notes.TryGetValue(record.Sequence, out var note))
        {
          ActorKindJson(actor, note).WriteTo(writer);
        }

        writer.WriteEndArray();
      }

      writer.WriteStartArray("blocks");

      foreach (var change in record.Blocks)
      {
        writer.WriteStartObject();
        writer.WriteString("id", change.Id);
        writer.WriteString("type", change.Type);
        writer.WriteString("kind", KindName(change.Kind));

        if (change.Before is { } before)
        {
          writer.WritePropertyName("before");
          before.WriteTo(writer);
        }

        if (change.After is { } after)
        {
          writer.WritePropertyName("after");
          after.WriteTo(writer);
        }

        if (detail && change.Kind == CollabBlockChangeKind.Changed)
        {
          foreach (var (name, value) in CollabDatabaseChanges.Describe(change.Type, change.Before, change.After))
          {
            writer.WritePropertyName(name);

            if (value is null)
            {
              writer.WriteNullValue();
            }
            else
            {
              value.WriteTo(writer);
            }
          }
        }

        writer.WriteEndObject();
      }

      writer.WriteEndArray();

      if (record.Page.Count > 0)
      {
        writer.WriteStartArray("page");

        foreach (var key in record.Page)
        {
          writer.WriteStringValue(key);
        }

        writer.WriteEndArray();
      }

      writer.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  /// <summary>{id, kind, onBehalfOf?}.</summary>
  private static JsonObject ActorKindJson(string id, CollabRecordNote note)
  {
    var json = new JsonObject { ["id"] = id, ["kind"] = note.Kind };

    if (note.OnBehalfOf is { } person)
    {
      json["onBehalfOf"] = person;
    }

    return json;
  }

  private static CollabRecordChanges? Narrowed(CollabRecordChanges record, string? block) =>
      block is null ? record : CollabVersionChanges.ForBlock(record, block);

  /// <summary>Absent is null; anything but one non-empty value is false.</summary>
  private static bool TryQueryBlock(HttpContext context, out string? block)
  {
    block = null;

    if (!context.Request.Query.TryGetValue("block", out var values))
    {
      return true;
    }

    if (values.Count != 1 || string.IsNullOrEmpty(values[0]))
    {
      return false;
    }

    block = values[0];

    return true;
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
