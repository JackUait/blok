using System.Net.WebSockets;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>GET /sync/{doc}: the WebSocket door onto a document's room.</summary>
internal static class SyncEndpoint
{
  /// <summary>Outbound backlog budget per connection, in inbound-message-size units.</summary>
  private const int OutboundQueueFactor = 8;

  /// <summary>
  /// A rejected client has nothing left to say, so its close gets a token
  /// grace instead of the full one — long enough for the frame to land, short
  /// enough that a flood of bad passes cannot park sockets on the server.
  /// </summary>
  private static readonly TimeSpan RejectedCloseGrace = TimeSpan.FromMilliseconds(250);

  public static async Task HandleAsync(HttpContext context)
  {
    var doc = RouteDoc(context);
    var handshake = context.RequestServices.GetRequiredService<SyncHandshake>();

    switch (await handshake.NegotiateAsync(context, doc))
    {
      case SyncRefused refused:
        await RefuseAsync(context, refused.StatusCode, refused.Body);
        break;
      case SyncRejected rejected:
        await AcceptThenCloseAsync(context, rejected.SubProtocol, rejected.Close);
        break;
      case SyncAccepted accepted:
        await ServeAsync(context, doc, accepted);
        break;
      default:
        break;
    }
  }

  internal static string RouteDoc(HttpContext context)
  {
    return context.Request.RouteValues["doc"] as string ?? "";
  }

  /// <summary>
  /// A route value keeps an encoded slash encoded, so the id "a/b" arrives as
  /// "a%2Fb" and never matches its ticket's doc claim — the client would see a
  /// 4401 it cannot diagnose, and a reset would rewrite a document nobody has.
  /// Ids are therefore one path segment, and anything else is refused by name.
  /// </summary>
  internal static bool IsSingleSegment(string doc)
  {
    return doc.Length > 0 &&
        !doc.Contains('/') &&
        !doc.Contains("%2f", StringComparison.OrdinalIgnoreCase);
  }

  internal static async Task RefuseAsync(HttpContext context, int statusCode, string body)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync(body);
  }

  private static async Task ServeAsync(HttpContext context, string doc, SyncAccepted accepted)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var connections = context.RequestServices.GetRequiredService<SyncConnectionTable>();
    var rooms = context.RequestServices.GetRequiredService<CollabRoomManager>();

    // Held until the request ends, which is when Kestrel frees its own slot;
    // the per-principal lease below is freed earlier, before the close is
    // answered, so a reconnecting client never races its own slot.
    using var slot = connections.TryEnter();

    if (slot is null)
    {
      await RefuseAsync(
          context,
          StatusCodes.Status503ServiceUnavailable,
          "too many connections on this server\n");

      return;
    }

    // No principal (anonymous in none/proxy mode) means no per-user cap, so no lease.
    var lease = accepted.Principal is null ? null : connections.TryReserve(doc, accepted.Principal);

    if (accepted.Principal is not null && lease is null)
    {
      await RefuseAsync(context, StatusCodes.Status429TooManyRequests, "too many connections\n");

      return;
    }

    using (lease)
    {
      var member = new SyncSocketMember(
          accepted.CanWrite,
          acceptsControlFrames: accepted.SubProtocol is not null,
          maxQueuedBytes: (long)OutboundQueueFactor * options.CollabMaxMessageBytes,
          new SyncInboundBudget(
              options,
              context.RequestServices.GetRequiredService<TimeProvider>()),
          actorId: accepted.ActorId,
          protocolSource: accepted.ProtocolSource);
      CollabJoinResult join;

      // Join before the upgrade: a draining server can still answer 503,
      // and the room's first frames simply wait in the member's queue.
      try
      {
        join = await rooms.JoinAsync(doc, member, context.RequestAborted);
      }
      catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
      {
        return;
      }

      if (join.Status == CollabJoinStatus.Draining)
      {
        await RefuseAsync(context, StatusCodes.Status503ServiceUnavailable, "shutting down\n");

        return;
      }

      WebSocket socket;

      try
      {
        socket = await AcceptAsync(context, accepted.SubProtocol, options);
      }
      catch
      {
        if (join.Membership is not null)
        {
          await join.Membership.LeaveAsync();
        }

        throw;
      }

      using (socket)
      {
        // Unavailable shares the frame: both mean "this document cannot serve
        // you right now, come back", which is exactly what 4503 says.
        if (join.Status is CollabJoinStatus.SeedFailed or CollabJoinStatus.Unavailable)
        {
          member.RequestClose(SyncClose.SeedFailed);
        }

        await member.RunAsync(
            socket,
            join.Membership,
            options.CollabMaxMessageBytes,
            lease,
            context.RequestAborted);
      }
    }
  }

  private static async Task AcceptThenCloseAsync(
      HttpContext context,
      string? subProtocol,
      SyncCloseFrame close)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    using var socket = await AcceptAsync(context, subProtocol, options);
    var member = new SyncSocketMember(
        canWrite: false,
        acceptsControlFrames: false,
        maxQueuedBytes: 0,
        inbound: null,
        RejectedCloseGrace);
    member.RequestClose(close);

    await member.RunAsync(
        socket,
        membership: null,
        options.CollabMaxMessageBytes,
        lease: null,
        context.RequestAborted);
    socket.Abort();
  }

  private static Task<WebSocket> AcceptAsync(
      HttpContext context,
      string? subProtocol,
      BlokServerOptions options)
  {
    var accept = new WebSocketAcceptContext
    {
      SubProtocol = subProtocol,
      KeepAliveInterval = options.CollabKeepAliveInterval,
    };

    // A ping that goes unanswered for two intervals means the peer is gone.
    if (options.CollabKeepAliveInterval > TimeSpan.Zero)
    {
      accept.KeepAliveTimeout = options.CollabKeepAliveInterval * 2;
    }

    return context.WebSockets.AcceptWebSocketAsync(accept);
  }
}
