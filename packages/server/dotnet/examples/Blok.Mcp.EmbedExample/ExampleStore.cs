using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp;

namespace Blok.Mcp.EmbedExample;

/*
 * --example-source endpoint:<url>: a document store on a small HTTP service. A real host reads
 * and writes its own database here. The shared conformance suite
 * (test/unit/mcp-conformance/fixtures/embed.json) records this exact wire, so every port's embed
 * example speaks it byte for byte:
 *
 *   <base>  <url> with one trailing "/" removed.
 *   <id>    the document id, percent-encoded as JS encodeURIComponent does: every UTF-8 byte
 *           is %XX (upper-case hex) except A-Z a-z 0-9 and - _ . ! ~ * ' ( ). Blok never passes
 *           "", "." or "..": it refuses those ids before it calls the store.
 *   Every request carries the caller, values sent as given:
 *     Blok-Caller: <caller.Principal>
 *     Blok-Caller-Client: <caller.ClientName>
 *     Blok-Caller-Actor: <caller.Actor.Id>
 *     Blok-Caller-On-Behalf-Of: <caller.Actor.OnBehalfOf>    left out when the actor has none
 *
 *   load  GET <base>/<id>
 *         200 body exactly `null`  -> never saved: load answers null.
 *         200 any other JSON body  -> { DocumentText: body.documentText, Version: body.version },
 *                                     both passed on as given (absent = null). documentText is the
 *                                     stored document as a JSON string; it is never parsed here,
 *                                     so Blok's own parser reads it (repeated keys, lone surrogates, depth).
 *   save  PUT <base>/<id>
 *         Content-Type: application/json; the body is documentText, byte for byte.
 *         Blok-If-Version: <ifVersion>, left out when ifVersion is null.
 *         200 JSON body            -> body.version as given (absent = none).
 *   list  GET <base>?limit=<n>&query=<q>&cursor=<c>
 *         In that order; query and cursor left out when absent; values form-encoded as
 *         URLSearchParams does: space is "+", every other UTF-8 byte is %XX except
 *         A-Z a-z 0-9 and * - . _. 200 JSON body -> its documents and nextCursor.
 *
 *   A JSON body is read as JSON.parse reads it: a repeated key keeps its last value.
 *   Any other answer, on every route:
 *     409 -> BlokMcpSourceException(Changed, m)       503 -> BlokMcpSourceException(Unavailable, m)
 *     403 -> BlokMcpSourceException(Forbidden, m)     422 -> BlokMcpSourceException(InvalidId, m)
 *     where m is the body's JSON "message" when that is a string, else "" (Blok's own words).
 *   Every other status, a 200 body that is not JSON, or a network error: a plain exception, which
 *   Blok logs and shows the agent as SOURCE_UNAVAILABLE.
 */
internal sealed class ExampleStore(string url) : IBlokMcpDocumentSource, IBlokMcpDocumentLister
{
  private static readonly HttpClient Http = new();

  private readonly string root = url.EndsWith('/') ? url[..^1] : url;

  public async ValueTask<BlokMcpStoredDocument?> LoadAsync(BlokMcpDocumentCaller caller, string documentId, CancellationToken cancellationToken)
  {
    var body = await CallAsync(Request(HttpMethod.Get, $"{root}/{EncodeComponent(documentId)}", caller), cancellationToken);

    // Passed on as given: Blok refuses a document without its text or a version, as a host bug.
    return body is null ? null : new BlokMcpStoredDocument(StringOf(body, "documentText")!, StringOf(body, "version")!);
  }

  public async ValueTask<string> SaveAsync(BlokMcpDocumentCaller caller, string documentId, string documentText, string? ifVersion, CancellationToken cancellationToken)
  {
    using var request = Request(HttpMethod.Put, $"{root}/{EncodeComponent(documentId)}", caller);

    request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(documentText));
    request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
    if (ifVersion is not null)
    {
      request.Headers.TryAddWithoutValidation("Blok-If-Version", ifVersion);
    }

