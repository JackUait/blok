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

  private static DocEndpointClient CreateClient(
      RequestRecorder recorder,
      string endpoint = "https://app.example.com/api/docs",
      string authorization = "Bearer secret",
      TimeSpan? timeout = null)
  {
    return new DocEndpointClient(
        new DocEndpointOptions(
            new Uri(endpoint),
            authorization,
            timeout ?? TimeSpan.FromSeconds(30)),
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
