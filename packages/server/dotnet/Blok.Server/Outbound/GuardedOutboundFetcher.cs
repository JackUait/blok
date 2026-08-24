using System.IO.Compression;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;

namespace Blok.Server.Outbound;

internal readonly record struct GuardedFetchLimits(
    TimeSpan TotalTimeout,
    long MaximumResponseBytes,
    int MaximumRedirects);

internal sealed record GuardedResponse(
    byte[] Body,
    string ContentType,
    string FinalUrl,
    int StatusCode);

internal interface IGuardedOutboundFetcher
{
  ValueTask<GuardedResponse> GetAsync(
      string rawUrl,
      GuardedFetchLimits limits,
      CancellationToken cancellationToken);
}

internal interface IGuardedDnsResolver
{
  ValueTask<IPAddress[]> ResolveAsync(
      string host,
      CancellationToken cancellationToken);
}

internal sealed class GuardedOutboundFetcher : IGuardedOutboundFetcher
{
  private const string UserAgent =
      "blok-server (+https://blokeditor.com)";

  private readonly X509Certificate2Collection? customTrustRoots;
  private readonly IGuardedDnsResolver resolver;
  private readonly IGuardedOutboundPolicy policy;

  internal GuardedOutboundFetcher() :
      this(new GuardedOutboundPolicy())
  {
  }

  internal GuardedOutboundFetcher(
      IGuardedOutboundPolicy policy) :
      this(policy, new SystemDnsResolver())
  {
  }

  internal GuardedOutboundFetcher(
      IGuardedOutboundPolicy policy,
      IGuardedDnsResolver resolver,
      X509Certificate2Collection? customTrustRoots = null)
  {
    ArgumentNullException.ThrowIfNull(policy);
    ArgumentNullException.ThrowIfNull(resolver);

    this.policy = policy;
    this.resolver = resolver;
    this.customTrustRoots = customTrustRoots;
  }

  public async ValueTask<GuardedResponse> GetAsync(
      string rawUrl,
      GuardedFetchLimits limits,
      CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    ValidateLimits(limits);
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);
    if (limits.TotalTimeout > TimeSpan.Zero)
    {
      deadline.CancelAfter(limits.TotalTimeout);
    }
    else
    {
      deadline.Cancel();
    }

