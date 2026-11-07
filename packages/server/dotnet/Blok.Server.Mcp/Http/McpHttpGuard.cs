using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;
using System.Text.RegularExpressions;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;
using Microsoft.AspNetCore.Http;

namespace Blok.Server.Mcp.Http;

/// <summary>
/// blok-mcp --http's front door, in Node's order: the Origin and Host checks, the
/// protected-resource metadata, then 404 for every path but the MCP one.
/// </summary>
internal sealed partial class McpHttpGuard(McpConfig config, Func<int> boundPort, string path)
{
  internal const string MetadataPath = "/.well-known/oauth-protected-resource";

  // A DNS-rebound page sends no Origin on a same-origin call, but its Host still names the attacker.
  private static readonly HashSet<string> LoopbackHostNames = ["localhost", "127.0.0.1", "[::1]"];

  // MCP clients are not browsers: only a loopback page may drive this server.
  [GeneratedRegex(@"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", RegexOptions.CultureInvariant)]
  internal static partial Regex LoopbackOrigin();

  internal bool IsLoopbackHost(string? host)
  {
    var at = host?.LastIndexOf(':') ?? -1;

    return host is not null && at > 0
        && LoopbackHostNames.Contains(host[..at].ToLowerInvariant())
        && host[(at + 1)..] == boundPort().ToString(System.Globalization.CultureInfo.InvariantCulture);
  }

  /// <summary>RFC 9728 protected-resource metadata, which a 401's WWW-Authenticate points at.</summary>
  internal static async Task WriteMetadataAsync(HttpResponse response, McpOAuth oauth)
  {
    response.ContentType = "application/json";
    await response.WriteAsync(McpJson.Write(new JsonObject
    {
      ["resource"] = oauth.Audience,
      ["authorization_servers"] = new JsonArray(oauth.Issuer),
      ["scopes_supported"] = new JsonArray("blok.read", "blok.write"),
      ["bearer_methods_supported"] = new JsonArray("header"),
    }));
  }

  internal async Task InvokeAsync(HttpContext context, RequestDelegate next)
  {
    var origin = context.Request.Headers.Origin;
    var host = context.Request.Headers.Host;

    if ((origin.Count > 0 && !LoopbackOrigin().IsMatch(origin.ToString())) || (!config.Public && !IsLoopbackHost(host.Count > 0 ? host.ToString() : null)))
    {
      context.Response.StatusCode = StatusCodes.Status403Forbidden;

      return;
    }
    if (config.OAuth is McpOAuth oauth && HttpMethods.IsGet(context.Request.Method) && context.Request.Path == MetadataPath)
    {
      await WriteMetadataAsync(context.Response, oauth);

      return;
    }
    // Node's router compares the path as written; PathString compares ignoring case.
    if (!string.Equals(context.Request.Path.Value, path, StringComparison.Ordinal))
    {
      context.Response.StatusCode = StatusCodes.Status404NotFound;

      return;
    }
    await next(context);
  }
}

/// <summary>
/// Right before the SDK, where Node's SDK handler differs from the C# one: the 4 MiB body
/// cap (413), 405 for GET and DELETE, -32700 for a body that is not JSON, no session ids
/// (stateless), and 2026-07-28 answers as JSON rather than SSE. Runs after authentication,
/// as Node reads no body before it.
/// </summary>
internal static class McpRequestGate
{
  // Node's own cap, which matches its SDK's default body bound.
  internal const int MaxBodyBytes = 4 * 1024 * 1024;

