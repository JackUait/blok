using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>
/// Where the consumer's document routes live (--doc-endpoint, validated by
/// the options layer), the value sent verbatim as the Authorization header
/// (BLOK_DOC_ENDPOINT_AUTH; empty = no header) and the per-request timeout.
/// </summary>
internal sealed record DocEndpointOptions(
    Uri Endpoint,
    string Authorization,
    TimeSpan RequestTimeout);

/// <summary>
/// One GET answer: the OutputData object, or null for "nothing saved yet",
/// plus the store's version when it sent a PersistedDocument envelope.
/// </summary>
internal sealed record LoadedDocument(JsonNode? Data, string? Version);

internal sealed class DocEndpointException(
    string message,
    int? statusCode = null,
    Exception? inner = null) : Exception(message, inner)
{
  public int? StatusCode { get; } = statusCode;
}

internal interface IDocEndpointClient
{
  Task<LoadedDocument> LoadAsync(
      string docId,
      CancellationToken cancellationToken);

  /// <summary>
  /// Unconditional overwrite. Returns the version the endpoint answered with
  /// (a JSON body carrying "version"), or null to keep the previous one.
  /// </summary>
  Task<string?> SaveAsync(
      string docId,
      JsonNode outputData,
      string? version,
      CancellationToken cancellationToken);
}

/// <summary>
/// The third documented owner of an outbound HTTP client (after the guarded
/// fetcher and the S3 store), pinned by OutboundClientArchitectureTests.
/// The guarded fetcher cannot serve this traffic: it forbids loopback (a
/// local --doc-endpoint is allowed) and has no PUT.
///
/// Wire (plan decision 13): GET {endpoint}/{docId} answers bare OutputData,
/// a {data, version} envelope (data null = legitimate empty seed) or a bare
/// null; PUT {endpoint}/{docId} carries bare OutputData and the last-seen
/// version in the <see cref="VersionHeader"/> header.
/// </summary>
internal sealed class DocEndpointClient : IDocEndpointClient, IDisposable
{
  /// <summary>Pass-through of the version the endpoint last reported.</summary>
  internal const string VersionHeader = "Blok-Doc-Version";

  private static readonly MediaTypeHeaderValue JsonMediaType =
      new("application/json") { CharSet = "utf-8" };

  private readonly DocEndpointOptions options;
  private readonly HttpClient client;

  internal DocEndpointClient(DocEndpointOptions options) :
      this(options, CreateHandler())
  {
  }

  internal DocEndpointClient(
      DocEndpointOptions options,
      HttpMessageHandler handler)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(handler);

    this.options = options;

    // This client may reach only the operator-configured doc endpoint.
    client = new HttpClient(handler, disposeHandler: true)
    {
      Timeout = Timeout.InfiniteTimeSpan,
    };
  }

  public async Task<LoadedDocument> LoadAsync(
      string docId,
      CancellationToken cancellationToken)
  {
    using var request = new HttpRequestMessage(HttpMethod.Get, UrlFor(docId));
    request.Headers.TryAddWithoutValidation("Accept", "application/json");

    var body = await SendAsync(request, cancellationToken);

    return ParseLoadedDocument(body);
  }

  public async Task<string?> SaveAsync(
      string docId,
      JsonNode outputData,
      string? version,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(outputData);

    using var request = new HttpRequestMessage(HttpMethod.Put, UrlFor(docId))
    {
      Content = new ByteArrayContent(
          JsonSerializer.SerializeToUtf8Bytes(outputData)),
    };
    request.Content.Headers.ContentType = JsonMediaType;

    if (version is not null)
    {
      request.Headers.TryAddWithoutValidation(VersionHeader, version);
    }

    var body = await SendAsync(request, cancellationToken);

    return ParseSavedVersion(body);
  }

  public void Dispose()
  {
    client.Dispose();
  }

  private static SocketsHttpHandler CreateHandler()
  {
    return new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      ConnectTimeout = TimeSpan.FromSeconds(10),
    };
  }

  private static LoadedDocument ParseLoadedDocument(byte[] body)
  {
    JsonNode? root;

    try
    {
      root = JsonNode.Parse(body);
    }
    catch (JsonException error)
    {
      throw new DocEndpointException(
          "collab: the doc endpoint did not answer with JSON.",
          inner: error);
    }

    if (root is null)
    {
      return new LoadedDocument(null, null);
    }

    if (root is not JsonObject document)
    {
      throw new DocEndpointException(
          "collab: the doc endpoint answered with JSON that is not an object.");
    }

    if (!document.ContainsKey("data"))
    {
      return new LoadedDocument(document, null);
    }

    var data = document["data"];

    if (data is not null && data is not JsonObject)
    {
      throw new DocEndpointException(
          "collab: the doc endpoint envelope carries data that is not an object.");
    }

    return new LoadedDocument(data, VersionOf(document));
  }

  private static string? ParseSavedVersion(byte[] body)
  {
    if (body.Length == 0)
    {
      return null;
    }

    try
    {
      return JsonNode.Parse(body) is JsonObject answer
        ? VersionOf(answer)
        : null;
    }
    catch (JsonException)
    {
      return null;
    }
    catch (DocEndpointException)
    {
      return null;
    }
  }

  private static string? VersionOf(JsonObject envelope)
  {
    var version = envelope["version"];

    if (version is not JsonValue value)
    {
      return null;
    }

    if (value.TryGetValue<string>(out var text))
    {
      return text;
    }

    if (value.TryGetValue<double>(out var number))
    {
      return number.ToString(CultureInfo.InvariantCulture);
    }

    throw new DocEndpointException(
        "collab: the doc endpoint version must be a string or a number.");
  }

  private Uri UrlFor(string docId)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    return new Uri(
        options.Endpoint.AbsoluteUri.TrimEnd('/') +
        "/" +
        Uri.EscapeDataString(docId));
  }

  private async Task<byte[]> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
  {
    if (options.Authorization != "")
    {
      request.Headers.TryAddWithoutValidation(
          "Authorization",
          options.Authorization);
    }

    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);

    if (options.RequestTimeout > TimeSpan.Zero)
    {
      timeout.CancelAfter(options.RequestTimeout);
    }

    HttpResponseMessage response;

    try
    {
      response = await client.SendAsync(
          request,
          HttpCompletionOption.ResponseHeadersRead,
          timeout.Token);
    }
    catch (OperationCanceledException error) when (
        !cancellationToken.IsCancellationRequested)
    {
      throw new DocEndpointException(
          $"collab: the doc endpoint {request.Method.Method} timed out after " +
          $"{options.RequestTimeout.TotalSeconds:0.###}s.",
          inner: error);
    }

    using (response)
    {
      byte[] body;

      try
      {
        body = await response.Content.ReadAsByteArrayAsync(timeout.Token);
      }
      catch (OperationCanceledException error) when (
          !cancellationToken.IsCancellationRequested)
      {
        throw new DocEndpointException(
            $"collab: the doc endpoint {request.Method.Method} timed out after " +
            $"{options.RequestTimeout.TotalSeconds:0.###}s.",
            inner: error);
      }

      if (!response.IsSuccessStatusCode)
      {
        throw new DocEndpointException(
            $"collab: the doc endpoint {request.Method.Method} returned " +
            $"{(int)response.StatusCode}.",
            (int)response.StatusCode);
      }

      return body;
    }
  }
}