    try
    {
      return await GetCoreAsync(
          rawUrl,
          limits,
          deadline.Token);
    }
    catch (GuardedFetchException)
    {
      throw;
    }
    catch (OperationCanceledException) when (
        cancellationToken.IsCancellationRequested)
    {
      throw new OperationCanceledException(cancellationToken);
    }
    catch (OperationCanceledException) when (
        deadline.IsCancellationRequested)
    {
      throw new GuardedFetchException(
          GuardedFetchFailure.TimedOut);
    }
    catch
    {
      throw Blocked();
    }
  }

  private async ValueTask<GuardedResponse> GetCoreAsync(
      string rawUrl,
      GuardedFetchLimits limits,
      CancellationToken cancellationToken)
  {
    var redirects = 0;

    while (true)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var target = policy.Validate(rawUrl);
      var addresses = target.LiteralAddress is null
        ? await resolver.ResolveAsync(
            target.Host,
            cancellationToken)
        : [target.LiteralAddress];

      if (addresses.Length == 0 ||
          addresses.Any(address => !policy.IsAddressAllowed(address)))
      {
        throw Blocked();
      }

      var useManagedTls = UsesManagedTls(target);
      using var handler = CreateHandler(
          target,
          addresses[0],
          useManagedTls);
      using var client = new HttpClient(
          handler,
          disposeHandler: false)
      {
        Timeout = Timeout.InfiniteTimeSpan,
      };
      using var request = new HttpRequestMessage(
          HttpMethod.Get,
          useManagedTls
            ? CreateManagedTlsTransportUrl(target)
            : target.Url);
      if (useManagedTls)
      {
        request.Headers.Host = CreateHostHeader(target);
      }
      request.Headers.TryAddWithoutValidation(
          "User-Agent",
          UserAgent);
      using var response = await client.SendAsync(
          request,
          HttpCompletionOption.ResponseHeadersRead,
          cancellationToken);

      if (IsRedirect(response.StatusCode) &&
          response.Headers.Location is Uri location)
      {
        if (redirects >= limits.MaximumRedirects)
        {
          throw new GuardedFetchException(
              GuardedFetchFailure.TooManyRedirects);
        }

        var redirect = policy.Validate(
            location.OriginalString,
            target.Url);
        rawUrl = redirect.Url.AbsoluteUri;
        redirects++;
        continue;
      }

      var body = await ReadBoundedAsync(
          response.Content,
          limits.MaximumResponseBytes,
          cancellationToken);

      return new GuardedResponse(
          body,
          response.Content?.Headers.ContentType?.ToString() ?? "",
          target.Url.AbsoluteUri,
          (int)response.StatusCode);
    }
  }

  private static bool IsRedirect(HttpStatusCode statusCode)
  {
    return statusCode is
        HttpStatusCode.MovedPermanently or
        HttpStatusCode.Found or
        HttpStatusCode.SeeOther or
        HttpStatusCode.TemporaryRedirect or
        HttpStatusCode.PermanentRedirect;
  }

  private static async ValueTask<byte[]> ReadBoundedAsync(
      HttpContent? content,
      long maximumBytes,
      CancellationToken cancellationToken)
  {
    if (content is null)
    {
      return [];
    }

    if (content.Headers.ContentLength is long contentLength &&
        contentLength > maximumBytes)
    {
      throw ResponseTooLarge();
    }

    await using var raw = await content.ReadAsStreamAsync(
        cancellationToken);
    var boundedRaw = new BoundedReadStream(
        raw,
        maximumBytes);
    if (!IsGzip(content))
    {
      return await ReadDecodedAsync(
          boundedRaw,
          maximumBytes,
          cancellationToken);
    }

    byte[] body;
    await using (var gzip = new GZipStream(
        boundedRaw,
        CompressionMode.Decompress,
        leaveOpen: true))
    {
      body = await ReadDecodedAsync(
          gzip,
          maximumBytes,
          cancellationToken);
    }

    await DrainAsync(
        boundedRaw,
        cancellationToken);
    return body;
  }

  private static bool IsGzip(HttpContent content)
  {
    return content.Headers.ContentEncoding.Count == 1 &&
        string.Equals(
            content.Headers.ContentEncoding.Single(),
            "gzip",
            StringComparison.OrdinalIgnoreCase);
  }

  private static async ValueTask<byte[]> ReadDecodedAsync(
      Stream stream,
      long maximumBytes,
      CancellationToken cancellationToken)
  {
    var initialCapacity = checked((int)Math.Min(maximumBytes, 81920));
    using var output = new MemoryStream(initialCapacity);
    var bufferLength = checked((int)Math.Min(maximumBytes + 1, 81920));
    var buffer = new byte[Math.Max(bufferLength, 1)];
    long total = 0;

    while (true)
    {
      cancellationToken.ThrowIfCancellationRequested();
      var remaining = maximumBytes - total;
      var readLength = remaining >= buffer.Length
        ? buffer.Length
        : checked((int)remaining + 1);
      var read = await stream.ReadAsync(
          buffer.AsMemory(0, readLength),
          cancellationToken);

      if (read == 0)
      {
        return output.ToArray();
      }

      if (read > remaining)
      {
        throw ResponseTooLarge();
      }

      output.Write(buffer, 0, read);
      total += read;
    }
  }

  private static async ValueTask DrainAsync(
      Stream stream,
      CancellationToken cancellationToken)
  {
    var buffer = new byte[81920];

    while (await stream.ReadAsync(buffer, cancellationToken) != 0)
    {
    }
  }

  private static void ValidateLimits(GuardedFetchLimits limits)
  {
    if (limits.MaximumResponseBytes < 0 ||
        limits.MaximumResponseBytes > Array.MaxLength)
    {
      throw new ArgumentOutOfRangeException(
          nameof(limits),
          "The response byte limit is outside the supported range.");
    }

    if (limits.MaximumRedirects < 0)
    {
      throw new ArgumentOutOfRangeException(
          nameof(limits),
          "The redirect limit cannot be negative.");
    }
  }

  private SocketsHttpHandler CreateHandler(
      GuardedTarget target,
      IPAddress address,
      bool useManagedTls)
  {
    var handler = new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      AutomaticDecompression = DecompressionMethods.None,
      ConnectCallback = (context, cancellationToken) =>
          ConnectAsync(
              context,
              target,
              address,
              useManagedTls,
              cancellationToken),
      MaxResponseDrainSize = 0,
      UseCookies = false,
      UseProxy = false,
    };

    if (target.Url.Scheme == Uri.UriSchemeHttps &&
        !useManagedTls)
    {
      handler.SslOptions = CreateTlsOptions(target);
    }

    return handler;
  }

  private static bool UsesManagedTls(GuardedTarget target)
  {
    return OperatingSystem.IsMacOS() &&
        target.Url.Scheme == Uri.UriSchemeHttps;
  }

  private static Uri CreateManagedTlsTransportUrl(
      GuardedTarget target)
  {
    return new UriBuilder(target.Url)
    {
      Scheme = Uri.UriSchemeHttp,
      Port = target.Port,
    }.Uri;
  }

  private static string CreateHostHeader(
      GuardedTarget target)
  {
    var host = target.LiteralAddress?.AddressFamily ==
        AddressFamily.InterNetworkV6
      ? $"[{target.Host.Trim('[', ']')}]"
      : target.Host;

    return target.Url.IsDefaultPort
      ? host
      : $"{host}:{target.Port}";
  }

  private SslClientAuthenticationOptions CreateTlsOptions(
      GuardedTarget target)
  {
    var chainPolicy = new X509ChainPolicy
    {
      DisableCertificateDownloads = true,
      RevocationMode = X509RevocationMode.NoCheck,
    };

    if (customTrustRoots is not null)
    {
      chainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
      chainPolicy.CustomTrustStore.AddRange(customTrustRoots);
    }

    return new SslClientAuthenticationOptions
    {
      CertificateChainPolicy = chainPolicy,
      CertificateRevocationCheckMode = X509RevocationMode.NoCheck,
      TargetHost = target.Host,
    };
  }

  private static bool MatchesTarget(
      DnsEndPoint endpoint,
      GuardedTarget target)
  {
    if (endpoint.Port != target.Port)
    {
      return false;
    }

    if (target.LiteralAddress is null)
    {
      return string.Equals(
          endpoint.Host,
          target.Host,
          StringComparison.OrdinalIgnoreCase);
    }

    return IPAddress.TryParse(
          endpoint.Host.Trim('[', ']'),
          out var endpointAddress) &&
        endpointAddress.Equals(target.LiteralAddress);
  }

  private async ValueTask<Stream> ConnectAsync(
      SocketsHttpConnectionContext context,
      GuardedTarget target,
      IPAddress address,
      bool useManagedTls,
      CancellationToken cancellationToken)
  {
    if (!MatchesTarget(context.DnsEndPoint, target))
    {
      throw new SocketException(
          (int)SocketError.AccessDenied);
    }

    var socket = new Socket(
        address.AddressFamily,
        SocketType.Stream,
        ProtocolType.Tcp);

    try
    {
      await socket.ConnectAsync(
          new IPEndPoint(address, target.Port),
          cancellationToken);
      var network = new NetworkStream(
          socket,
          ownsSocket: true);

      return useManagedTls
        ? await MacOsTlsTransport.AuthenticateAsync(
            network,
            target.Host,
            customTrustRoots,
            cancellationToken)
        : network;
    }
    catch
    {
      socket.Dispose();
      throw;
    }
  }

  private static GuardedFetchException Blocked()
  {
    return new GuardedFetchException(
        GuardedFetchFailure.BlockedDestination);
  }

  private static GuardedFetchException ResponseTooLarge()
  {
    return new GuardedFetchException(
        GuardedFetchFailure.ResponseTooLarge);
  }

  private sealed class BoundedReadStream(
      Stream inner,
      long maximumBytes) : Stream
  {
    private long total;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length =>
        throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
      inner.Flush();
    }

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      var read = inner.Read(
          buffer,
          offset,
          LimitReadLength(count));
      Count(read);
      return read;
    }

    public override int Read(Span<byte> buffer)
    {
      var read = inner.Read(
          buffer[..LimitReadLength(buffer.Length)]);
      Count(read);
      return read;
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

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      var read = await inner.ReadAsync(
          buffer[..LimitReadLength(buffer.Length)],
          cancellationToken);
      Count(read);
      return read;
    }

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

    private int LimitReadLength(int requested)
    {
      if (requested == 0)
      {
        return 0;
      }

      var remaining = maximumBytes - total;
      return checked((int)Math.Min(requested, remaining + 1));
    }

    private void Count(int read)
    {
      total += read;
      if (total > maximumBytes)
      {
        throw ResponseTooLarge();
      }
    }
  }

  private sealed class SystemDnsResolver : IGuardedDnsResolver
  {
    public async ValueTask<IPAddress[]> ResolveAsync(
        string host,
        CancellationToken cancellationToken)
    {
      return await Dns.GetHostAddressesAsync(
          host,
          cancellationToken);
    }
  }
}
