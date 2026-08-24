using Blok.Server.Storage;
using Xunit;

namespace Blok.Server.Tests;

public sealed class S3TargetResolverTests
{
  public static TheoryData<string, string, string, string, string> AddressingCases =>
      new()
      {
        {
          "http://127.0.0.1:9000",
          "media",
          "",
          "http://127.0.0.1:9000/media/key.png",
          "127.0.0.1:9000"
        },
        {
          "https://minio.internal:9000",
          "media",
          "",
          "https://minio.internal:9000/media/key.png",
          "minio.internal:9000"
        },
        {
          "https://abc123.r2.cloudflarestorage.com",
          "media",
          "",
          "https://abc123.r2.cloudflarestorage.com/media/key.png",
          "abc123.r2.cloudflarestorage.com"
        },
        {
          "https://s3.eu-central-1.amazonaws.com",
          "media",
          "",
          "https://media.s3.eu-central-1.amazonaws.com/key.png",
          "media.s3.eu-central-1.amazonaws.com"
        },
        {
          "https://s3.eu-central-1.amazonaws.com",
          "my.media",
          "",
          "https://s3.eu-central-1.amazonaws.com/my.media/key.png",
          "s3.eu-central-1.amazonaws.com"
        },
        {
          "https://s3.amazonaws.com",
          "Media",
          "",
          "https://s3.amazonaws.com/Media/key.png",
          "s3.amazonaws.com"
        },
        {
          "https://s3.amazonaws.com",
          "media",
          "path",
          "https://s3.amazonaws.com/media/key.png",
          "s3.amazonaws.com"
        },
        {
          "https://minio.internal:9000",
          "media",
          "virtual",
          "https://media.minio.internal:9000/key.png",
          "media.minio.internal:9000"
        },
        {
          "https://s3.example.com:443",
          "media",
          "",
          "https://s3.example.com/media/key.png",
          "s3.example.com"
        },
        {
          "https://s3.example.com/?debug=1",
          "media",
          "",
          "https://s3.example.com/media/key.png",
          "s3.example.com"
        },
      };

  [Theory]
  [MemberData(nameof(AddressingCases))]
  public void ResolvesTheFrozenAddressingContract(
      string endpoint,
      string bucket,
      string addressing,
      string expectedUrl,
      string expectedHost)
  {
    var target = S3TargetResolver.Resolve(
        CreateOptions(endpoint, bucket, addressing),
        "key.png");

    Assert.Equal(expectedUrl, target.Url.AbsoluteUri);
    Assert.Equal(expectedHost, target.Host);
  }

  public static TheoryData<string, string, string> InvalidTargetCases =>
      new()
      {
        { "", "media", "" },
        { "/just/a/path", "media", "" },
        { "https://s3.example.com", "", "" },
        { "https://s3.example.com/%zz", "media", "" },
        { "https://s3.example.com", "media/../secrets", "" },
        { "https://ünïcode.example.com", "media", "" },
        { "https://s3.example.com", "media", "dns" },
        { "https://gateway.example.com/s3", "media", "" },
      };

  [Theory]
  [MemberData(nameof(InvalidTargetCases))]
  public void RefusesAnUnusableTarget(
      string endpoint,
      string bucket,
      string addressing)
  {
    Assert.Throws<InvalidOperationException>(
        () => S3TargetResolver.Resolve(
            CreateOptions(endpoint, bucket, addressing),
            "key.png"));
  }

  private static S3BlobStoreOptions CreateOptions(
      string endpoint,
      string bucket,
      string addressing)
  {
    return new S3BlobStoreOptions(
        endpoint,
        "eu-central-1",
        bucket,
        "AKIAEXAMPLE",
        "wJalrXUtnFEMI/K7MDENG",
        "https://cdn.example.com/media",
        addressing,
        1024,
        Path.GetTempPath());
  }
}

