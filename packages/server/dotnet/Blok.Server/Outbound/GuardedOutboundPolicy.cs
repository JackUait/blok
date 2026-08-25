using System.Net;
using System.Net.Sockets;

namespace Blok.Server.Outbound;

internal enum GuardedFetchFailure
{
  BlockedDestination,
  ResponseTooLarge,
  TimedOut,
  TooManyRedirects,
}

internal sealed class GuardedFetchException : Exception
{
  internal GuardedFetchException(GuardedFetchFailure failure) :
      base("Outbound destination is not permitted.")
  {
    Failure = failure;
  }

  internal GuardedFetchFailure Failure { get; }
}

internal sealed record GuardedTarget(
    Uri Url,
    string Host,
    int Port,
    IPAddress? LiteralAddress);

internal interface IGuardedOutboundPolicy
{
  GuardedTarget Validate(string rawUrl, Uri? baseUrl = null);

  bool IsAddressAllowed(IPAddress address);
}

internal sealed class GuardedOutboundPolicy : IGuardedOutboundPolicy
{
  private static readonly NetworkRange[] ForbiddenNetworks =
  [
    NetworkRange.Parse("10.0.0.0/8"),
    NetworkRange.Parse("172.16.0.0/12"),
    NetworkRange.Parse("192.168.0.0/16"),
    NetworkRange.Parse("127.0.0.0/8"),
    NetworkRange.Parse("0.0.0.0/8"),
    NetworkRange.Parse("169.254.0.0/16"),
    NetworkRange.Parse("192.0.0.0/24"),
    NetworkRange.Parse("192.0.2.0/24"),
    NetworkRange.Parse("198.51.100.0/24"),
    NetworkRange.Parse("203.0.113.0/24"),
    NetworkRange.Parse("192.88.99.0/24"),
    NetworkRange.Parse("198.18.0.0/15"),
    NetworkRange.Parse("224.0.0.0/4"),
    NetworkRange.Parse("240.0.0.0/4"),
    NetworkRange.Parse("255.255.255.255/32"),
    NetworkRange.Parse("100.64.0.0/10"),
    NetworkRange.Parse("::/128"),
    NetworkRange.Parse("::1/128"),
    NetworkRange.Parse("100::/64"),
    NetworkRange.Parse("2001::/23"),
    NetworkRange.Parse("2001:2::/48"),
    NetworkRange.Parse("2001:db8::/32"),
    NetworkRange.Parse("2001::/32"),
    NetworkRange.Parse("fc00::/7"),
    NetworkRange.Parse("fec0::/10"),
    NetworkRange.Parse("fe80::/10"),
    NetworkRange.Parse("ff00::/8"),
    NetworkRange.Parse("2002::/16"),
    NetworkRange.Parse("64:ff9b::/96"),
    NetworkRange.Parse("64:ff9b:1::/48"),
    NetworkRange.Parse("5f00::/16"),
    NetworkRange.Parse("2001:10::/28"),
    NetworkRange.Parse("2001:20::/28"),
    NetworkRange.Parse("3fff::/20"),
    NetworkRange.Parse("100:0:0:1::/64"),
  ];

  public GuardedTarget Validate(
      string rawUrl,
      Uri? baseUrl = null)
  {
    var parsed = baseUrl is null
      ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
      : Uri.TryCreate(baseUrl, rawUrl, out url);

    if (string.IsNullOrWhiteSpace(rawUrl) ||
        !parsed ||
        url is null ||
        (url.Scheme != Uri.UriSchemeHttp &&
         url.Scheme != Uri.UriSchemeHttps) ||
        url.Host == "" ||
        url.UserInfo != "" ||
        AuthorityContainsUserInfo(url))
    {
      throw Blocked();
    }

    int port;

    try
    {
      port = url.Port;
    }
    catch (UriFormatException)
    {
      throw Blocked();
    }

    if (port is not (80 or 443))
    {
      throw Blocked();
    }

    var host = url.IdnHost;
    var literalAddress =
        url.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6 &&
        IPAddress.TryParse(host, out var parsedAddress)
          ? parsedAddress
          : null;

    if (url.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6 &&
        literalAddress is null)
    {
      throw Blocked();
    }

    return new GuardedTarget(url, host, port, literalAddress);
  }

  public bool IsAddressAllowed(IPAddress address)
  {
    ArgumentNullException.ThrowIfNull(address);

    if (address.IsIPv4MappedToIPv6)
    {
      address = address.MapToIPv4();
    }

    return !ForbiddenNetworks.Any(network => network.Contains(address));
  }

  private static GuardedFetchException Blocked()
  {
    return new GuardedFetchException(
        GuardedFetchFailure.BlockedDestination);
  }

  private static bool AuthorityContainsUserInfo(Uri url)
  {
    var canonical = url.AbsoluteUri.AsSpan();
    var authorityStart =
        url.Scheme.Length + Uri.SchemeDelimiter.Length;
    var relativeAuthorityEnd = canonical[authorityStart..]
        .IndexOfAny('/', '?', '#');
    var authorityEnd = relativeAuthorityEnd < 0
      ? canonical.Length
      : authorityStart + relativeAuthorityEnd;

    return canonical[authorityStart..authorityEnd].Contains('@');
  }

  private readonly record struct NetworkRange(
      AddressFamily Family,
      byte[] Network,
      int PrefixLength)
  {
    internal static NetworkRange Parse(string value)
    {
      var separator = value.LastIndexOf('/');
      var address = IPAddress.Parse(value[..separator]);
      var prefixLength = int.Parse(
          value[(separator + 1)..],
          System.Globalization.CultureInfo.InvariantCulture);

      return new NetworkRange(
          address.AddressFamily,
          address.GetAddressBytes(),
          prefixLength);
    }

    internal bool Contains(IPAddress address)
    {
      if (address.AddressFamily != Family)
      {
        return false;
      }

      var candidate = address.GetAddressBytes();
      var completeBytes = PrefixLength / 8;
      var remainingBits = PrefixLength % 8;

      for (var index = 0; index < completeBytes; index++)
      {
        if (candidate[index] != Network[index])
        {
          return false;
        }
      }

      if (remainingBits == 0)
      {
        return true;
      }

      var mask = (byte)(0xff << (8 - remainingBits));

      return (candidate[completeBytes] & mask) ==
          (Network[completeBytes] & mask);
    }
  }
}
