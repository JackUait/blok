using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
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
    TimeSpan RequestTimeout)
{
  /// <summary>
  /// Ceiling on a single answer's body. Generous — a document with a large
  /// pasted table is legitimately megabytes — but finite: without it a
  /// misbehaving or hostile endpoint can hand the room an unbounded stream
  /// and take the process down with an OutOfMemoryException.
  /// </summary>
  internal long MaxResponseBytes { get; init; } = 64L * 1024 * 1024;
}

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

  /// <summary>How much of an error body goes into the exception message.</summary>
  private const int ErrorBodyPrefixBytes = 512;

  private static readonly MediaTypeHeaderValue JsonMediaType =
      new("application/json") { CharSet = "utf-8" };

  /// <summary>
  /// Both directions carry the SAME depth ceiling as the converter's own
  /// nesting limit allows — see <see cref="YDocConverter.JsonMaxDepth"/>. The
  /// framework default is 64, below what the converter accepts, so a
  /// legitimately deep document would fail to load or to save; and duplicate
  /// property names are rejected here rather than becoming an ArgumentException
  /// from whichever line first indexes the object.
  /// </summary>
  private static readonly JsonDocumentOptions ReaderOptions = new()
  {
    MaxDepth = YDocConverter.JsonMaxDepth,
    AllowDuplicateProperties = false,
  };

  private static readonly JsonSerializerOptions WriterOptions = new()
  {
    MaxDepth = YDocConverter.JsonMaxDepth,
  };

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
      Content = new ByteArrayContent(Serialize(outputData)),
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

  private static byte[] Serialize(JsonNode outputData)
  {
    try
    {
      return JsonSerializer.SerializeToUtf8Bytes(outputData, WriterOptions);
    }
    catch (JsonException error)
    {
      throw new DocEndpointException(
          "collab: the document is nested too deeply to send " +
          $"(over {YDocConverter.JsonMaxDepth} levels).",
          inner: error);
    }
  }

  private static SocketsHttpHandler CreateHandler()
  {
    return new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      ConnectTimeout = TimeSpan.FromSeconds(10),
      // A pooled connection outliving a DNS change at the endpoint would
      // keep talking to the old address.
      PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    };
  }

  private static LoadedDocument ParseLoadedDocument(byte[] body)
  {
    JsonNode? root;

    try
    {
      root = JsonNode.Parse(body, documentOptions: ReaderOptions);
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
      return JsonNode.Parse(body, documentOptions: ReaderOptions) is JsonObject answer
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

  /// <summary>
  /// One escaped path segment under the endpoint, never more and never less.
  /// <see cref="Uri"/> normalizes dot segments, so an id of "." or ".."
  /// (percent-encoded or not) would collapse the path and retarget the
  /// request at the collection or its parent — the answer to a GET for one
  /// document would be the whole collection, and a PUT would overwrite it.
  /// Escaping alone does not save us: the constructor unescapes %2e before
  /// normalizing. So the built URL is checked against the escaped id it was
  /// supposed to carry, and anything that did not survive is refused before
  /// a request is made. (The endpoint side has its own single-segment guard;
  /// this is the client half of it.)
  /// </summary>
  private Uri UrlFor(string docId)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    var basePath = options.Endpoint.AbsoluteUri.TrimEnd('/');
    var segment = Uri.EscapeDataString(docId);
    var url = new Uri($"{basePath}/{segment}");

    if (!string.Equals(url.AbsoluteUri, $"{basePath}/{segment}", StringComparison.Ordinal))
    {
      throw new ArgumentException(
          $"collab: the document id \"{docId}\" does not address a single path segment.",
          nameof(docId));
    }

    return url;
  }

  private async Task<byte[]> SendAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
  {
    // Refused, not dropped: TryAddWithoutValidation accepts a value with a
    // CR or LF (a stray newline from a shell-quoted secret) and HttpHeaders
    // then discards it when the header is read, so every request used to go
    // out unauthenticated with the endpoint's 401 as the only clue.
    if (options.Authorization != "" &&
        (options.Authorization.AsSpan().IndexOfAny('\r', '\n') >= 0 ||
            !request.Headers.TryAddWithoutValidation("Authorization", options.Authorization)))
    {
      throw new DocEndpointException(
          "collab: the doc endpoint Authorization value cannot be sent as a header " +
          "(a stray newline?).");
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
      // The status decides before any body is read: an error body is never
      // buffered, only its head goes into the message.
      if (!response.IsSuccessStatusCode)
      {
        var prefix = await ReadErrorPrefixAsync(response, timeout.Token);
        cancellationToken.ThrowIfCancellationRequested();

        throw new DocEndpointException(
            $"collab: the doc endpoint {request.Method.Method} returned " +
            $"{(int)response.StatusCode}{prefix}",
            (int)response.StatusCode);
      }

      try
      {
        return await ReadCappedAsync(response, request, timeout.Token);
      }
      catch (OperationCanceledException error) when (
          !cancellationToken.IsCancellationRequested)
      {
        throw new DocEndpointException(
            $"collab: the doc endpoint {request.Method.Method} timed out after " +
            $"{options.RequestTimeout.TotalSeconds:0.###}s.",
            inner: error);
      }
    }
  }

  /// <summary>Up to the first <see cref="ErrorBodyPrefixBytes"/> of an error body as one line, best effort; "." when there is none.</summary>
  private static async Task<string> ReadErrorPrefixAsync(
      HttpResponseMessage response,
      CancellationToken cancellationToken)
  {
    var buffer = new byte[ErrorBodyPrefixBytes];
    var read = 0;

    try
    {
      await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);

      while (read < buffer.Length)
      {
        var count = await source.ReadAsync(buffer.AsMemory(read), cancellationToken);

        if (count == 0)
        {
          break;
        }

        read += count;
      }
    }
    catch (Exception)
    {
      // The status is the message; the body was only ever a courtesy.
    }

    var text = string.Join(
        ' ',
        Encoding.UTF8.GetString(buffer, 0, read).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    return text.Length == 0 ? "." : $": {text}";
  }

  /// <summary>
  /// Read at most <see cref="DocEndpointOptions.MaxResponseBytes"/>. The
  /// declared Content-Length is only a hint — a chunked answer declares
  /// none — so the stream is read with a hard ceiling either way.
  /// </summary>
  private async Task<byte[]> ReadCappedAsync(
      HttpResponseMessage response,
      HttpRequestMessage request,
      CancellationToken cancellationToken)
  {
    var cap = options.MaxResponseBytes;

    if (response.Content.Headers.ContentLength > cap)
    {
      throw TooLarge(request, cap);
    }

    await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
    using var buffer = new MemoryStream();
    var chunk = new byte[81920];

    while (true)
    {
      var read = await source.ReadAsync(chunk, cancellationToken);

      if (read == 0)
      {
        break;
      }

      if (buffer.Length + read > cap)
      {
        throw TooLarge(request, cap);
      }

      buffer.Write(chunk, 0, read);
    }

    return buffer.ToArray();
  }

  private static DocEndpointException TooLarge(HttpRequestMessage request, long cap)
  {
    return new DocEndpointException(
        $"collab: the doc endpoint {request.Method.Method} answer is too large " +
        $"(over {cap} bytes).");
  }
}