public sealed class S3RequestSignerTests
{
  [Fact]
  public void MatchesTheFrozenSigV4Vector()
  {
    var options = new S3BlobStoreOptions(
        "https://s3.example.com",
        "eu-central-1",
        "media",
        "AKIAEXAMPLE",
        "wJalrXUtnFEMI/K7MDENG",
        "https://cdn.example.com/media",
        "path",
        1024,
        Path.GetTempPath());
    var target = S3TargetResolver.Resolve(options, "key.png");
    using var request = new HttpRequestMessage(HttpMethod.Put, target.Url)
    {
      Content = new ByteArrayContent("bytes"u8.ToArray()),
    };
    request.Content.Headers.ContentLength = 5;
    request.Content.Headers.TryAddWithoutValidation("Content-Type", "image/png");

    S3RequestSigner.Sign(
        request,
        target,
        options,
        "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9",
        new DateTimeOffset(2025, 1, 2, 3, 4, 5, TimeSpan.Zero));

    Assert.Equal("s3.example.com", request.Headers.Host);
    Assert.Equal(
        "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9",
        Assert.Single(request.Headers.GetValues("x-amz-content-sha256")));
    Assert.Equal(
        "20250102T030405Z",
        Assert.Single(request.Headers.GetValues("x-amz-date")));
    Assert.Equal(
        "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20250102/eu-central-1/s3/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, " +
        "Signature=2d50477b639388426c272609afac34d42f0f92aac413acf8afc4deee4278ec0c",
        request.Headers.Authorization?.ToString());
  }
}

public sealed class S3BlobStoreRequestTests
{
  private static readonly DateTimeOffset FrozenTime =
      new(2025, 1, 2, 3, 4, 5, TimeSpan.Zero);

  [Fact]
  public async Task PutsASeekableBodyWithKnownLengthAndReturnsThePublicUrl()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    CapturedRequest? captured = null;
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          captured = await CapturedRequest.CreateAsync(
              request,
              cancellationToken);

