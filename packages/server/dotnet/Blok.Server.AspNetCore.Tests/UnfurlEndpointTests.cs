using System.Net;
using Blok.Server.Outbound;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class UnfurlEndpointTests
{
  [Theory]
  [InlineData("/unfurl")]
  [InlineData("/unfurl?url=")]
  public async Task MissingUrlReturnsTheExactBadRequestWire(
      string path)
  {
    var fetcher = new StubFetcher();
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(path);

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Equal(
        "application/json",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"success\":0}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal(0, fetcher.CallCount);
  }

  [Fact]
  public async Task FetchesThroughTheRegisteredGuardWithFrozenLimits()
  {
    var fetcher = new StubFetcher
    {
      Response = new GuardedResponse(
          """
          <title>Plain title</title>
          <meta name="description" content="Plain description">
          <meta name="twitter:title" content="Twitter title">
          <meta name="twitter:description" content="Twitter description">
          <meta name="twitter:image" content="/twitter.png">
          <meta property="og:title" content="OpenGraph title">
          <meta property="og:description" content="OpenGraph description">
          <meta property="og:image" content="../images/cover.png?size=2">
          <link rel="icon" href="./favicon.svg">
          """u8.ToArray(),
          "application/json",
          "https://example.com/final/page.html?from=redirect",
          StatusCodes.Status200OK),
    };
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(
        "/unfurl?url=https%3A%2F%2Fexample.com%2Fredirect");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "application/json",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"success\":1,\"link\":\"https://example.com/final/page.html?from=redirect\",\"meta\":{\"title\":\"OpenGraph title\",\"description\":\"OpenGraph description\",\"image\":{\"url\":\"https://example.com/images/cover.png?size=2\"},\"favicon\":\"https://example.com/final/favicon.svg\",\"domain\":\"example.com\"}}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal(1, fetcher.CallCount);
    Assert.Equal(
        "https://example.com/redirect",
        fetcher.Target);
    Assert.Equal(
        TimeSpan.FromSeconds(10),
        fetcher.Limits.TotalTimeout);
    Assert.Equal(2L << 20, fetcher.Limits.MaximumResponseBytes);
    Assert.Equal(5, fetcher.Limits.MaximumRedirects);
  }

  [Fact]
  public async Task FetchFailureReturnsTheExactOpaqueWire()
  {
    var fetcher = new StubFetcher
    {
      Error = new GuardedFetchException(
          GuardedFetchFailure.BlockedDestination),
    };
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(
        "/unfurl?url=file%3A%2F%2F%2Fetc%2Fpasswd");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "application/json",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"success\":0}\n",
        await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData(301)]
  [InlineData(401)]
  [InlineData(404)]
  [InlineData(429)]
  [InlineData(502)]
  public async Task NonTwoHundredStatusIsNotParsed(int statusCode)
  {
    var fetcher = new StubFetcher
    {
      Response = new GuardedResponse(
          "<title>Error page</title>"u8.ToArray(),
          "text/html",
          "https://example.com/error",
          statusCode),
    };
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(
        "/unfurl?url=https%3A%2F%2Fexample.com%2Ferror");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"success\":0}\n",
        await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData(200)]
  [InlineData(203)]
  [InlineData(226)]
  public async Task EveryTwoHundredStatusIsParsed(int statusCode)
  {
    var fetcher = new StubFetcher
    {
      Response = new GuardedResponse(
          "<title>T</title>"u8.ToArray(),
          "",
          "https://example.com/a",
          statusCode),
    };
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(
        "/unfurl?url=https%3A%2F%2Fexample.com%2Fa");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"success\":1,\"link\":\"https://example.com/a\",\"meta\":{\"title\":\"T\",\"image\":{},\"favicon\":\"https://example.com/favicon.ico\",\"domain\":\"example.com\"}}\n",
        await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task EmptyMetadataScalarsAreOmittedButImageRemainsAnObject()
  {
    var fetcher = new StubFetcher
    {
      Response = new GuardedResponse(
          [],
          "",
          ":",
          StatusCodes.Status200OK),
    };
    await using var app = await BuildApplication(fetcher);
    using var response = await app.GetTestClient().GetAsync(
        "/unfurl?url=https%3A%2F%2Fexample.com");

    Assert.Equal(
        "{\"success\":1,\"link\":\":\",\"meta\":{\"image\":{}}}\n",
        await response.Content.ReadAsStringAsync());
  }

  private static async Task<WebApplication> BuildApplication(
      IGuardedOutboundFetcher fetcher)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(fetcher);
    builder.Services.AddBlokServer(options =>
        options.StorageDirectory = "");

    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private sealed class StubFetcher : IGuardedOutboundFetcher
  {
    public GuardedResponse? Response { get; init; }

    public GuardedFetchException? Error { get; init; }

    public int CallCount { get; private set; }

    public string? Target { get; private set; }

    public GuardedFetchLimits Limits { get; private set; }

    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits limits,
        CancellationToken cancellationToken)
    {
      CallCount++;
      Target = rawUrl;
      Limits = limits;

      if (Error is not null)
      {
        throw Error;
      }

      return ValueTask.FromResult(
          Response ??
          throw new InvalidOperationException("No guarded response was configured."));
    }
  }
}
