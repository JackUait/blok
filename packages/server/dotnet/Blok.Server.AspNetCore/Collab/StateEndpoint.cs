using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// GET /sync/{doc}/state: the live room's document as the consumer export,
/// for a backend that wants to read before it edits. Same door as the edit
/// endpoint, but a read: the guard does not ask for a write pass, and only
/// the read gate is consulted.
///
/// In journal mode the response names the head the body reflects, as
/// Blok-Doc-Lineage, Blok-Doc-Sequence and an ETag the edit endpoint accepts
/// as If-Match. A working-copy room has no head, so those are left out.
/// </summary>
internal static class StateEndpoint
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
        !await authorization.CanReadDocumentAsync(user, doc, context.RequestAborted))
    {
      await SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

      return;
    }

    var rooms = context.RequestServices.GetRequiredService<CollabRoomManager>();
    var result = await rooms.StateAsync(doc, context.RequestAborted);

    switch (result.Status)
    {
      case CollabStateStatus.Ready:
        if (result.Head is { } head)
        {
          EditEndpoint.WriteHead(context, head.Tag.Lineage, head.ServerSequence);
          context.Response.Headers.ETag = EditEndpoint.EntityTag(head.Tag.Lineage, head.ServerSequence);
        }

        // Document content behind an access check: no shared cache may keep it.
        context.Response.Headers.CacheControl = "no-store";
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.ContentType = "application/json";
        await context.Response.Body.WriteAsync(result.Json, context.RequestAborted);

        return;

      case CollabStateStatus.Purged:
        await SyncEndpoint.RefuseAsync(context, StatusCodes.Status403Forbidden, "forbidden\n");

        return;

      case CollabStateStatus.Unavailable:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status503ServiceUnavailable,
            "the document is unavailable, retry\n");

        return;

      case CollabStateStatus.Overloaded:
        await SyncEndpoint.RefuseRetryLaterAsync(
            context,
            rooms.RetryAfter,
            "the server ran past its limits exporting this document, retry\n");

        return;

      case CollabStateStatus.ExportFailed:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status500InternalServerError,
            "the document could not be exported\n");

        return;

      default:
        await SyncEndpoint.RefuseAsync(
            context,
            StatusCodes.Status503ServiceUnavailable,
            "the document could not be loaded\n");

        return;
    }
  }
}