  internal static async Task InvokeAsync(HttpContext context, RequestDelegate next)
  {
    var request = context.Request;

    if (context.RequestServices?.GetService(typeof(McpConfig)) is McpConfig { Gate: { } gate } && !Admits(gate, request))
    {
      context.Response.StatusCode = StatusCodes.Status403Forbidden;

      return;
    }
    if (context.RequestServices?.GetService(typeof(McpConfig)) is McpConfig { Gate: not null } && BlokMcpServiceCollectionExtensions.IsUnnamedHostUser(context.User))
    {
      context.Response.StatusCode = StatusCodes.Status401Unauthorized;

      return;
    }
    // No OAuth: an anonymous caller becomes the default principal, so it must be on this machine.
    // The Host header proves nothing; the peer address does. No address means no network peer.
    if (context.RequestServices?.GetService(typeof(McpConfig)) is McpConfig { Gate: { TrustRemote: false }, OAuth: null }
        && context.User?.Identity?.IsAuthenticated != true
        && context.Connection.RemoteIpAddress is { } remote && !System.Net.IPAddress.IsLoopback(remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote))
    {
      context.Response.StatusCode = StatusCodes.Status403Forbidden;

      return;
    }

    // Node's createMcpHandler: 405 for every method but POST, then 415, before it reads a body.
    if (!HttpMethods.IsPost(request.Method))
    {
      context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
      context.Response.Headers.Allow = "POST";
      context.Response.ContentType = "application/json";
      if (!HttpMethods.IsHead(request.Method))
      {
        await context.Response.WriteAsync(Refusal(-32000, "Method not allowed."));
      }

      return;
    }
    if (!IsJsonContentType(request.ContentType))
    {
      await RefuseAsync(context.Response, 415, -32000, "Unsupported Media Type: Content-Type must be application/json");

      return;
    }
    if (request.ContentLength > MaxBodyBytes || await BufferAsync(request, context.RequestAborted) is not MemoryStream buffered)
    {
      context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;

      return;
    }
    var sent = AsTextDecoderReads(buffered.ToArray());
    var read = McpRequestShape.Read(Encoding.UTF8.GetBytes(sent));

    request.Body = new MemoryStream(Encoding.UTF8.GetBytes(sent));
    request.ContentLength = request.Body.Length;
    if (read is null)
    {
      await RefuseAsync(context.Response, 400, -32700, "Parse error: Invalid JSON");

      return;
    }
    using (read.Value.Document)
    {
      if (await LegacyRefusalAsync(context, read.Value.Document.RootElement))
      {
        return;
      }
    }
    // A repeated key reaches the SDK with its last value, as JSON.parse reads it, and a lone
    // surrogate escape as U+FFFD, which the SDK can read.
    if (read.Value.Repeated || McpJson.HasLoneSurrogateEscape(sent))
    {
      sent = McpJson.Write(McpJson.Parse(sent));
      request.Body = new MemoryStream(Encoding.UTF8.GetBytes(sent));
      request.ContentLength = request.Body.Length;
    }
    var core = context.RequestServices?.GetService(typeof(McpServerCore)) as McpServerCore;

    if (McpJson.Parse(sent) is JsonArray batch)
    {
      request.Headers.Remove("Mcp-Session-Id");
      await ServeBatchAsync(context, next, batch, core);

      return;
    }
    if (core is not null && McpRequestShape.ParkDeepArguments(sent, core) is { } parked)
    {
      request.Body = new MemoryStream(Encoding.UTF8.GetBytes(parked));
      request.ContentLength = request.Body.Length;
    }
    // Stateless, as Node: a session id names nothing, so it is not checked.
    request.Headers.Remove("Mcp-Session-Id");
    // Node still serves 2024-10-07; the C# SDK knows 2024-11-05 as its oldest, the same wire.
    // An initialize names its version in the body, which the wire filter answers, so its header goes.
    if (request.Headers["MCP-Protocol-Version"].ToString() == "2024-10-07")
    {
      if (request.Body is MemoryStream body && IsInitialize(body))
      {
        request.Headers.Remove("MCP-Protocol-Version");
      }
      else
      {
        request.Headers["MCP-Protocol-Version"] = "2024-11-05";
      }
    }
    if (request.Headers["MCP-Protocol-Version"].ToString() != Modern)
    {
      await next(context);

      return;
    }
    var original = context.Response.Body;
    using var answer = new MemoryStream();

    context.Response.Body = answer;
    try
    {
      await next(context);
    }
    finally
    {
      context.Response.Body = original;
    }
    await WriteModernAsync(context.Response, answer);
  }

  private const string Modern = "2026-07-28";
  private const string ProtocolVersionMeta = "io.modelcontextprotocol/protocolVersion";
  private const string LegacyVersions = "2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07";

