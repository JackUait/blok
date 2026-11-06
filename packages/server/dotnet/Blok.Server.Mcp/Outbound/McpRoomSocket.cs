using System.Net.WebSockets;

namespace Blok.Server.Mcp.Outbound;

/// <summary>
/// The one WebSocket client owner: blok-mcp joining a sync room at the operator's
/// --sync-url. The ticket rides as the last offered subprotocol, as browsers send it.
/// Every socket upgrades through one invoker, so all rooms share one handler's rules.
/// </summary>
internal static class McpRoomSocket
{
  private static readonly HttpMessageInvoker invoker = new(CreateHandler());

  /// <summary>Opens a room socket offering <paramref name="protocols"/>: the versions, then the ticket.</summary>
  /// <param name="url">The room's ws(s) URL.</param>
  /// <param name="origin">The Origin header, when the operator set one.</param>
  /// <param name="protocols">The offered subprotocols.</param>
  /// <param name="cancellationToken">Cancels the handshake.</param>
  /// <returns>The open socket; the caller owns it.</returns>
  internal static async Task<WebSocket> ConnectAsync(Uri url, string? origin, IReadOnlyList<string> protocols, CancellationToken cancellationToken)
  {
    var socket = new ClientWebSocket();

    try
    {
      if (origin is not null)
      {
        socket.Options.SetRequestHeader("Origin", origin);
      }
      foreach (var protocol in protocols)
      {
        socket.Options.AddSubProtocol(protocol);
      }
      await socket.ConnectAsync(url, invoker, cancellationToken);

      return socket;
    }
    catch
    {
      socket.Dispose();
      throw;
    }
  }

  // Node's ws dials the room directly, with no proxy.
  private static SocketsHttpHandler CreateHandler()
  {
    return new SocketsHttpHandler
    {
      UseProxy = false,
      UseCookies = false,
      AllowAutoRedirect = false,
    };
  }
}
