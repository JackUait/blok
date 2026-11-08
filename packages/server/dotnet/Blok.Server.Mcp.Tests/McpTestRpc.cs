using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;

namespace Blok.Server.Mcp.Tests;

/// <summary>JSON-RPC over a test server's /mcp, as a stateless 2025-11-25 client.</summary>
internal static class McpTestRpc
{
  /// <summary>The whole answer: its result or its error.</summary>
  internal static async Task<JsonObject> SendAsync(HttpClient client, string method, JsonObject parameters, string? user = null, bool signedIn = false)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
    {
      Content = new StringContent(
          new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = method, ["params"] = parameters }.ToJsonString(), Encoding.UTF8, "application/json"),
    };

    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
    request.Headers.Add("MCP-Protocol-Version", "2025-11-25");
    if (user is not null)
    {
      request.Headers.Add("X-Test-User", user);
    }
    if (signedIn)
    {
      request.Headers.Add("X-Test-Signed-In", "true");
    }
    using var response = await client.SendAsync(request);
    var text = await response.Content.ReadAsStringAsync();
    var data = text.Split('\n').FirstOrDefault(line => line.StartsWith("data:", StringComparison.Ordinal));

    return (JsonObject)JsonNode.Parse(data is null ? text : data[5..])!;
  }

  internal static Task<JsonObject> CallAsync(HttpClient client, string tool, JsonObject arguments, string? user = null, JsonObject? meta = null)
  {
    var parameters = new JsonObject { ["name"] = tool, ["arguments"] = arguments };

    if (meta is not null)
    {
      parameters["_meta"] = meta;
    }

    return SendAsync(client, "tools/call", parameters, user);
  }

  /// <summary>The structured answer of a tool call that is not a protocol error.</summary>
  internal static async Task<JsonObject> ToolAsync(HttpClient client, string tool, JsonObject arguments, string? user = null, JsonObject? meta = null)
  {
    var answer = await CallAsync(client, tool, arguments, user, meta);

    return answer["result"]?["structuredContent"] as JsonObject
        ?? throw new InvalidOperationException($"{tool} gave no structuredContent: {answer.ToJsonString()}");
  }

  /// <summary>Signs a request in from X-Test-User (named) or X-Test-Signed-In (no name), as a host's own auth would.</summary>
  internal static void UseTestSignIn(this WebApplication app)
  {
    app.Use((context, next) =>
    {
      if (context.Request.Headers["X-Test-User"].ToString() is { Length: > 0 } user)
      {
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", user), new Claim("scope", "other")], "test"));
      }
      else if (context.Request.Headers["X-Test-Signed-In"] == "true")
      {
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("role", "reader")], "test"));
      }

      return next(context);
    });
  }

  internal static JsonObject ClientMeta(string name)
  {
    return new JsonObject { ["io.modelcontextprotocol/clientInfo"] = new JsonObject { ["name"] = name, ["version"] = "1" } };
  }
}
