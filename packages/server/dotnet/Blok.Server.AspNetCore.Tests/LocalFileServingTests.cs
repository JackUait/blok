using System.Globalization;
using System.Net;
using System.Text;
using Blok.Server.AspNetCore;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class LocalFileServingTests : IDisposable
{
  private const string StoredKey = "0123456789abcdef0123456789abcdef.html";
  private const string RangeKey = "0123456789abcdef0123456789abcdef.png";
  private readonly string directory =
      Path.Combine(Path.GetTempPath(), $"blok-local-files-{Guid.NewGuid():N}");

  [Theory]
  [InlineData("GET", "2345")]
  [InlineData("HEAD", "")]
  public async Task ServesSingleByteRangesForGetAndHead(string method, string expectedBody)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, method, "bytes=2-5");

    Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
    Assert.Equal("bytes 2-5/10", response.Content.Headers.ContentRange?.ToString());
    Assert.Equal(4L, response.Content.Headers.ContentLength);
    Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.ToString());
    Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
    Assert.Equal(expectedBody, await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData("GET")]
  [InlineData("HEAD")]
  public async Task ServesMultipleByteRangesForGetAndHead(string method)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, method, "bytes=0-1,4-6");

    Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
    var contentType = response.Content.Headers.ContentType;
    Assert.NotNull(contentType);
    Assert.Equal("multipart/byteranges", contentType.MediaType);
    var boundaryParameter = Assert.Single(
        contentType.Parameters,
        parameter => string.Equals(
            parameter.Name,
            "boundary",
            StringComparison.OrdinalIgnoreCase));
    Assert.NotNull(boundaryParameter.Value);
    var boundary = boundaryParameter.Value.Trim('"');
    var expectedBody =
        $"--{boundary}\r\n" +
        "Content-Range: bytes 0-1/10\r\n" +
        "Content-Type: image/png\r\n" +
        "\r\n" +
        "01\r\n" +
        $"--{boundary}\r\n" +
        "Content-Range: bytes 4-6/10\r\n" +
        "Content-Type: image/png\r\n" +
        "\r\n" +
        "456\r\n" +
        $"--{boundary}--\r\n";

    Assert.Equal(
        Encoding.ASCII.GetByteCount(expectedBody),
        response.Content.Headers.ContentLength);
    Assert.Equal(
        string.Equals(method, "HEAD", StringComparison.Ordinal) ? "" : expectedBody,
        await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData("GET", "invalid range: failed to overlap\n")]
  [InlineData("HEAD", "")]
  public async Task RejectsUnsatisfiableByteRangesForGetAndHead(
      string method,
      string expectedBody)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, method, "bytes=10-");

    Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, response.StatusCode);
    Assert.Equal("bytes */10", response.Content.Headers.ContentRange?.ToString());
    Assert.Equal(33L, response.Content.Headers.ContentLength);
    Assert.Equal("text/plain; charset=utf-8", response.Content.Headers.ContentType?.ToString());
    Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.ToString());
    Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    Assert.Empty(response.Headers.AcceptRanges);
    Assert.Null(response.Content.Headers.LastModified);
    Assert.Equal(expectedBody, await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData("GET", "invalid range: failed to overlap\n")]
  [InlineData("HEAD", "")]
  public async Task RejectsAZeroLengthSuffixRangeForANonemptyFile(
      string method,
      string expectedBody)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, method, "bytes=-0");

    Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, response.StatusCode);
    Assert.Equal("bytes */10", response.Content.Headers.ContentRange?.ToString());
    Assert.Equal(33L, response.Content.Headers.ContentLength);
    Assert.Equal(expectedBody, await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData("GET")]
  [InlineData("HEAD")]
  public async Task IgnoresAZeroLengthSuffixRangeForAnEmptyFile(string method)
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllBytesAsync(
        Path.Combine(directory, RangeKey),
        [],
        CancellationToken.None);
    await using var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, method, "bytes=-0");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Null(response.Content.Headers.ContentRange);
    Assert.Equal(0L, response.Content.Headers.ContentLength);
    Assert.Equal("", await response.Content.ReadAsStringAsync());
  }

  [Theory]
  [InlineData("GET", "0123456789")]
  [InlineData("HEAD", "")]
  public async Task HonorsDateRepresentationPreconditions(
      string method,
      string successfulBody)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var complete = await client.GetAsync($"/files/{RangeKey}");
    var lastModified = Assert.IsType<DateTimeOffset>(
        complete.Content.Headers.LastModified);

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.IfModifiedSince = lastModified;
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.NotModified, response.StatusCode);
      Assert.Null(response.Content.Headers.ContentType);
      Assert.Equal(lastModified, response.Content.Headers.LastModified);
      Assert.Equal("", await response.Content.ReadAsStringAsync());
    }

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.IfModifiedSince = lastModified.AddDays(-1);
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Equal(successfulBody, await response.Content.ReadAsStringAsync());
    }

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.IfUnmodifiedSince = lastModified.AddDays(-1);
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.PreconditionFailed, response.StatusCode);
      Assert.Null(response.Content.Headers.ContentType);
      Assert.Equal("", await response.Content.ReadAsStringAsync());
    }

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.IfUnmodifiedSince = lastModified;
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Equal(successfulBody, await response.Content.ReadAsStringAsync());
    }
  }

  [Theory]
  [InlineData("GET", "0123456789")]
  [InlineData("HEAD", "")]
  public async Task HonorsWildcardAndMismatchedEntityTagPreconditions(
      string method,
      string successfulBody)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.TryAddWithoutValidation("If-Match", "\"stale\"");
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.PreconditionFailed, response.StatusCode);
      Assert.Equal("", await response.Content.ReadAsStringAsync());
    }

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.TryAddWithoutValidation("If-Match", "*");
      request.Headers.IfUnmodifiedSince = DateTimeOffset.UnixEpoch;
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Equal(successfulBody, await response.Content.ReadAsStringAsync());
    }

    using (var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}"))
    {
      request.Headers.TryAddWithoutValidation("If-None-Match", "*");
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.NotModified, response.StatusCode);
      Assert.Equal("", await response.Content.ReadAsStringAsync());
    }

    using (var complete = await client.GetAsync($"/files/{RangeKey}"))
    {
      var lastModified = Assert.IsType<DateTimeOffset>(
          complete.Content.Headers.LastModified);
      using var request = new HttpRequestMessage(
          new HttpMethod(method),
          $"/files/{RangeKey}");
      request.Headers.TryAddWithoutValidation(
          "If-None-Match",
          "\"stale\"");
      request.Headers.IfModifiedSince = lastModified;
      using var response = await client.SendAsync(request);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Equal(successfulBody, await response.Content.ReadAsStringAsync());
    }
  }

  [Theory]
  [InlineData("GET")]
  [InlineData("HEAD")]
  public async Task AppliesRepresentationPreconditionsBeforeRange(string method)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();

    foreach (var header in new[] { "If-Match", "If-None-Match" })
    {
      using var request = new HttpRequestMessage(
          new HttpMethod(method),
          $"/files/{RangeKey}");
      request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(2, 5);
      request.Headers.TryAddWithoutValidation(
          header,
          header == "If-Match" ? "\"stale\"" : "*");
      using var response = await client.SendAsync(request);

      Assert.Equal(
          header == "If-Match"
            ? HttpStatusCode.PreconditionFailed
            : HttpStatusCode.NotModified,
          response.StatusCode);
      Assert.Null(response.Content.Headers.ContentRange);
      Assert.Equal("", await response.Content.ReadAsStringAsync());
    }
  }

  [Fact]
  public async Task HonorsOnlyMatchingDateIfRangeValidators()
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var complete = await client.GetAsync($"/files/{RangeKey}");
    var lastModified = complete.Content.Headers.LastModified;
    Assert.NotNull(lastModified);

    using var matching = await SendRangeAsync(
        client,
        "GET",
        "bytes=2-5",
        lastModified.Value.ToString("R"));

    Assert.Equal(HttpStatusCode.PartialContent, matching.StatusCode);
    Assert.Equal("2345", await matching.Content.ReadAsStringAsync());

    foreach (var ifRange in new[]
    {
      lastModified.Value.AddDays(-1).ToString("R"),
      "\"stale\"",
    })
    {
      using var ignored = await SendRangeAsync(client, "GET", "bytes=2-5", ifRange);

      Assert.Equal(HttpStatusCode.OK, ignored.StatusCode);
      Assert.Null(ignored.Content.Headers.ContentRange);
      Assert.Equal(10L, ignored.Content.Headers.ContentLength);
      Assert.Equal("0123456789", await ignored.Content.ReadAsStringAsync());
    }
  }

  [Theory]
  [InlineData("rfc850")]
  [InlineData("ansi-c")]
  public async Task HonorsMatchingAlternateHttpDateIfRangeValidator(string format)
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var complete = await client.GetAsync($"/files/{RangeKey}");
    var lastModified = complete.Content.Headers.LastModified;
    Assert.NotNull(lastModified);
    var ifRange = format switch
    {
      "rfc850" => lastModified.Value.ToString(
          "dddd, dd-MMM-yy HH:mm:ss 'GMT'",
          CultureInfo.InvariantCulture),
      _ => string.Format(
          CultureInfo.InvariantCulture,
          "{0:ddd MMM} {1,2} {0:HH:mm:ss yyyy}",
          lastModified.Value,
          lastModified.Value.Day),
    };

    var context = await app.GetTestServer().SendAsync(request =>
    {
      request.Request.Method = "HEAD";
      request.Request.Path = $"/files/{RangeKey}";
      request.Request.Headers.Range = "bytes=2-5";
      request.Request.Headers.IfRange = ifRange;
    }, CancellationToken.None);

    Assert.Equal(StatusCodes.Status206PartialContent, context.Response.StatusCode);
    Assert.Equal("bytes 2-5/10", context.Response.Headers.ContentRange.ToString());
  }

  [Fact]
  public async Task DiscardsUnsatisfiableMembersWhenAByteRangeStillOverlaps()
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, "GET", "bytes=99-,2-5");

    Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
    Assert.Equal("bytes 2-5/10", response.Content.Headers.ContentRange?.ToString());
    Assert.Equal(4L, response.Content.Headers.ContentLength);
    Assert.Equal("2345", await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task IgnoresByteRangesWhoseCombinedLengthExceedsTheFile()
  {
    await using var app = await StartRangeApplicationAsync();
    using var client = app.GetTestClient();
    using var response = await SendRangeAsync(client, "GET", "bytes=0-9,0-0");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Null(response.Content.Headers.ContentRange);
    Assert.Equal(10L, response.Content.Headers.ContentLength);
    Assert.Equal("0123456789", await response.Content.ReadAsStringAsync());
  }

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
      options.PublicUrl = "https://uploads.example.com/%zz";
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
      options.PublicUrl = "https://uploads.example.com/%zz";
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
        service => service.ServiceType == typeof(IBlobStore));
    Assert.NotNull(descriptor.ImplementationFactory);
    Assert.Equal(ServiceLifetime.Singleton, descriptor.Lifetime);

    using var provider = services.BuildServiceProvider();
    Assert.IsType<LocalBlobStore>(
        provider.GetRequiredService<IBlobStore>());
  }

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  private async Task<WebApplication> StartRangeApplicationAsync()
  {
    Directory.CreateDirectory(directory);
    await File.WriteAllTextAsync(
        Path.Combine(directory, RangeKey),
        "0123456789",
        Encoding.ASCII,
        CancellationToken.None);
    var app = BuildApplication(options =>
    {
      options.StorageDirectory = directory;
      options.PublicUrl = "https://uploads.example.com/files";
    });
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private static async Task<HttpResponseMessage> SendRangeAsync(
      HttpClient client,
      string method,
      string range,
      string? ifRange = null)
  {
    using var request = new HttpRequestMessage(
        new HttpMethod(method),
        $"/files/{RangeKey}");
    request.Headers.TryAddWithoutValidation("Range", range);

    if (ifRange is not null)
    {
      request.Headers.TryAddWithoutValidation("If-Range", ifRange);
    }

    return await client.SendAsync(request);
  }

  private static WebApplication BuildApplication(Action<BlokServerOptions> configure)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(configure);

    return builder.Build();
  }
}
