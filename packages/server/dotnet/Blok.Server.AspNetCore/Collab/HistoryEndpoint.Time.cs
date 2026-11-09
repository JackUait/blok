using System.Globalization;
using System.Text;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// History by time: <c>GET /sync/{doc}/history/at?time=</c> and
/// <c>GET /sync/{doc}/history/changes?from=&amp;to=&amp;before=</c>.
/// </summary>
internal static partial class HistoryEndpoint
{
  private const string BadTime = "time must be an ISO 8601 time with an offset\n";
  private const string BadRange = "from and to must be ISO 8601 times with an offset, from no later than to\n";
  private const string BadBefore = "before must be one <lineage>:<sequence>\n";
  private const string BadDetail = "detail must be properties\n";

  /// <summary>The longest ,"olderEnd":{...} an answer adds.</summary>
  private const int OlderEndBytes = 125;

  /// <summary>
  /// The newest point at or before the time: a redirect to it, or the point
  /// as JSON when the caller accepts JSON.
  /// </summary>
  public static async Task AtAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: false) is not { } admitted)
    {
      return;
    }

    if (!TryQueryTime(context, "time", out var time) || time is not { } at)
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, BadTime);

      return;
    }

    var result = await admitted.Rooms.AtAsync(admitted.Doc, at, context.RequestAborted);

    if (result.Status == CollabHistoryStatus.NotFound)
    {
      context.Response.StatusCode = StatusCodes.Status404NotFound;
      context.Response.ContentType = "application/json";
      await context.Response.WriteAsync("{\"reason\":\"not_found\"}", context.RequestAborted);

      return;
    }

    if (result.Status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.Status);

      return;
    }

    var point = result.Point!;

    WriteHistoryHead(context, point.Lineage, point.Sequence);

    if (!AcceptsJson(context))
    {
      // Relative, so it keeps the mount prefix and the doc as sent.
      context.Response.StatusCode = StatusCodes.Status302Found;
      context.Response.Headers.Location = $"{point.Lineage}/{point.Sequence.ToString(CultureInfo.InvariantCulture)}";
      context.Response.ContentLength = 0;

      return;
    }

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "application/json";
    await context.Response.Body.WriteAsync(Point(point.Lineage, point.Sequence, point.CommittedAt), context.RequestAborted);
  }

  /// <summary>Each record's edits in [from, to), newest first across lineages. The default range is the last 24 hours.</summary>
  public static async Task ChangesBetweenAsync(HttpContext context)
  {
    if (await AdmitAsync(context, requireWrite: false) is not { } admitted)
    {
      return;
    }

    if (!TryQueryTime(context, "from", out var from) || !TryQueryTime(context, "to", out var to))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, BadRange);

      return;
    }

    var end = to ?? DateTimeOffset.UtcNow;
    var start = from ?? new DateTimeOffset(
        Math.Max(0, end.UtcTicks - CollabHistoryTime.DefaultRange.Ticks),
        TimeSpan.Zero);

    if (start > end)
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, BadRange);

      return;
    }

    if (!TryQueryPoint(context, "before", out var before))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, BadBefore);

      return;
    }

    if (!TryQueryDetail(context, out var detail))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status400BadRequest, BadDetail);

      return;
    }

    var result = await admitted.Rooms.ChangesBetweenAsync(
        admitted.Doc,
        start,
        end,
        before,
        cancellationToken: context.RequestAborted);

    if (result.Status != CollabHistoryStatus.Ready)
    {
      await RefuseAsync(context, admitted, result.Status);

      return;
    }

    var rows = new List<byte[]>();
    long size = ChangesEnvelopeBytes + OlderEndBytes;
    var truncated = result.Truncated;

    foreach (var record in result.Records)
    {
      var row = ChangeRow(record.Changes, detail);
      var prefix = Encoding.UTF8.GetBytes($"{{\"lineage\":\"{record.Lineage}\",");
      var lineaged = new byte[prefix.Length + row.Length - 1];

      prefix.CopyTo(lineaged, 0);
      row.AsSpan(1).CopyTo(lineaged.AsSpan(prefix.Length));

      if (rows.Count > 0 && size + lineaged.Length + 1 > CollabRoomManager.MaxChangeBytes)
      {
        truncated = true;

        break;
      }

      rows.Add(lineaged);
      size += lineaged.Length + 1;
    }

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
      var oldest = result.Records[rows.Count - 1];

      await body.WriteAsync(OlderEnd(oldest.Lineage, oldest.Changes.Sequence, oldest.Changes.CommittedAt), cancel);
    }

    await body.WriteAsync("}"u8.ToArray(), cancel);
  }

  /// <summary>,"truncated":true,"olderEnd":{...}: the oldest record in the answer, so a caller can ask for what is older.</summary>
  private static byte[] OlderEnd(string lineage, ulong sequence, DateTimeOffset committedAt) =>
      [.. ",\"truncated\":true,\"olderEnd\":"u8, .. Point(lineage, sequence, committedAt)];

  // Lineages are 32 hex digits, so they need no escaping.
  private static byte[] Point(string lineage, ulong sequence, DateTimeOffset? at) => Encoding.UTF8.GetBytes(
      $"{{\"lineage\":\"{lineage}\",\"sequence\":{sequence.ToString(CultureInfo.InvariantCulture)}," +
      $"\"committedAt\":{(at is { } value ? value.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture) : "null")}}}");

  /// <summary>Absent is null; a repeated value or one the time format refuses is false.</summary>
  private static bool TryQueryTime(HttpContext context, string name, out DateTimeOffset? value)
  {
    value = null;

    if (!context.Request.Query.TryGetValue(name, out var values))
    {
      return true;
    }

    if (values.Count != 1 || !CollabHistoryTime.TryParse(values[0], out var at))
    {
      return false;
    }

    value = at;

    return true;
  }

  /// <summary>Reads &lt;lineage&gt;:&lt;sequence&gt;; absent is null.</summary>
  private static bool TryQueryPoint(HttpContext context, string name, out (string Lineage, ulong Sequence)? value)
  {
    value = null;

    if (!context.Request.Query.TryGetValue(name, out var values))
    {
      return true;
    }

    var text = values.Count == 1 ? values[0] ?? "" : "";
    var colon = text.IndexOf(':', StringComparison.Ordinal);

    if (colon < 0 ||
        !CollabWorkingSetTag.IsLineage(text[..colon]) ||
        !ulong.TryParse(text[(colon + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var sequence))
    {
      return false;
    }

    value = (text[..colon], sequence);

    return true;
  }

  /// <summary>Absent is false; only one detail=properties is true.</summary>
  private static bool TryQueryDetail(HttpContext context, out bool detail)
  {
    detail = context.Request.Query.TryGetValue("detail", out var values);

    return !detail || (values.Count == 1 && values[0] == "properties");
  }

  /// <summary>Some Accept entry is application/json, ignoring case and parameters. */* is a redirect.</summary>
  private static bool AcceptsJson(HttpContext context)
  {
    foreach (var value in context.Request.Headers.Accept)
    {
      foreach (var entry in (value ?? "").Split(','))
      {
        var mediaType = entry.Split(';')[0].Trim();

        if (string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase))
        {
          return true;
        }
      }
    }

    return false;
  }
}
