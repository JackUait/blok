#if BLOK_SERVER_CONFORMANCE
using System.Net;
using Blok.Server.Outbound;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Blok.Server.AspNetCore;

public static class BlokServerConformanceExtensions
{
  public static BlokServerBuilder UseConformanceOrigin(
      this BlokServerBuilder builder,
      string origin,
      int port)
  {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentNullException.ThrowIfNull(origin);

    builder.Services.RemoveAll<IGuardedOutboundPolicy>();
    builder.Services.AddSingleton<IGuardedOutboundPolicy>(
        new ExactOriginOutboundPolicy(origin, port));

    return builder;
  }

  private sealed class ExactOriginOutboundPolicy(
      string origin,
      int port) : IGuardedOutboundPolicy
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
          url.Scheme != Uri.UriSchemeHttp ||
          url.Host != "127.0.0.1" ||
          url.Port != port ||
          url.UserInfo != "" ||
          !HasExactOrigin(url))
      {
        throw Blocked();
      }

      return new GuardedTarget(
          url,
          "127.0.0.1",
          port,
          IPAddress.Loopback);
    }

    public bool IsAddressAllowed(IPAddress address)
    {
      return address.Equals(IPAddress.Loopback);
    }

    private bool HasExactOrigin(Uri url)
    {
      var value = url.OriginalString.AsSpan();
      return value.StartsWith(
            origin,
            StringComparison.Ordinal) &&
          (value.Length == origin.Length ||
           value[origin.Length] is '/' or '?' or '#');
    }

    private static GuardedFetchException Blocked()
    {
      return new GuardedFetchException(
          GuardedFetchFailure.BlockedDestination);
    }
  }
}
#endif
