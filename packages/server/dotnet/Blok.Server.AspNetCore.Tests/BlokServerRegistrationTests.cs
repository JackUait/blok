using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Blok.Server.AspNetCore;
using Blok.Server.Collab;
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
  private static readonly string[] HealthMethods = ["GET", "HEAD"];
  private static readonly string[] ReadMethods = ["GET", "OPTIONS"];
  private static readonly string[] WriteMethods = ["OPTIONS", "POST"];

  [Fact]
  public void DoesNotRegisterUnusedFutureServices()
  {
    var services = new ServiceCollection();

    services.AddBlokServer();
    services.AddBlokServer();

    // The runtime is no longer a future service: IBlokDocumentConverter runs it.
    // What still has to hold is that a second AddBlokServer does not register a
    // second engine pool — each one parses the embedded bundle into every
    // engine it holds.
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType.FullName == "Blok.Server.Runtime.IBlokRuntime");
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType.FullName == "Blok.Server.Documents.IBlokDocumentConverter");
    Assert.DoesNotContain(
        services,
        descriptor =>
            descriptor.ServiceType.FullName == "Blok.Server.AspNetCore.IBlokAuthorization");
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IBlobStore));
  }

  [Fact]
  public void RegistersCollabServiceFactoriesOnce()
  {
    var services = new ServiceCollection();

    services.AddBlokServer();
    services.AddBlokServer();

    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(ICollabWorkingSetStore));
    Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(ICollabRoomManager));
  }

  [Fact]
  public void CollabServicesThrowWhenCollaborationIsDisabled()
  {
    var services = new ServiceCollection();
    services.AddBlokServer();
    using var provider = services.BuildServiceProvider();

    var store = Assert.Throws<InvalidOperationException>(() =>
        provider.GetRequiredService<ICollabWorkingSetStore>());
    Assert.Equal("Collaboration is disabled.", store.Message);

    var rooms = Assert.Throws<InvalidOperationException>(() =>
        provider.GetRequiredService<ICollabRoomManager>());
    Assert.Equal("Collaboration is disabled.", rooms.Message);
  }

  [Fact]
  public void RejectsCollabWithoutADocEndpoint()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options => options.CollabEnabled = true));

    Assert.Contains(
        "--collab needs --doc-endpoint",
        error.Message,
        StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsADocEndpointWithoutCollab()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
            options.DocEndpoint = "https://app.example.com/api/blok-docs"));

    Assert.Contains(
        "--doc-endpoint needs --collab",
        error.Message,
        StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("app.example.com/api/blok-docs")]
  [InlineData("/api/blok-docs")]
  [InlineData("ftp://app.example.com/api/blok-docs")]
  [InlineData("https://user@app.example.com/api/blok-docs")]
  [InlineData("https://app.example.com/api/blok-docs?mode=test")]
  [InlineData("https://app.example.com/api/blok-docs#fragment")]
  public void RejectsUnsafeDocEndpoints(string docEndpoint)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.CollabEnabled = true;
          options.DocEndpoint = docEndpoint;
        }));

    Assert.Contains("--doc-endpoint", error.Message, StringComparison.Ordinal);
    Assert.Contains("credentials", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsNonLoopbackHttpDocEndpoints()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.CollabEnabled = true;
          options.DocEndpoint = "http://app.example.com/api/blok-docs";
        }));

    Assert.Contains("--doc-endpoint", error.Message, StringComparison.Ordinal);
    Assert.Contains("HTTPS", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("https://app.example.com/api/blok-docs")]
  [InlineData("https://app.example.com")]
  [InlineData("http://127.0.0.1:5100/api/blok-docs")]
  [InlineData("http://localhost:5100/api/blok-docs")]
  public void AllowsFullDocEndpoints(string docEndpoint)
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = docEndpoint;
    });
  }

  [Theory]
  [InlineData("/srv/blok/uploads")]
  [InlineData("/srv/blok/uploads/")]
  [InlineData("/srv/blok/uploads/working-set")]
  [InlineData("/srv/blok/collab/../uploads/working-set")]
  public void RejectsCollabDirectoriesInsideTheStorageDirectory(string collabDirectory)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.CollabEnabled = true;
          options.DocEndpoint = "https://app.example.com/api/blok-docs";
          options.StorageDirectory = "/srv/blok/uploads";
          options.PublicUrl = "/files";
          options.CollabDirectory = collabDirectory;
        }));

    Assert.Contains("--collab-dir", error.Message, StringComparison.Ordinal);
    Assert.Contains("--storage-dir", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsACollabDirectoryEqualToATrailingSlashStorageDirectory()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.CollabEnabled = true;
          options.DocEndpoint = "https://app.example.com/api/blok-docs";
          options.StorageDirectory = "/srv/blok/uploads/";
          options.PublicUrl = "/files";
          options.CollabDirectory = "/srv/blok/uploads";
        }));

    Assert.Contains("--collab-dir", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsACollabDirectoryBesideTheStorageDirectory()
  {
    var services = new ServiceCollection();

    // Shares the storage path as a raw string prefix; only a
    // separator-aware check keeps this sibling directory legal.
    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.StorageDirectory = "/srv/blok/uploads";
      options.PublicUrl = "/files";
      options.CollabDirectory = "/srv/blok/uploads-collab";
    });
  }

  [Fact]
  public void RegistersTheLocalCollabStoreWhenACollabDirectoryIsConfigured()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.CollabDirectory = "/srv/blok/collab";
    });

    using var provider = services.BuildServiceProvider();

    Assert.IsType<LocalCollabStore>(
        provider.GetRequiredService<ICollabWorkingSetStore>());
  }

  [Fact]
  public void RegistersTheS3CollabStoreWhenAPrefixIsConfigured()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.CollabS3Prefix = "collab/";
      options.S3Endpoint = "https://s3.example.com";
      options.S3Region = "eu-central-1";
      options.S3Bucket = "media";
      options.S3BucketUrl = "https://cdn.example.com/media";
      options.S3AccessKey = "access-key";
      options.S3SecretKey = "secret-key";
    });

    using var provider = services.BuildServiceProvider();

    Assert.IsType<S3CollabStore>(
        provider.GetRequiredService<ICollabWorkingSetStore>());
  }

  [Fact]
  public void RejectsACollabS3PrefixWithoutCollab()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
            options.CollabS3Prefix = "collab/"));

    Assert.Contains(
        "--collab-s3-prefix needs --collab",
        error.Message,
        StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsACollabS3PrefixWithoutAnS3Bucket()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.CollabEnabled = true;
          options.DocEndpoint = "https://app.example.com/api/blok-docs";
          options.CollabS3Prefix = "collab/";
        }));

    Assert.Contains(
        "--collab-s3-prefix needs --s3-bucket",
        error.Message,
        StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsACollabS3PrefixWithTheFullS3Battery()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.CollabS3Prefix = "collab/";
      options.S3Endpoint = "https://s3.example.com";
      options.S3Region = "eu-central-1";
      options.S3Bucket = "media";
      options.S3BucketUrl = "https://cdn.example.com/media";
      options.S3AccessKey = "access-key";
      options.S3SecretKey = "secret-key";
    });
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
  public void RegistersCustomAuthorizationForCompatibility()
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

  [Theory]
  [InlineData("javascript:alert(1)")]
  [InlineData("data:text/plain,payload")]
  [InlineData("//evil.example/files")]
  [InlineData("/\\evil.example/files")]
  [InlineData("/files\\nested")]
  [InlineData("https://user@uploads.example.com/files")]
  [InlineData("files")]
  public void RejectsUnsafeLocalPublicUrls(string publicUrl)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.StorageDirectory = "/local/storage";
          options.PublicUrl = publicUrl;
        }));

    Assert.Contains("PublicUrl", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("javascript:alert(1)")]
  [InlineData("data:text/plain,payload")]
  [InlineData("ftp://cdn.example.com/media")]
  [InlineData("//evil.example/media")]
  [InlineData("/media")]
  [InlineData("https://user@cdn.example.com/media")]
  [InlineData("https://cdn.example.com/%zz")]
  public void RejectsUnsafeS3BucketUrls(string bucketUrl)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.S3Endpoint = "https://s3.example.com";
          options.S3Region = "eu-central-1";
          options.S3Bucket = "media";
          options.S3BucketUrl = bucketUrl;
          options.S3AccessKey = "access-key";
          options.S3SecretKey = "secret-key";
        }));

    Assert.Contains("--s3-bucket-url", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("https://user@s3.example.com")]
  [InlineData("https://s3.example.com/path")]
  [InlineData("https://s3.example.com?mode=test")]
  [InlineData("https://s3.example.com#fragment")]
  public void RejectsUnsafeS3Endpoints(string endpoint)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.S3Endpoint = endpoint;
          options.S3Region = "eu-central-1";
          options.S3Bucket = "media";
          options.S3BucketUrl = "https://cdn.example.com/media";
          options.S3AccessKey = "access-key";
          options.S3SecretKey = "secret-key";
        }));

    Assert.Contains("--s3-endpoint", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsNonLoopbackHttpS3Endpoints()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.S3Endpoint = "http://s3.example.com";
          options.S3Region = "eu-central-1";
          options.S3Bucket = "media";
          options.S3BucketUrl = "https://cdn.example.com/media";
          options.S3AccessKey = "access-key";
          options.S3SecretKey = "secret-key";
        }));

    Assert.Contains("--s3-endpoint", error.Message, StringComparison.Ordinal);
    Assert.Contains("HTTPS", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsLoopbackHttpS3Endpoints()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.S3Endpoint = "http://127.0.0.1:9000";
      options.S3Region = "local";
      options.S3Bucket = "media";
      options.S3BucketUrl = "http://127.0.0.1:9000/media";
      options.S3AccessKey = "access-key";
      options.S3SecretKey = "secret-key";
    });
  }

  [Fact]
  public void RejectsUploadLimitsLargerThanManagedArraysWhenRemoteUploadsAreEnabled()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.MaxUploadBytes = (long)Array.MaxLength + 1;
          options.PublicUrl = "/files";
          options.StorageDirectory = "/local/storage";
          options.UnfurlDisabled = false;
        }));

    Assert.Contains("--max-upload", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsUploadLimitsLargerThanManagedArraysWhenRemoteUploadsAreDisabled()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.MaxUploadBytes = (long)Array.MaxLength + 1;
      options.PublicUrl = "/files";
      options.StorageDirectory = "/local/storage";
      options.UnfurlDisabled = true;
    });
  }

  [Fact]
  public void AllowsUploadLimitsLargerThanManagedArraysWithoutStorage()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.MaxUploadBytes = (long)Array.MaxLength + 1;
      options.UnfurlDisabled = false;
    });
  }

  [Fact]
  public void RejectsNegativeRateLimits()
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
            options.RateLimitPerMinute = -1));

    Assert.Contains("--rate-limit", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("internal.example:4000")]
  [InlineData("example.test:0")]
  public void RejectsDnsListenHostsThatKestrelWouldTreatAsWildcards(
      string listenAddress)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.AllowedOrigins = ["https://app.example.com"];
          options.Auth = "ticket";
          options.ListenAddress = listenAddress;
          options.Secret = new string('s', 32);
        }));

    Assert.Contains("DNS host", error.Message, StringComparison.Ordinal);
    Assert.Contains("every network interface", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("https://uploads.example.com/files?download=1")]
  [InlineData("/files#latest")]
  public void RejectsQueryOrFragmentInLocalPublicUrls(string publicUrl)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.StorageDirectory = "/local/storage";
          options.PublicUrl = publicUrl;
        }));

    Assert.Contains("PublicUrl", error.Message, StringComparison.Ordinal);
    Assert.Contains("query or fragment", error.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("https://cdn.example.com/media?download=1")]
  [InlineData("https://cdn.example.com/media#latest")]
  public void RejectsQueryOrFragmentInS3BucketUrls(string bucketUrl)
  {
    var services = new ServiceCollection();

    var error = Assert.Throws<InvalidOperationException>(() =>
        services.AddBlokServer(options =>
        {
          options.S3Endpoint = "https://s3.example.com";
          options.S3Region = "eu-central-1";
          options.S3Bucket = "media";
          options.S3BucketUrl = bucketUrl;
          options.S3AccessKey = "access-key";
          options.S3SecretKey = "secret-key";
        }));

    Assert.Contains("--s3-bucket-url", error.Message, StringComparison.Ordinal);
    Assert.Contains("query or fragment", error.Message, StringComparison.Ordinal);
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
  public async Task ValidatesPreRegisteredOptionsBeforeMappingRoutes()
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(new BlokServerOptions
    {
      RateLimitPerMinute = -1,
    });
    builder.Services.AddBlokServer();
    await using var app = builder.Build();

    var error = Assert.Throws<InvalidOperationException>(() =>
        app.MapBlokServer());

    Assert.Contains("--rate-limit", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void ValidatesPreRegisteredOptionsBeforeResolvingStorage()
  {
    var services = new ServiceCollection();
    services.AddSingleton(new BlokServerOptions
    {
      MaxUploadBytes = (long)Array.MaxLength + 1,
      PublicUrl = "/files",
      StorageDirectory = "/effective/local/storage",
      UnfurlDisabled = false,
    });
    services.AddBlokServer();
    using var provider = services.BuildServiceProvider();

    var error = Assert.Throws<InvalidOperationException>(() =>
        provider.GetRequiredService<IBlobStore>());

    Assert.Contains("--max-upload", error.Message, StringComparison.Ordinal);
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

    Assert.Equal(HealthMethods, GetMethods(app, "/blok/health"));
    Assert.Empty(GetMethods(app, "/blok/unfurl"));
    Assert.Empty(GetMethods(app, "/blok/upload"));
    Assert.Empty(GetMethods(app, "/blok/upload-by-url"));
  }

  [Fact]
  public async Task RegistersOnlyRoutesWhoseDependenciesAreEnabled()
  {
    await using var enabled = BuildApplication(_ => { });
    enabled.MapBlokServer("/blok");

    Assert.Equal(HealthMethods, GetMethods(enabled, "/blok/health"));
    Assert.Equal(ReadMethods, GetMethods(enabled, "/blok/unfurl"));
    Assert.Equal(WriteMethods, GetMethods(enabled, "/blok/upload"));
    Assert.Equal(WriteMethods, GetMethods(enabled, "/blok/upload-by-url"));

    await using var noStorage = BuildApplication(options => options.StorageDirectory = "");
    noStorage.MapBlokServer("/blok");

    Assert.Equal(ReadMethods, GetMethods(noStorage, "/blok/unfurl"));
    Assert.Empty(GetMethods(noStorage, "/blok/upload"));
    Assert.Empty(GetMethods(noStorage, "/blok/upload-by-url"));

    await using var noUnfurl = BuildApplication(options => options.UnfurlDisabled = true);
    noUnfurl.MapBlokServer("/blok");

    Assert.Empty(GetMethods(noUnfurl, "/blok/unfurl"));
    Assert.Equal(WriteMethods, GetMethods(noUnfurl, "/blok/upload"));
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
