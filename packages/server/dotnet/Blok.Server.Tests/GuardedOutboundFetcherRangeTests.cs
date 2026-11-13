using System.Net;
using System.Text;
using Blok.Server.Outbound;
using Xunit;

namespace Blok.Server.Tests;

public sealed partial class GuardedOutboundFetcherTests
{
  [Fact]
  public async Task SendsTheRangeOnEveryHop()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = request.Target == "/start"
            ? "HTTP/1.1 302 Found\r\n" +
              "Location: /final\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n"
            : "HTTP/1.1 206 Partial Content\r\n" +
              "Content-Range: bytes 5-9/20\r\n" +
              "Content-Length: 5\r\n" +
              "Connection: close\r\n\r\n" +
              "56789";
          await stream.WriteAsync(Encoding.ASCII.GetBytes(response), cancellationToken);
        });
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy("pdf.example", origin.Port, IPAddress.Loopback),
        new SequenceDnsResolver([IPAddress.Loopback], [IPAddress.Loopback]));

    await using var response = await fetcher.GetAsync(
        $"http://pdf.example:{origin.Port}/start",
        Limits with { Range = new GuardedByteRange(5, 9) },
        CancellationToken.None);

    Assert.Equal(206, response.StatusCode);
    Assert.Equal("56789", Encoding.ASCII.GetString(response.Body.Span));
    Assert.Equal($"http://pdf.example:{origin.Port}/final", response.FinalUrl);
    Assert.Equal(
        ["/start bytes=5-9", "/final bytes=5-9"],
        origin.Requests.Select(request => $"{request.Target} {request.Headers.GetValueOrDefault("Range")}"));
  }

  [Fact]
  public async Task AnOpenRangeHasNoEnd()
  {
    await using var origin = new LoopbackOrigin();
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy("pdf.example", origin.Port, IPAddress.Loopback),
        new SequenceDnsResolver([IPAddress.Loopback]));

    await using var response = await fetcher.GetAsync(
        $"http://pdf.example:{origin.Port}/doc.pdf",
        Limits with { Range = new GuardedByteRange(1400, -1) },
        CancellationToken.None);

    Assert.Equal("bytes=1400-", origin.LastRequest?.Headers.GetValueOrDefault("Range"));
  }

  [Fact]
  public async Task SendsNoRangeUnlessAsked()
  {
    await using var origin = new LoopbackOrigin();
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy("pdf.example", origin.Port, IPAddress.Loopback),
        new SequenceDnsResolver([IPAddress.Loopback]));

    await using var response = await fetcher.GetAsync(
        $"http://pdf.example:{origin.Port}/doc.pdf",
        Limits,
        CancellationToken.None);

    Assert.NotNull(origin.LastRequest);
    Assert.False(origin.LastRequest.Headers.ContainsKey("Range"));
  }
}
