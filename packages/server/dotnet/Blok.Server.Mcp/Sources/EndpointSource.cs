using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;

namespace Blok.Server.Mcp.Sources;

/// <summary>The host's doc routes (packages/server/README.md, "endpoint"), plus the list route only MCP uses.</summary>
internal sealed class EndpointSource(McpSourceConfig.Endpoint config, McpHttpCaller http) : IDocumentSource
{
  // No spec value; long enough for a slow host save.
  private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

  public string DocumentTextForm => "compact";

  public bool CanList => config.List is not null;

  public async Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken)
  {
    var response = await CallAsync(new McpHttpRequest("GET", UrlOf(documentId), Auth()), cancellationToken);

    if (response.Status != 200)
    {
      throw Unavailable($"answered {response.Status} for {documentId}");
    }
    var body = ParseJson(response.Body, $"for {documentId}");

    if (body is null)
    {
      return new LoadedDocument(new JsonObject { ["blocks"] = new JsonArray() }, null, Missing: true);
    }
    if (body is JsonObject envelope && envelope.ContainsKey("data") && !envelope.ContainsKey("blocks"))
    {
      var version = McpJson.String(envelope["version"]);
      var data = envelope["data"];

      if (data is null)
      {
        return new LoadedDocument(new JsonObject { ["blocks"] = new JsonArray() }, version, Missing: true);
      }
      AssertDocumentShape(data, documentId);

      return new LoadedDocument(data.DeepClone(), version);
    }
    AssertDocumentShape(body, documentId);

    return new LoadedDocument(body, null);
  }

  public async Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken)
  {
    var headers = Auth().ToList();

    if (ifVersion is not null)
    {
      headers.Add(new("Blok-Doc-Version", ifVersion));
    }
    var response = await CallAsync(
        new McpHttpRequest("PUT", UrlOf(documentId), headers, Encoding.UTF8.GetBytes(text), "application/json"),
        cancellationToken);

    // README recommends 409 for a stale PUT; without it the host is last-writer-wins.
    if (response.Status == 409)
    {
      throw McpHostError.Surface("DOCUMENT_CHANGED", "Someone saved this document since you opened it. Read it again, then retry.");
    }
    if (response.Status is < 200 or > 299)
    {
      throw Unavailable($"refused the save with {response.Status}");
    }
    if (response.Body.Length == 0)
    {
      return ifVersion;
    }
    try
    {
      return McpJson.Parse(response.Body) is JsonObject answer && McpJson.String(answer["version"]) is string version
          ? version
          : ifVersion;
    }
    catch (JsonException)
    {
      return ifVersion;
    }
  }

  public async Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken)
  {
    var pairs = new List<KeyValuePair<string, string>>();

    if (query is not null)
    {
      pairs.Add(new("query", query));
    }
    if (cursor is not null)
    {
      pairs.Add(new("cursor", cursor));
    }
    pairs.Add(new("limit", limit.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    var response = await CallAsync(new McpHttpRequest("GET", $"{config.List}?{JsUri.FormEncode(pairs)}", Auth()), cancellationToken);

    if (response.Status != 200)
    {
      throw Unavailable($"list answered {response.Status}");
    }
    if (ParseJson(response.Body, "for the list") is not JsonObject body || body["documents"] is not JsonArray documents)
    {
      throw Unavailable("list answered without a \"documents\" array");
    }
    var listed = new JsonArray();

    foreach (var doc in documents)
    {
      if (doc is JsonObject entry && McpJson.String(entry["id"]) is string id)
      {
        listed.Add(new JsonObject { ["id"] = id, ["title"] = McpJson.String(entry["title"]) });
      }
    }

    return new JsonObject { ["documents"] = listed, ["nextCursor"] = McpJson.String(body["nextCursor"]) };
  }

  internal static void AssertDocumentShape(JsonNode value, string documentId)
  {
    if (value is not JsonObject document || document["blocks"] is not JsonArray)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", $"{documentId} is not a Blok document: expected an object with a \"blocks\" array.");
    }
  }

  private static McpHostError Unavailable(string what)
  {
    return McpHostError.Surface("SOURCE_UNAVAILABLE", $"The document endpoint {what}.");
  }

  private static JsonNode? ParseJson(string text, string what)
  {
    try
    {
      return McpJson.Parse(text);
    }
    catch (JsonException)
    {
      throw Unavailable($"answered non-JSON {what}");
    }
  }

  private KeyValuePair<string, string>[] Auth()
  {
    return [new("Authorization", config.EndpointAuth)];
  }

  // encodeURIComponent keeps "." and "..", which a URL parser resolves as path steps to other routes.
  private string UrlOf(string documentId)
  {
    if (documentId is "" or "." or "..")
    {
      throw McpHostError.Surface("INVALID_ARGS", $"\"{documentId}\" is not a document id.");
    }

    return $"{config.Url.TrimEnd('/')}/{JsUri.EncodeComponent(documentId)}";
  }

  private async Task<McpHttpResponse> CallAsync(McpHttpRequest request, CancellationToken cancellationToken)
  {
    try
    {
      return await http.SendAsync(request, Timeout, cancellationToken);
    }
    catch (McpUnreachableException)
    {
      throw Unavailable("could not be reached");
    }
    catch (McpBodyException)
    {
      throw Unavailable("dropped the connection while answering");
    }
  }
}
