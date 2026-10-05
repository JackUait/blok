using System.Globalization;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// POST /sync/{doc}/edit: block-level edits from a consumer backend that is
/// not a WebSocket peer. Same door as the reset endpoint — the HTTP guard
/// checks origin, write ticket and rate limit, and this handler adds the
/// ticket's doc claim and the application's read and write gates.
///
/// The body is read under the same ceiling one sync message gets. A caller
/// able to POST an unbounded document could otherwise grow it past what any
/// client can ever receive, locking everyone out of the room they just filled.
/// </summary>
internal static class EditEndpoint
{
  private const string IdempotencyKeyHeader = "Blok-Idempotency-Key";
  private const string LineageHeader = "Blok-Doc-Lineage";
  private const string SequenceHeader = "Blok-Doc-Sequence";

  public static async Task HandleAsync(HttpContext context)
  {
    var doc = SyncEndpoint.RouteDoc(context);

    if (!SyncEndpoint.IsSingleSegment(doc))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          $"{SyncClose.BadDocument.Reason}\n");

      return;
    }

    var claims = context.Features.Get<TicketClaimsFeature>()?.Claims;

    if (claims is { } ticket &&
        !string.Equals(ticket.Document, doc, StringComparison.Ordinal))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status403Forbidden,
          "pass is for another document\n");

      return;
    }

    var authorization = context.RequestServices.GetService<IBlokAuthorization>();
    // In ticket mode the pass is the identity; context.User is empty there.
    var user = claims is null ? context.User : TicketPrincipal.For(claims.Value);

    if (authorization is not null &&
        (!await authorization.CanReadDocumentAsync(user, doc, context.RequestAborted) ||
         !await authorization.CanWriteDocumentAsync(user, doc, context.RequestAborted)))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

      return;
    }

    if (!context.Request.Headers.TryGetValue(IdempotencyKeyHeader, out var keys) ||
        keys.Count != 1 ||
        !CollabEditOps.TryNormalizeIdempotencyKey(keys[0], out var operationId))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          $"a valid {IdempotencyKeyHeader} header is required\n");

      return;
    }

    CollabEditPrecondition? expect = null;

    if (context.Request.Headers.ContainsKey(HeaderNames.IfMatch) &&
        !TryParseEntityTag(context.Request.Headers.IfMatch, out expect))
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status400BadRequest,
          "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n");

      return;
    }

    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var body = await ReadBodyAsync(context, options.CollabMaxMessageBytes);

    if (body is null)
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status413PayloadTooLarge,
          $"an edit request is at most {options.CollabMaxMessageBytes} bytes\n");

      return;
    }

    IReadOnlyList<CollabEditOp> ops;

    try
    {
      ops = CollabEditOps.Parse(body);
    }
    catch (CollabEditException refusal)
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status422UnprocessableEntity,
          $"{refusal.Message}\n");

      return;
    }

    var rooms = context.RequestServices.GetRequiredService<CollabRoomManager>();
    var actorId = SyncHandshake.DeriveActor(
        claims is { } actorTicket ? actorTicket.User : "",
        user);
    var result = await rooms.EditAsync(
        doc,
        ops,
        operationId,
        CollabEditOps.CanonicalBodyDigest(ops),
        actorId,
        expect,
        context.RequestAborted);

    switch (result.Status)
    {
      case CollabEditStatus.Applied:
        if (result.Receipt is { } receipt)
        {
          WriteHead(context, receipt.Tag.Lineage, receipt.ServerSequence);
        }

        context.Response.StatusCode = StatusCodes.Status204NoContent;

        return;

      case CollabEditStatus.PreconditionFailed:
        if (result.Receipt is { } head)
        {
          WriteHead(context, head.Tag.Lineage, head.ServerSequence);
        }

        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status412PreconditionFailed,
            "the document is no longer at the If-Match head\n");

        return;

      case CollabEditStatus.PreconditionRequired:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status428PreconditionRequired,
            "If-Match needs the operation journal, and this server keeps none\n");

        return;

      case CollabEditStatus.Conflict:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status409Conflict,
            "the idempotency key was already used for a different edit\n");

        return;

      case CollabEditStatus.Invalid:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status422UnprocessableEntity,
            $"{result.Error?.Message ?? "collab: the edit was refused."}\n");

        return;

      case CollabEditStatus.Purged:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status403Forbidden,
            "forbidden\n");

        return;

      case CollabEditStatus.Unavailable:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status503ServiceUnavailable,
            "the document is unavailable, retry\n");

        return;

      default:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status503ServiceUnavailable,
            "the document could not be loaded\n");

        return;
    }
  }

  /// <summary>Sets Blok-Doc-Lineage and Blok-Doc-Sequence; If-Match and the /state ETag use the same two values.</summary>
  internal static void WriteHead(HttpContext context, string lineage, ulong sequence)
  {
    context.Response.Headers[LineageHeader] = lineage;
    context.Response.Headers[SequenceHeader] = sequence.ToString(CultureInfo.InvariantCulture);

    // A browser hides non-safelisted headers from a cross-origin page unless
    // they are exposed; without this it cannot build If-Match or read a 412.
    // Merged, not replaced: the host's own CORS layer may have exposed others.
    if (context.Response.Headers.ContainsKey(HeaderNames.AccessControlAllowOrigin))
    {
      var exposed = context.Response.Headers.AccessControlExposeHeaders
          .SelectMany(value => (value ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
          .ToList();

      foreach (var name in new[] { LineageHeader, SequenceHeader, HeaderNames.ETag })
      {
        if (!exposed.Contains(name, StringComparer.OrdinalIgnoreCase))
        {
          exposed.Add(name);
        }
      }

      context.Response.Headers.AccessControlExposeHeaders = string.Join(", ", exposed);
    }
  }

  /// <summary>The strong entity tag for one journal head: <c>"&lt;lineage&gt;:&lt;sequence&gt;"</c>.</summary>
  internal static string EntityTag(string lineage, ulong sequence)
  {
    return $"\"{lineage}:{sequence.ToString(CultureInfo.InvariantCulture)}\"";
  }

  /// <summary>
  /// Exactly one strong tag in the form <see cref="EntityTag"/> prints. A list,
  /// <c>*</c> or a weak tag is refused rather than half-read: a caller that
  /// meant a guard must not get an unguarded write.
  /// </summary>
  private static bool TryParseEntityTag(StringValues values, out CollabEditPrecondition? expect)
  {
    expect = null;

    if (values.Count != 1 || values[0] is not { Length: >= 2 } value ||
        value[0] != '"' || value[^1] != '"')
    {
      return false;
    }

    var inner = value[1..^1];
    var colon = inner.IndexOf(':');

    if (colon < 0 || inner.IndexOf(':', colon + 1) >= 0)
    {
      return false;
    }

    var lineage = inner[..colon];
    var digits = inner[(colon + 1)..];

    // Round-trip check: NumberStyles.None already refuses a sign, but "01" parses and is not what the server prints.
    if (!CollabWorkingSetTag.IsLineage(lineage) ||
        !ulong.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence) ||
        sequence.ToString(CultureInfo.InvariantCulture) != digits)
    {
      return false;
    }

    expect = new CollabEditPrecondition(lineage, sequence);

    return true;
  }

  /// <summary>
  /// The whole body, or null when it is over the ceiling. Counted while
  /// reading rather than trusted from Content-Length, which a caller sets.
  /// </summary>
  private static async Task<byte[]?> ReadBodyAsync(HttpContext context, int maxBytes)
  {
    using var buffer = new MemoryStream();
    var chunk = new byte[8192];

    while (true)
    {
      var read = await context.Request.Body.ReadAsync(chunk, context.RequestAborted);

      if (read == 0)
      {
        return buffer.ToArray();
      }

      if (buffer.Length + read > maxBytes)
      {
        return null;
      }

      buffer.Write(chunk, 0, read);
    }
  }
}