          return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });
    await using var content = new MemoryStream("bytes"u8.ToArray());

    var url = await store.PutAsync(
        ".PNG",
        "image/png",
        content,
        CancellationToken.None);

    Assert.Matches(
        "^https://cdn\\.example\\.com/media/[0-9a-f]{32}\\.png$",
        url);
    Assert.NotNull(captured);
    var key = new Uri(url).Segments[^1];
    Assert.Equal(HttpMethod.Put, captured.Method);
    Assert.Equal($"https://s3.example.com/media/{key}", captured.Url);
    Assert.Equal("s3.example.com", captured.Headers["Host"]);
    Assert.Equal("5", captured.ContentHeaders["Content-Length"]);
    Assert.Equal("image/png", captured.ContentHeaders["Content-Type"]);
    Assert.Equal(
        "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9",
        captured.Headers["x-amz-content-sha256"]);
    Assert.Equal("bytes"u8.ToArray(), captured.Body);
    Assert.Contains(
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
        captured.Headers["Authorization"],
        StringComparison.Ordinal);
    Assert.True(content.CanRead);
  }

  [Fact]
  public async Task DeletesAnOwnedUrlWithASignedEmptyPayload()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    CapturedRequest? captured = null;
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          captured = await CapturedRequest.CreateAsync(
              request,
              cancellationToken);

          return new HttpResponseMessage(
              System.Net.HttpStatusCode.NoContent);
        });
    var key = $"{new string('a', 32)}.png";

    await store.DeleteAsync(
        $"https://cdn.example.com/media/{key}?download=1#file",
        CancellationToken.None);

    Assert.NotNull(captured);
    Assert.Equal(HttpMethod.Delete, captured.Method);
    Assert.Equal(
        $"https://s3.example.com/media/{key}",
        captured.Url);
    Assert.Equal("0", captured.ContentHeaders["Content-Length"]);
    Assert.Empty(captured.Body);
    Assert.Equal(
        "e3b0c44298fc1c149afbf4c8996fb924" +
        "27ae41e4649b934ca495991b7852b855",
        captured.Headers["x-amz-content-sha256"]);
    Assert.Contains(
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        captured.Headers["Authorization"],
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task RefusesAForeignDeleteWithoutSendingARequest()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var requests = 0;
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          requests++;

          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.NoContent));
        });

    await Assert.ThrowsAsync<ForeignBlobUrlException>(
        () => store.DeleteAsync(
            $"https://evil.example.com/media/{new string('a', 32)}.png",
            CancellationToken.None));

    Assert.Equal(0, requests);
  }

  [Fact]
  public async Task DropsAnInvalidMediaTypeBeforeSigning()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    CapturedRequest? captured = null;
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          captured = await CapturedRequest.CreateAsync(
              request,
              cancellationToken);

          return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });

    await store.PutAsync(
        ".txt",
        "definitely not a media type",
        new MemoryStream("bytes"u8.ToArray()),
        CancellationToken.None);

    Assert.NotNull(captured);
    Assert.DoesNotContain("Content-Type", captured.ContentHeaders.Keys);
    Assert.DoesNotContain(
        "content-type",
        captured.Headers["Authorization"],
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task SpoolsANonSeekableBodyOnlyForTheRequestLifetime()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var spoolFilesDuringRequest = -1;
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          spoolFilesDuringRequest =
              Directory.GetFiles(temporaryDirectory.Path).Length;
          _ = await CapturedRequest.CreateAsync(
              request,
              cancellationToken);

          return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });
    await using var content =
        new NonSeekableStream("non-seekable bytes"u8.ToArray());

    await store.PutAsync(
        ".bin",
        "application/octet-stream",
        content,
        CancellationToken.None);

    Assert.Equal(1, spoolFilesDuringRequest);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task DoesNotSpoolASeekableBody()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var spoolFilesDuringRequest = -1;
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          spoolFilesDuringRequest =
              Directory.GetFiles(temporaryDirectory.Path).Length;
          _ = await CapturedRequest.CreateAsync(
              request,
              cancellationToken);

          return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });

    await store.PutAsync(
        ".bin",
        "application/octet-stream",
        new MemoryStream("seekable bytes"u8.ToArray()),
        CancellationToken.None);

    Assert.Equal(0, spoolFilesDuringRequest);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task DoesNotRetryASeekableBodyAfterHashingFails()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var requests = 0;
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          requests++;

          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.OK));
        });
    await using var content =
        new FailingSeekableStream("bytes"u8.ToArray());

    var error = await Assert.ThrowsAsync<IOException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            CancellationToken.None));

    Assert.Equal("hashing failed", error.Message);
    Assert.Equal(0, requests);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task BoundsANonSeekableSpool()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var requests = 0;
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          requests++;

          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.OK));
        },
        maximumSpoolBytes: 4);
    await using var content =
        new NonSeekableStream("12345"u8.ToArray());

    var error = await Assert.ThrowsAsync<IOException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            CancellationToken.None));

    Assert.Contains(
        "exceeds the configured 4-byte limit",
        error.Message,
        StringComparison.Ordinal);
    Assert.Equal(0, requests);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task RemovesTheSpoolWhenTheInputFails()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.OK));
        });
    await using var content = new FailingInputStream();

    var error = await Assert.ThrowsAsync<IOException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            CancellationToken.None));

    Assert.Equal("input failed", error.Message);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task RemovesTheSpoolWhenInputCopyIsCancelled()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    using var cancellation = new CancellationTokenSource();
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.OK));
        });
    await using var content =
        new CancellingInputStream(cancellation);

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            cancellation.Token));

    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task BoundsTheConfiguredS3RequestAndRemovesTheSpool()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          await Task.Delay(
              Timeout.InfiniteTimeSpan,
              cancellationToken);

          return new HttpResponseMessage(
              System.Net.HttpStatusCode.OK);
        },
        requestTimeout: TimeSpan.FromMilliseconds(20));
    await using var content =
        new NonSeekableStream("bytes"u8.ToArray());

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            CancellationToken.None).WaitAsync(
                TimeSpan.FromSeconds(5)));

    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task RemovesTheSpoolWhenTheS3RequestIsCancelled()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    using var cancellation = new CancellationTokenSource();
    var requestStarted = new TaskCompletionSource(
        TaskCreationOptions.RunContinuationsAsynchronously);
    using var store = CreateStore(
        temporaryDirectory.Path,
        async (request, cancellationToken) =>
        {
          Assert.Single(
              Directory.GetFiles(temporaryDirectory.Path));
          requestStarted.TrySetResult();
          await Task.Delay(
              Timeout.InfiniteTimeSpan,
              cancellationToken);

          return new HttpResponseMessage(
              System.Net.HttpStatusCode.OK);
        });
    await using var content =
        new NonSeekableStream("bytes"u8.ToArray());
    var put = store.PutAsync(
        ".bin",
        "application/octet-stream",
        content,
        cancellation.Token);

    await requestStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => put);
    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task RemovesTheSpoolWhenS3RejectsTheRequest()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.Forbidden)
              {
                Content = new StringContent(
                    "<Error><Code>FixtureFailure</Code></Error>"),
              });
        });
    await using var content =
        new NonSeekableStream("bytes"u8.ToArray());

    await Assert.ThrowsAsync<HttpRequestException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            content,
            CancellationToken.None));

    Assert.Empty(Directory.GetFileSystemEntries(temporaryDirectory.Path));
  }

  [Fact]
  public async Task TruncatesTheUpstreamErrorBody()
  {
    using var temporaryDirectory = new TemporaryDirectory();
    var errorBody = new ProbeStream(
        "<Error><Code>FixtureFailure</Code></Error>"u8.ToArray(),
        totalLength: 2048);
    using var store = CreateStore(
        temporaryDirectory.Path,
        (request, cancellationToken) =>
        {
          return Task.FromResult(
              new HttpResponseMessage(
                  System.Net.HttpStatusCode.Forbidden)
              {
                Content = new StreamContent(errorBody),
              });
        });

    var error = await Assert.ThrowsAsync<HttpRequestException>(
        () => store.PutAsync(
            ".bin",
            "application/octet-stream",
            new MemoryStream("bytes"u8.ToArray()),
            CancellationToken.None));

    Assert.Equal(512, errorBody.BytesRead);
    Assert.Contains(
        "FixtureFailure",
        error.Message,
        StringComparison.Ordinal);
    Assert.True(error.Message.Length < 600);
  }

  private static S3BlobStore CreateStore(
      string temporaryDirectory,
      Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send,
      long maximumSpoolBytes = 1024,
      TimeSpan requestTimeout = default)
  {
    return new S3BlobStore(
        new S3BlobStoreOptions(
            "https://s3.example.com",
            "eu-central-1",
            "media",
            "AKIAEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG",
            "https://cdn.example.com/media",
            "path",
            maximumSpoolBytes,
            temporaryDirectory,
            requestTimeout),
        new DelegateHandler(send),
        new FrozenTimeProvider(FrozenTime));
  }

  private sealed record CapturedRequest(
      HttpMethod Method,
      string Url,
      IReadOnlyDictionary<string, string> Headers,
      IReadOnlyDictionary<string, string> ContentHeaders,
      byte[] Body)
  {
    internal static async Task<CapturedRequest> CreateAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
      var headers = request.Headers.ToDictionary(
          header => header.Key,
          header => string.Join(", ", header.Value),
          StringComparer.OrdinalIgnoreCase);
      var contentHeaders = request.Content?.Headers.ToDictionary(
          header => header.Key,
          header => string.Join(", ", header.Value),
          StringComparer.OrdinalIgnoreCase) ??
          new Dictionary<string, string>(
              StringComparer.OrdinalIgnoreCase);
      var body = request.Content is null
        ? []
        : await request.Content.ReadAsByteArrayAsync(
            cancellationToken);

      return new CapturedRequest(
          request.Method,
          request.RequestUri?.AbsoluteUri ?? "",
          headers,
          contentHeaders,
          body);
    }
  }

  private sealed class DelegateHandler(
      Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) :
      HttpMessageHandler
  {
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
      return send(request, cancellationToken);
    }
  }

  private abstract class ReadOnlyStream : Stream
  {
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

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      return Read(buffer.AsSpan(offset, count));
    }

    public override int Read(Span<byte> buffer)
    {
      throw new NotSupportedException();
    }

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return ReadAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public abstract override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default);

    public override long Seek(
        long offset,
        SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(
        byte[] buffer,
        int offset,
        int count)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class NonSeekableStream(byte[] bytes) :
      ReadOnlyStream
  {
    private readonly MemoryStream inner = new(bytes);

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      return inner.ReadAsync(buffer, cancellationToken);
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        inner.Dispose();
      }

      base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
      await inner.DisposeAsync();
      GC.SuppressFinalize(this);
    }
  }

  private sealed class FailingSeekableStream(byte[] bytes) :
      ReadOnlyStream
  {
    private readonly MemoryStream inner = new(bytes);
    private bool failed;

    public override bool CanSeek => true;

    public override long Length => inner.Length;

    public override long Position
    {
      get => inner.Position;
      set => inner.Position = value;
    }

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (!failed && inner.Position == inner.Length)
      {
        failed = true;

        return ValueTask.FromException<int>(
            new IOException("hashing failed"));
      }

      return inner.ReadAsync(buffer, cancellationToken);
    }

    public override long Seek(
        long offset,
        SeekOrigin origin)
    {
      return inner.Seek(offset, origin);
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        inner.Dispose();
      }

      base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
      await inner.DisposeAsync();
      GC.SuppressFinalize(this);
    }
  }

  private sealed class FailingInputStream : ReadOnlyStream
  {
    private bool returnedBytes;

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (returnedBytes)
      {
        return ValueTask.FromException<int>(
            new IOException("input failed"));
      }

      returnedBytes = true;
      "part"u8.CopyTo(buffer.Span);

      return ValueTask.FromResult("part"u8.Length);
    }
  }

  private sealed class CancellingInputStream(
      CancellationTokenSource cancellation) : ReadOnlyStream
  {
    private bool returnedBytes;

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (returnedBytes)
      {
        return ValueTask.FromCanceled<int>(
            cancellationToken);
      }

      returnedBytes = true;
      "part"u8.CopyTo(buffer.Span);
      cancellation.Cancel();

      return ValueTask.FromResult("part"u8.Length);
    }
  }

  private sealed class ProbeStream(
      byte[] prefix,
      int totalLength) : ReadOnlyStream
  {
    private int position;

    internal int BytesRead => position;

    public override int Read(Span<byte> buffer)
    {
      var count = Math.Min(
          buffer.Length,
          totalLength - position);

      for (var index = 0; index < count; index++)
      {
        buffer[index] = position + index < prefix.Length
          ? prefix[position + index]
          : (byte)'x';
      }

      position += count;

      return count;
    }

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      cancellationToken.ThrowIfCancellationRequested();

      return ValueTask.FromResult(Read(buffer.Span));
    }
  }

  private sealed class FrozenTimeProvider(DateTimeOffset utcNow) :
      TimeProvider
  {
    public override DateTimeOffset GetUtcNow()
    {
      return utcNow;
    }
  }

  private sealed class TemporaryDirectory : IDisposable
  {
    internal TemporaryDirectory()
    {
      Path = System.IO.Path.Combine(
          System.IO.Path.GetTempPath(),
          $"blok-s3-store-{Guid.NewGuid():N}");
      Directory.CreateDirectory(Path);
    }

    internal string Path { get; }

    public void Dispose()
    {
      Directory.Delete(Path, recursive: true);
    }
  }
}
