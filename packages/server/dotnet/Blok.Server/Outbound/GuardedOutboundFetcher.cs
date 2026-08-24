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
      this(new GuardedOutboundPolicy(), new SystemDnsResolver())
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

      using var handler = CreateHandler(target, addresses[0]);
      using var client = new HttpClient(
          handler,
          disposeHandler: false)
      {
        Timeout = Timeout.InfiniteTimeSpan,
      };
      using var request = new HttpRequestMessage(
          HttpMethod.Get,
          target.Url);
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
      throw new GuardedFetchException(
          GuardedFetchFailure.ResponseTooLarge);
    }

    await using var stream = await content.ReadAsStreamAsync(
        cancellationToken);
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
        throw new GuardedFetchException(
            GuardedFetchFailure.ResponseTooLarge);
      }

      output.Write(buffer, 0, read);
      total += read;
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
      IPAddress address)
  {
    var handler = new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      AutomaticDecompression = DecompressionMethods.GZip,
      ConnectCallback = (context, cancellationToken) =>
          ConnectAsync(
              context,
              target,
              address,
              cancellationToken),
      MaxResponseDrainSize = 0,
      UseCookies = false,
      UseProxy = false,
    };

    if (customTrustRoots is not null)
    {
      var chainPolicy = new X509ChainPolicy
      {
        RevocationMode = X509RevocationMode.NoCheck,
        TrustMode = X509ChainTrustMode.CustomRootTrust,
      };
      chainPolicy.CustomTrustStore.AddRange(customTrustRoots);
      handler.SslOptions = new SslClientAuthenticationOptions
      {
        CertificateChainPolicy = chainPolicy,
      };
    }

    return handler;
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

  private static async ValueTask<Stream> ConnectAsync(
      SocketsHttpConnectionContext context,
      GuardedTarget target,
      IPAddress address,
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

      return new NetworkStream(socket, ownsSocket: true);
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
