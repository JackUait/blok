using System.Net;

namespace Blok.Server.Outbound;

/// <summary>
/// The filter for a URL Blok hands to a reader's browser to load, such as an
/// oEmbed thumbnail. Go's outbound.BrowserURL is the same filter.
/// </summary>
internal static class BrowserUrl
{
  // In UTF-16 units, like every other cap in the server.
  private const int MaximumLength = 2048;

  private static readonly GuardedOutboundPolicy AddressPolicy = new();

  /// <summary>
  /// The https URL with a punycode host, or null when it should not load.
  /// A null base reads the reference as an absolute URL.
  /// </summary>
  internal static string? Secure(Uri? baseUrl, string reference)
  {
    Uri? url;
    if (HasControl(reference) ||
        !(baseUrl is null
          ? Uri.TryCreate(reference, UriKind.Absolute, out url)
          : Uri.TryCreate(baseUrl, reference, out url)) ||
        url.Scheme != Uri.UriSchemeHttps ||
        url.Host == "" ||
        url.UserInfo != "")
    {
      return null;
    }

    var host = PublicHost(url);
    var prefix = "https://" + url.Host;
    if (host is null ||
        !url.AbsoluteUri.StartsWith(prefix, StringComparison.Ordinal))
    {
      return null;
    }

    var secured = "https://" + host + url.AbsoluteUri[prefix.Length..];
    return HasEncodedControl(secured) || secured.Length > MaximumLength
      ? null
      : secured;
  }

  // A C0, DEL or C1 character. .NET escapes them and Go's parser trims them
  // at the ends, so a URL with one is dropped before parsing.
  internal static bool HasControl(string text)
  {
    foreach (var c in text)
    {
      if (c < 0x20 || c is >= '\u007f' and <= '\u009f')
      {
        return true;
      }
    }

    return false;
  }

  // The host to write, punycode for a name, or null when the host is an
  // address the outbound policy refuses, a zoned IPv6 literal, localhost, a
  // single label, a trailing-dot name or a name ending in a number (a
  // browser reads "１２７.0.0.1" as 127.0.0.1). No DNS lookup.
  private static string? PublicHost(Uri url)
  {
    string name;
    try
    {
      name = url.IdnHost;
    }
    catch (UriFormatException)
    {
      return null;
    }

    switch (url.HostNameType)
    {
      case UriHostNameType.IPv4 or UriHostNameType.IPv6:
        return !name.Contains('%') &&
          IPAddress.TryParse(name, out var address) &&
          AddressPolicy.IsAddressAllowed(address)
          ? url.Host
          : null;
      case UriHostNameType.Dns:
        var dot = name.LastIndexOf('.');
        return dot < 0 || dot == name.Length - 1 ||
          name.EndsWith(".localhost", StringComparison.Ordinal) ||
          char.IsAsciiDigit(name[dot + 1])
          ? null
          : name;
      default:
        return null;
    }
  }

  // %00-%1F or %7F, in either hex case.
  private static bool HasEncodedControl(string url)
  {
    for (var i = 0; i + 2 < url.Length; i++)
    {
      if (url[i] != '%')
      {
        continue;
      }

      var high = (char)(url[i + 1] | 0x20);
      var low = (char)(url[i + 2] | 0x20);
      if (high is '0' or '1' || (high == '7' && low == 'f'))
      {
        return true;
      }
    }

    return false;
  }
}
