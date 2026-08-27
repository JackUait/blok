using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class BlokServerRequestGuardTests
{
  private const string AllowedOrigin = "https://app.example.com";
  private const string DisallowedOrigin = "https://evil.example.net";
  private const string RemoteAddressHeader = "X-Test-Remote-Address";
  private static readonly DateTimeOffset FixedNow =
      DateTimeOffset.FromUnixTimeSeconds(1_700_000_000);

  [Theory]
  [InlineData("none", DisallowedOrigin)]
  [InlineData("none", "null")]
  [InlineData("proxy", DisallowedOrigin)]
  [InlineData("proxy", "null")]
  [InlineData("ticket", DisallowedOrigin)]
  [InlineData("ticket", "null")]
  public async Task RejectsEveryPresentDisallowedOrigin(
      string auth,
      string origin)
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication(auth, rateLimit: 0);
    using var client = app.GetTestClient();
    var authorization = auth == "ticket"
      ? $"Bearer {fixture.Compatible}"
      : null;
    using var response = await SendUnfurl(
        client,
        origin,
        authorization);

    Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "origin not allowed\n",
        await response.Content.ReadAsStringAsync());
    AssertNoCors(response);
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  public async Task RejectsOriginlessCrossSiteBrowserRequests(string auth)
  {
    await using var app = await StartApplication(auth, rateLimit: 0);
    using var client = app.GetTestClient();
    using var response = await SendUnfurl(
        client,
        origin: null,
        authorization: null,
        secFetchSite: "cross-site");

    Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "origin not allowed\n",
        await response.Content.ReadAsStringAsync());
    AssertNoCors(response);
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  public async Task PreservesGenuinelyOriginlessBackendRequests(string auth)
  {
    await using var app = await StartApplication(auth, rateLimit: 0);
    using var client = app.GetTestClient();
    using var response = await SendUnfurl(
        client,
        origin: null,
        authorization: null);

    await AssertShellResponse(response);
    AssertNoCors(response);
  }

  [Fact]
  public async Task TicketModeStillRequiresAnAllowedOrigin()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 0);
    using var client = app.GetTestClient();
    using var response = await SendUnfurl(
        client,
        origin: null,
        authorization: $"Bearer {fixture.Compatible}");

    Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    Assert.Equal(
        "origin not allowed\n",
        await response.Content.ReadAsStringAsync());
    AssertNoCors(response);
  }

  [Fact]
  public async Task PreservesTheTicketAuthorizationGrammar()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 0);
    using var client = app.GetTestClient();

    foreach (var authorization in new[]
    {
      $"Bearer {fixture.Compatible}",
      fixture.Compatible,
    })
    {
      using var accepted = await SendUnfurl(client, AllowedOrigin, authorization);

      await AssertShellResponse(accepted);
      AssertAllowedCors(accepted);
    }

    foreach (var testCase in new[]
    {
      new AuthorizationCase(null, "missing pass\n"),
      new AuthorizationCase($"Bearer {fixture.Malformed}", "invalid pass\n"),
      new AuthorizationCase($"Bearer {fixture.Expired}", "invalid pass\n"),
      new AuthorizationCase($"Bearer {fixture.Tampered}", "invalid pass\n"),
      new AuthorizationCase(
          $"Bearer {fixture.NoncanonicalHeaderTicket}",
          "invalid pass\n"),
      new AuthorizationCase($"bearer {fixture.Compatible}", "invalid pass\n"),
    })
    {
      using var rejected = await SendUnfurl(
          client,
          AllowedOrigin,
          testCase.Authorization);

      Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
      Assert.Equal(
          "text/plain; charset=utf-8",
          rejected.Content.Headers.ContentType?.ToString());
      Assert.Equal(testCase.Body, await rejected.Content.ReadAsStringAsync());
      AssertAllowedCors(rejected);
    }
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  [InlineData("ticket")]
  public async Task AnswersAnonymousPreflightsAndRejectsOtherOrigins(string auth)
  {
    await using var app = await StartApplication(
        auth,
        rateLimit: 1,
        storageEnabled: true);
    using var client = app.GetTestClient();

    foreach (var route in new[]
    {
      new PreflightRoute("/unfurl", "GET, OPTIONS"),
      new PreflightRoute("/upload", "POST, OPTIONS"),
      new PreflightRoute("/upload-by-url", "POST, OPTIONS"),
    })
    {
      using var accepted = await SendPreflight(
          client,
          route.Path,
          AllowedOrigin,
          "authorization, x-tenant-id");

      Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
      Assert.Equal("", await accepted.Content.ReadAsStringAsync());
      Assert.Null(accepted.Content.Headers.ContentType);
      Assert.Equal(
          AllowedOrigin,
          Assert.Single(accepted.Headers.GetValues("Access-Control-Allow-Origin")));
      Assert.Equal(
          route.AllowedMethods,
          Assert.Single(accepted.Headers.GetValues("Access-Control-Allow-Methods")));
      Assert.Equal(
          "authorization, x-tenant-id",
          Assert.Single(accepted.Headers.GetValues("Access-Control-Allow-Headers")));
      Assert.Equal(
          "600",
          Assert.Single(accepted.Headers.GetValues("Access-Control-Max-Age")));
      Assert.Equal(
          new[] { "Access-Control-Request-Headers", "Origin" },
          accepted.Headers.Vary);
    }

    foreach (var origin in new[] { DisallowedOrigin, null })
    {
      using var rejected = await SendPreflight(
          client,
          "/unfurl",
          origin,
          requestedHeaders: null);

      Assert.Equal(HttpStatusCode.Forbidden, rejected.StatusCode);
      Assert.Equal(
          "text/plain; charset=utf-8",
          rejected.Content.Headers.ContentType?.ToString());
      Assert.Equal(
          "origin not allowed\n",
          await rejected.Content.ReadAsStringAsync());
      AssertNoCors(rejected);
    }
  }

  [Theory]
  [InlineData("/upload")]
  [InlineData("/upload-by-url")]
  public async Task RejectsReadOnlyTicketsOnWriteRoutes(string path)
  {
    var fixture = LoadFixture();
    var ticket = SignPayload(
        fixture.Secret,
        "{\"user\":\"reader\",\"doc\":\"doc-42\",\"write\":false,\"exp\":4102444800}");
    await using var app = await StartApplication(
        "ticket",
        rateLimit: 0,
        storageEnabled: true);
    using var client = app.GetTestClient();
    using var response = await SendWriteRequest(
        client,
        path,
        ticket);

    Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    Assert.Equal(
        "write access required\n",
        await response.Content.ReadAsStringAsync());
    AssertAllowedCors(response);
  }

  [Fact]
  public async Task AllowsReadOnlyTicketsToUnfurl()
  {
    var fixture = LoadFixture();
    var ticket = SignPayload(
        fixture.Secret,
        "{\"user\":\"reader\",\"doc\":\"doc-42\",\"write\":false,\"exp\":4102444800}");
    await using var app = await StartApplication(
        "ticket",
        rateLimit: 0);
    using var client = app.GetTestClient();
    using var response = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {ticket}");

    await AssertShellResponse(response);
  }

  [Fact]
  public async Task RejectedOriginsDoNotSpendTheRateLimit()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 1);
    using var client = app.GetTestClient();

    for (var index = 0; index < 3; index++)
    {
      using var rejected = await SendUnfurl(
          client,
          DisallowedOrigin,
          authorization: null);
      Assert.Equal(HttpStatusCode.Forbidden, rejected.StatusCode);
    }

    using (var accepted = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertShellResponse(accepted);
    }

    using var limited = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}");
    await AssertRateLimited(limited);
  }

  [Fact]
  public async Task RejectedTicketsDoNotSpendTheRateLimit()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 1);
    using var client = app.GetTestClient();

    for (var index = 0; index < 3; index++)
    {
      using var rejected = await SendUnfurl(
          client,
          AllowedOrigin,
          $"Bearer {fixture.Malformed}");
      Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
    }

    using (var accepted = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertShellResponse(accepted);
    }

    using var limited = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}");
    await AssertRateLimited(limited);
  }

  [Fact]
  public async Task PreflightsDoNotSpendTheRateLimit()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 1);
    using var client = app.GetTestClient();

    for (var index = 0; index < 3; index++)
    {
      using var preflight = await SendPreflight(
          client,
          "/unfurl",
          AllowedOrigin,
          "authorization");
      Assert.Equal(HttpStatusCode.NoContent, preflight.StatusCode);
    }

    using (var accepted = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertShellResponse(accepted);
    }

    using var limited = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}");
    await AssertRateLimited(limited);
  }

  [Fact]
  public async Task UsesIndependentTicketUserBuckets()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 1);
    using var client = app.GetTestClient();

    using (var firstUser = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertShellResponse(firstUser);
    }

    using (var limitedFirstUser = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertRateLimited(limitedFirstUser);
    }

    using var secondUser = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.UserTwo}");
    await AssertShellResponse(secondUser);
  }

  [Fact]
  public async Task DisablesAZeroRateLimit()
  {
    var fixture = LoadFixture();
    await using var app = await StartApplication("ticket", rateLimit: 0);
    using var client = app.GetTestClient();

    for (var index = 0; index < 3; index++)
    {
      using var accepted = await SendUnfurl(
          client,
          AllowedOrigin,
          $"Bearer {fixture.Compatible}");
      await AssertShellResponse(accepted);
    }
  }

  [Fact]
  public async Task ResetsAtSixtySecondsFromTheFirstAcceptedRequest()
  {
    var fixture = LoadFixture();
    var timeProvider = new ManualTimeProvider(FixedNow);
    await using var app = await StartApplication(
        "ticket",
        rateLimit: 1,
        timeProvider: timeProvider);
    using var client = app.GetTestClient();

    using (var accepted = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertShellResponse(accepted);
    }

    timeProvider.Advance(TimeSpan.FromSeconds(59));

    using (var stillLimited = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}"))
    {
      await AssertRateLimited(stillLimited);
    }

    timeProvider.Advance(TimeSpan.FromSeconds(1));

    using var reset = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {fixture.Compatible}");
    await AssertShellResponse(reset);
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  public async Task UsesClientAddressBucketsOutsideTicketMode(string auth)
  {
    await using var app = await StartApplication(auth, rateLimit: 1);
    using var client = app.GetTestClient();

    using (var first = await SendUnfurl(
        client,
        origin: null,
        authorization: null,
        remoteAddress: "192.0.2.1"))
    {
      await AssertShellResponse(first);
    }

    using (var limited = await SendUnfurl(
        client,
        origin: null,
        authorization: null,
        remoteAddress: "192.0.2.1"))
    {
      await AssertRateLimited(limited);
    }

    using var independent = await SendUnfurl(
        client,
        origin: null,
        authorization: null,
        remoteAddress: "192.0.2.2");
    await AssertShellResponse(independent);
  }

  [Fact]
  public async Task UsesClientAddressWhenATicketHasNoUser()
  {
    var fixture = LoadFixture();
    var ticket = SignPayload(
        fixture.Secret,
        "{\"user\":\"\",\"doc\":\"doc-42\",\"write\":true,\"exp\":4102444800}");
    await using var app = await StartApplication("ticket", rateLimit: 1);
    using var client = app.GetTestClient();

    using (var first = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {ticket}",
        "192.0.2.1"))
    {
      await AssertShellResponse(first);
    }

    using (var limited = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {ticket}",
        "192.0.2.1"))
    {
      await AssertRateLimited(limited);
    }

    using var independent = await SendUnfurl(
        client,
        AllowedOrigin,
        $"Bearer {ticket}",
        "192.0.2.2");
    await AssertShellResponse(independent);
  }

  private static async Task<WebApplication> StartApplication(
      string auth,
      long rateLimit,
      bool storageEnabled = false,
      TimeProvider? timeProvider = null)
  {
    var fixture = LoadFixture();
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      options.Auth = auth;
      options.Secret = auth == "ticket" ? fixture.Secret : "";
      options.AllowedOrigins = [AllowedOrigin];
      options.RateLimitPerMinute = rateLimit;
      options.StorageDirectory = storageEnabled ? "./blok-uploads" : "";
      options.PublicUrl = storageEnabled
        ? "http://127.0.0.1:4000/files"
        : "";
      options.UnfurlDisabled = false;
    });

    if (timeProvider is not null)
    {
      builder.Services.AddSingleton<TimeProvider>(timeProvider);
    }

    var app = builder.Build();
    app.Use(async (context, next) =>
    {
      if (context.Request.Headers.TryGetValue(
            RemoteAddressHeader,
            out var remoteAddress) &&
          IPAddress.TryParse(remoteAddress.ToString(), out var address))
      {
        context.Connection.RemoteIpAddress = address;
      }

      await next(context);
    });
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private static async Task<HttpResponseMessage> SendUnfurl(
      HttpClient client,
      string? origin,
      string? authorization,
      string? remoteAddress = null,
      string? secFetchSite = null)
  {
    using var request = new HttpRequestMessage(HttpMethod.Get, "/unfurl");

    if (origin is not null)
    {
      request.Headers.TryAddWithoutValidation("Origin", origin);
    }

    if (authorization is not null)
    {
      request.Headers.TryAddWithoutValidation("Authorization", authorization);
    }

    if (remoteAddress is not null)
    {
      request.Headers.TryAddWithoutValidation(RemoteAddressHeader, remoteAddress);
    }

    if (secFetchSite is not null)
    {
      request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", secFetchSite);
    }

    return await client.SendAsync(request);
  }

  private static async Task<HttpResponseMessage> SendWriteRequest(
      HttpClient client,
      string path,
      string ticket)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, path);
    request.Headers.TryAddWithoutValidation("Origin", AllowedOrigin);
    request.Headers.TryAddWithoutValidation(
        "Authorization",
        $"Bearer {ticket}");

    return await client.SendAsync(request);
  }

  private static async Task<HttpResponseMessage> SendPreflight(
      HttpClient client,
      string path,
      string? origin,
      string? requestedHeaders)
  {
    using var request = new HttpRequestMessage(HttpMethod.Options, path);

    if (origin is not null)
    {
      request.Headers.TryAddWithoutValidation("Origin", origin);
    }

    request.Headers.TryAddWithoutValidation(
        "Access-Control-Request-Method",
        path == "/unfurl" ? "GET" : "POST");

    if (requestedHeaders is not null)
    {
      request.Headers.TryAddWithoutValidation(
          "Access-Control-Request-Headers",
          requestedHeaders);
    }

    return await client.SendAsync(request);
  }

  private static async Task AssertShellResponse(HttpResponseMessage response)
  {
    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.ToString());
    Assert.Equal("{\"success\":0}\n", await response.Content.ReadAsStringAsync());
  }

  private static async Task AssertRateLimited(HttpResponseMessage response)
  {
    Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "rate limit exceeded\n",
        await response.Content.ReadAsStringAsync());
  }

  private static void AssertAllowedCors(HttpResponseMessage response)
  {
    Assert.Equal(
        AllowedOrigin,
        Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    Assert.Equal(new[] { "Origin" }, response.Headers.Vary);
  }

  private static void AssertNoCors(HttpResponseMessage response)
  {
    Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    Assert.Empty(response.Headers.Vary);
  }

  private static TicketFixture LoadFixture()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets.json");
    var fixture = JsonSerializer.Deserialize<TicketFixture>(File.ReadAllText(path));

    return Assert.IsType<TicketFixture>(fixture);
  }

  private static string SignPayload(string secret, string payload)
  {
    const string header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    var signingInput = $"{Base64Url(header)}.{Base64Url(payload)}";
    var signature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(secret),
        Encoding.UTF8.GetBytes(signingInput));

    return $"{signingInput}.{Base64Url(signature)}";
  }

  private static string Base64Url(string value)
  {
    return Base64Url(Encoding.UTF8.GetBytes(value));
  }

  private static string Base64Url(byte[] value)
  {
    return Convert.ToBase64String(value)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
  }

  private sealed record AuthorizationCase(string? Authorization, string Body);

  private sealed record PreflightRoute(string Path, string AllowedMethods);

  private sealed record TicketFixture(
      [property: JsonPropertyName("secret")] string Secret,
      [property: JsonPropertyName("compatible")] string Compatible,
      [property: JsonPropertyName("expired")] string Expired,
      [property: JsonPropertyName("malformed")] string Malformed,
      [property: JsonPropertyName("noncanonicalHeaderTicket")] string NoncanonicalHeaderTicket,
      [property: JsonPropertyName("tampered")] string Tampered,
      [property: JsonPropertyName("userTwo")] string UserTwo);

  private sealed class ManualTimeProvider(DateTimeOffset utcNow) : TimeProvider
  {
    private DateTimeOffset _utcNow = utcNow;

    public override DateTimeOffset GetUtcNow()
    {
      return _utcNow;
    }

    public void Advance(TimeSpan duration)
    {
      _utcNow += duration;
    }
  }
}
