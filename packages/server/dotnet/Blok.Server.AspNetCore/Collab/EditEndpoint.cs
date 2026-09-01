using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// POST /sync/{doc}/edit: block-level edits from a consumer backend that is
/// not a WebSocket peer. Same door as the reset endpoint — the HTTP guard
/// checks origin, write ticket and rate limit, and this handler adds the
/// ticket's doc claim and the application's write gate.
///
/// The body is read under the same ceiling one sync message gets. A caller
/// able to POST an unbounded document could otherwise grow it past what any
/// client can ever receive, locking everyone out of the room they just filled.
/// </summary>
internal static class EditEndpoint
{
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
        !await authorization.CanWriteDocumentAsync(user, doc, context.RequestAborted))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

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
    var result = await rooms.EditAsync(doc, ops, context.RequestAborted);

    switch (result.Status)
    {
      case CollabEditStatus.Applied:
        context.Response.StatusCode = StatusCodes.Status204NoContent;

        return;

      case CollabEditStatus.Invalid:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status422UnprocessableEntity,
            $"{result.Error?.Message ?? "collab: the edit was refused."}\n");

        return;

      default:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status503ServiceUnavailable,
            "the document could not be loaded\n");

        return;
    }
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
