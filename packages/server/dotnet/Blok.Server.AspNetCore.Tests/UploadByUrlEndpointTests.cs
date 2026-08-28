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

public sealed class UploadByUrlEndpointTests
{
  private const string StoredUrl =
      "https://uploads.example.test/files/blob";

  public static TheoryData<string> MalformedEnvelopes =>
      new()
      {
        "",
        "not json",
        "{}",
        """{"url":""}""",
        """{"url":1}""",
        "null",
        "[]",
        $$"""{"url":"{{new string('x', 8 << 10)}}"}""",
      };

  public static TheoryData<string> InvalidMediaTypes
  {
    get
    {
      var maximum = "text/plain; x=" + new string('a', 241);

      Assert.Equal(255, maximum.Length);

      return new TheoryData<string>
      {
        "",
        "   ",
        "not a media type",
        "text/plain; charset=utf-8; charset=iso-8859-1",
        maximum + "a",
      };
    }
  }

  [Theory]
  [InlineData(null)]
  [InlineData("text/plain")]
  [InlineData("application/problem+json")]
  [InlineData("application/json-patch+json")]
  [InlineData("application/json; charset=utf-8; charset=iso-8859-1")]
  public async Task RejectsUnsupportedOrConflictingMediaTypesBeforeFetching(
      string? contentType)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var content = new ByteArrayContent(
        """{"url":"https://source.example.test/file"}"""u8.ToArray());

