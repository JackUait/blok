using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Tickets;

namespace Blok.Server.Mcp.Live;

/// <summary>Opens live handles on a remote sync room (open-live.ts): mints the handle's ticket, joins, and waits for the first sync.</summary>
internal sealed class LiveOpener(McpConfig config, McpHttpCaller http, McpBundle bundle, JsonObject flags, Func<CancellationToken, Task<JsonObject>> surfaceAsync)
{
  private const long TicketRefreshMarginMs = 30_000;
  // A collaboration pass is checked at the handshake only; 1800 s is the ceiling ticket.ts recommends.
  private const long TicketTtlSeconds = 1800;
  // blok_open waits on this; a hung host must not hold the call open.
  private static readonly TimeSpan TicketFetchTimeout = TimeSpan.FromSeconds(10);
  private static readonly TimeSpan SyncTimeout = TimeSpan.FromSeconds(15);

  private readonly Lock fieldsLock = new();
  private Task<RichTextFields>? fieldsTask;

  /// <summary>Page documents under page-map; null when pages are not documents.</summary>
  internal PagePorts? Pages { get; set; }

  /// <summary>The host uploader's port, when one is configured.</summary>
  internal UploadPorts? Uploads { get; set; }

  /*
   * The rich-text fields the room converter uses (mcp-contracts.ts richTextFieldsOf): the
   * manifest's for each tool it lists, built-ins and --manifest ones; --rich-text-fields only
   * for types the manifest does not list. Built once; a failed build is tried again.
   */
  internal Task<RichTextFields> RichTextFieldsAsync()
  {
    lock (fieldsLock)
    {
      if (fieldsTask is null || fieldsTask.IsFaulted || fieldsTask.IsCanceled)
      {
        fieldsTask = BuildRichTextFieldsAsync();
      }

      return fieldsTask;
    }
  }

  private async Task<RichTextFields> BuildRichTextFieldsAsync()
  {
    var input = new JsonObject();

    if (config.Manifest is not null)
    {
      input["customTools"] = config.Manifest.DeepClone();
    }
    if (config.Overrides is not null)
    {
      input["overrides"] = config.Overrides.DeepClone();
    }
    var built = await bundle.CallAsync("manifest", input);
    var listed = new HashSet<string>(StringComparer.Ordinal);
    var table = new List<KeyValuePair<string, IList<string>>>();

    foreach (var block in (built["manifest"]?["blocks"] as JsonArray ?? []).OfType<JsonObject>())
    {
      if (McpJson.String(block["name"]) is not { } name)
      {
        continue;
      }
      listed.Add(name);
      table.Add(new(name, [.. (block["richTextFields"] as JsonArray ?? []).Select(field => McpJson.String(field)).OfType<string>()]));
    }
    foreach (var (type, list) in config.RichTextFields ?? [])
    {
      if (!listed.Contains(type))
      {
        table.Add(new(type, [.. (list as JsonArray ?? []).Select(field => McpJson.String(field)).OfType<string>()]));
      }
    }

    return RichTextFields.With(table);
  }

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
    // Before the join: a wait between the join and the session's start lets the room answer awareness first.
    var fields = await RichTextFieldsAsync();
    var sync = config.Sync!;
    var url = SyncUrlFor(sync.Url, documentId);
    var source = await TicketSourceAsync(documentId, write, caller, cancellationToken);
    var guard = source is null ? null : new RevocableTickets(source);
    using var refused = new CancellationTokenSource();
    using var waiting = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, refused.Token);
    LiveRoom room;

    if (guard is not null)
    {
      guard.Refused += refused.Cancel;
    }
    try
    {
      room = await LiveRoom.OpenAsync(
          async (protocols, token) => new RoomConnection(await McpRoomSocket.ConnectAsync(new Uri(url), sync.Origin, protocols, token)),
          guard is null ? null : guard.NextAsync,
          SyncTimeout,
          waiting.Token);
    }
    catch (OperationCanceledException) when (guard?.Refusal is { } refusal)
    {
      // A refused ticket ends the wait at once; name the real cause.
      throw refusal;
    }
    catch (TimeoutException)
    {
      throw McpHostError.Surface("ROOM_SYNC_TIMEOUT", "The room did not finish loading in time. Try again.");
    }
    catch (LiveRoomTerminalException terminal)
    {
      throw await RoomErrorAsync(terminal.Terminal, cancellationToken);
    }
    finally
    {
      if (guard is not null)
      {
        guard.Refused -= refused.Cancel;
      }
    }
    try
    {
      if (guard is not null)
      {
        // Later refusals end the room for this handle.
        guard.Refused += () => room.Loop.Post(() => room.EndWith(new RoomEnd(false, "forbidden")));
      }
      var surface = await surfaceAsync(cancellationToken);
      var revision = McpJson.String(surface["contractRevision"]?["live"]) ?? string.Empty;
      var unavailable = surface["liveUnavailableCommands"] as JsonArray;
      var history = new LiveVersionHistory(http, url, sync.Origin, guard is null ? null : guard.NextAsync);
      var session = new LiveSession(room, bundle, flags, caller, write, revision, unavailable, history)
      {
        Pages = Pages,
        Uploads = Uploads,
        DocumentId = documentId,
        Fields = fields,
      };

      await room.Loop.RunAsync(session.Start);

      return session;
    }
    catch
    {
      await room.CloseAsync();
      throw;
    }
  }

  private async Task<McpHostError> RoomErrorAsync(string? terminal, CancellationToken cancellationToken)
  {
    var input = new JsonObject();

    if (terminal is not null)
    {
      input["terminal"] = terminal;
    }

    return new McpHostError((JsonObject)(await bundle.CallAsync("mcpRoomError", input, cancellationToken))["error"]!);
  }

  /// <summary>Mints the first ticket eagerly, so a refusal surfaces at blok_open (tickets.ts).</summary>
  private async Task<RoomTicketSource?> TicketSourceAsync(string documentId, bool write, McpCaller caller, CancellationToken cancellationToken)
  {
    var cached = await TicketAsync(documentId, write, caller, cancellationToken);

    if (cached is null)
    {
      return null;
    }
    if (config.Tickets is not McpTickets.Url)
    {
      return _ => TicketAsync(documentId, write, caller, CancellationToken.None);
    }

    return async force =>
    {
      if (force || ExpiresAtMs(cached) - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < TicketRefreshMarginMs)
      {
        cached = await TicketAsync(documentId, write, caller, CancellationToken.None) ?? cached;
      }

      return cached;
    };
  }

  private static long ExpiresAtMs(string ticket)
  {
    return ReadTicketClaims(ticket)?["exp"] is JsonValue exp && exp.TryGetValue<double>(out var seconds)
        ? (long)(seconds * 1000)
        : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
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

/// <summary>
/// The provider retries a failed mint forever, so a host's refusal on reconnect
/// would never reach the agent: one FORBIDDEN ends the room, and no later mint runs.
/// </summary>
internal sealed class RevocableTickets(RoomTicketSource source)
{
  internal event Action? Refused;

  internal McpHostError? Refusal { get; private set; }

  internal async Task<string?> NextAsync(bool forceRefresh)
  {
    if (Refusal is not null)
    {
      throw Refusal;
    }
    try
    {
      return await source(forceRefresh);
    }
    catch (McpHostError error) when (error.Code == "FORBIDDEN")
    {
      Refusal = error;
      Refused?.Invoke();
      throw;
    }
  }
}
