using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Mcp.Outbound;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// <c>--create-page &lt;url&gt;</c>, on the wire src/mcp/create-page.ts sends:
/// POST, only <c>Content-Type: application/json</c>, 10 s, redirects not followed (McpHttpCaller).
/// Body <c>{"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"}</c>.
/// 200 <c>{"pageId":"&lt;id&gt;"}</c> is the id, 200 <c>{"pageId":null}</c> a refusal (null). Anything
/// else (another status, no answer, a body that is not a JSON object, a pageId that is neither a
/// string nor null, and an empty string) throws: a host error, never a refusal. A repeated key
/// keeps its last value, as JSON.parse does.
/// </summary>
internal sealed class CreatePageWebhook : IBlokPageCreator
{
  // A hung host must not hold blok_execute open forever; the same limit as the authorize webhook.
  private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
  // How much of a refused answer the error keeps.
  private const int BodyShown = 500;

  private readonly string url;
  private readonly McpHttpCaller http;

  private CreatePageWebhook(string url, McpHttpCaller http)
  {
    this.url = url;
    this.http = http;
  }

  internal static CreatePageWebhook Create(string url, McpHttpCaller http)
  {
    return new CreatePageWebhook(url, http);
  }

  public async ValueTask<string?> CreateAsync(BlokPageCreateRequest request, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(request);
    var body = new JsonObject
    {
      ["parentDocumentId"] = request.ParentDocumentId,
      ["principal"] = request.Principal,
      ["actor"] = new JsonObject { ["id"] = request.Actor.Id, ["name"] = request.Actor.Name, ["onBehalfOf"] = request.Actor.OnBehalfOf },
      ["suggestedPageId"] = request.SuggestedPageId,
    };
    var response = await http.SendAsync(
        new McpHttpRequest("POST", url, [], Encoding.UTF8.GetBytes(McpJson.Write(body)), "application/json"),
        Timeout,
        cancellationToken);

    if (response.Status != 200)
    {
      throw Refused($"answered {response.Status}", response.Body);
    }
    JsonElement? pageId;

    try
    {
      pageId = PageIdOf(response.Body);
    }
    catch (JsonException error)
    {
      throw new InvalidOperationException($"--create-page {url} answered not JSON: {Shown(response.Body)}", error);
    }
    if (pageId is not { ValueKind: JsonValueKind.String or JsonValueKind.Null } value)
    {
      throw Refused("answered no \"pageId\" string or null", response.Body);
    }
    if (value.ValueKind == JsonValueKind.Null)
    {
      return null;
    }
    // Read as JSON.parse reads it, so a lone surrogate reaches the id check instead of turning into U+FFFD.
    var id = McpJson.UnescapeExact(value.GetRawText());

    // The library reads "" as a refusal; on this wire only null refuses.
    return id.Length == 0 ? throw Refused("answered no valid page id", response.Body) : id;
  }

  // The answer's pageId, its last one when the key repeats, as JSON.parse keeps it; null when the answer is no object or has none.
  private static JsonElement? PageIdOf(string body)
  {
    using var document = JsonDocument.Parse(body);

    if (document.RootElement.ValueKind != JsonValueKind.Object)
    {
      return null;
    }
    JsonElement? found = null;

    foreach (var property in document.RootElement.EnumerateObject())
    {
      if (property.NameEquals("pageId"))
      {
        found = property.Value.Clone();
      }
    }

    return found;
  }

  /// <summary>Blok's MCP server only creates through the request overload.</summary>
  public ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default)
  {
    throw new NotSupportedException("--create-page is asked with a BlokPageCreateRequest.");
  }

  /// <summary>Blok's MCP server opens pages through its own source, never through the creator.</summary>
  public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
  {
    throw new NotSupportedException("--create-page only creates pages.");
  }

  private InvalidOperationException Refused(string what, string body)
  {
    return new InvalidOperationException($"--create-page {url} {what}: {Shown(body)}");
  }

  private static string Shown(string body)
  {
    return body.Length <= BodyShown ? body : body[..BodyShown];
  }
}