    return StringOf(await CallAsync(request, cancellationToken), "version") ?? string.Empty;
  }

  public async ValueTask<BlokMcpDocumentList> ListAsync(BlokMcpDocumentCaller caller, BlokMcpListRequest request, CancellationToken cancellationToken)
  {
    var query = new List<string> { $"limit={request.Limit.ToString(System.Globalization.CultureInfo.InvariantCulture)}" };

    if (request.Query is not null)
    {
      query.Add($"query={EncodeForm(request.Query)}");
    }
    if (request.Cursor is not null)
    {
      query.Add($"cursor={EncodeForm(request.Cursor)}");
    }
    var body = await CallAsync(Request(HttpMethod.Get, $"{root}?{string.Join('&', query)}", caller), cancellationToken);

    if (body is not JsonObject answer || answer["documents"] is not JsonArray documents)
    {
      throw new InvalidOperationException("the document store listed no documents array");
    }

    return new BlokMcpDocumentList([.. documents.OfType<JsonObject>()
        .Where(doc => StringOf(doc, "id") is not null)
        .Select(doc => new BlokMcpListedDocument(StringOf(doc, "id")!) { Title = StringOf(doc, "title") })])
    {
      NextCursor = StringOf(answer, "nextCursor"),
    };
  }

  private static HttpRequestMessage Request(HttpMethod method, string target, BlokMcpDocumentCaller caller)
  {
    // As sent: System.Uri would turn %7E back into "~".
    var request = new HttpRequestMessage(method, new Uri(target, new UriCreationOptions { DangerousDisablePathAndQueryCanonicalization = true }));

    request.Headers.TryAddWithoutValidation("Blok-Caller", caller.Principal);
    request.Headers.TryAddWithoutValidation("Blok-Caller-Client", caller.ClientName);
    request.Headers.TryAddWithoutValidation("Blok-Caller-Actor", caller.Actor.Id);
    if (caller.Actor.OnBehalfOf is { } onBehalfOf)
    {
      request.Headers.TryAddWithoutValidation("Blok-Caller-On-Behalf-Of", onBehalfOf);
    }

    return request;
  }

  private static async Task<JsonNode?> CallAsync(HttpRequestMessage request, CancellationToken cancellationToken)
  {
    using (request)
    {
      using var response = await Http.SendAsync(request, cancellationToken);
      var text = await response.Content.ReadAsStringAsync(cancellationToken);
      var status = (int)response.StatusCode;

      if (status == 200)
      {
        return Parse(text);
      }
      BlokMcpSourceErrorKind? kind = status switch
      {
        409 => BlokMcpSourceErrorKind.Changed,
        503 => BlokMcpSourceErrorKind.Unavailable,
        403 => BlokMcpSourceErrorKind.Forbidden,
        422 => BlokMcpSourceErrorKind.InvalidId,
        _ => null,
      };

      if (kind is null)
      {
        throw new HttpRequestException($"the document store answered {status}: {text}");
      }
      string message;

      try
      {
        message = Parse(text) is JsonObject body ? StringOf(body, "message") ?? string.Empty : string.Empty;
      }
      catch (JsonException)
      {
        message = string.Empty;
      }

      throw new BlokMcpSourceException(kind.Value, message);
    }
  }

  private static string? StringOf(JsonNode? node, string key)
  {
    return node is JsonObject json && json[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
  }

  // As JSON.parse: a repeated key keeps its last value (JsonNode.Parse refuses one).
  private static JsonNode? Parse(string text)
  {
    using var document = JsonDocument.Parse(text);

    return NodeOf(document.RootElement);
  }

  private static JsonNode? NodeOf(JsonElement element)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        var node = new JsonObject();

        foreach (var property in element.EnumerateObject())
        {
          node[property.Name] = NodeOf(property.Value);
        }

        return node;
      case JsonValueKind.Array:
        return new JsonArray([.. element.EnumerateArray().Select(NodeOf)]);
      case JsonValueKind.Null:
        return null;
      default:
        return JsonValue.Create(element.Clone());
    }
  }

  // encodeURIComponent: every UTF-8 byte but A-Z a-z 0-9 - _ . ! ~ * ' ( ) as %XX.
  private static string EncodeComponent(string value)
  {
    return Encode(value, "-_.!~*'()", spaceAsPlus: false);
  }

  // URLSearchParams: space as "+", every UTF-8 byte but A-Z a-z 0-9 * - . _ as %XX.
  private static string EncodeForm(string value)
  {
    return Encode(value, "*-._", spaceAsPlus: true);
  }

  private static string Encode(string value, string kept, bool spaceAsPlus)
  {
    var encoded = new StringBuilder();

    foreach (var b in Encoding.UTF8.GetBytes(value))
    {
      var c = (char)b;

      if (char.IsAsciiLetterOrDigit(c) || kept.Contains(c, StringComparison.Ordinal))
      {
        encoded.Append(c);
      }
      else if (spaceAsPlus && c == ' ')
      {
        encoded.Append('+');
      }
      else
      {
        encoded.Append('%').Append(b.ToString("X2", System.Globalization.CultureInfo.InvariantCulture));
      }
    }

    return encoded.ToString();
  }
}