    if (contentType is not null)
    {
      content.Headers.TryAddWithoutValidation("Content-Type", contentType);
    }

    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        content);

    await AssertError(
        response,
        HttpStatusCode.UnsupportedMediaType,
        "expected application/json\n");
    Assert.Equal(0, fetcher.CallCount);
    Assert.Equal(0, store.PutCalls);
  }

  [Theory]
  [MemberData(nameof(MalformedEnvelopes))]
  public async Task RejectsMalformedOrOversizedEnvelopesBeforeFetching(
      string body)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(body));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, fetcher.CallCount);
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task DuplicateNullUrlRetainsThePriorString()
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(
            """{"url":"https://source.example.test/file","url":null}"""));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "https://source.example.test/file",
        fetcher.Target);
    Assert.Single(store.Puts);
  }

  [Fact]
  public async Task AcceptsAValidEnvelopeEndingAtEightKiB()
  {
    var body = EnvelopeWithClosingByteAt(8 << 10);
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(body));

    Assert.Equal(8 << 10, Encoding.UTF8.GetByteCount(body));
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(1, fetcher.CallCount);
    Assert.Single(store.Puts);
  }

  [Fact]
  public async Task RejectsAnEnvelopeWhoseClosingByteIsAtEightKiBPlusOne()
  {
    var body = EnvelopeWithClosingByteAt((8 << 10) + 1);
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(body));

    Assert.Equal((8 << 10) + 1, Encoding.UTF8.GetByteCount(body));
    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, fetcher.CallCount);
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task RejectsAnOversizedEnvelopeWhoseFirstEightKiBAreValidJson()
  {
    const string envelope =
        "{\"url\":\"https://source.example.test/file\"}";
    var body = envelope.PadRight(8 << 10, ' ') + "x";
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(body));

    Assert.Equal((8 << 10) + 1, Encoding.UTF8.GetByteCount(body));
    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, fetcher.CallCount);
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task RejectsATrailingJsonValueBeforeFetching()
  {
    const string body =
        "{\"url\":\"https://source.example.test/file\"} {}";
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json(body));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "expected {\"url\": \"...\"}\n");
    Assert.Equal(0, fetcher.CallCount);
    Assert.Equal(0, store.PutCalls);
  }

  [Theory]
  [InlineData((int)GuardedFetchFailure.BlockedDestination)]
  [InlineData((int)GuardedFetchFailure.ResponseTooLarge)]
  [InlineData((int)GuardedFetchFailure.TimedOut)]
  [InlineData((int)GuardedFetchFailure.TooManyRedirects)]
  public async Task EveryGuardFailureReturnsTheExactBadRequestAndMediaLimits(
      int failure)
  {
    var fetcher = new StubFetcher
    {
      Error = new GuardedFetchException((GuardedFetchFailure)failure),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(
        fetcher,
        store,
        maxUploadBytes: 12345);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "the URL could not be fetched\n");
    Assert.Equal(1, fetcher.CallCount);
    Assert.Equal(
        "https://source.example.test/file",
        fetcher.Target);
    Assert.Equal(TimeSpan.FromMinutes(2), fetcher.Limits.TotalTimeout);
    Assert.Equal(12345, fetcher.Limits.MaximumResponseBytes);
    Assert.Equal(5, fetcher.Limits.MaximumRedirects);
    Assert.Equal(0, store.PutCalls);
  }

  [Fact]
  public async Task PropagatesRequestCancellationToTheFetcher()
  {
    var fetcher = new StubFetcher
    {
      WaitForCancellation = true,
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var cancellation = new CancellationTokenSource();

    var response = app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""),
        cancellation.Token);
    await fetcher.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => response);
    await fetcher.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.Equal(0, store.PutCalls);
  }

  [Theory]
  [InlineData(199)]
  [InlineData(301)]
  [InlineData(404)]
  [InlineData(502)]
  [InlineData(300)]
  public async Task RejectsEveryRepresentativeNonTwoHundredStatusBeforeStorage(
      int statusCode)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(statusCode: statusCode),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "the URL could not be fetched\n");
    Assert.Equal(0, store.PutCalls);
  }

  [Theory]
  [InlineData(200)]
  [InlineData(203)]
  [InlineData(226)]
  [InlineData(299)]
  public async Task AcceptsEveryRepresentativeTwoHundredStatus(
      int statusCode)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(
          body: [],
          finalUrl: "https://example.test/",
          contentType: "",
          statusCode: statusCode),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\"}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Single(store.Puts);
  }

  [Fact]
  public async Task StoresExactBytesWithFinalNameMimeAndResponseSize()
  {
    var bytes = new byte[] { 0, 1, 2, 127, 128, 255 };
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(
          bytes,
          "https://cdn.example.test/final/photo.JPEG?download=1#ignored",
          " image/jpeg; profile=web ",
          StatusCodes.Status206PartialContent),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/redirect"}"""));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "application/json",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"fileName\":\"photo.JPEG\",\"size\":6,\"mimeType\":\"image/jpeg; profile=web\"}\n",
        await response.Content.ReadAsStringAsync());
    var put = Assert.Single(store.Puts);
    Assert.Equal(".jpeg", put.Extension);
    Assert.Equal("image/jpeg; profile=web", put.MimeType);
    Assert.Equal(bytes, put.Bytes);
  }

  [Fact]
  public async Task PercentDecodesTheFinalUrlFileName()
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(
          body: [1],
          finalUrl:
              "https://cdn.example.test/final/photo%20one.PNG?download=1",
          contentType: "image/png"),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"fileName\":\"photo one.PNG\",\"size\":1,\"mimeType\":\"image/png\"}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal(".png", Assert.Single(store.Puts).Extension);
  }

  [Theory]
  [InlineData("https://example.test")]
  [InlineData("https://example.test/")]
  [InlineData("https://example.test/folder/")]
  [InlineData("https://example.test/a/../")]
  public async Task OmitsANameForAPathlessOrTrailingSlashFinalUrl(
      string finalUrl)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(
          body: [1],
          finalUrl: finalUrl,
          contentType: "image/png"),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"size\":1,\"mimeType\":\"image/png\"}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal("", Assert.Single(store.Puts).Extension);
  }

  [Theory]
  [MemberData(nameof(InvalidMediaTypes))]
  public async Task DropsInvalidConflictingOrOverlongMediaTypes(
      string contentType)
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(
          body: [1],
          finalUrl: "https://example.test/file.bin",
          contentType: contentType),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(
        "{\"url\":\"https://uploads.example.test/files/blob\",\"fileName\":\"file.bin\",\"size\":1}\n",
        await response.Content.ReadAsStringAsync());
    Assert.Equal("", Assert.Single(store.Puts).MimeType);
  }

  [Fact]
  public async Task StoreFailureReturnsTheExactBadGateway()
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore
    {
      Failure = new IOException("store failed"),
    };
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    await AssertError(
        response,
        HttpStatusCode.BadGateway,
        "upload failed\n");
    Assert.Equal(1, store.PutCalls);
  }

  [Fact]
  public async Task PropagatesRequestCancellationToStorageAndDisposesItsInput()
  {
    var fetcher = new StubFetcher
    {
      Response = SuccessfulResponse(),
    };
    var store = new RecordingBlobStore
    {
      WaitForCancellation = true,
    };
    await using var app = await StartApplication(fetcher, store);
    using var cancellation = new CancellationTokenSource();

    var response = app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""),
        cancellation.Token);
    await store.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => response);
    await store.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.NotNull(store.Input);
    Assert.Throws<ObjectDisposedException>(() => store.Input.ReadByte());
  }

  [Fact]
  public async Task DisposesFetchedResponseAfterStorageFinishes()
  {
    using var permit = new SemaphoreSlim(0, 1);
    var fetcher = new StubFetcher
    {
      Response = new GuardedResponse(
          "imagebytes"u8.ToArray(),
          "image/png",
          "https://example.test/file.png",
          StatusCodes.Status200OK,
          permit),
    };
    var store = new RecordingBlobStore();
    await using var app = await StartApplication(fetcher, store);
    using var response = await app.GetTestClient().PostAsync(
        "/upload-by-url",
        Json("""{"url":"https://source.example.test/file"}"""));

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.True(permit.Wait(0));
  }

  private static GuardedResponse SuccessfulResponse(
      byte[]? body = null,
      string finalUrl = "https://example.test/file.png",
      string contentType = "image/png",
      int statusCode = StatusCodes.Status200OK)
  {
    return new GuardedResponse(
        body ?? "imagebytes"u8.ToArray(),
        contentType,
        finalUrl,
        statusCode);
  }

  private static string EnvelopeWithClosingByteAt(int bytePosition)
  {
    const string prefix = "{\"url\":\"";
    const string suffix = "\"}";

    return prefix +
        new string('x', bytePosition - prefix.Length - suffix.Length) +
        suffix;
  }

  private static async Task WaitUntilCancelledAsync(
      TaskCompletionSource cancelled,
      string dependency,
      CancellationToken cancellationToken)
  {
    using var timeout = new CancellationTokenSource(
        TimeSpan.FromSeconds(6));
    using var wait = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken,
        timeout.Token);

    try
    {
      await Task.Delay(Timeout.InfiniteTimeSpan, wait.Token);
    }
    catch (OperationCanceledException) when (
        cancellationToken.IsCancellationRequested)
    {
      cancelled.TrySetResult();
      throw new OperationCanceledException(cancellationToken);
    }
    catch (OperationCanceledException)
    {
      throw new TimeoutException(
          $"The {dependency} did not receive request cancellation.");
    }
  }

  private static StringContent Json(string body)
  {
    return new StringContent(body, Encoding.UTF8, "application/json");
  }

  private static async Task<WebApplication> StartApplication(
      IGuardedOutboundFetcher fetcher,
      IBlobStore store,
      long maxUploadBytes = 32L << 20)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(fetcher);
    builder.Services.AddSingleton(store);
    builder.Services.AddBlokServer(options =>
    {
      options.StorageDirectory = "./unused-upload-by-url-test-storage";
      options.PublicUrl = "https://unused.example.test/files";
      options.MaxUploadBytes = maxUploadBytes;
      options.UnfurlDisabled = false;
    });
    var app = builder.Build();
    app.MapBlokServer();
    await app.StartAsync();

    return app;
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

  private sealed record PutObservation(
      string Extension,
      string MimeType,
      byte[] Bytes);

  private sealed class StubFetcher : IGuardedOutboundFetcher
  {
    public GuardedResponse? Response { get; init; }

    public GuardedFetchException? Error { get; init; }

    public bool WaitForCancellation { get; init; }

    public TaskCompletionSource Entered { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource Cancelled { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public int CallCount { get; private set; }

    public string? Target { get; private set; }

    public GuardedFetchLimits Limits { get; private set; }

    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits limits,
        CancellationToken cancellationToken)
    {
      CallCount++;
      Target = rawUrl;
      Limits = limits;

      if (Error is not null)
      {
        throw Error;
      }

      return WaitForCancellation
        ? WaitForCancellationAsync(cancellationToken)
        : ValueTask.FromResult(
            Response ??
            throw new InvalidOperationException(
                "No guarded response was configured."));
    }

    private async ValueTask<GuardedResponse> WaitForCancellationAsync(
        CancellationToken cancellationToken)
    {
      Entered.TrySetResult();

      await WaitUntilCancelledAsync(
          Cancelled,
          "fetcher",
          cancellationToken);

      return Response ??
          throw new InvalidOperationException(
              "No guarded response was configured.");
    }
  }

  private sealed class RecordingBlobStore : IBlobStore
  {
    public List<PutObservation> Puts { get; } = [];

    public int PutCalls { get; private set; }

    public Exception? Failure { get; init; }

    public bool WaitForCancellation { get; init; }

    public Stream? Input { get; private set; }

    public TaskCompletionSource Entered { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public TaskCompletionSource Cancelled { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public async Task<string> PutAsync(
        string extension,
        string mimeType,
        Stream content,
        CancellationToken cancellationToken = default)
    {
      PutCalls++;
      Input = content;

      if (WaitForCancellation)
      {
        Entered.TrySetResult();
        await WaitUntilCancelledAsync(
            Cancelled,
            "store",
            cancellationToken);
      }

      using var bytes = new MemoryStream();
      await content.CopyToAsync(bytes, cancellationToken);
      Puts.Add(new PutObservation(
          extension,
          mimeType,
          bytes.ToArray()));

      if (Failure is not null)
      {
        throw Failure;
      }

      return StoredUrl;
    }

    public Task DeleteAsync(
        string url,
        CancellationToken cancellationToken = default)
    {
      throw new NotSupportedException();
    }
  }
}
