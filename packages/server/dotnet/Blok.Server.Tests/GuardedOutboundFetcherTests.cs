using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Blok.Server.Outbound;
using Xunit;

namespace Blok.Server.Tests;

public sealed class GuardedOutboundFetcherTests
{
  private static readonly GuardedFetchLimits Limits = new(
      TimeSpan.FromSeconds(2),
      1024,
      3);

  [Fact]
  public void ImplementsTheSoleGuardedFetcherInterface()
  {
    var fetcher = new GuardedOutboundFetcher();

    IGuardedOutboundFetcher contract = fetcher;

    Assert.Same(fetcher, contract);
  }

  [Fact]
  public async Task BoundsAndRedactsDnsAndTransportErrors()
  {
    var resolver = new ThrowingDnsResolver(
        new InvalidOperationException(new string('x', 10_000)));
    var fetcher = new GuardedOutboundFetcher(
        new GuardedOutboundPolicy(),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            "http://failure.example/private-path?secret=value",
            Limits,
            CancellationToken.None));

    Assert.Equal(
        GuardedFetchFailure.BlockedDestination,
        error.Failure);
    Assert.Null(error.InnerException);
    Assert.True(error.Message.Length <= 128);
    Assert.DoesNotContain(
        "failure.example",
        error.Message,
        StringComparison.Ordinal);
    Assert.DoesNotContain('x', error.Message);
  }

  [Fact]
  public async Task RejectsTheWholeDnsAnswerWhenAnyCandidateIsBlocked()
  {
    var resolver = new SequenceDnsResolver(
        [IPAddress.Parse("93.184.216.34"), IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new GuardedOutboundPolicy(),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            "http://mixed.example/",
            Limits,
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.BlockedDestination, error.Failure);
    Assert.Equal(1, resolver.CallCount);
  }

  [Fact]
  public async Task ResolvesOnceAndConnectsToTheExactFirstValidatedAddress()
  {
    await using var origin = new LoopbackOrigin();
    var resolver = new SequenceDnsResolver(
        [IPAddress.Loopback, IPAddress.Parse("127.0.0.2")],
        [IPAddress.Parse("127.0.0.2")]);
    var policy = new FixtureOutboundPolicy(
        "pinned.example",
        origin.Port,
        IPAddress.Loopback,
        IPAddress.Parse("127.0.0.2"));
    var fetcher = new GuardedOutboundFetcher(policy, resolver);

    var response = await fetcher.GetAsync(
        $"http://pinned.example:{origin.Port}/exact",
        Limits,
        CancellationToken.None);

    Assert.Equal(1, resolver.CallCount);
    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal("text/plain; charset=utf-8", response.ContentType);
    Assert.Equal(200, response.StatusCode);
    Assert.Equal(
        $"http://pinned.example:{origin.Port}/exact",
        response.FinalUrl);
    Assert.Equal($"pinned.example:{origin.Port}", origin.LastRequest?.Host);
    Assert.Equal("/exact", origin.LastRequest?.Target);
  }

  [Fact]
  public async Task PinsAnIpv6LiteralWithoutResolvingItAgain()
  {
    if (!Socket.OSSupportsIPv6)
    {
      return;
    }

    await using var origin = new LoopbackOrigin(
        IPAddress.IPv6Loopback);
    var resolver = new SequenceDnsResolver([IPAddress.IPv6Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new LiteralFixturePolicy(
            origin.Port,
            IPAddress.IPv6Loopback),
        resolver);

    var response = await fetcher.GetAsync(
        $"http://[::1]:{origin.Port}/literal",
        Limits,
        CancellationToken.None);

    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal(0, resolver.CallCount);
    Assert.Equal("/literal", origin.LastRequest?.Target);
  }

  [Fact]
  public async Task ConnectsToTheExactValidatedIpv6Candidate()
  {
    if (!Socket.OSSupportsIPv6)
    {
      return;
    }

    await using var origin = new LoopbackOrigin(
        IPAddress.IPv6Loopback);
    var resolver = new SequenceDnsResolver(
        [IPAddress.IPv6Loopback, IPAddress.Parse("::2")]);
    var policy = new FixtureOutboundPolicy(
        "ipv6-pinned.example",
        origin.Port,
        IPAddress.IPv6Loopback,
        IPAddress.Parse("::2"));
    var fetcher = new GuardedOutboundFetcher(policy, resolver);

    var response = await fetcher.GetAsync(
        $"http://ipv6-pinned.example:{origin.Port}/ipv6",
        Limits,
        CancellationToken.None);

    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal(1, resolver.CallCount);
    Assert.Equal("/ipv6", origin.LastRequest?.Target);
  }

  [Fact]
  public async Task PreservesTheHostnameForTlsSniAndCertificateValidation()
  {
    using var certificates = TestCertificates.Create("secure.example");
    await using var origin = new LoopbackOrigin(certificates.Server);
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var policy = new FixtureOutboundPolicy(
        "secure.example",
        origin.Port,
        IPAddress.Loopback);
    var fetcher = new GuardedOutboundFetcher(
        policy,
        resolver,
        new X509Certificate2Collection(certificates.Root));

    var response = await fetcher.GetAsync(
        $"https://secure.example:{origin.Port}/tls",
        Limits,
        CancellationToken.None);

    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal("secure.example", origin.LastTlsServerName);
    Assert.Equal($"secure.example:{origin.Port}", origin.LastRequest?.Host);
  }

  [Fact]
  public async Task RejectsATrustedCertificateForTheWrongHostname()
  {
    using var certificates = TestCertificates.Create("other.example");
    await using var origin = new LoopbackOrigin(certificates.Server);
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var policy = new FixtureOutboundPolicy(
        "secure.example",
        origin.Port,
        IPAddress.Loopback);
    var fetcher = new GuardedOutboundFetcher(
        policy,
        resolver,
        new X509Certificate2Collection(certificates.Root));

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"https://secure.example:{origin.Port}/",
            Limits,
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.BlockedDestination, error.Failure);
  }

  [Fact]
  public async Task RetainsNormalTlsCertificateValidation()
  {
    using var certificates = TestCertificates.Create("untrusted.example");
    await using var origin = new LoopbackOrigin(certificates.Server);
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var policy = new FixtureOutboundPolicy(
        "untrusted.example",
        origin.Port,
        IPAddress.Loopback);
    var fetcher = new GuardedOutboundFetcher(policy, resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"https://untrusted.example:{origin.Port}/",
            Limits,
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.BlockedDestination, error.Failure);
  }

  [Fact]
  public async Task ReturnsTheFinalNonSuccessStatusForTheConsumerToRefuse()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await stream.WriteAsync(
              "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 5\r\nConnection: close\r\n\r\nerror"u8.ToArray(),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "status.example");

    var response = await fetcher.GetAsync(
        $"http://status.example:{origin.Port}/error",
        Limits,
        CancellationToken.None);

    Assert.Equal(503, response.StatusCode);
    Assert.Equal("error", Encoding.UTF8.GetString(response.Body));
  }

  [Fact]
  public async Task FollowsARelativeRedirectByGetAndRevalidatesTheHop()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = request.Target == "/start"
            ? "HTTP/1.1 302 Found\r\n" +
              "Location: /final\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n"
            : "HTTP/1.1 200 OK\r\n" +
              "Content-Length: 7\r\n" +
              "Connection: close\r\n\r\n" +
              "arrived";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var resolver = new SequenceDnsResolver(
        [IPAddress.Loopback],
        [IPAddress.Loopback]);
    var policy = new FixtureOutboundPolicy(
        "redirect.example",
        origin.Port,
        IPAddress.Loopback);
    var fetcher = new GuardedOutboundFetcher(policy, resolver);

    var response = await fetcher.GetAsync(
        $"http://redirect.example:{origin.Port}/start",
        new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 1),
        CancellationToken.None);

    Assert.Equal("arrived", Encoding.UTF8.GetString(response.Body));
    Assert.Equal(
        $"http://redirect.example:{origin.Port}/final",
        response.FinalUrl);
    Assert.Equal(2, resolver.CallCount);
    Assert.Equal(2, origin.RequestCount);
    Assert.All(origin.Requests, request => Assert.Equal("GET", request.Method));
    Assert.All(
        origin.Requests,
        request => Assert.DoesNotContain(
            request.Headers.Keys,
            header => string.Equals(
                header,
                "Authorization",
                StringComparison.OrdinalIgnoreCase)));
  }

  [Theory]
  [InlineData(301)]
  [InlineData(302)]
  [InlineData(303)]
  [InlineData(307)]
  [InlineData(308)]
  public async Task KeepsGetSemanticsForEveryRedirectStatus(int status)
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = request.Target == "/start"
            ? $"HTTP/1.1 {status} Redirect\r\n" +
              "Location: /final\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n"
            : "HTTP/1.1 200 OK\r\n" +
              "Content-Length: 2\r\n" +
              "Connection: close\r\n\r\nok";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "method.example");

    var response = await fetcher.GetAsync(
        $"http://method.example:{origin.Port}/start",
        new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 1),
        CancellationToken.None);

    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal(2, origin.RequestCount);
    Assert.All(origin.Requests, request => Assert.Equal("GET", request.Method));
  }

  [Fact]
  public async Task FollowsExactlyTheConfiguredRedirectCap()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var hop = int.Parse(
              request.Target.TrimStart('/'),
              System.Globalization.CultureInfo.InvariantCulture);
          var response = hop == 2
            ? "HTTP/1.1 200 OK\r\n" +
              "Content-Length: 2\r\n" +
              "Connection: close\r\n\r\nok"
            : "HTTP/1.1 302 Found\r\n" +
              $"Location: /{hop + 1}\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            "cap.example",
            origin.Port,
            IPAddress.Loopback),
        resolver);

    var response = await fetcher.GetAsync(
        $"http://cap.example:{origin.Port}/0",
        new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 2),
        CancellationToken.None);

    Assert.Equal("ok", Encoding.UTF8.GetString(response.Body));
    Assert.Equal(3, origin.RequestCount);
    Assert.Equal(3, resolver.CallCount);
  }

  [Fact]
  public async Task RejectsTheRedirectAfterTheConfiguredCap()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = "HTTP/1.1 302 Found\r\n" +
              $"Location: /{requestCount}\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            "cap.example",
            origin.Port,
            IPAddress.Loopback),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://cap.example:{origin.Port}/0",
            new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 2),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.TooManyRedirects, error.Failure);
    Assert.Equal(3, origin.RequestCount);
    Assert.Equal(3, resolver.CallCount);
  }

  [Fact]
  public async Task RejectsCredentialsIntroducedByARedirect()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = "HTTP/1.1 302 Found\r\n" +
              $"Location: http://user:secret@{request.Host}/private\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            "redirect.example",
            origin.Port,
            IPAddress.Loopback),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://redirect.example:{origin.Port}/start",
            Limits,
            CancellationToken.None));

    Assert.Equal(
        GuardedFetchFailure.BlockedDestination,
        error.Failure);
    Assert.Equal(1, origin.RequestCount);
    Assert.Equal(1, resolver.CallCount);
  }

  [Fact]
  public async Task RejectsABlockedAddressIntroducedByARedirect()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var response = "HTTP/1.1 302 Found\r\n" +
              $"Location: http://private.example:{new Uri($"http://{request.Host}").Port}/private\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var blocked = IPAddress.Parse("127.0.0.2");
    var resolver = new SequenceDnsResolver(
        [IPAddress.Loopback],
        [blocked]);
    var fetcher = new GuardedOutboundFetcher(
        new MultiHostFixturePolicy(
            ["source.example", "private.example"],
            origin.Port,
            [IPAddress.Loopback]),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://source.example:{origin.Port}/start",
            Limits,
            CancellationToken.None));

    Assert.Equal(
        GuardedFetchFailure.BlockedDestination,
        error.Failure);
    Assert.Equal(1, origin.RequestCount);
    Assert.Equal(2, resolver.CallCount);
  }

  [Fact]
  public async Task KeepsABodyExactlyAtTheConfiguredCap()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(
                  "HTTP/1.1 200 OK\r\n" +
                  "Connection: close\r\n\r\n1234"),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "size.example");

    var response = await fetcher.GetAsync(
        $"http://size.example:{origin.Port}/exact",
        new GuardedFetchLimits(TimeSpan.FromSeconds(2), 4, 0),
        CancellationToken.None);

    Assert.Equal("1234", Encoding.UTF8.GetString(response.Body));
  }

  [Fact]
  public async Task StopsAfterOneByteBeyondTheConfiguredBodyCap()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(
                  "HTTP/1.1 200 OK\r\n" +
                  "Connection: close\r\n\r\n12345"),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "size.example");

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://size.example:{origin.Port}/oversized",
            new GuardedFetchLimits(TimeSpan.FromSeconds(2), 4, 0),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.ResponseTooLarge, error.Failure);
  }

  [Fact]
  public async Task TotalDeadlineStopsAResponseThatKeepsMakingProgress()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await stream.WriteAsync(
              "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"u8.ToArray(),
              cancellationToken);

          for (var index = 0; index < 20; index++)
          {
            await stream.WriteAsync(
                "1\r\nx\r\n"u8.ToArray(),
                cancellationToken);
            await Task.Delay(
                TimeSpan.FromMilliseconds(10),
                cancellationToken);
          }

          await stream.WriteAsync(
              "0\r\n\r\n"u8.ToArray(),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "deadline.example");

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://deadline.example:{origin.Port}/progress",
            new GuardedFetchLimits(TimeSpan.FromMilliseconds(50), 1024, 0),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.TimedOut, error.Failure);
  }

  [Fact]
  public async Task TotalDeadlineSpansTheWholeRedirectChain()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await Task.Delay(
              TimeSpan.FromMilliseconds(
                  request.Target == "/start" ? 40 : 90),
              cancellationToken);
          var response = request.Target == "/start"
            ? "HTTP/1.1 302 Found\r\n" +
              "Location: /final\r\n" +
              "Content-Length: 0\r\n" +
              "Connection: close\r\n\r\n"
            : "HTTP/1.1 200 OK\r\n" +
              "Content-Length: 2\r\n" +
              "Connection: close\r\n\r\nok";
          await stream.WriteAsync(
              Encoding.ASCII.GetBytes(response),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "deadline.example");

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://deadline.example:{origin.Port}/start",
            new GuardedFetchLimits(TimeSpan.FromMilliseconds(100), 1024, 1),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.TimedOut, error.Failure);
    Assert.Equal(2, origin.RequestCount);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(-1)]
  public async Task NonPositiveDeadlineFailsClosedBeforeDns(
      int timeoutMilliseconds)
  {
    await using var origin = new LoopbackOrigin();
    var resolver = new SequenceDnsResolver([IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            "deadline.example",
            origin.Port,
            IPAddress.Loopback),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://deadline.example:{origin.Port}/",
            new GuardedFetchLimits(
                TimeSpan.FromMilliseconds(timeoutMilliseconds),
                1024,
                0),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.TimedOut, error.Failure);
    Assert.Equal(0, resolver.CallCount);
    Assert.Equal(0, origin.RequestCount);
  }

  [Fact]
  public async Task TotalDeadlineIncludesDnsResolution()
  {
    await using var origin = new LoopbackOrigin();
    var resolver = new DelayedDnsResolver(
        TimeSpan.FromMilliseconds(150),
        [IPAddress.Loopback]);
    var fetcher = new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            "slow-dns.example",
            origin.Port,
            IPAddress.Loopback),
        resolver);

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://slow-dns.example:{origin.Port}/",
            new GuardedFetchLimits(TimeSpan.FromMilliseconds(30), 1024, 0),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.TimedOut, error.Failure);
    Assert.Equal(0, origin.RequestCount);
  }

  [Fact]
  public async Task HonorsCallerCancellationBeforeStarting()
  {
    await using var origin = new LoopbackOrigin();
    var fetcher = CreateFixtureFetcher(origin, "cancel.example");
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();

    var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(
        async () => await fetcher.GetAsync(
            $"http://cancel.example:{origin.Port}/",
            Limits,
            cancellation.Token));

    Assert.Equal(cancellation.Token, error.CancellationToken);
    Assert.Equal(0, origin.RequestCount);
  }

  [Fact]
  public async Task HonorsCallerCancellationWhileStreamingTheBody()
  {
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          await stream.WriteAsync(
              "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"u8.ToArray(),
              cancellationToken);

          for (var index = 0; index < 20; index++)
          {
            await stream.WriteAsync(
                "1\r\nx\r\n"u8.ToArray(),
                cancellationToken);
            await Task.Delay(
                TimeSpan.FromMilliseconds(10),
                cancellationToken);
          }

          await stream.WriteAsync(
              "0\r\n\r\n"u8.ToArray(),
              cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "cancel.example");
    using var cancellation = new CancellationTokenSource(
        TimeSpan.FromMilliseconds(40));

    var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(
        async () => await fetcher.GetAsync(
            $"http://cancel.example:{origin.Port}/progress",
            Limits,
            cancellation.Token));

    Assert.Equal(cancellation.Token, error.CancellationToken);
  }

  [Fact]
  public async Task AppliesTheBodyCapAfterGzipDecompression()
  {
    var compressed = Compress(Encoding.UTF8.GetBytes(
        new string('x', 1024)));
    Assert.True(compressed.Length < 64);
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          var headers = Encoding.ASCII.GetBytes(
              "HTTP/1.1 200 OK\r\n" +
              "Content-Encoding: gzip\r\n" +
              $"Content-Length: {compressed.Length}\r\n" +
              "Connection: close\r\n\r\n");
          await stream.WriteAsync(headers, cancellationToken);
          await stream.WriteAsync(compressed, cancellationToken);
        });
    var fetcher = CreateFixtureFetcher(origin, "gzip.example");

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://gzip.example:{origin.Port}/large.gz",
            new GuardedFetchLimits(TimeSpan.FromSeconds(2), 64, 0),
            CancellationToken.None));

    Assert.Equal(GuardedFetchFailure.ResponseTooLarge, error.Failure);
  }

  [Fact]
  public async Task DisposesTheResponseConnectionAfterTheSizeLimitTrips()
  {
    var disconnected = new TaskCompletionSource(
        TaskCreationOptions.RunContinuationsAsynchronously);
    await using var origin = new LoopbackOrigin(
        async (request, stream, requestCount, cancellationToken) =>
        {
          try
          {
            await stream.WriteAsync(
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"u8.ToArray(),
                cancellationToken);

            var closeProbe = stream.ReadAsync(
                new byte[1],
                cancellationToken).AsTask();

            while (!closeProbe.IsCompleted)
            {
              await stream.WriteAsync(
                  "1\r\nx\r\n"u8.ToArray(),
                  cancellationToken);
              await stream.FlushAsync(cancellationToken);
              await Task.Delay(
                  TimeSpan.FromMilliseconds(5),
                  cancellationToken);
            }

            if (await closeProbe == 0)
            {
              disconnected.TrySetResult();
            }
          }
          catch (IOException)
          {
            disconnected.TrySetResult();
          }
        });
    var fetcher = CreateFixtureFetcher(origin, "dispose.example");

    var error = await Assert.ThrowsAsync<GuardedFetchException>(
        async () => await fetcher.GetAsync(
            $"http://dispose.example:{origin.Port}/oversized",
            new GuardedFetchLimits(TimeSpan.FromSeconds(1), 4, 0),
            CancellationToken.None).AsTask().WaitAsync(
                TimeSpan.FromSeconds(2)));

    Assert.Equal(GuardedFetchFailure.ResponseTooLarge, error.Failure);
    await disconnected.Task.WaitAsync(TimeSpan.FromSeconds(2));
  }

  private static byte[] Compress(byte[] bytes)
  {
    using var output = new MemoryStream();

    using (var gzip = new GZipStream(
        output,
        CompressionLevel.SmallestSize,
        leaveOpen: true))
    {
      gzip.Write(bytes);
    }

    return output.ToArray();
  }

  private static GuardedOutboundFetcher CreateFixtureFetcher(
      LoopbackOrigin origin,
      string host)
  {
    return new GuardedOutboundFetcher(
        new FixtureOutboundPolicy(
            host,
            origin.Port,
            IPAddress.Loopback),
        new SequenceDnsResolver([IPAddress.Loopback]));
  }

  private sealed class FixtureOutboundPolicy(
      string host,
      int port,
      params IPAddress[] allowedAddresses) : IGuardedOutboundPolicy
  {
    private readonly HashSet<IPAddress> addresses = new(
        allowedAddresses);

    public GuardedTarget Validate(
        string rawUrl,
        Uri? baseUrl = null)
    {
      var parsed = baseUrl is null
        ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
        : Uri.TryCreate(baseUrl, rawUrl, out url);

      if (!parsed ||
          url is null ||
          url.Host != host ||
          url.Port != port ||
          url.UserInfo != "" ||
          (url.Scheme != Uri.UriSchemeHttp &&
           url.Scheme != Uri.UriSchemeHttps))
      {
        throw new GuardedFetchException(
            GuardedFetchFailure.BlockedDestination);
      }

      return new GuardedTarget(url, url.IdnHost, url.Port, null);
    }

    public bool IsAddressAllowed(IPAddress address)
    {
      return addresses.Contains(address);
    }
  }

  private sealed class LiteralFixturePolicy(
      int port,
      IPAddress allowedAddress) : IGuardedOutboundPolicy
  {
    public GuardedTarget Validate(
        string rawUrl,
        Uri? baseUrl = null)
    {
      var parsed = baseUrl is null
        ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
        : Uri.TryCreate(baseUrl, rawUrl, out url);

      if (!parsed ||
          url is null ||
          url.Port != port ||
          !IPAddress.TryParse(url.IdnHost, out var address))
      {
        throw new GuardedFetchException(
            GuardedFetchFailure.BlockedDestination);
      }

      return new GuardedTarget(
          url,
          url.IdnHost,
          url.Port,
          address);
    }

    public bool IsAddressAllowed(IPAddress address)
    {
      return address.Equals(allowedAddress);
    }
  }

  private sealed class MultiHostFixturePolicy(
      IEnumerable<string> hosts,
      int port,
      IEnumerable<IPAddress> allowedAddresses) : IGuardedOutboundPolicy
  {
    private readonly HashSet<IPAddress> addresses = new(
        allowedAddresses);
    private readonly HashSet<string> hostNames = new(
        hosts,
        StringComparer.OrdinalIgnoreCase);

    public GuardedTarget Validate(
        string rawUrl,
        Uri? baseUrl = null)
    {
      var parsed = baseUrl is null
        ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
        : Uri.TryCreate(baseUrl, rawUrl, out url);

      if (!parsed ||
          url is null ||
          !hostNames.Contains(url.Host) ||
          url.Port != port ||
          url.UserInfo != "" ||
          (url.Scheme != Uri.UriSchemeHttp &&
           url.Scheme != Uri.UriSchemeHttps))
      {
        throw new GuardedFetchException(
            GuardedFetchFailure.BlockedDestination);
      }

      return new GuardedTarget(url, url.IdnHost, url.Port, null);
    }

    public bool IsAddressAllowed(IPAddress address)
    {
      return addresses.Contains(address);
    }
  }

  private sealed class DelayedDnsResolver(
      TimeSpan delay,
      IPAddress[] answer) : IGuardedDnsResolver
  {
    public async ValueTask<IPAddress[]> ResolveAsync(
        string host,
        CancellationToken cancellationToken)
    {
      _ = host;
      await Task.Delay(delay, cancellationToken);

      return answer;
    }
  }

  private sealed class ThrowingDnsResolver(
      Exception error) : IGuardedDnsResolver
  {
    public ValueTask<IPAddress[]> ResolveAsync(
        string host,
        CancellationToken cancellationToken)
    {
      _ = host;
      cancellationToken.ThrowIfCancellationRequested();

      return ValueTask.FromException<IPAddress[]>(error);
    }
  }

  private sealed class SequenceDnsResolver(
      params IPAddress[][] answers) : IGuardedDnsResolver
  {
    private int callCount;

    internal int CallCount => Volatile.Read(ref callCount);

    public ValueTask<IPAddress[]> ResolveAsync(
        string host,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var call = Interlocked.Increment(ref callCount);
      var answer = answers[Math.Min(call - 1, answers.Length - 1)];

      return ValueTask.FromResult(answer);
    }
  }

  private sealed class LoopbackOrigin : IAsyncDisposable
  {
    private const string OkResponse =
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        "Content-Length: 2\r\n" +
        "Connection: close\r\n\r\n" +
        "ok";

    private readonly X509Certificate2? certificate;
    private readonly ConcurrentBag<Task> connections = new();
    private readonly ConcurrentQueue<WireRequest> requests = new();
    private readonly Func<
        WireRequest,
        Stream,
        int,
        CancellationToken,
        Task> respond;
    private readonly CancellationTokenSource stopping = new();
    private readonly TcpListener listener;
    private readonly Task worker;
    private WireRequest? lastRequest;
    private string? lastTlsServerName;
    private int requestCount;

    internal LoopbackOrigin(X509Certificate2? certificate = null) :
        this(DefaultRespondAsync, certificate, IPAddress.Loopback)
    {
    }

    internal LoopbackOrigin(IPAddress listenAddress) :
        this(DefaultRespondAsync, certificate: null, listenAddress)
    {
    }

    internal LoopbackOrigin(
        Func<WireRequest, Stream, int, CancellationToken, Task> respond,
        X509Certificate2? certificate = null) :
        this(respond, certificate, IPAddress.Loopback)
    {
    }

    private LoopbackOrigin(
        Func<WireRequest, Stream, int, CancellationToken, Task> respond,
        X509Certificate2? certificate,
        IPAddress listenAddress)
    {
      this.certificate = certificate;
      this.respond = respond;
      listener = new TcpListener(listenAddress, 0);
      listener.Start();
      Port = ((IPEndPoint)listener.LocalEndpoint).Port;
      worker = ServeAsync();
    }

    internal WireRequest? LastRequest => Volatile.Read(ref lastRequest);

    internal string? LastTlsServerName => Volatile.Read(
        ref lastTlsServerName);

    internal int Port { get; }

    internal int RequestCount => Volatile.Read(ref requestCount);

    internal IReadOnlyList<WireRequest> Requests => [.. requests];

    public async ValueTask DisposeAsync()
    {
      stopping.Cancel();
      listener.Stop();

      try
      {
        await worker.WaitAsync(TimeSpan.FromSeconds(5));
      }
      catch (Exception error) when (
          error is OperationCanceledException or
              SocketException or ObjectDisposedException)
      {
      }

      await Task.WhenAll(connections).WaitAsync(
          TimeSpan.FromSeconds(5));
      stopping.Dispose();
    }

    private async Task ServeAsync()
    {
      while (!stopping.IsCancellationRequested)
      {
        TcpClient client;

        try
        {
          client = await listener.AcceptTcpClientAsync(stopping.Token);
        }
        catch (Exception error) when (
            error is OperationCanceledException or
                SocketException or ObjectDisposedException)
        {
          return;
        }

        connections.Add(ServeConnectionAsync(client));
      }
    }

    private async Task ServeConnectionAsync(TcpClient client)
    {
      using (client)
      {
        await using var network = client.GetStream();
        Stream stream = network;
        SslStream? tls = null;

        try
        {
          if (certificate is not null)
          {
            tls = new SslStream(network, leaveInnerStreamOpen: true);
            await tls.AuthenticateAsServerAsync(
                new SslServerAuthenticationOptions
                {
                  ServerCertificate = certificate,
                  EnabledSslProtocols =
                      SslProtocols.Tls12 | SslProtocols.Tls13,
                },
                stopping.Token);
            Volatile.Write(
                ref lastTlsServerName,
                tls.TargetHostName);
            stream = tls;
          }

          var request = await WireRequest.ReadAsync(
              stream,
              stopping.Token);
          Volatile.Write(ref lastRequest, request);
          requests.Enqueue(request);
          var count = Interlocked.Increment(ref requestCount);
          await respond(
              request,
              stream,
              count,
              stopping.Token);
        }
        catch (Exception error) when (
            error is AuthenticationException or IOException or
                OperationCanceledException or SocketException)
        {
        }
        finally
        {
          if (tls is not null)
          {
            await tls.DisposeAsync();
          }
        }
      }
    }

    private static Task DefaultRespondAsync(
        WireRequest request,
        Stream stream,
        int requestCount,
        CancellationToken cancellationToken)
    {
      _ = request;
      _ = requestCount;

      return stream.WriteAsync(
          Encoding.ASCII.GetBytes(OkResponse),
          cancellationToken).AsTask();
    }
  }

  private sealed record WireRequest(
      string Method,
      string Target,
      IReadOnlyDictionary<string, string> Headers)
  {
    internal string Host => Headers["Host"];

    internal static async Task<WireRequest> ReadAsync(
        Stream stream,
        CancellationToken cancellationToken)
    {
      var bytes = new List<byte>();

      while (!EndsWithHeaders(bytes))
      {
        var next = new byte[1];
        var read = await stream.ReadAsync(next, cancellationToken);

        if (read == 0)
        {
          throw new IOException("Request ended before its headers.");
        }

        bytes.Add(next[0]);

        if (bytes.Count > 64 * 1024)
        {
          throw new IOException("Request headers exceeded the fixture cap.");
        }
      }

      var lines = Encoding.ASCII.GetString([.. bytes]).Split(
          "\r\n",
          StringSplitOptions.None);
      var requestLine = lines[0].Split(' ');
      var headers = new Dictionary<string, string>(
          StringComparer.OrdinalIgnoreCase);

      foreach (var line in lines.Skip(1))
      {
        var separator = line.IndexOf(':');

        if (separator > 0)
        {
          headers[line[..separator]] = line[(separator + 1)..].Trim();
        }
      }

      return new WireRequest(
          requestLine[0],
          requestLine[1],
          headers);
    }

    private static bool EndsWithHeaders(IReadOnlyList<byte> bytes)
    {
      return bytes.Count >= 4 &&
          bytes[^4] == '\r' &&
          bytes[^3] == '\n' &&
          bytes[^2] == '\r' &&
          bytes[^1] == '\n';
    }
  }

  private sealed class TestCertificates(
      X509Certificate2 root,
      X509Certificate2 server) : IDisposable
  {
    internal X509Certificate2 Root { get; } = root;

    internal X509Certificate2 Server { get; } = server;

    internal static TestCertificates Create(string host)
    {
      using var rootKey = RSA.Create(2048);
      var rootRequest = new CertificateRequest(
          "CN=Blok Guarded Fetch Test Root",
          rootKey,
          HashAlgorithmName.SHA256,
          RSASignaturePadding.Pkcs1);
      rootRequest.CertificateExtensions.Add(
          new X509BasicConstraintsExtension(
              certificateAuthority: true,
              hasPathLengthConstraint: false,
              pathLengthConstraint: 0,
              critical: true));
      rootRequest.CertificateExtensions.Add(
          new X509KeyUsageExtension(
              X509KeyUsageFlags.KeyCertSign |
                  X509KeyUsageFlags.CrlSign,
              critical: true));
      using var generatedRoot = rootRequest.CreateSelfSigned(
          DateTimeOffset.UtcNow.AddMinutes(-5),
          DateTimeOffset.UtcNow.AddDays(1));
      var root = X509CertificateLoader.LoadPkcs12(
          generatedRoot.Export(X509ContentType.Pfx),
          password: null);

      using var serverKey = RSA.Create(2048);
      var serverRequest = new CertificateRequest(
          $"CN={host}",
          serverKey,
          HashAlgorithmName.SHA256,
          RSASignaturePadding.Pkcs1);
      serverRequest.CertificateExtensions.Add(
          new X509BasicConstraintsExtension(
              certificateAuthority: false,
              hasPathLengthConstraint: false,
              pathLengthConstraint: 0,
              critical: true));
      serverRequest.CertificateExtensions.Add(
          new X509KeyUsageExtension(
              X509KeyUsageFlags.DigitalSignature |
                  X509KeyUsageFlags.KeyEncipherment,
              critical: true));
      serverRequest.CertificateExtensions.Add(
          new X509EnhancedKeyUsageExtension(
              [new Oid("1.3.6.1.5.5.7.3.1")],
              critical: true));
      var names = new SubjectAlternativeNameBuilder();
      names.AddDnsName(host);
      serverRequest.CertificateExtensions.Add(names.Build());
      using var issuedServer = serverRequest.Create(
          root,
          DateTimeOffset.UtcNow.AddMinutes(-5),
          DateTimeOffset.UtcNow.AddHours(12),
          RandomNumberGenerator.GetBytes(16));
      using var serverWithKey =
          issuedServer.CopyWithPrivateKey(serverKey);
      var server = X509CertificateLoader.LoadPkcs12(
          serverWithKey.Export(X509ContentType.Pfx),
          password: null);

      return new TestCertificates(root, server);
    }

    public void Dispose()
    {
      Server.Dispose();
      Root.Dispose();
    }
  }
}
