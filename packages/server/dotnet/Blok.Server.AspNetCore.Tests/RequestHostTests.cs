using System.Net;
using System.Text.Json.Nodes;
using Blok.Server.Outbound;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// A loopback server (Auth "none" or "proxy") answers only its own names.
/// Reads test/unit/server-conformance/fixtures/request-hosts.json, which the
/// Go and Rust servers read too.
/// </summary>
public sealed class RequestHostTests
{
  // A DNS-rebinding page sends a same-origin GET under its own name and no
  // Origin.
  [Fact]
  public async Task ALoopbackServerRefusesAFrameCheckUnderAForeignHost()
  {
    await using var app = await BuildApplication(_ => { });
    using var request = new HttpRequestMessage(
        HttpMethod.Get,
        "/frame-check?url=https%3A%2F%2Fexample.com%2F&embedder=http%3A%2F%2Fattacker.example%3A4000");
    request.Headers.Host = "attacker.example:4000";
    request.Headers.Add("Sec-Fetch-Site", "same-origin");
    using var response = await app.GetTestClient().SendAsync(request);

    Assert.Equal("host not allowed\n", await response.Content.ReadAsStringAsync());
    Assert.Equal(HttpStatusCode.MisdirectedRequest, response.StatusCode);
    Assert.Equal("text/plain; charset=utf-8", response.Content.Headers.ContentType?.ToString());
  }

  // An app that maps the routes under its own public name, without the
  // hook, keeps serving that name.
  [Fact]
  public async Task TheHostCheckIsOffUnlessAsked()
  {
    await using var app = await BuildApplication(_ => { }, checkHost: false);
    using var request = new HttpRequestMessage(HttpMethod.Get, "/frame-check?url=https%3A%2F%2Fexample.com%2F");
    request.Headers.Host = "app.example.com";
    using var response = await app.GetTestClient().SendAsync(request);

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
  }

  [Fact]
  public async Task ALoopbackServerAnswersUnderItsOwnName()
  {
    await using var app = await BuildApplication(_ => { });
    using var request = new HttpRequestMessage(HttpMethod.Get, "/frame-check?url=https%3A%2F%2Fexample.com%2F");
    request.Headers.Host = "127.0.0.1:4000";
    using var response = await app.GetTestClient().SendAsync(request);

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
  }

  // Ticket mode already needs an allowed Origin and a pass, and a proxy in
  // front of it may forward the public Host.
  [Fact]
  public async Task TicketModeKeepsAnyHost()
  {
    await using var app = await BuildApplication(options =>
    {
      options.Auth = "ticket";
      options.Secret = "s3cret-value-at-least-32-chars-long!";
      options.AllowedOrigins = ["https://app.example.com"];
    });
    using var request = new HttpRequestMessage(HttpMethod.Get, "/frame-check?url=https%3A%2F%2Fexample.com%2F");
    request.Headers.Host = "blok.example.com";
    request.Headers.Add("Origin", "https://app.example.com");
    using var response = await app.GetTestClient().SendAsync(request);

    Assert.Equal("missing pass\n", await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public void RequestHostsMatchTheSharedFixture()
  {
    var path = Path.Combine(
        OptionsValidateFixtureTests.RepositoryRoot(),
        "test/unit/server-conformance/fixtures/request-hosts.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var names = RequestHost.Names(
        fixture["allowedOrigins"]!.AsArray().Select(origin => origin!.GetValue<string>()),
        fixture["publicUrl"]!.GetValue<string>());
    var wrong = fixture["cases"]!.AsArray()
        .Where(row => RequestHost.IsAllowed(row!["host"]!.GetValue<string>(), names) != row["allowed"]!.GetValue<bool>())
        .Select(row => row!["host"]!.GetValue<string>())
        .ToList();

    Assert.Empty(wrong);
  }

  private static async Task<WebApplication> BuildApplication(
      Action<BlokServerOptions> configure,
      bool checkHost = true)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton<IGuardedOutboundFetcher>(new StubFetcher());
    var server = builder.Services.AddBlokServer(options =>
    {
      options.StorageDirectory = "";
      options.UnfurlDisabled = false;
      configure(options);
    });
    if (checkHost)
    {
      server.UseLoopbackHostCheck();
    }

    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private sealed class StubFetcher : IGuardedOutboundFetcher
  {
    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits limits,
        CancellationToken cancellationToken)
    {
      return ValueTask.FromResult(new GuardedResponse(
          "<title>t</title>"u8.ToArray(),
          "text/html",
          "https://example.com/",
          StatusCodes.Status200OK));
    }
  }
}
