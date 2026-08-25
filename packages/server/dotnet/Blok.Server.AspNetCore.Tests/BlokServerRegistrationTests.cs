using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Blok.Server.AspNetCore;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class BlokServerRegistrationTests
{
  [Fact]
  public async Task AddsTheEmbeddedRuntimeAndDenyByDefaultAuthorizationOnce()
  {
    var services = new ServiceCollection();

    services.AddBlokServer();
    services.AddBlokServer();

    var runtimeDescriptor = Assert.Single(
        services,
        descriptor => descriptor.ServiceType.FullName == "Blok.Server.Runtime.IBlokRuntime");
    Assert.Equal(ServiceLifetime.Singleton, runtimeDescriptor.Lifetime);
    Assert.NotNull(runtimeDescriptor.ImplementationFactory);
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IBlobStore));

    using var provider = services.BuildServiceProvider();
    var runtime = provider.GetService(runtimeDescriptor.ServiceType);
    Assert.NotNull(runtime);
    Assert.Equal("Blok.Server.Runtime.JintBlokRuntime", runtime.GetType().FullName);

    var authorization = provider.GetRequiredService<IBlokAuthorization>();
    var user = new ClaimsPrincipal();
    Assert.False(await authorization.CanReadDocumentAsync(user, "document-1"));
    Assert.False(await authorization.CanWriteDocumentAsync(user, "document-1"));
  }

  [Fact]
  public void RegistersOneGuardedOutboundFetcher()
  {
    var services = new ServiceCollection();

    services.AddBlokServer();
    services.AddBlokServer();

    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IGuardedOutboundPolicy));
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IGuardedOutboundFetcher));

    using var provider = services.BuildServiceProvider();

    Assert.IsType<GuardedOutboundFetcher>(
        provider.GetRequiredService<IGuardedOutboundFetcher>());
  }

  [Fact]
  public void ReplacesTheDefaultAuthorization()
  {
    var services = new ServiceCollection();

    services.AddBlokServer().UseAuthorization<AllowAllAuthorization>();

    var authorizationDescriptor = Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IBlokAuthorization));
    Assert.Equal(typeof(AllowAllAuthorization), authorizationDescriptor.ImplementationType);

    using var provider = services.BuildServiceProvider();
    Assert.IsType<AllowAllAuthorization>(provider.GetRequiredService<IBlokAuthorization>());
  }

  [Fact]
  public void RequiresAnExplicitValidPublicUrlForLocalStorage()
  {
    var services = new ServiceCollection();

    var missing = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
            options.StorageDirectory = "/local/storage"));
    Assert.Contains("PublicUrl", missing.Message, StringComparison.Ordinal);

    var malformed = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.StorageDirectory = "/local/storage";
          options.PublicUrl = "https://uploads.example/%zz";
        }));
    Assert.Contains("PublicUrl", malformed.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void RegistersTheSharedS3StoreWhenABucketIsConfigured()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.StorageDirectory = "/unused/local/storage";
      options.S3Endpoint = "https://s3.example.com";
      options.S3Region = "eu-central-1";
      options.S3Bucket = "media";
      options.S3BucketUrl = "https://cdn.example.com/media";
      options.S3Addressing = "path";
      options.S3AccessKey = "access-key";
      options.S3SecretKey = "secret-key";
    });

    using var provider = services.BuildServiceProvider();

    Assert.IsType<S3BlobStore>(
        provider.GetRequiredService<IBlobStore>());
  }

  [Fact]
  public void UsesTheRegisteredOptionsForBlobStoreSelection()
  {
    var services = new ServiceCollection();
    var registeredOptions = new BlokServerOptions
    {
      StorageDirectory = "/effective/local/storage",
      PublicUrl = "/effective-media",
    };
    services.AddSingleton(registeredOptions);

    services.AddBlokServer(options =>
    {
      options.StorageDirectory = "/unused/local/storage";
      options.S3Endpoint = "https://s3.example.com";
      options.S3Region = "eu-central-1";
      options.S3Bucket = "media";
      options.S3BucketUrl = "https://cdn.example.com/media";
      options.S3Addressing = "path";
      options.S3AccessKey = "access-key";
      options.S3SecretKey = "secret-key";
    });

    using var provider = services.BuildServiceProvider();

    Assert.Same(registeredOptions, provider.GetRequiredService<BlokServerOptions>());
    Assert.IsType<LocalBlobStore>(provider.GetRequiredService<IBlobStore>());
  }

  [Fact]
  public void HonorsAnExistingBlobStoreOverride()
  {
    var services = new ServiceCollection();
    var customStore = new LocalBlobStore(
        "/custom/local/storage",
        "https://uploads.example.com/files");
    services.AddSingleton<IBlobStore>(customStore);

    services.AddBlokServer();

    using var provider = services.BuildServiceProvider();

    Assert.Same(customStore, provider.GetRequiredService<IBlobStore>());
  }

  [Fact]
  public void HonorsAnExistingGuardedFetcherOverride()
  {
    var services = new ServiceCollection();
    var fetcher = new StubGuardedFetcher();
    services.AddSingleton<IGuardedOutboundFetcher>(fetcher);

    services.AddBlokServer();

    using var provider = services.BuildServiceProvider();

    Assert.Same(
        fetcher,
        provider.GetRequiredService<IGuardedOutboundFetcher>());
  }

  [Fact]
  public async Task MapsTheExactUngatedHealthWireWithoutCors()
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      options.Version = "dev";
      options.StorageDirectory = "";
      options.UnfurlDisabled = true;
    });
    await using var app = builder.Build();
    app.MapBlokServer("/blok");
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var request = new HttpRequestMessage(HttpMethod.Get, "/blok/health");
    request.Headers.Add("Origin", "https://app.example.com");
    using var response = await client.SendAsync(request);

    Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.ToString());
    Assert.Equal("{\"status\":\"ok\",\"version\":\"dev\"}\n", await response.Content.ReadAsStringAsync());
    Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    Assert.False(response.Headers.Contains("Vary"));
  }

  [Fact]
  public async Task ApplicationAuthorizationProtectsGuardedRoutesOnly()
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services
        .AddAuthentication("test")
        .AddScheme<AuthenticationSchemeOptions, HeaderAuthenticationHandler>(
            "test",
            _ => { });
    builder.Services.AddAuthorization();
    builder.Services.AddBlokServer(options =>
    {
      options.AllowedOrigins = ["https://app.example.test"];
      options.UnfurlDisabled = false;
    });
    await using var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapBlokServer("/blok").RequireAuthorization();
    await app.StartAsync();
    using var client = app.GetTestClient();

    using var anonymous = await client.GetAsync("/blok/unfurl");
    Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

    using var authenticatedRequest = new HttpRequestMessage(
        HttpMethod.Get,
        "/blok/unfurl");
    authenticatedRequest.Headers.Add("X-Test-User", "signed-in");
    using var authenticated = await client.SendAsync(authenticatedRequest);
    Assert.Equal(HttpStatusCode.BadRequest, authenticated.StatusCode);
    Assert.Equal(
        "{\"success\":0}\n",
        await authenticated.Content.ReadAsStringAsync());

    using var health = await client.GetAsync("/blok/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);

    using var preflightRequest = new HttpRequestMessage(
        HttpMethod.Options,
        "/blok/unfurl");
    preflightRequest.Headers.Add("Origin", "https://app.example.test");
    preflightRequest.Headers.Add("Access-Control-Request-Method", "GET");
    using var preflight = await client.SendAsync(preflightRequest);
    Assert.Equal(HttpStatusCode.NoContent, preflight.StatusCode);
  }

  [Fact]
  public async Task BareDefaultsMapOnlySafeRoutes()
  {
    await using var app = BuildApplication(
        _ => { },
        enableGuardedRoutes: false);
    app.MapBlokServer("/blok");

    Assert.Equal(new[] { "GET", "HEAD" }, GetMethods(app, "/blok/health"));
    Assert.Empty(GetMethods(app, "/blok/unfurl"));
    Assert.Empty(GetMethods(app, "/blok/upload"));
    Assert.Empty(GetMethods(app, "/blok/upload-by-url"));
  }

  [Fact]
  public async Task RegistersOnlyRoutesWhoseDependenciesAreEnabled()
  {
    await using var enabled = BuildApplication(_ => { });
    enabled.MapBlokServer("/blok");

    Assert.Equal(new[] { "GET", "HEAD" }, GetMethods(enabled, "/blok/health"));
    Assert.Equal(new[] { "GET", "OPTIONS" }, GetMethods(enabled, "/blok/unfurl"));
    Assert.Equal(new[] { "OPTIONS", "POST" }, GetMethods(enabled, "/blok/upload"));
    Assert.Equal(new[] { "OPTIONS", "POST" }, GetMethods(enabled, "/blok/upload-by-url"));

    await using var noStorage = BuildApplication(options => options.StorageDirectory = "");
    noStorage.MapBlokServer("/blok");

    Assert.Equal(new[] { "GET", "OPTIONS" }, GetMethods(noStorage, "/blok/unfurl"));
    Assert.Empty(GetMethods(noStorage, "/blok/upload"));
    Assert.Empty(GetMethods(noStorage, "/blok/upload-by-url"));

    await using var noUnfurl = BuildApplication(options => options.UnfurlDisabled = true);
    noUnfurl.MapBlokServer("/blok");

    Assert.Empty(GetMethods(noUnfurl, "/blok/unfurl"));
    Assert.Equal(new[] { "OPTIONS", "POST" }, GetMethods(noUnfurl, "/blok/upload"));
    Assert.Empty(GetMethods(noUnfurl, "/blok/upload-by-url"));
  }

  [Fact]
  public async Task ActiveRoutesUseTheExactMethodNotAllowedWire()
  {
    await using var app = BuildApplication(_ => { });
    app.MapBlokServer();
    await app.StartAsync();
    using var client = app.GetTestClient();

    var cases = new[]
    {
      (Method: HttpMethod.Post, Path: "/unfurl", Allow: "GET, HEAD, OPTIONS"),
      (Method: HttpMethod.Get, Path: "/upload", Allow: "OPTIONS, POST"),
      (Method: HttpMethod.Get, Path: "/upload-by-url", Allow: "OPTIONS, POST"),
    };

    foreach (var testCase in cases)
    {
      using var request = new HttpRequestMessage(testCase.Method, testCase.Path);
      using var response = await client.SendAsync(request);

      Assert.Equal(System.Net.HttpStatusCode.MethodNotAllowed, response.StatusCode);
      Assert.Equal(testCase.Allow, string.Join(", ", response.Content.Headers.Allow));
      Assert.Equal("text/plain; charset=utf-8", response.Content.Headers.ContentType?.ToString());
      Assert.Equal("Method Not Allowed\n", await response.Content.ReadAsStringAsync());
    }
  }

  [Fact]
  public async Task ActiveRoutesKeepTheirRejectedPreflightWire()
  {
    await using var app = BuildApplication(_ => { });
    app.MapBlokServer();
    await app.StartAsync();
    using var client = app.GetTestClient();

    foreach (var path in new[] { "/unfurl", "/upload", "/upload-by-url" })
    {
      using var request = new HttpRequestMessage(HttpMethod.Options, path);
      using var response = await client.SendAsync(request);

      Assert.Equal(System.Net.HttpStatusCode.Forbidden, response.StatusCode);
      Assert.Equal("text/plain; charset=utf-8", response.Content.Headers.ContentType?.ToString());
      Assert.Equal("origin not allowed\n", await response.Content.ReadAsStringAsync());
    }
  }

  [Fact]
  public async Task PreservesTheGoMethodAndUnknownRouteResponses()
  {
    var app = BuildApplication(options =>
    {
      options.StorageDirectory = "";
      options.UnfurlDisabled = true;
    });
    await using (app)
    {
      app.MapBlokServer();
      await app.StartAsync();
      using var client = app.GetTestClient();

      using var wrongMethod = await client.PostAsync("/health", content: null);
      Assert.Equal(System.Net.HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
      Assert.Equal("GET, HEAD", string.Join(", ", wrongMethod.Content.Headers.Allow));
      Assert.Equal("text/plain; charset=utf-8", wrongMethod.Content.Headers.ContentType?.ToString());
      Assert.Equal("Method Not Allowed\n", await wrongMethod.Content.ReadAsStringAsync());

      foreach (var path in new[] { "/missing", "/upload" })
      {
        using var unknownRoute = await client.GetAsync(path);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, unknownRoute.StatusCode);
        Assert.Equal("text/plain; charset=utf-8", unknownRoute.Content.Headers.ContentType?.ToString());
        Assert.Equal("404 page not found\n", await unknownRoute.Content.ReadAsStringAsync());
      }
    }
  }

  private static WebApplication BuildApplication(
      Action<BlokServerOptions> configure,
      bool enableGuardedRoutes = true)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      if (enableGuardedRoutes)
      {
        options.StorageDirectory = "./blok-uploads";
        options.PublicUrl = "http://127.0.0.1:4000/files";
        options.UnfurlDisabled = false;
      }

      configure(options);
    });

    return builder.Build();
  }

  private static string[] GetMethods(WebApplication app, string pattern)
  {
    return ((IEndpointRouteBuilder)app).DataSources
        .SelectMany(dataSource => dataSource.Endpoints)
        .OfType<RouteEndpoint>()
        .Where(endpoint => endpoint.RoutePattern.RawText == pattern)
        .SelectMany(endpoint => endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
        .Order()
        .ToArray();
  }

  private sealed class HeaderAuthenticationHandler(
      IOptionsMonitor<AuthenticationSchemeOptions> options,
      ILoggerFactory logger,
      UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(
          options,
          logger,
          encoder)
  {
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
      if (!Request.Headers.ContainsKey("X-Test-User"))
      {
        return Task.FromResult(AuthenticateResult.NoResult());
      }

      var identity = new ClaimsIdentity(
          [new Claim(ClaimTypes.NameIdentifier, "signed-in")],
          Scheme.Name);
      var principal = new ClaimsPrincipal(identity);
      var ticket = new AuthenticationTicket(principal, Scheme.Name);

      return Task.FromResult(AuthenticateResult.Success(ticket));
    }
  }

  private sealed class StubGuardedFetcher : IGuardedOutboundFetcher
  {
    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits limits,
        CancellationToken cancellationToken)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class AllowAllAuthorization : IBlokAuthorization
  {
    public ValueTask<bool> CanReadDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }

    public ValueTask<bool> CanWriteDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }
  }
}
