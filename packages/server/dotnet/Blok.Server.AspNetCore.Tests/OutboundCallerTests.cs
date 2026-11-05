using System.Net;
using System.Text;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

// The fetcher caps each caller's fetches per pool; the endpoints name the
// caller (the guard's rate-limit key) and the pool.
public sealed class OutboundCallerTests
{
  private const string RemoteAddressHeader = "X-Test-Remote-Address";
  private const string Page = "https://quick.example.test/page";
  private const string OEmbed = "https://quick.example.test/oembed.json";

  [Fact]
  public async Task NamesTheCallerAndThePoolOfEveryFetchWhenTheRateLimitIsOn()
  {
    var fetcher = new RecordingFetcher();
    await using var app = await StartApplication(fetcher, rateLimit: 60);
    var client = app.GetTestClient();

    (await Upload(client)).Dispose();
    (await Get(client, $"/unfurl?url={Uri.EscapeDataString(Page)}")).Dispose();
    (await Get(client, $"/frame-check?url={Uri.EscapeDataString(Page)}")).Dispose();

    Assert.Equal(
        [
          (Page, true, "addr:192.0.2.1"),
          (Page, false, "addr:192.0.2.1"),
          (Page, false, "addr:192.0.2.1"),
          (OEmbed, false, "addr:192.0.2.1"),
        ],
        fetcher.Calls);
  }

  [Fact]
  public async Task NamesNoCallerWhenTheRateLimitIsOff()
  {
    var fetcher = new RecordingFetcher();
    await using var app = await StartApplication(fetcher, rateLimit: 0);
    var client = app.GetTestClient();

    (await Upload(client)).Dispose();
    (await Get(client, $"/frame-check?url={Uri.EscapeDataString(Page)}")).Dispose();

    Assert.All(fetcher.Calls, call => Assert.Null(call.Caller));
    Assert.Equal(3, fetcher.Calls.Count);
  }

  private static Task<HttpResponseMessage> Upload(HttpClient client)
  {
    var request = new HttpRequestMessage(HttpMethod.Post, "/upload-by-url")
    {
      Content = new StringContent($$"""{"url":"{{Page}}"}""", Encoding.UTF8, "application/json"),
    };
    request.Headers.TryAddWithoutValidation(RemoteAddressHeader, "192.0.2.1");
    return client.SendAsync(request);
  }

  private static Task<HttpResponseMessage> Get(HttpClient client, string path)
  {
    var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation(RemoteAddressHeader, "192.0.2.1");
    return client.SendAsync(request);
  }

  private static async Task<WebApplication> StartApplication(
      IGuardedOutboundFetcher fetcher,
      long rateLimit)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(fetcher);
    builder.Services.AddSingleton<IBlobStore>(new FixedBlobStore());
    builder.Services.AddBlokServer(options =>
    {
      options.StorageDirectory = "./unused-outbound-caller-test-storage";
      options.PublicUrl = "https://unused.example.test/files";
      options.RateLimitPerMinute = rateLimit;
      options.UnfurlDisabled = false;
    });
    var app = builder.Build();
    app.Use(async (context, next) =>
    {
      if (context.Request.Headers.TryGetValue(RemoteAddressHeader, out var remote) &&
          IPAddress.TryParse(remote.ToString(), out var address))
      {
        context.Connection.RemoteIpAddress = address;
      }

      await next(context);
    });
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  // Records each fetch; the page links an oEmbed answer so frame-check makes two.
  private sealed class RecordingFetcher : IGuardedOutboundFetcher
  {
    public List<(string Url, bool Upload, string? Caller)> Calls { get; } = [];

    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits limits,
        CancellationToken cancellationToken)
    {
      lock (Calls)
      {
        Calls.Add((rawUrl, limits.Upload, limits.Caller));
      }

      var body = rawUrl == OEmbed
        ? """{"title":"t"}"""
        : $"""<html><head><link rel="alternate" type="application/json+oembed" href="{OEmbed}"></head></html>""";

      return ValueTask.FromResult(new GuardedResponse(
          Encoding.UTF8.GetBytes(body),
          rawUrl == OEmbed ? "application/json" : "text/html",
          rawUrl,
          StatusCodes.Status200OK));
    }
  }

  private sealed class FixedBlobStore : IBlobStore
  {
    public Task<string> PutAsync(
        string extension,
        string mimeType,
        Stream content,
        CancellationToken cancellationToken = default)
    {
      return Task.FromResult("https://unused.example.test/files/blob");
    }

    public Task DeleteAsync(string url, CancellationToken cancellationToken = default)
    {
      return Task.CompletedTask;
    }
  }
}