  // Node's classifyInboundRequest and its legacy transport's checks, in their order; true when it answered.
  private static async Task<bool> LegacyRefusalAsync(HttpContext context, JsonElement root)
  {
    var response = context.Response;

    if (root.ValueKind == JsonValueKind.Array)
    {
      var refusal = root.GetArrayLength() == 0 ? "Bad Request: empty JSON-RPC batch"
          : root.EnumerateArray().Any(element => ClaimOf(element) is not null) ? "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later"
          : root.EnumerateArray().Any(element => !McpRequestShape.IsNodeMessage(element)) ? "Bad Request: JSON-RPC batch contains an invalid message"
          : null;

      if (refusal is not null)
      {
        await RefuseAsync(response, 400, -32600, refusal);

        return true;
      }

      return await LegacyTransportRefusalAsync(
          context, root.EnumerateArray().Any(element => element.TryGetProperty("method", out var name) && element.TryGetProperty("id", out _) && name.GetString() == "initialize"));
    }
    if (!McpRequestShape.IsNodeMessage(root))
    {
      await RefuseAsync(response, 400, -32600, McpRequestShape.NotAMessage, EchoableId(root));

      return true;
    }
    var header = context.Request.Headers["MCP-Protocol-Version"];
    var version = header.Count > 0 ? header.ToString().Trim(' ', '\t') : null;
    var headerModern = version is not null && string.CompareOrdinal(version, Modern) >= 0;
    var isRequest = root.TryGetProperty("method", out var method) && root.TryGetProperty("id", out _);
    var isInitialize = isRequest && method.GetString() == "initialize";
    var claimed = ClaimOf(root) is not null;

    // A modern header on a request with no _meta at all; other modern shapes are the SDK's.
    if (isRequest && !isInitialize && !claimed && headerModern)
    {
      if (root.TryGetProperty("params", out var parameters) && parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("_meta", out _))
      {
        return false;
      }
      var missing = new JsonObject { ["envelope"] = new JsonObject { ["missing"] = new JsonArray("_meta") } };

      await RefuseAsync(
          response, 400, -32602,
          $"Invalid params: the MCP-Protocol-Version header names protocol revision {version}, but the request is missing the required per-request envelope key(s): _meta",
          EchoableId(root), missing);

      return true;
    }
    if (claimed || (headerModern && !isInitialize))
    {
      return false;
    }

    return await LegacyTransportRefusalAsync(context, isInitialize);
  }

