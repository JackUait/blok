using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Tickets;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// Opens live handles on a remote sync room: mints the handle's ticket, then joins.
/// This phase stops at the join: a room that accepts the upgrade is not served yet.
/// </summary>
internal sealed class LiveOpener(McpConfig config, McpHttpCaller http)
{
  // A collaboration pass is checked at the handshake only; 1800 s is the ceiling ticket.ts recommends.
  private const long TicketTtlSeconds = 1800;
  // blok_open waits on this; a hung host must not hold the call open.
  private static readonly TimeSpan TicketFetchTimeout = TimeSpan.FromSeconds(10);
  private static readonly TimeSpan SyncTimeout = TimeSpan.FromSeconds(15);

  internal static string SyncUrlFor(string baseUrl, string documentId)
  {
    if (documentId is "" or "." or "..")
    {
      throw McpHostError.Surface("INVALID_ARGS", $"\"{documentId}\" is not a document id.");
    }

    return $"{baseUrl.TrimEnd('/')}/{JsUri.EncodeComponent(documentId)}";
  }

  internal static JsonObject? ReadTicketClaims(string ticket)
  {
    var parts = ticket.Split('.');

    if (parts.Length < 2)
    {
      return null;
    }
    try
    {
      var payload = parts[1].Replace('-', '+').Replace('_', '/');

      payload = string.Concat(payload.Where(c => !char.IsWhiteSpace(c)));
      payload = payload.PadRight(payload.Length + ((4 - (payload.Length % 4)) % 4), '=');

      return McpJson.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload))) as JsonObject;
    }
    catch (Exception error) when (error is FormatException or JsonException)
    {
      return null;
    }
  }

  internal async Task<IHandleSession> OpenAsync(string documentId, bool write, McpCaller caller, CancellationToken cancellationToken)
  {
    var sync = config.Sync!;
    var url = SyncUrlFor(sync.Url, documentId);
    var ticket = await TicketAsync(documentId, write, caller, cancellationToken);

    await JoinAsync(new Uri(url), sync.Origin, ticket, cancellationToken);

    throw McpHostError.Surface("SOURCE_UNAVAILABLE", "Live rooms over --sync-url are not served by this blok-mcp yet.");
  }

  private static async Task JoinAsync(Uri url, string? origin, string? ticket, CancellationToken cancellationToken)
  {
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    deadline.CancelAfter(SyncTimeout);
    var pause = TimeSpan.FromMilliseconds(250);

    while (true)
    {
      try
      {
        using var socket = await McpRoomSocket.ConnectAsync(url, origin, ticket, deadline.Token);

        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);

        return;
      }
      catch (Exception error) when (error is WebSocketException or OperationCanceledException or HttpRequestException)
      {
        cancellationToken.ThrowIfCancellationRequested();
      }
      try
      {
        await Task.Delay(pause, deadline.Token);
      }
      catch (OperationCanceledException)
      {
        cancellationToken.ThrowIfCancellationRequested();
      }
      if (deadline.IsCancellationRequested)
      {
        throw McpHostError.Surface("ROOM_SYNC_TIMEOUT", "The room did not finish loading in time. Try again.");
      }
      pause = TimeSpan.FromMilliseconds(Math.Min(pause.TotalMilliseconds * 2, 2_000));
    }
  }

  private async Task<string?> TicketAsync(string documentId, bool write, McpCaller caller, CancellationToken cancellationToken)
  {
    var actorId = McpJson.String(caller.Actor["id"]) ?? string.Empty;

    switch (config.Tickets)
    {
      case McpTickets.Secret secret:
        return BlokTicket.Create(secret.Value, new BlokTicketClaims { User = actorId, Doc = documentId, Write = write, TtlSeconds = TicketTtlSeconds });
      case McpTickets.Url endpoint:
        return await FetchTicketAsync(endpoint, documentId, write, caller, actorId, cancellationToken);
      default:
        return null;
    }
  }

  private async Task<string> FetchTicketAsync(McpTickets.Url endpoint, string documentId, bool write, McpCaller caller, string actorId, CancellationToken cancellationToken)
  {
    var body = new JsonObject
    {
      ["doc"] = documentId,
      ["write"] = write,
      ["principal"] = caller.Principal,
      ["clientName"] = caller.ClientName,
      ["actorId"] = actorId,
    };
    McpHttpResponse response;

    try
    {
      response = await http.SendAsync(
          new McpHttpRequest("POST", endpoint.Endpoint, [new("Authorization", $"Bearer {endpoint.HostToken}")], Encoding.UTF8.GetBytes(McpJson.Write(body)), "application/json"),
          TicketFetchTimeout,
          cancellationToken);
    }
    catch (Exception error) when (error is McpUnreachableException or McpBodyException)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The ticket endpoint could not be reached.");
    }
    // 401 refuses our host token, not the agent: retryable, so a token rotation never ends live handles.
    if (response.Status == 401)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The ticket endpoint refused the host token.");
    }
    if (response.Status == 403)
    {
      throw McpHostError.Surface("FORBIDDEN", "The host did not grant this document to this agent.");
    }
    if (response.Status is < 200 or > 299)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", $"The ticket endpoint answered {response.Status}.");
    }
    string? ticket = null;

    try
    {
      ticket = McpJson.Parse(response.Body) is JsonObject answer ? McpJson.String(answer["ticket"]) : null;
    }
    catch (JsonException)
    {
      ticket = null;
    }
    if (ticket is null)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The ticket endpoint answered without a \"ticket\" field.");
    }
    var claims = ReadTicketClaims(ticket);

    // The journal names the ticket's user; it must be the agent, never the human. The room checks the signature.
    if (claims is null || McpJson.String(claims["user"]) != actorId || McpJson.String(claims["doc"]) != documentId)
    {
      throw McpHostError.Surface("FORBIDDEN", "The host minted a ticket for another user or document. Its \"user\" must equal actorId.");
    }
    if (McpJson.Bool(claims["write"]) == true && !write)
    {
      throw McpHostError.Surface("FORBIDDEN", "The host minted a write ticket for a read-only open.");
    }

    return ticket;
  }
}
