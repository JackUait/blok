using System.Net.WebSockets;

namespace Blok.Server.Mcp.Outbound;

/// <summary>
/// The one WebSocket client owner: blok-mcp joining a sync room at the operator's
/// --sync-url. The ticket rides as the last offered subprotocol, as browsers send it.
/// </summary>
internal static class McpRoomSocket
{
  internal static readonly string[] Protocols = ["blok-sync.v2", "blok-sync.v1"];

  /// <returns>The open socket; the caller owns it.</returns>
  internal static async Task<WebSocket> ConnectAsync(Uri url, string? origin, string? ticket, CancellationToken cancellationToken)
  {
    var socket = new ClientWebSocket();

    try
    {
      socket.Options.Proxy = null;
      if (origin is not null)
      {
        socket.Options.SetRequestHeader("Origin", origin);
      }
      foreach (var protocol in Protocols)
      {
        socket.Options.AddSubProtocol(protocol);
      }
      if (ticket is not null)
      {
        socket.Options.AddSubProtocol(ticket);
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
