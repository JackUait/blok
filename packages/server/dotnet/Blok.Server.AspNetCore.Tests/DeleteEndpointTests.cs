using System.Net;
using System.Security.Cryptography;
using System.Text;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class DeleteEndpointTests : IDisposable
{
  private const string AllowedOrigin = "https://app.example.com";
  private const string PublicUrl = "https://uploads.example.test/files";
  private const string StoredKey = "0123456789abcdef0123456789abcdef.png";
  private const string TicketSecret =
      "delete-endpoint-secret-value-at-least-32-chars";

  private readonly string directory =
      Path.Combine(Path.GetTempPath(), $"blok-delete-{Guid.NewGuid():N}");

  public static TheoryData<string> ForeignUrls =>
      new()
      {
        // Another store's public prefix.
        $"https://other.example.test/files/{StoredKey}",
        // The right host under a different path prefix.
        $"https://uploads.example.test/other/{StoredKey}",
        // A prefix this one only starts with.
        $"https://uploads.example.test.evil/files/{StoredKey}",
      };

  public static TheoryData<string> MalformedKeys =>
      new()
      {
        // Not a generated key at all.
        $"{PublicUrl}/notes.txt",
        // Too few hex characters.
        $"{PublicUrl}/0123456789abcdef.png",
        // Hex-shaped but not lowercase hex.
        $"{PublicUrl}/0123456789ABCDEF0123456789ABCDEF.png",
        // A traversal dressed as a key.
        $"{PublicUrl}/../0123456789abcdef0123456789abcdef.png",
        // A nested path under a generated-looking directory.
        $"{PublicUrl}/0123456789abcdef0123456789abcdef/../../etc/passwd",
        // Empty key.
        $"{PublicUrl}/",
      };

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  [Fact]
  public async Task DeletesAStoredBlobAndReturnsTheSiblingSuccessShape()
  {
    var path = await SeedStoredBlobAsync();
    await using var app = await StartLocalApplication();
    using var response = await Delete(app, $"{PublicUrl}/{StoredKey}");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "application/json",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"success\":1}\n",
        await response.Content.ReadAsStringAsync());
    Assert.False(File.Exists(path));
  }

  [Theory]
  [MemberData(nameof(ForeignUrls))]
  public async Task AnswersNotFoundForAUrlThisStoreDidNotIssue(string url)
  {
    var path = await SeedStoredBlobAsync();
    await using var app = await StartLocalApplication();
    using var response = await Delete(app, url);

    await AssertError(response, HttpStatusCode.NotFound, "not found\n");
    Assert.True(File.Exists(path));
  }

  [Theory]
  [MemberData(nameof(MalformedKeys))]
  public async Task AnswersNotFoundForAKeyThisStoreCouldNotHaveGenerated(
      string url)
  {
    var path = await SeedStoredBlobAsync();
    await using var app = await StartLocalApplication();
    using var response = await Delete(app, url);

    await AssertError(response, HttpStatusCode.NotFound, "not found\n");
    Assert.True(File.Exists(path));
  }

  [Fact]
  public async Task DeletingTheSameUrlTwiceNeverFailsWithAServerError()
  {
    var path = await SeedStoredBlobAsync();
    await using var app = await StartLocalApplication();
    using var first = await Delete(app, $"{PublicUrl}/{StoredKey}");
    using var second = await Delete(app, $"{PublicUrl}/{StoredKey}");

    Assert.Equal(HttpStatusCode.OK, first.StatusCode);
    Assert.False(File.Exists(path));
    Assert.InRange((int)second.StatusCode, 200, 499);
    Assert.Equal(first.StatusCode, second.StatusCode);
    Assert.Equal(
        await first.Content.ReadAsStringAsync(),
        await second.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task RejectsAnAnonymousCallerInTicketModeBeforeStorage()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store, auth: "ticket");
    using var response = await Delete(
        app,
        $"{PublicUrl}/{StoredKey}",
        ticket: null);

    await AssertError(
        response,
        HttpStatusCode.Unauthorized,
        "missing pass\n");
    Assert.Equal(0, store.DeleteCalls);
  }

  [Fact]
  public async Task RejectsAReadOnlyPassBeforeStorage()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store, auth: "ticket");
    using var response = await Delete(
        app,
        $"{PublicUrl}/{StoredKey}",
        ticket: SignPayload(
            "{\"user\":\"reader\",\"write\":false,\"exp\":4102444800}"));

    await AssertError(
        response,
        HttpStatusCode.Forbidden,
        "write access required\n");
    Assert.Equal(0, store.DeleteCalls);
  }

  [Fact]
  public async Task AcceptsAWritePassInTicketMode()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store, auth: "ticket");
    using var response = await Delete(
        app,
        $"{PublicUrl}/{StoredKey}",
        ticket: SignPayload(
            "{\"user\":\"writer\",\"write\":true,\"exp\":4102444800}"));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal($"{PublicUrl}/{StoredKey}", Assert.Single(store.Deletes));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("text/plain")]
  [InlineData("application/x-www-form-urlencoded")]
  [InlineData("application/problem+json")]
  [InlineData("application/json; charset=utf-8; charset=iso-8859-1")]
  public async Task RejectsUnsupportedMediaTypesBeforeStorage(
      string? contentType)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var content = new ByteArrayContent(
        Encoding.UTF8.GetBytes($"{{\"url\":\"{PublicUrl}/{StoredKey}\"}}"));

    if (contentType is not null)
    {
      content.Headers.TryAddWithoutValidation("Content-Type", contentType);
    }

    using var response = await app.GetTestClient().PostAsync("/delete", content);

    await AssertError(
        response,
        HttpStatusCode.UnsupportedMediaType,
        "expected application/json\n");
    Assert.Equal(0, store.DeleteCalls);
  }

  [Theory]
  [InlineData("")]
  [InlineData("not json")]
  [InlineData("{}")]
  [InlineData("""{"url":""}""")]
  [InlineData("""{"url":1}""")]
  [InlineData("null")]
  [InlineData("[]")]
  public async Task RejectsMalformedEnvelopesBeforeStorage(string body)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var response = await app.GetTestClient().PostAsync(
        "/delete",
        Json(body));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, store.DeleteCalls);
  }

  [Fact]
  public async Task RejectsAnOversizedEnvelopeBeforeStorage()
  {
    const string prefix = "{\"url\":\"";
    const string suffix = "\"}";
    var body = prefix +
        new string('x', (8 << 10) + 1 - prefix.Length - suffix.Length) +
        suffix;
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var response = await app.GetTestClient().PostAsync(
        "/delete",
        Json(body));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, store.DeleteCalls);
  }

  [Fact]
  public async Task ReportsAStoreFailureAsABadGatewayRatherThanAServerError()
  {
    var store = new RecordingBlobStore
    {
      Failure = new IOException("store failed"),
    };
    await using var app = await StartApplication(store);
    using var response = await Delete(app, $"{PublicUrl}/{StoredKey}");

    await AssertError(
        response,
        HttpStatusCode.BadGateway,
        "delete failed\n");
    Assert.Equal(1, store.DeleteCalls);
  }

  [Fact]
  public async Task UnregistersTheDeleteRouteWhenStorageIsAbsent()
  {
    await using var app = await StartStoragelessApplication();
    using var client = app.GetTestClient();
    using var post = await client.PostAsync(
        "/delete",
        Json($"{{\"url\":\"{PublicUrl}/{StoredKey}\"}}"));
    using var preflight = await SendPreflight(client);

    foreach (var response in new[] { post, preflight })
    {
      Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
      Assert.Equal(
          "404 page not found\n",
          await response.Content.ReadAsStringAsync());
    }
  }

  [Fact]
  public async Task AnswersTheSharedWriteRouteWireForOtherMethods()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    using var wrongMethod = await client.GetAsync("/delete");
    using var preflight = await SendPreflight(client);

    Assert.Equal(HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
    Assert.Equal(
        "OPTIONS, POST",
        string.Join(", ", wrongMethod.Content.Headers.Allow));
    Assert.Equal(HttpStatusCode.NoContent, preflight.StatusCode);
    Assert.Equal(
        "POST, OPTIONS",
        Assert.Single(
            preflight.Headers.GetValues("Access-Control-Allow-Methods")));
    Assert.Equal(0, store.DeleteCalls);
  }

  private static Task<HttpResponseMessage> SendPreflight(HttpClient client)
  {
    using var request = new HttpRequestMessage(HttpMethod.Options, "/delete");
    request.Headers.TryAddWithoutValidation("Origin", AllowedOrigin);
    request.Headers.TryAddWithoutValidation(
        "Access-Control-Request-Method",
        "POST");

    return client.SendAsync(request);
  }

  private static async Task<HttpResponseMessage> Delete(
      WebApplication app,
      string url,
      string? ticket = null)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "/delete")
    {
      Content = Json($"{{\"url\":\"{url}\"}}"),
    };
    request.Headers.TryAddWithoutValidation("Origin", AllowedOrigin);

    if (ticket is not null)
    {
      request.Headers.TryAddWithoutValidation(
          "Authorization",
          $"Bearer {ticket}");
    }

    return await app.GetTestClient().SendAsync(request);
  }

  private static StringContent Json(string body)
  {
    return new StringContent(body, Encoding.UTF8, "application/json");
  }

  private static async Task AssertError(
      HttpResponseMessage response,
      HttpStatusCode status,
      string body)
  {
    Assert.Equal(status, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(body, await response.Content.ReadAsStringAsync());
  }

  private static string SignPayload(string payload)
  {
    const string header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    var signingInput = $"{Base64Url(Encoding.UTF8.GetBytes(header))}." +
        $"{Base64Url(Encoding.UTF8.GetBytes(payload))}";
    var signature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(TicketSecret),
        Encoding.UTF8.GetBytes(signingInput));

    return $"{signingInput}.{Base64Url(signature)}";
  }

  private static string Base64Url(byte[] value)
  {
    return Convert.ToBase64String(value)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
  }

  private static async Task<WebApplication> StartStoragelessApplication()
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      options.AllowedOrigins = [AllowedOrigin];
      options.StorageDirectory = "";
      options.PublicUrl = "";
      options.UnfurlDisabled = false;
    });
    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private async Task<string> SeedStoredBlobAsync()
  {
    Directory.CreateDirectory(directory);
    var path = Path.Combine(directory, StoredKey);

    await File.WriteAllBytesAsync(path, [1, 2, 3]);

    return path;
  }

  private async Task<WebApplication> StartLocalApplication()
  {
    Directory.CreateDirectory(directory);

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      options.AllowedOrigins = [AllowedOrigin];
      options.StorageDirectory = directory;
      options.PublicUrl = PublicUrl;
      options.UnfurlDisabled = false;
    });
    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private async Task<WebApplication> StartApplication(
      IBlobStore store,
      string auth = "none")
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(store);
    builder.Services.AddBlokServer(options =>
    {
      options.Auth = auth;
      options.Secret = auth == "ticket" ? TicketSecret : "";
      options.AllowedOrigins = [AllowedOrigin];
      options.StorageDirectory = directory;
      options.PublicUrl = PublicUrl;
      options.UnfurlDisabled = false;
    });
    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private sealed class RecordingBlobStore : IBlobStore
  {
    public List<string> Deletes { get; } = [];

    public int DeleteCalls { get; private set; }

    public Exception? Failure { get; init; }

    public Task<string> PutAsync(
        string extension,
        string mimeType,
        Stream content,
        CancellationToken cancellationToken = default)
    {
      throw new NotSupportedException();
    }

    public Task DeleteAsync(
        string url,
        CancellationToken cancellationToken = default)
    {
      DeleteCalls++;
      Deletes.Add(url);

      if (Failure is not null)
      {
        throw Failure;
      }

      return Task.CompletedTask;
    }
  }
}
