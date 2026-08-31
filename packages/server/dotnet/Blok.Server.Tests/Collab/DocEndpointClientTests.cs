using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class DocEndpointClientTests
{
  private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(10);

  [Fact]
  public async Task LoadGetsTheDocumentUrlWithTheAuthorizationVerbatim()
  {
    var recorder = new RequestRecorder(_ => Json("""{"blocks":[]}"""));
    using var client = CreateClient(
        recorder,
        endpoint: "https://app.example.com/api/docs/",
        authorization: "Bearer abc def");

    await client.LoadAsync("doc 1/x", CancellationToken.None);

    var request = Assert.Single(recorder.Requests);
    Assert.Equal(HttpMethod.Get, request.Method);
    Assert.Equal(
        "https://app.example.com/api/docs/doc%201%2Fx",
        request.Url);
    Assert.Equal("Bearer abc def", request.Headers["Authorization"]);
    Assert.Equal("application/json", request.Headers["Accept"]);
  }

  [Fact]
  public async Task LoadOmitsTheAuthorizationHeaderWhenNoneIsConfigured()
  {
    var recorder = new RequestRecorder(_ => Json("""{"blocks":[]}"""));
    using var client = CreateClient(recorder, authorization: "");

    await client.LoadAsync("doc", CancellationToken.None);

    Assert.DoesNotContain("Authorization", Assert.Single(recorder.Requests).Headers.Keys);
  }

  [Fact]
  public async Task LoadReadsABareOutputDataDocument()
  {
    var recorder = new RequestRecorder(_ => Json(
        """{"time":1,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi"}}],"version":"1.12.0"}"""));
    using var client = CreateClient(recorder);

    var loaded = await client.LoadAsync("doc", CancellationToken.None);

    var data = Assert.IsType<JsonObject>(loaded.Data);
    Assert.Equal("a", data["blocks"]?[0]?["id"]?.GetValue<string>());
    Assert.Null(loaded.Version);
  }

  [Theory]
  [InlineData("""{"data":{"blocks":[{"id":"a"}]},"version":"v7"}""", "v7")]
  [InlineData("""{"data":{"blocks":[{"id":"a"}]},"version":42}""", "42")]
  [InlineData("""{"data":{"blocks":[{"id":"a"}]}}""", null)]
  public async Task LoadReadsAPersistedDocumentEnvelope(string body, string? version)
  {
    var recorder = new RequestRecorder(_ => Json(body));
    using var client = CreateClient(recorder);

    var loaded = await client.LoadAsync("doc", CancellationToken.None);

    var data = Assert.IsType<JsonObject>(loaded.Data);
    Assert.Equal("a", data["blocks"]?[0]?["id"]?.GetValue<string>());
    Assert.Equal(version, loaded.Version);
  }

  [Theory]
  [InlineData("""{"data":null,"version":"v1"}""", "v1")]
  [InlineData("null", null)]
  public async Task LoadReadsANullDocumentAsAnEmptySeed(string body, string? version)
  {
    var recorder = new RequestRecorder(_ => Json(body));
    using var client = CreateClient(recorder);

    var loaded = await client.LoadAsync("doc", CancellationToken.None);

    Assert.Null(loaded.Data);
    Assert.Equal(version, loaded.Version);
  }

  [Theory]
  [InlineData(HttpStatusCode.NotFound)]
  [InlineData(HttpStatusCode.Unauthorized)]
  [InlineData(HttpStatusCode.InternalServerError)]
  [InlineData(HttpStatusCode.Found)]
  public async Task LoadRejectsANonSuccessStatus(HttpStatusCode status)
  {
    var recorder = new RequestRecorder(_ => new HttpResponseMessage(status)
    {
      Content = new StringContent("nope"),
    });
    using var client = CreateClient(recorder);

    var error = await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));

    Assert.Equal((int)status, error.StatusCode);
    Assert.Contains(
        ((int)status).ToString(CultureInfo.InvariantCulture),
        error.Message,
        StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("")]
  [InlineData("{not json")]
  [InlineData("[]")]
  [InlineData("\"text\"")]
  [InlineData("""{"data":"text"}""")]
  public async Task LoadRejectsAMalformedBody(string body)
  {
    var recorder = new RequestRecorder(_ => Json(body));
    using var client = CreateClient(recorder);

    var error = await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));

    Assert.Null(error.StatusCode);
  }

  [Fact]
  public async Task SavePutsTheBareDocumentWithTheVersionHeader()
  {
    var recorder = new RequestRecorder(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
    using var client = CreateClient(
        recorder,
        endpoint: "https://app.example.com/api/docs",
        authorization: "Token xyz");
    var document = JsonNode.Parse("""{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}""");

    await client.SaveAsync("doc-1", document!, "v7", CancellationToken.None);

    var request = Assert.Single(recorder.Requests);
    Assert.Equal(HttpMethod.Put, request.Method);
    Assert.Equal("https://app.example.com/api/docs/doc-1", request.Url);
    Assert.Equal("Token xyz", request.Headers["Authorization"]);
    Assert.Equal("v7", request.Headers[DocEndpointClient.VersionHeader]);
    Assert.StartsWith("application/json", request.ContentType, StringComparison.Ordinal);
    Assert.Equal(
        JsonNode.Parse("""{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}""")!.ToJsonString(),
        JsonNode.Parse(request.Body)!.ToJsonString());
  }

  [Fact]
  public async Task SaveOmitsTheVersionHeaderWhenNoVersionIsKnown()
  {
    var recorder = new RequestRecorder(_ => new HttpResponseMessage(HttpStatusCode.OK));
    using var client = CreateClient(recorder);

    await client.SaveAsync("doc", JsonNode.Parse("""{"blocks":[]}""")!, null, CancellationToken.None);

    Assert.DoesNotContain(
        DocEndpointClient.VersionHeader,
        Assert.Single(recorder.Requests).Headers.Keys);
  }

  [Theory]
  [InlineData("""{"version":"v8"}""", "v8")]
  [InlineData("""{"version":9}""", "9")]
  [InlineData("""{"ok":true}""", null)]
  [InlineData("", null)]
  [InlineData("not json", null)]
  public async Task SaveReturnsTheVersionTheEndpointAnswersWithIfAny(string body, string? expected)
  {
    var recorder = new RequestRecorder(_ => Json(body));
    using var client = CreateClient(recorder);

    var version = await client.SaveAsync(
        "doc",
        JsonNode.Parse("""{"blocks":[]}""")!,
        "v7",
        CancellationToken.None);

    Assert.Equal(expected, version);
  }

  [Theory]
  [InlineData(HttpStatusCode.Conflict)]
  [InlineData(HttpStatusCode.BadGateway)]
  public async Task SaveRejectsANonSuccessStatus(HttpStatusCode status)
  {
    var recorder = new RequestRecorder(_ => new HttpResponseMessage(status));
    using var client = CreateClient(recorder);

    var error = await Assert.ThrowsAsync<DocEndpointException>(
        () => client.SaveAsync("doc", JsonNode.Parse("""{"blocks":[]}""")!, null, CancellationToken.None));

    Assert.Equal((int)status, error.StatusCode);
  }

  [Fact]
  public async Task RequestsGiveUpAfterTheConfiguredTimeout()
  {
    var recorder = new RequestRecorder(async cancellationToken =>
    {
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);

      return new HttpResponseMessage(HttpStatusCode.OK);
    });
    using var client = CreateClient(recorder, timeout: TimeSpan.FromMilliseconds(200));

    var load = client.LoadAsync("doc", CancellationToken.None);
    var finished = await Task.WhenAny(load, Task.Delay(Deadline));

    Assert.Same(load, finished);
    var error = await Assert.ThrowsAsync<DocEndpointException>(() => load);
    Assert.Contains("timed out", error.Message, StringComparison.Ordinal);
    Assert.Null(error.StatusCode);
  }

  [Fact]
  public async Task ACallerCancellationStopsTheRequest()
  {
    var recorder = new RequestRecorder(async cancellationToken =>
    {
      await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);

      return new HttpResponseMessage(HttpStatusCode.OK);
    });
    using var client = CreateClient(recorder);
    using var cancellation = new CancellationTokenSource();

    var load = client.LoadAsync("doc", cancellation.Token);
    cancellation.Cancel();
    var finished = await Task.WhenAny(load, Task.Delay(Deadline));

    Assert.Same(load, finished);
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => load);
  }

  /// <summary>
  /// A document id must address ONE path segment. Uri normalization collapses
  /// dot segments, so "." and ".." would silently retarget the request at the
  /// collection root or its parent — defence in depth beside the endpoint's
  /// own single-segment guard.
  /// </summary>
  [Theory]
  [InlineData("")]
  [InlineData(".")]
  [InlineData("..")]
  public async Task LoadRejectsADocIdThatIsNotOneOrdinarySegment(string docId)
  {
    var recorder = new RequestRecorder(_ => Json("""{"blocks":[]}"""));
    using var client = CreateClient(recorder);

    await Assert.ThrowsAnyAsync<ArgumentException>(
        () => client.LoadAsync(docId, CancellationToken.None));
    Assert.Empty(recorder.Requests);
  }

  [Fact]
  public async Task SaveRejectsADotSegmentDocIdBeforeSending()
  {
    var recorder = new RequestRecorder(_ => Json("{}"));
    using var client = CreateClient(recorder);

    await Assert.ThrowsAnyAsync<ArgumentException>(
        () => client.SaveAsync("..", new JsonObject(), null, CancellationToken.None));
    Assert.Empty(recorder.Requests);
  }

  [Theory]
  [InlineData("doc 1/x", "https://app.example.com/api/docs/doc%201%2Fx")]
  [InlineData("a.b", "https://app.example.com/api/docs/a.b")]
  [InlineData("...", "https://app.example.com/api/docs/...")]
  [InlineData("a?b#c", "https://app.example.com/api/docs/a%3Fb%23c")]
  [InlineData("../x", "https://app.example.com/api/docs/..%2Fx")]
  // A percent-encoded dot is not a dot segment here: escaping the id escapes
  // its own '%', so the server decodes the segment back to the literal "%2e".
  [InlineData("%2e", "https://app.example.com/api/docs/%252e")]
  [InlineData("%2E%2e", "https://app.example.com/api/docs/%252E%252e")]
  public async Task AnAcceptedDocIdStaysOneEscapedSegment(string docId, string expected)
  {
    var recorder = new RequestRecorder(_ => Json("""{"blocks":[]}"""));
    using var client = CreateClient(recorder);

    await client.LoadAsync(docId, CancellationToken.None);

    Assert.Equal(expected, Assert.Single(recorder.Requests).Url);
  }

  [Fact]
  public async Task LoadRefusesAResponseLargerThanTheCap()
  {
    var recorder = new RequestRecorder(_ => Json($$"""{"blocks":[],"pad":"{{new string('x', 4096)}}"}"""));
    using var client = CreateClient(recorder, maxResponseBytes: 1024);

    var error = await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));

    Assert.Contains("too large", error.Message, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public async Task LoadRefusesAnOverlongResponseThatDeclaresNoLength()
  {
    var recorder = new RequestRecorder(_ => new HttpResponseMessage(HttpStatusCode.OK)
    {
      Content = new StreamContent(new MemoryStream(
          Encoding.UTF8.GetBytes($$"""{"blocks":[],"pad":"{{new string('x', 4096)}}"}"""))),
    });
    using var client = CreateClient(recorder, maxResponseBytes: 1024);

    await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));
  }

  [Fact]
  public async Task LoadAcceptsAResponseAtTheCap()
  {
    var body = """{"blocks":[]}""";
    var recorder = new RequestRecorder(_ => Json(body));
    using var client = CreateClient(recorder, maxResponseBytes: Encoding.UTF8.GetByteCount(body));

    var loaded = await client.LoadAsync("doc", CancellationToken.None);

    Assert.NotNull(loaded.Data);
  }

  /// <summary>
  /// System.Text.Json defaults to a MaxDepth of 64 in BOTH directions, well
  /// under the converter's own nesting limit, so a legitimate deep document
  /// would fail to load or to save.
  /// </summary>
  [Fact]
  public async Task LoadReadsADocumentNestedPastTheFrameworkDefaultDepth()
  {
    var recorder = new RequestRecorder(_ => Json(DeepJson(100)));
    using var client = CreateClient(recorder);

    var loaded = await client.LoadAsync("doc", CancellationToken.None);

    Assert.NotNull(loaded.Data);
  }

  [Fact]
  public async Task SaveWritesADocumentNestedPastTheFrameworkDefaultDepth()
  {
    var recorder = new RequestRecorder(_ => Json("{}"));
    using var client = CreateClient(recorder);
    var document = JsonNode.Parse(
        DeepJson(100),
        documentOptions: new System.Text.Json.JsonDocumentOptions { MaxDepth = 4096 })!;

    await client.SaveAsync("doc", document, null, CancellationToken.None);

    Assert.Contains("\"a\"", Assert.Single(recorder.Requests).Body, StringComparison.Ordinal);
  }

  [Fact]
  public async Task LoadRejectsADocumentNestedPastTheConfiguredDepth()
  {
    var recorder = new RequestRecorder(_ => Json(DeepJson(YDocConverter.JsonMaxDepth + 2)));
    using var client = CreateClient(recorder);

    await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));
  }

  [Fact]
  public async Task SaveRejectsADocumentNestedPastTheConfiguredDepth()
  {
    var recorder = new RequestRecorder(_ => Json("{}"));
    using var client = CreateClient(recorder);
    var document = JsonNode.Parse(
        DeepJson(YDocConverter.JsonMaxDepth + 2),
        documentOptions: new System.Text.Json.JsonDocumentOptions { MaxDepth = 4096 })!;

    await Assert.ThrowsAsync<DocEndpointException>(
        () => client.SaveAsync("doc", document, null, CancellationToken.None));
    Assert.Empty(recorder.Requests);
  }

  /// <summary>
  /// JsonNode.Parse accepts duplicate keys lazily and then throws an
  /// ArgumentException — not a JsonException — the first time the object is
  /// indexed, from wherever that happens to be. The client must decide at
  /// parse time and report it as a DocEndpointException like any other bad
  /// answer. (The JS client takes last-wins here; see the report.)
  /// </summary>
  [Fact]
  public async Task LoadRejectsAnAnswerWithDuplicateJsonKeys()
  {
    var recorder = new RequestRecorder(_ => Json("""{"data":{"a":1},"data":{"a":2}}"""));
    using var client = CreateClient(recorder);

    await Assert.ThrowsAsync<DocEndpointException>(
        () => client.LoadAsync("doc", CancellationToken.None));
  }

  private static string DeepJson(int depth)
  {
    return string.Concat(Enumerable.Repeat("""{"a":""", depth)) +
        "1" +
        new string('}', depth);
  }

  private static DocEndpointClient CreateClient(
      RequestRecorder recorder,
      string endpoint = "https://app.example.com/api/docs",
      string authorization = "Bearer secret",
      TimeSpan? timeout = null,
      long? maxResponseBytes = null)
  {
    var options = new DocEndpointOptions(
        new Uri(endpoint),
        authorization,
        timeout ?? TimeSpan.FromSeconds(30));

    return new DocEndpointClient(
        maxResponseBytes is null
          ? options
          : options with { MaxResponseBytes = maxResponseBytes.Value },
        recorder);
  }

  private static HttpResponseMessage Json(string body)
  {
    return new HttpResponseMessage(HttpStatusCode.OK)
    {
      Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };
  }

  private sealed record RecordedRequest(
      HttpMethod Method,
      string Url,
      IReadOnlyDictionary<string, string> Headers,
      string ContentType,
      string Body);

  private sealed class RequestRecorder : HttpMessageHandler
  {
    private readonly Func<CancellationToken, Task<HttpResponseMessage>> respond;

    internal RequestRecorder(Func<CancellationToken, HttpResponseMessage> respond) :
        this(cancellationToken => Task.FromResult(respond(cancellationToken)))
    {
    }

    internal RequestRecorder(Func<CancellationToken, Task<HttpResponseMessage>> respond)
    {
      this.respond = respond;
    }

    internal List<RecordedRequest> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
      var body = request.Content is null
        ? ""
        : await request.Content.ReadAsStringAsync(cancellationToken);
      Requests.Add(new RecordedRequest(
          request.Method,
          request.RequestUri?.AbsoluteUri ?? "",
          request.Headers.ToDictionary(
              header => header.Key,
              header => string.Join(", ", header.Value),
              StringComparer.OrdinalIgnoreCase),
          request.Content?.Headers.ContentType?.ToString() ?? "",
          body));

      return await respond(cancellationToken);
    }
  }
}
