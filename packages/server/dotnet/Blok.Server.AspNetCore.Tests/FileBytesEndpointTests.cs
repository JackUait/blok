using System.Net;
using System.Text;
using Blok.Server.Outbound;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

// The shared fixture (file-bytes-responses.json) runs the server as a
// process; these cover what a process run cannot: the clock, the cache size,
// the answer cap and when the fetch slot is freed.
public sealed class FileBytesEndpointTests
{
  private const string Target = "https://pdf.example/doc.pdf";

  private static byte[] TestPdf(int size)
  {
    return Encoding.ASCII.GetBytes(("%PDF-1.7" + new string('x', size))[..size]);
  }

  [Fact]
  public void FileBytesAndFilesCorsAreOffByDefault()
  {
    var options = new BlokServerOptions();

    Assert.False(options.FileBytesEnabled);
    Assert.False(options.FilesCors);
    Assert.Equal(100L << 20, options.FileBytesMaxBytes);
  }

  [Fact]
  public void RefusesACapBelowOneByte()
  {
    var options = new BlokServerOptions { FileBytesEnabled = true, FileBytesMaxBytes = 0 };

    var error = Assert.Throws<InvalidOperationException>(options.Validate);
    Assert.Equal("FileBytesMaxBytes must be a positive number of bytes (got 0)", error.Message);
  }

  [Fact]
  public async Task TheRouteIsNotMappedWhenOff()
  {
    var origin = new PdfOrigin(TestPdf(1500));
    await using var app = await StartAsync(origin, enabled: false);

    using var response = await app.GetTestClient().GetAsync(FileBytesPath(Target));

    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    Assert.Empty(origin.Ranges);
  }

  [Fact]
  public async Task ChecksAUrlAgainAfterTenMinutes()
  {
    var origin = new PdfOrigin(TestPdf(1500));
    var clock = new ManualTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
    await using var app = await StartAsync(origin, clock: clock);
    using var client = app.GetTestClient();
    async Task Middle()
    {
      using var response = await GetAsync(client, "bytes=1000-1099");
      Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
    }

    await Middle();
    await Middle();
    clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(1));
    await Middle();
    clock.Advance(TimeSpan.FromSeconds(1));
    await Middle();

