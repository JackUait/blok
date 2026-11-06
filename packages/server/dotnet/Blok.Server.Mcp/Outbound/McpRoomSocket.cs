using System.Net.WebSockets;

namespace Blok.Server.Mcp.Outbound;

/// <summary>
/// The one WebSocket client owner: blok-mcp joining a sync room at the operator's
/// --sync-url. The ticket rides as the last offered subprotocol, as browsers send it.
/// </summary>
internal static class McpRoomSocket
{
  // protocols: the version offers, then the ticket.
  /// <returns>The open socket; the caller owns it.</returns>
  internal static async Task<WebSocket> ConnectAsync(Uri url, string? origin, IReadOnlyList<string> protocols, CancellationToken cancellationToken)
  {
    var socket = new ClientWebSocket();

    try
    {
      socket.Options.Proxy = null;
      if (origin is not null)
      {
        socket.Options.SetRequestHeader("Origin", origin);
      }
      foreach (var protocol in protocols)
      {
        socket.Options.AddSubProtocol(protocol);
      }
      await socket.ConnectAsync(url, cancellationToken);

      return socket;
    }
    catch
    {
      socket.Dispose();
      throw;
    }
  }
}
