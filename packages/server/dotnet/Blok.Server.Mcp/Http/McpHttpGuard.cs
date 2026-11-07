using System.Text.Json;
using System.Text.Json.Nodes;
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
    if (context.Request.Path != path)
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

  private const string Modern = "2026-07-28";

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

    if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method))
    {
      if (request.ContentLength > MaxBodyBytes || await BufferAsync(request, context.RequestAborted) is not MemoryStream body)
      {
        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;

        return;
      }
      request.Body = body;
      request.ContentLength = body.Length;
    }
    if (HttpMethods.IsGet(request.Method) || HttpMethods.IsDelete(request.Method))
    {
      context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
      context.Response.Headers.Allow = "POST";
      await WriteJsonAsync(context.Response, """{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}""");

      return;
    }
    if (request.Body is MemoryStream buffered)
    {
      var read = McpRequestShape.Read(buffered.ToArray());

      if (read is null)
      {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await WriteJsonAsync(context.Response, """{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}""");

        return;
      }
      using (read.Value.Document)
      {
        var root = read.Value.Document.RootElement;

        if (!McpRequestShape.IsMessage(root))
        {
          var id = root.TryGetProperty("id", out var given) && given.ValueKind is JsonValueKind.String or JsonValueKind.Number ? JsonNode.Parse(given.GetRawText()) : null;

          context.Response.StatusCode = StatusCodes.Status400BadRequest;
          await WriteJsonAsync(context.Response, McpJson.Write(new JsonObject
          {
            ["jsonrpc"] = "2.0",
            ["error"] = new JsonObject { ["code"] = -32600, ["message"] = McpRequestShape.NotAMessage },
            ["id"] = id,
          }));

          return;
        }
      }
      // A repeated key reaches the SDK with its last value, as JSON.parse reads it.
      if (read.Value.Repeated)
      {
        var normal = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(McpJson.Write(McpJson.Parse(System.Text.Encoding.UTF8.GetString(buffered.ToArray())))));

        request.Body = normal;
        request.ContentLength = normal.Length;
      }
    }
    // Stateless, as Node: a session id names nothing, so it is not checked.
    request.Headers.Remove("Mcp-Session-Id");
    // Node still serves 2024-10-07; the C# SDK knows 2024-11-05 as its oldest, the same wire.
    // An initialize names its version in the body, which the wire filter answers, so its header goes.
    if (request.Headers["MCP-Protocol-Version"].ToString() == "2024-10-07")
    {
      if (request.Body is MemoryStream sent && IsInitialize(sent))
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

  private static bool Admits(McpCallerGate gate, HttpRequest request)
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
