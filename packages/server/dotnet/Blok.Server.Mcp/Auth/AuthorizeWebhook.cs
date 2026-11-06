using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;

namespace Blok.Server.Mcp.Auth;

/// <summary>--authorize with an http(s) URL. Fails closed: any answer but { allowed: true } denies.</summary>
internal static class AuthorizeWebhook
{
  // Every open waits on the webhook; a hung host must not hold the call open.
  private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

  internal static McpAuthorize Create(string url, McpHttpCaller http)
  {
    return async (principal, documentId, write, cancellationToken) =>
    {
      try
      {
        var body = new JsonObject { ["principal"] = principal, ["documentId"] = documentId, ["write"] = write };
        var response = await http.SendAsync(
            new McpHttpRequest("POST", url, [], Encoding.UTF8.GetBytes(McpJson.Write(body)), "application/json"),
            Timeout,
            cancellationToken);

        return response.Status == 200
            && McpJson.Parse(response.Body) is JsonObject answer
            && McpJson.Bool(answer["allowed"]) == true;
      }
      catch (Exception error) when (error is McpUnreachableException or McpBodyException or JsonException)
      {
        return false;
      }
    };
  }
}