    Assert.Equal(
        [
          "bytes=1000-1099", "bytes=0-1023",
          "bytes=1000-1099",
          "bytes=1000-1099",
          "bytes=1000-1099", "bytes=0-1023",
        ],
        origin.Ranges);
  }

  [Fact]
  public void PdfCheckCacheForgetsTheLeastRecentlyUsed()
  {
    var cache = new PdfCheckCache(TimeProvider.System);

    for (var i = 0; i < 256; i++)
    {
      cache.Add(i.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    Assert.True(cache.Has("0"));
    cache.Add("256");
    Assert.False(cache.Has("1"));
    Assert.True(cache.Has("0"));
    Assert.True(cache.Has("2"));
    Assert.True(cache.Has("256"));
  }

  // A body sent with no length is measured after it is read.
  [Fact]
  public async Task RefusesABodyOverTheCap()
  {
    var origin = new PdfOrigin(TestPdf(3000), ranges: false);
    await using var app = await StartAsync(origin, maxBytes: 2048);

    using var response = await GetAsync(app.GetTestClient(), null);

    Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    Assert.Equal("file too large\n", await response.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task ServesABodyUnderTheCap()
  {
    var origin = new PdfOrigin(TestPdf(1500), ranges: false);
    await using var app = await StartAsync(origin, maxBytes: 2048);

    using var response = await GetAsync(app.GetTestClient(), null);

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal(TestPdf(1500), await response.Content.ReadAsByteArrayAsync());
  }

  [Fact]
  public async Task AnswersAtMostOneMebibyte()
  {
    var origin = new PdfOrigin(TestPdf((1 << 20) + 1));
    await using var app = await StartAsync(origin);
    using var client = app.GetTestClient();

    using (var range = await GetAsync(client, "bytes=0-1048575"))
    {
      Assert.Equal(HttpStatusCode.PartialContent, range.StatusCode);
      Assert.Equal(1 << 20, (await range.Content.ReadAsByteArrayAsync()).Length);
    }

    using var whole = await GetAsync(client, null);
    Assert.Equal(HttpStatusCode.RequestEntityTooLarge, whole.StatusCode);
    Assert.Equal("range too large\n", await whole.Content.ReadAsStringAsync());
  }

  // A client that stops reading must not keep an outbound slot: the answer
  // is read whole, the slot freed, and only then written.
  [Fact]
  public async Task FreesItsFetchSlotBeforeWritingToTheClient()
  {
    using var permit = new SemaphoreSlim(0, 1);
    var origin = new PdfOrigin(TestPdf(1500)) { Permit = permit };
    int? slotsFreeAtFirstWrite = null;
    await using var app = await StartAsync(
        origin,
        firstWrite: () => slotsFreeAtFirstWrite ??= permit.CurrentCount);

    using var response = await GetAsync(app.GetTestClient(), "bytes=0-99");

    Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
    Assert.Equal(1, slotsFreeAtFirstWrite);
  }

  private static string FileBytesPath(string target)
  {
    return "/file-bytes?url=" + Uri.EscapeDataString(target);
  }

  private static Task<HttpResponseMessage> GetAsync(HttpClient client, string? range)
  {
    var request = new HttpRequestMessage(HttpMethod.Get, FileBytesPath(Target));
    if (range is not null)
    {
      request.Headers.TryAddWithoutValidation("Range", range);
    }

    return client.SendAsync(request);
  }

  private static async Task<WebApplication> StartAsync(
      IGuardedOutboundFetcher fetcher,
      bool enabled = true,
      long? maxBytes = null,
      TimeProvider? clock = null,
      Action? firstWrite = null)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(fetcher);
    if (clock is not null)
    {
      builder.Services.AddSingleton(clock);
    }

    builder.Services.AddBlokServer(options =>
    {
      options.StorageDirectory = "";
      options.FileBytesEnabled = enabled;
      if (maxBytes is { } cap)
      {
        options.FileBytesMaxBytes = cap;
      }
    });

    var app = builder.Build();
    if (firstWrite is not null)
    {
      app.Use(async (context, next) =>
      {
        context.Response.Body = new FirstWriteStream(context.Response.Body, firstWrite);
        await next(context);
      });
    }

    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  // Serves one PDF for every url, with one-range support unless ranges is
  // false, as the guarded fetcher would hand it over.
  private sealed class PdfOrigin(byte[] body, bool ranges = true) : IGuardedOutboundFetcher
  {
    private readonly Lock gate = new();
    private readonly List<string> seen = [];
    private readonly List<GuardedFetchLimits> limits = [];

    public SemaphoreSlim? Permit { get; init; }

    public IReadOnlyList<string> Ranges
    {
      get
      {
        lock (gate)
        {
          return [.. seen];
        }
      }
    }

    public IReadOnlyList<GuardedFetchLimits> Limits
    {
      get
      {
        lock (gate)
        {
          return [.. limits];
        }
      }
    }

    public ValueTask<GuardedResponse> GetAsync(
        string rawUrl,
        GuardedFetchLimits fetchLimits,
        CancellationToken cancellationToken)
    {
      lock (gate)
      {
        seen.Add(fetchLimits.Range?.HeaderValue ?? "");
        limits.Add(fetchLimits);
      }

      var headers = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
      var status = StatusCodes.Status200OK;
      var slice = body.AsMemory();
      if (ranges && fetchLimits.Range is { } range)
      {
        var end = range.End < 0 ? body.Length - 1 : Math.Min(range.End, body.Length - 1);
        slice = body.AsMemory((int)range.Start, (int)(end - range.Start + 1));
        headers["Content-Range"] = [$"bytes {range.Start}-{end}/{body.Length}"];
        status = StatusCodes.Status206PartialContent;
      }

      if (slice.Length > fetchLimits.MaximumResponseBytes)
      {
        if (!fetchLimits.TruncateBody)
        {
          throw new GuardedFetchException(GuardedFetchFailure.ResponseTooLarge);
        }

        slice = slice[..(int)fetchLimits.MaximumResponseBytes];
      }

      return ValueTask.FromResult(new GuardedResponse(
          slice, "application/pdf", rawUrl, status, Permit, headers));
    }
  }

  private sealed class FirstWriteStream(Stream inner, Action firstWrite) : Stream
  {
    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
      inner.Flush();
    }

    public override Task FlushAsync(CancellationToken cancellationToken)
    {
      return inner.FlushAsync(cancellationToken);
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
      throw new NotSupportedException();
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
      firstWrite();
      inner.Write(buffer, offset, count);
    }

    public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
      firstWrite();
      return inner.WriteAsync(buffer, cancellationToken);
    }
  }

  private sealed class ManualTimeProvider(DateTimeOffset utcNow) : TimeProvider
  {
    private DateTimeOffset now = utcNow;

    public override DateTimeOffset GetUtcNow()
    {
      return now;
    }

    public void Advance(TimeSpan duration)
    {
      now += duration;
    }
  }
}
