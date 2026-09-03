using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// POST /sync/{doc}/reset (plan decision 5). Runs behind the normal HTTP
/// guard (origin, write ticket, rate limit); this handler adds what the guard
/// never checks: the ticket's doc claim and the application's write gate.
/// </summary>
internal static class ResetEndpoint
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

    var rooms = context.RequestServices.GetRequiredService<CollabRoomManager>();

    try
    {
      await rooms.ResetAsync(doc, context.RequestAborted);
    }
    catch (CollabResetUnavailableException)
    {
      await SyncEndpoint.RefuseAsync(
          context,
          StatusCodes.Status503ServiceUnavailable,
          "the document cannot be reset right now\n");

      return;
    }

    context.Response.StatusCode = StatusCodes.Status204NoContent;
  }
}