  // The checks of Node's legacy transport (handlePostRequest), for a message or a batch.
  private static async Task<bool> LegacyTransportRefusalAsync(HttpContext context, bool isInitialize)
  {
    var response = context.Response;
    var header = context.Request.Headers["MCP-Protocol-Version"];
    var version = header.Count > 0 ? header.ToString().Trim(' ', '\t') : null;
    var accept = context.Request.Headers.Accept.ToString();

    if (!accept.Contains("application/json", StringComparison.Ordinal) || !accept.Contains("text/event-stream", StringComparison.Ordinal))
    {
      await RefuseAsync(response, 406, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream");

      return true;
    }
    if (!isInitialize && version is not null && !LegacyVersions.Split(", ").Contains(version, StringComparer.Ordinal))
    {
      await RefuseAsync(response, 400, -32000, $"Bad Request: Unsupported protocol version: {version} (supported versions: {LegacyVersions})");

      return true;
    }

    return false;
  }

  // params._meta's protocol-version claim, when the key is there.
  private static JsonElement? ClaimOf(JsonElement message)
  {
    return message.ValueKind == JsonValueKind.Object && message.TryGetProperty("params", out var parameters) && parameters.ValueKind == JsonValueKind.Object
        && parameters.TryGetProperty("_meta", out var meta) && meta.ValueKind == JsonValueKind.Object && meta.TryGetProperty(ProtocolVersionMeta, out var claim)
        ? claim
        : null;
  }

  // Node's echoableRequestId: a string or number id of an object with a string method.
  private static JsonNode? EchoableId(JsonElement root)
  {
    return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("method", out var method) && method.ValueKind == JsonValueKind.String
        && root.TryGetProperty("id", out var id) && id.ValueKind is JsonValueKind.String or JsonValueKind.Number
        ? JsonNode.Parse(id.GetRawText())
        : null;
  }

  // Node's isJsonContentType: the media type's essence, case-insensitive.
  private static bool IsJsonContentType(string? contentType)
  {
    return contentType is not null
        && string.Equals(contentType.Split(';', 2)[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase);
  }

  // TextDecoder's read: a leading BOM goes, invalid UTF-8 becomes U+FFFD.
  private static string AsTextDecoderReads(byte[] bytes)
  {
    var text = Encoding.UTF8.GetString(bytes);

    return text.StartsWith('\uFEFF') ? text[1..] : text;
  }

  private static string Refusal(int code, string message, JsonNode? id = null, JsonNode? data = null)
  {
    var error = new JsonObject { ["code"] = code, ["message"] = message };

    if (data is not null)
    {
      error["data"] = data;
    }

    return McpJson.Write(new JsonObject { ["jsonrpc"] = "2.0", ["error"] = error, ["id"] = id });
  }

  private static async Task RefuseAsync(HttpResponse response, int status, int code, string message, JsonNode? id = null, JsonNode? data = null)
  {
    response.StatusCode = status;
    await WriteJsonAsync(response, Refusal(code, message, id, data));
  }

  internal static bool Admits(McpCallerGate gate, HttpRequest request)
  {
    var origin = request.Headers.Origin;
    var originOk = origin.Count == 0 || (gate.Origins is { } origins
        ? origins.Contains(origin.ToString(), StringComparer.OrdinalIgnoreCase)
        : McpHttpGuard.LoopbackOrigin().IsMatch(origin.ToString()));

    return originOk && (gate.Hosts is not { } hosts || hosts.Contains(request.Host.Host, StringComparer.OrdinalIgnoreCase));
  }

  private static async Task WriteJsonAsync(HttpResponse response, string json)
  {
    response.ContentType = "application/json";
    await response.WriteAsync(json);
  }

  // The C# SDK takes one message per request; Node's legacy transport answers a batch's requests
  // as one event stream, and 202 when it holds none.
  private static async Task ServeBatchAsync(HttpContext context, RequestDelegate next, JsonArray batch, McpServerCore? core)
  {
    var original = context.Response.Body;
    var events = new StringBuilder();
    var legacy = context.Request.Headers["MCP-Protocol-Version"].ToString() == "2024-10-07";

    foreach (var message in batch)
    {
      // As for one message below: the SDK knows 2024-11-05, the same wire.
      if (legacy)
      {
        context.Request.Headers["MCP-Protocol-Version"] = McpJson.String(message?["method"]) == "initialize" ? string.Empty : "2024-11-05";
      }
      var text = McpJson.Write(message);

      text = core is not null && McpRequestShape.ParkDeepArguments(text, core) is { } parked ? parked : text;
      context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(text));
      context.Request.ContentLength = context.Request.Body.Length;
      context.Response.StatusCode = StatusCodes.Status200OK;
      context.Response.Headers.Clear();
      using var answer = new MemoryStream();

      context.Response.Body = answer;
      try
      {
        await next(context);
      }
      finally
      {
        context.Response.Body = original;
      }
      var body = Encoding.UTF8.GetString(answer.ToArray());
      var data = context.Response.ContentType?.StartsWith("text/event-stream", StringComparison.Ordinal) == true ? SingleEvent(body) : Parse(body);

      if (data is not null)
      {
        events.Append("event: message\ndata: ").Append(McpJson.Write(data)).Append("\n\n");
      }
    }
    context.Response.Headers.Clear();
    if (events.Length == 0)
    {
      context.Response.StatusCode = StatusCodes.Status202Accepted;

      return;
    }
    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-cache, no-transform";
    await context.Response.WriteAsync(events.ToString());
  }

  private static bool IsInitialize(MemoryStream body)
  {
    try
    {
      return McpJson.Parse(System.Text.Encoding.UTF8.GetString(body.ToArray())) is JsonObject message
          && McpJson.String(message["method"]) == "initialize";
    }
    catch (System.Text.Json.JsonException)
    {
      return false;
    }
  }

  // Node's SDK answers a 2026-07-28 request with one JSON body, and gives an envelope refusal (400) a data field.
  private static async Task WriteModernAsync(HttpResponse response, MemoryStream answer)
  {
    var text = System.Text.Encoding.UTF8.GetString(answer.ToArray());
    var message = response.ContentType?.StartsWith("text/event-stream", StringComparison.Ordinal) == true
        ? SingleEvent(text)
        : response.ContentType?.StartsWith("application/json", StringComparison.Ordinal) == true ? Parse(text) : null;

    if (response.StatusCode == StatusCodes.Status400BadRequest && message is JsonObject body && body["error"] is JsonObject error && !error.ContainsKey("data"))
    {
      error["data"] = McpJson.String(error["message"]);
    }
    // The HTTP handler refuses ping on 2026-07-28 before the server, so the wire filter never sees it.
    if (message is JsonObject refusal && refusal["error"] is JsonObject missing && McpJson.Number(missing["code"]) == -32601)
    {
      missing["message"] = "Method not found";
    }
    if (message is null)
    {
      answer.Position = 0;
      await answer.CopyToAsync(response.Body);

      return;
    }
    response.ContentLength = null;
    await WriteJsonAsync(response, McpJson.Write(message));
  }

  private static JsonNode? SingleEvent(string text)
  {
    var data = text.Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
        .Select(evt => string.Join('\n', evt.Split('\n').Where(line => line.StartsWith("data:", StringComparison.Ordinal)).Select(line => line[5..].TrimStart())))
        .Where(evt => evt.Length > 0)
        .ToArray();

    return data.Length == 1 ? Parse(data[0]) : null;
  }

  private static JsonNode? Parse(string text)
  {
    try
    {
      return McpJson.Parse(text);
    }
    catch (System.Text.Json.JsonException)
    {
      return null;
    }
  }

  private static async Task<MemoryStream?> BufferAsync(HttpRequest request, CancellationToken cancellationToken)
  {
    var body = new MemoryStream();
    var chunk = new byte[81920];

    while (true)
    {
      var read = await request.Body.ReadAsync(chunk, cancellationToken);

      if (read == 0)
      {
        body.Position = 0;

        return body;
      }
      if (body.Length + read > MaxBodyBytes)
      {
        await body.DisposeAsync();

        return null;
      }
      body.Write(chunk, 0, read);
    }
  }
}

/// <summary>--http cannot be listened on: the CLI prints it after "blok-mcp: " and exits 1, as Node's McpListenError.</summary>
internal sealed class McpListenException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>--http's host:port, as Node's splitListen reads it, and Node's words when it cannot be listened on.</summary>
internal static class McpHttpListen
{
  /// <summary>The host without brackets and the port: up to five digits, 0 to 65535; an empty port is 0.</summary>
  internal static (string Host, int Port) Split(string listen)
  {
    var at = listen.LastIndexOf(':');
    var port = at < 0 ? string.Empty : listen[(at + 1)..];

    if (at < 0 || port.Length > 5 || !port.All(char.IsAsciiDigit) || (port.Length > 0 && int.Parse(port, System.Globalization.CultureInfo.InvariantCulture) > 65_535))
    {
      throw new McpListenException($"--http needs a port from 0 to 65535 after the last \":\", got \"{listen}\"");
    }
    var host = listen[..at];

    host = host.StartsWith('[') ? host[1..] : host;
    host = host.EndsWith(']') ? host[..^1] : host;

    return (host, port.Length == 0 ? 0 : int.Parse(port, System.Globalization.CultureInfo.InvariantCulture));
  }

