using System.Net;
using System.Text;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class LocalFileServingTests : IDisposable
{
  private const string StoredKey = "0123456789abcdef0123456789abcdef.html";
  private readonly string directory =
      Path.Combine(Path.GetTempPath(), $"blok-local-files-{Guid.NewGuid():N}");

  [Fact]
  public async Task ServesDirectFilesAtTheConfiguredPublicUrlPathAsAttachments()
  {
    Directory.CreateDirectory(directory);
    var bytes = Encoding.UTF8.GetBytes("<h1>uploaded html</h1>");
    await File.WriteAllBytesAsync(
        Path.Combine(directory, StoredKey),
        bytes,
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/assets/files/";
    });
    app.MapBlokServer("/blok");
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var response = await client.GetAsync($"/assets/files/{StoredKey}");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.ToString());
    Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
    Assert.Equal(bytes, await response.Content.ReadAsByteArrayAsync());
  }

  [Fact]
  public async Task DoesNotSniffAnExtensionlessFileAsHtml()
  {
    const string extensionlessKey = "abcdef0123456789abcdef0123456789";
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, extensionlessKey),
        "<h1>uploaded html</h1>",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var response = await client.GetAsync($"/files/{extensionlessKey}");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.ToString());
    Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    Assert.Equal("application/octet-stream", response.Content.Headers.ContentType?.MediaType);
  }

  [Fact]
  public async Task RefusesDirectoryListingsAndNestedPaths()
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, StoredKey),
        "secret file",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();

    foreach (var path in new[]
    {
      "/files/",
      $"/files/sub/{StoredKey}",
    })
    {
      using var response = await client.GetAsync(path);

      Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
      Assert.Equal("404 page not found\n", await response.Content.ReadAsStringAsync());
      Assert.DoesNotContain(StoredKey, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }
  }

  [Theory]
  [InlineData("/files/%2e%2e%2foutside.txt")]
  [InlineData("/files/..%5coutside.txt")]
  [InlineData("/files/%2fetc%2fpasswd")]
  public async Task RefusesTraversalInsteadOfServingOutsideTheStorageDirectory(string path)
  {
    var storage = Path.Combine(directory, "storage");
    Directory.CreateDirectory(storage);
    await File.WriteAllTextAsync(
        Path.Combine(directory, "outside.txt"),
        "outside",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = storage;
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var response = await client.GetAsync(path);

    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    Assert.NotEqual("outside", await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task DoesNotMapFilesWhenLocalStorageIsDisabled()
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, StoredKey),
        "bystander",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = "";
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var response = await client.GetAsync($"/files/{StoredKey}");

    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
  }

  [Fact]
  public async Task DoesNotMapTheLocalDirectoryWhenS3TakesPrecedence()
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, StoredKey),
        "bystander",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
      options.S3Endpoint = "https://s3.example.com";
      options.S3Region = "eu-test-1";
      options.S3Bucket = "media";
      options.S3BucketUrl = "https://cdn.example.com/media";
      options.S3AccessKey = "access";
      options.S3SecretKey = "secret";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var response = await client.GetAsync($"/files/{StoredKey}");

    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
  }

  [Fact]
  public async Task DoesNotMapAHostOnlyPublicUrlOverApiRoutes()
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, StoredKey),
        "bystander",
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com";
    });
    app.MapBlokServer();
    await app.StartAsync();

    using var client = app.GetTestClient();
    using var file = await client.GetAsync($"/{StoredKey}");
    using var health = await client.GetAsync("/health");

    Assert.Equal(HttpStatusCode.NotFound, file.StatusCode);
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
  }

  [Fact]
  public void RegistersTheInternalLocalStoreForLaterUploadEndpoints()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
    });

    var descriptor = Assert.Single(
        services,
        service => service.ServiceType.FullName == "Blok.Server.Storage.IBlobStore");
    Assert.Equal(
        "Blok.Server.Storage.LocalBlobStore",
        descriptor.ImplementationInstance?.GetType().FullName);
    Assert.Equal(ServiceLifetime.Singleton, descriptor.Lifetime);
  }

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  private static WebApplication BuildApplication(Action<BlokServerOptions> configure)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(configure);

    return builder.Build();
  }
}
