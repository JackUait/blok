using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Blok.Server.AspNetCore;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class UploadEndpointTests
{
  private const string Boundary = "blok-upload-test-boundary";
  private const string UploadUrl = "https://uploads.example.test/files/blob";

  public static TheoryData<string, string, string> BrowserFileNames =>
      new()
      {
        { @"C:\Users\me\PHOTO.PNG", "PHOTO.PNG", ".png" },
        { "../../notes/report.txt", "report.txt", ".txt" },
        { "report.💥", "report.💥", "" },
        { "report.abcdefghijklmnop", "report.abcdefghijklmnop", "" },
      };

  public static TheoryData<string> InvalidDisplayNames =>
      new()
      {
        ".",
        "..",
        new string('a', 256),
        new string('é', 128),
      };

  public static TheoryData<string, string> MediaTypes
  {
    get
    {
      var maximum = "text/plain; x=" + new string('a', 241);
      var tooLong = maximum + "a";

      Assert.Equal(255, maximum.Length);
      Assert.Equal(256, tooLong.Length);

      return new TheoryData<string, string>
      {
        { " text/plain; charset=utf-8 ", "text/plain; charset=utf-8" },
        { maximum, maximum },
        { tooLong, "" },
        { "not a media type", "" },
        { "   ", "" },
      };
    }
  }

  [Fact]
  public async Task StreamsTheExactFileToStorageAndReturnsItsMetadata()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var bytes = new byte[] { 0, 1, 2, 127, 128, 255 };
    var body = BuildMultipart(
        new MultipartPart("file", "archive.TAR", " application/octet-stream ", bytes));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"fileName\":\"archive.TAR\",\"size\":6,\"mimeType\":\"application/octet-stream\"}\n",
        await response.Content.ReadAsStringAsync());
    var put = Assert.Single(store.Puts);
    Assert.Equal(".tar", put.Extension);
    Assert.Equal("application/octet-stream", put.MimeType);
    Assert.Equal(bytes, put.Bytes);
  }

  [Theory]
  [MemberData(nameof(BrowserFileNames))]
  public async Task ReducesBrowserPathsBeforePassingOnlyTheExtensionToStorage(
      string fileName,
      string expectedName,
      string expectedExtension)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", fileName, "text/plain", Encoding.UTF8.GetBytes("bytes")));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    using var payload = JsonDocument.Parse(
        await response.Content.ReadAsStringAsync());
    Assert.Equal(
        expectedName,
        payload.RootElement.GetProperty("fileName").GetString());
    Assert.Equal(expectedExtension, Assert.Single(store.Puts).Extension);
  }

  [Fact]
  public async Task CreatesTheEndpointSpoolOwnerOnlyWhileStorageIsBlocked()
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    var existingSpools = Directory
        .GetFiles(Path.GetTempPath(), ".blok-upload-*")
        .ToHashSet(StringComparer.Ordinal);
    var store = new RecordingBlobStore
    {
      WaitForRelease = true,
    };
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart(
            "file",
            "private.bin",
            "application/octet-stream",
            "private endpoint bytes"u8.ToArray()));
    using var request = CreateUploadRequest(body);
    var responseTask = client.SendAsync(request);

    await store.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));

    try
    {
      var temporaryPath = Assert.Single(await WaitForNewSpoolsAsync(existingSpools, 1));
      var mode = File.GetUnixFileMode(temporaryPath);
      Assert.Equal(
          UnixFileMode.UserRead | UnixFileMode.UserWrite,
          mode & (UnixFileMode)Convert.ToInt32("777", 8));
    }
    finally
    {
      store.Release.TrySetResult();
    }

    using var response = await responseTask;
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
  }

  [Fact]
  public async Task OmitsEmptyFileNameSizeAndMimeTypeFromTheResponse()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", ".", "not a media type", []));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\"}\n",
        await response.Content.ReadAsStringAsync());
    var put = Assert.Single(store.Puts);
    Assert.Equal("", put.Extension);
    Assert.Equal("", put.MimeType);
    Assert.Empty(put.Bytes);
  }

  [Theory]
  [MemberData(nameof(InvalidDisplayNames))]
  public async Task DropsUnsafeOrOverlongDisplayNames(string fileName)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", fileName, "text/plain", Encoding.UTF8.GetBytes("x")));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"size\":1,\"mimeType\":\"text/plain\"}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal("", Assert.Single(store.Puts).Extension);
  }

  [Theory]
  [MemberData(nameof(MediaTypes))]
  public async Task KeepsOnlyTrimmedValidBoundedMediaTypes(
      string mediaType,
      string expectedMediaType)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", "file.bin", mediaType, Encoding.UTF8.GetBytes("x")));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var expectedMimeProperty = expectedMediaType == ""
      ? ""
      : $",\"mimeType\":\"{expectedMediaType}\"";
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"fileName\":\"file.bin\",\"size\":1" +
        expectedMimeProperty +
        "}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal(expectedMediaType, Assert.Single(store.Puts).MimeType);
  }

  [Fact]
  public async Task RejectsMissingOrWrongFileFieldsBeforeStorage()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var bodies = new[]
    {
      BuildMultipart(),
      BuildMultipart(new MultipartPart("asset", "photo.png", "image/png", [1])),
      BuildMultipart(new MultipartPart("file", null, null, Encoding.UTF8.GetBytes("value"))),
    };

    foreach (var body in bodies)
    {
      using var response = await client.SendAsync(CreateUploadRequest(body));

      await AssertError(
          response,
          HttpStatusCode.BadRequest,
          "missing file field\n");
    }

    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task RejectsMalformedMultipartBeforeStorage()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var validBody = BuildMultipart(
        new MultipartPart("file", "photo.png", "image/png", [1, 2, 3]));
    var cases = new[]
    {
      new MalformedCase(validBody, null),
      new MalformedCase(validBody, "multipart/form-data"),
      new MalformedCase(Encoding.UTF8.GetBytes("not multipart"), MultipartContentType),
      new MalformedCase(
          BuildMultipart(
              close: false,
              new MultipartPart("file", "photo.png", "image/png", [1, 2, 3])),
          MultipartContentType),
    };

    foreach (var testCase in cases)
    {
      using var response = await client.SendAsync(
          CreateUploadRequest(testCase.Body, testCase.ContentType));

      await AssertError(
          response,
          HttpStatusCode.BadRequest,
          "malformed upload\n");
    }

    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task AcceptsOneThousandMultipartSectionsAndRejectsTheNext()
  {
    var acceptedParts = new List<MultipartPart>
    {
      new("file", "accepted.txt", "text/plain", "accepted"u8.ToArray()),
    };
    acceptedParts.AddRange(Enumerable.Range(1, 999).Select(index =>
        new MultipartPart(
            $"field-{index}",
            null,
            null,
            Array.Empty<byte>())));
    var acceptedStore = new RecordingBlobStore();
    await using (var app = await StartApplication(acceptedStore))
    {
      using var client = app.GetTestClient();
      using var response = await client.SendAsync(
          CreateUploadRequest(BuildMultipart([.. acceptedParts])));

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Single(acceptedStore.Puts);
    }

    var existingSpools = Directory
        .GetFiles(Path.GetTempPath(), ".blok-upload-*")
        .ToHashSet(StringComparer.Ordinal);
    var rejectedParts = new List<MultipartPart>
    {
      new("file", "rejected.txt", "text/plain", "rejected"u8.ToArray()),
    };
    rejectedParts.AddRange(Enumerable.Range(1, 1_000).Select(index =>
        new MultipartPart(
            $"field-{index}",
            null,
            null,
            Array.Empty<byte>())));
    var rejectedStore = new RecordingBlobStore();
    await using (var app = await StartApplication(rejectedStore))
    {
      using var client = app.GetTestClient();
      using var response = await client.SendAsync(
          CreateUploadRequest(BuildMultipart([.. rejectedParts])));

      await AssertError(
          response,
          HttpStatusCode.BadRequest,
          "malformed upload\n");
      Assert.Equal(0, rejectedStore.PutCalls);
      Assert.Empty(await WaitForNewSpoolsAsync(existingSpools, 0));
    }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task RejectsMalformedQuotedPrintableInDiscardedPartsBeforeStorage(
      bool laterFile)
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var discarded = laterFile
      ? new MultipartPart(
          "file",
          "later.txt",
          null,
          Encoding.UTF8.GetBytes("="),
          "quoted-printable")
      : new MultipartPart(
          "note",
          null,
          null,
          Encoding.UTF8.GetBytes("="),
          "quoted-printable");
    var body = BuildMultipart(
        new MultipartPart(
            "file",
            "first.txt",
            "text/plain",
            Encoding.UTF8.GetBytes("valid file")),
        discarded);

    using var response = await client.SendAsync(CreateUploadRequest(body));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "malformed upload\n");
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task AcceptsAMultipartBoundaryWithoutAnEndpointSpecificCap()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var boundary = new string('a', 129);
    var body = BuildMultipart(
        boundary,
        new MultipartPart("file", "photo.png", "image/png", [1]));

    using var response = await client.SendAsync(
        CreateUploadRequest(
            body,
            $"multipart/form-data; boundary={boundary}"));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Single(store.Puts);
  }

  [Fact]
  public async Task AppliesTheCompleteBodyCapAtTheExactUnknownLengthBoundary()
  {
    var acceptedStore = new RecordingBlobStore();
    var body = BuildMultipart(
        new MultipartPart("file", "small.txt", "text/plain", Encoding.UTF8.GetBytes("small")),
        new MultipartPart("note", null, null, Encoding.UTF8.GetBytes("other field")));
    await using (var acceptedApp = await StartApplication(acceptedStore, body.Length))
    {
      using var client = acceptedApp.GetTestClient();
      using var response = await client.SendAsync(
          CreateUploadRequest(body, unknownLength: true));

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Single(acceptedStore.Puts);
    }

    var rejectedStore = new RecordingBlobStore();
    await using (var rejectedApp = await StartApplication(rejectedStore, body.Length - 1))
    {
      using var client = rejectedApp.GetTestClient();
      using var response = await client.SendAsync(
          CreateUploadRequest(body, unknownLength: true));

      await AssertError(
          response,
          HttpStatusCode.RequestEntityTooLarge,
          "file too large\n");
      Assert.Equal(0, rejectedStore.PutCalls);
    }
  }

  [Fact]
  public async Task RejectsAnOversizedKnownLengthBeforeStorage()
  {
    var store = new RecordingBlobStore();
    var body = BuildMultipart(
        new MultipartPart("file", "small.txt", "text/plain", Encoding.UTF8.GetBytes("small")));
    await using var app = await StartApplication(store, body.Length - 1);
    using var client = app.GetTestClient();

    using var response = await client.SendAsync(CreateUploadRequest(body));

    await AssertError(
        response,
        HttpStatusCode.RequestEntityTooLarge,
        "file too large\n");
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task ReportsOnlyTheBytesTheStoreActuallyConsumes()
  {
    var store = new RecordingBlobStore
    {
      MaximumBytesToRead = 3,
    };
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", "partial.bin", null, [1, 2, 3, 4, 5]));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    using var payload = JsonDocument.Parse(
        await response.Content.ReadAsStringAsync());
    Assert.Equal(3, payload.RootElement.GetProperty("size").GetInt64());
    Assert.Equal(new byte[] { 1, 2, 3 }, Assert.Single(store.Puts).Bytes);
  }

  [Fact]
  public async Task OmitsSizeWhenTheStoreConsumesNoBytes()
  {
    var store = new RecordingBlobStore
    {
      MaximumBytesToRead = 0,
    };
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", "unread.bin", null, [1, 2, 3]));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    using var payload = JsonDocument.Parse(
        await response.Content.ReadAsStringAsync());
    Assert.False(payload.RootElement.TryGetProperty("size", out _));
    Assert.Empty(Assert.Single(store.Puts).Bytes);
  }

  [Fact]
  public async Task MapsAStorageExceptionToTheExactBadGatewayWire()
  {
    var store = new RecordingBlobStore
    {
      Failure = new IOException("store unavailable"),
    };
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var bytes = Encoding.UTF8.GetBytes("preserved bytes");
    var body = BuildMultipart(
        new MultipartPart("file", "photo.png", "image/png", bytes));

    using var response = await client.SendAsync(CreateUploadRequest(body));

    await AssertError(response, HttpStatusCode.BadGateway, "upload failed\n");
    Assert.Equal(bytes, Assert.Single(store.Puts).Bytes);
  }

  [Fact]
  public async Task PropagatesRequestCancellationToStorageAndDisposesItsInput()
  {
    var store = new RecordingBlobStore
    {
      WaitForCancellation = true,
    };
    await using var app = await StartApplication(store);
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", "photo.png", "image/png", [1, 2, 3]));
    using var request = CreateUploadRequest(body);
    using var cancellation = new CancellationTokenSource();

    var response = client.SendAsync(request, cancellation.Token);
    await store.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => response);
    await store.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.NotNull(store.Input);
    Assert.Throws<ObjectDisposedException>(() => store.Input.ReadByte());
  }

  [Fact]
  public async Task RunsTheSharedGuardBeforeParsingOrStorage()
  {
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(
        store,
        configure: options =>
        {
          options.Auth = "ticket";
          options.Secret = "a-secret-value-with-at-least-32-characters";
          options.AllowedOrigins = ["https://app.example.com"];
        });
    using var client = app.GetTestClient();
    var body = BuildMultipart(
        new MultipartPart("file", "photo.png", "image/png", [1]));
    using var request = CreateUploadRequest(body);
    request.Headers.TryAddWithoutValidation("Origin", "https://app.example.com");

    using var response = await client.SendAsync(request);

    await AssertError(response, HttpStatusCode.Unauthorized, "missing pass\n");
    Assert.Equal(0, store.PutCalls);
  }

  /// <summary>
  /// Reads the endpoint spools that were not there before, waiting for the
  /// expected count.
  /// </summary>
  /// <remarks>
  /// The spool lives in the machine-wide temp directory, so a file there can
  /// belong to a request this assembly never made — Blok.Server.Host.Tests
  /// uploads through a real host process, and `dotnet test` runs the two in
  /// parallel. A leak is a spool that never goes away, so both callers wait
  /// for one instead of reading the directory the instant a response arrives:
  /// the handler deletes its spool in a `finally` that runs after the client
  /// already has the response.
  /// </remarks>
  private static async Task<string[]> WaitForNewSpoolsAsync(
      IReadOnlyCollection<string> existing,
      int expectedCount)
  {
    var stopwatch = Stopwatch.StartNew();
    string[] found;

    do
    {
      found = [.. Directory
          .GetFiles(Path.GetTempPath(), ".blok-upload-*")
          .Where(path => !existing.Contains(path))];

      if (found.Length == expectedCount)
      {
        return found;
      }

      await Task.Delay(25);
    }
    while (stopwatch.Elapsed < TimeSpan.FromSeconds(5));

    return found;
  }

  private static string MultipartContentType =>
      $"multipart/form-data; boundary={Boundary}";

  private static async Task<WebApplication> StartApplication(
      RecordingBlobStore store,
      long maxUploadBytes = 32L << 20,
      Action<BlokServerOptions>? configure = null)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options =>
    {
      options.StorageDirectory = "./unused-upload-test-storage";
      options.PublicUrl = "https://unused.example.test/files";
      options.MaxUploadBytes = maxUploadBytes;
      configure?.Invoke(options);
    });
    builder.Services.AddSingleton<IBlobStore>(store);
    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private static HttpRequestMessage CreateUploadRequest(
      byte[] body,
      bool unknownLength = false)
  {
    return CreateUploadRequest(body, MultipartContentType, unknownLength);
  }

  private static HttpRequestMessage CreateUploadRequest(
      byte[] body,
      string? contentType,
      bool unknownLength = false)
  {
    HttpContent content = unknownLength
      ? new StreamContent(new NonSeekableReadStream(body))
      : new ByteArrayContent(body);

    if (contentType is not null)
    {
      content.Headers.TryAddWithoutValidation("Content-Type", contentType);
    }

    return new HttpRequestMessage(HttpMethod.Post, "/upload")
    {
      Content = content,
    };
  }

  private static byte[] BuildMultipart(
      params MultipartPart[] parts)
  {
    return BuildMultipart(Boundary, close: true, parts);
  }

  private static byte[] BuildMultipart(
      string boundary,
      params MultipartPart[] parts)
  {
    return BuildMultipart(boundary, close: true, parts);
  }

  private static byte[] BuildMultipart(
      bool close,
      params MultipartPart[] parts)
  {
    return BuildMultipart(Boundary, close, parts);
  }

  private static byte[] BuildMultipart(
      string boundary,
      bool close,
      params MultipartPart[] parts)
  {
    using var body = new MemoryStream();

    foreach (var part in parts)
    {
      Write(body, $"--{boundary}\r\n");
      var disposition = $"Content-Disposition: form-data; name=\"{Escape(part.Name)}\"";

      if (part.FileName is not null)
      {
        disposition += $"; filename=\"{Escape(part.FileName)}\"";
      }

      Write(body, disposition + "\r\n");

      if (part.ContentType is not null)
      {
        Write(body, $"Content-Type: {part.ContentType}\r\n");
      }

      if (part.TransferEncoding is not null)
      {
        Write(
            body,
            $"Content-Transfer-Encoding: {part.TransferEncoding}\r\n");
      }

      Write(body, "\r\n");
      body.Write(part.Bytes);
      Write(body, "\r\n");
    }

    if (close)
    {
      Write(body, $"--{boundary}--\r\n");
    }

    return body.ToArray();
  }

  private static void Write(Stream stream, string value)
  {
    stream.Write(Encoding.UTF8.GetBytes(value));
  }

  private static string Escape(string value)
  {
    return value.Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("\"", "\\\"", StringComparison.Ordinal);
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

  private sealed record MultipartPart(
      string Name,
      string? FileName,
      string? ContentType,
      byte[] Bytes,
      string? TransferEncoding = null);

  private sealed record MalformedCase(
      byte[] Body,
      string? ContentType);

  private sealed record PutObservation(
      string Extension,
      string MimeType,
      byte[] Bytes);

  private sealed class RecordingBlobStore : IBlobStore
  {
    public List<PutObservation> Puts { get; } = [];

    public int PutCalls { get; private set; }

    public Exception? Failure { get; init; }

    public int? MaximumBytesToRead { get; init; }

    public bool WaitForCancellation { get; init; }

    public bool WaitForRelease { get; init; }

    public Stream? Input { get; private set; }

    public TaskCompletionSource Entered { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource Cancelled { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource Release { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public async Task<string> PutAsync(
        string extension,
        string mimeType,
        Stream content,
        CancellationToken cancellationToken = default)
    {
      PutCalls++;
      Input = content;
      Entered.TrySetResult();

      if (WaitForCancellation)
      {
        try
        {
          await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
        catch (OperationCanceledException)
        {
          Cancelled.TrySetResult();
          throw;
        }
      }

      if (WaitForRelease)
      {
        await Release.Task.WaitAsync(cancellationToken);
      }

      using var bytes = new MemoryStream();

      if (MaximumBytesToRead is int maximum)
      {
        var buffer = new byte[Math.Min(maximum, 81920)];
        var remaining = maximum;

        while (remaining > 0)
        {
          var read = await content.ReadAsync(
              buffer.AsMemory(0, Math.Min(remaining, buffer.Length)),
              cancellationToken);

          if (read == 0)
          {
            break;
          }

          bytes.Write(buffer, 0, read);
          remaining -= read;
        }
      }
      else
      {
        await content.CopyToAsync(bytes, cancellationToken);
      }

      Puts.Add(new PutObservation(extension, mimeType, bytes.ToArray()));

      if (Failure is not null)
      {
        throw Failure;
      }

      return UploadUrl;
    }

    public Task DeleteAsync(
        string url,
        CancellationToken cancellationToken = default)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class NonSeekableReadStream(byte[] bytes) : Stream
  {
    private readonly MemoryStream _inner = new(bytes, writable: false);

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
      return _inner.Read(buffer, offset, count);
    }

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      return _inner.ReadAsync(buffer, cancellationToken);
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(byte[] buffer, int offset, int count)
    {
      throw new NotSupportedException();
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        _inner.Dispose();
      }

      base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
      await _inner.DisposeAsync();
      await base.DisposeAsync();
    }
  }
}