  /// <summary>A bind that failed, in libuv's words as Node prints them.</summary>
  internal static McpListenException BindError(string listen, System.Net.IPAddress address, int port, Exception thrown)
  {
    var socket = Find(thrown);
    var words = socket?.SocketErrorCode switch
    {
      System.Net.Sockets.SocketError.AddressAlreadyInUse => "EADDRINUSE: address already in use",
      System.Net.Sockets.SocketError.AddressNotAvailable => "EADDRNOTAVAIL: address not available",
      System.Net.Sockets.SocketError.AccessDenied => "EACCES: permission denied",
      _ => null,
    };
    var detail = words is null ? (socket ?? thrown).Message : $"listen {words} {address}{(port > 0 ? $":{port}" : string.Empty)}";

    return new McpListenException($"Cannot listen on {listen}: {detail}", thrown);
  }

  /// <summary>A host name that did not resolve, as Node's getaddrinfo error reads.</summary>
  internal static McpListenException LookupError(string listen, string host, Exception thrown)
  {
    var detail = Find(thrown)?.SocketErrorCode == System.Net.Sockets.SocketError.HostNotFound
      ? $"getaddrinfo ENOTFOUND {host}"
      : thrown.Message;

    return new McpListenException($"Cannot listen on {listen}: {detail}", thrown);
  }

  private static System.Net.Sockets.SocketException? Find(Exception? error)
  {
    for (; error is not null; error = error.InnerException)
    {
      if (error is System.Net.Sockets.SocketException socket)
      {
        return socket;
      }
    }

    return null;
  }
}
