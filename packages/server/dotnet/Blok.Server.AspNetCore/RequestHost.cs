using System.Net;
using System.Net.Sockets;

namespace Blok.Server.AspNetCore;

/// <summary>
/// Decides a Host header for Auth "none" and "proxy", which bind loopback
/// only. A DNS-rebinding page sends its own name, so only loopback names and
/// the hosts of <see cref="BlokServerOptions.AllowedOrigins"/> and
/// <see cref="BlokServerOptions.PublicUrl"/> pass. The port is not checked:
/// a page can never make its Host a loopback name. No Host passes, since
/// browsers always send one.
/// </summary>
internal static class RequestHost
{
  public static bool IsAllowed(string host, IEnumerable<string> names)
  {
    if (host.Length == 0)
    {
      return true;
    }

    if (!TryName(host, out var name))
    {
      return false;
    }

    if (string.Equals(name, "localhost", StringComparison.OrdinalIgnoreCase) || IsLoopbackIPv4(name))
    {
      return true;
    }

    // A zone id ("%lo0") parses with a scope only where that interface exists, so the answer would differ by OS.
    if (name.StartsWith('[') &&
        !name.Contains('%') &&
        IPAddress.TryParse(name[1..^1], out var address) &&
        address.AddressFamily == AddressFamily.InterNetworkV6 &&
        address.Equals(IPAddress.IPv6Loopback))
    {
      return true;
    }

    return names.Any(allowed => string.Equals(allowed, name, StringComparison.OrdinalIgnoreCase));
  }

  /// <summary>The host of every allowed origin and of the public URL, ports dropped.</summary>
  public static List<string> Names(IEnumerable<string> allowedOrigins, string publicUrl)
  {
    var names = new List<string>();
    foreach (var candidate in allowedOrigins.Append(publicUrl))
    {
      var raw = candidate.Trim();
      var scheme = raw.IndexOf("://", StringComparison.Ordinal);
      if (scheme < 0)
      {
        continue;
      }

      var authority = raw[(scheme + 3)..];
      var end = authority.IndexOfAny(['/', '?', '#']);
      if (end >= 0)
      {
        authority = authority[..end];
      }

      if (TryName(authority, out var name) && name.Length > 0)
      {
        names.Add(name);
      }
    }

    return names;
  }

  /// <summary>Splits "name[:digits]" or "[v6][:digits]"; the name keeps its brackets.</summary>
  private static bool TryName(string host, out string name)
  {
    name = host;
    var port = "";
    if (host.StartsWith('['))
    {
      var end = host.IndexOf(']');
      if (end < 0)
      {
        return false;
      }

      name = host[..(end + 1)];
      port = host[(end + 1)..];
      if (port.Length > 0 && port[0] != ':')
      {
        return false;
      }

      port = port.Length > 0 ? port[1..] : port;
    }
    else
    {
      var colon = host.IndexOf(':');
      if (colon >= 0)
      {
        name = host[..colon];
        port = host[(colon + 1)..];
      }
    }

    return port.All(c => c is >= '0' and <= '9');
  }

  /// <summary>Four dotted decimal parts in 127.0.0.0/8, not the short or numeric forms.</summary>
  private static bool IsLoopbackIPv4(string name)
  {
    var parts = name.Split('.');
    if (parts.Length != 4)
    {
      return false;
    }

    foreach (var part in parts)
    {
      if (part.Length is 0 or > 3 || !part.All(c => c is >= '0' and <= '9') || int.Parse(part, System.Globalization.CultureInfo.InvariantCulture) > 255)
      {
        return false;
      }
    }

    return parts[0] == "127";
  }
}
