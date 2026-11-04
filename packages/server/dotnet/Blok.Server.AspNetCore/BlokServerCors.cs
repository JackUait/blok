using Microsoft.AspNetCore.Http;

namespace Blok.Server.AspNetCore;

internal static class BlokServerCors
{
  public static string RequestOrigin(HttpRequest request)
  {
    return request.Headers.Origin.FirstOrDefault() ?? "";
  }

  public static bool IsAllowed(string origin, IList<string> allowedOrigins)
  {
    // Kestrel cannot echo such an origin (a 500), and a browser never sends
    // one: it writes a non-ASCII host in punycode.
    if (origin.Length == 0 || origin.Any(c => c != '\t' && c is < ' ' or > '~'))
    {
      return false;
    }

    return allowedOrigins.Any(candidate =>
        string.Equals(
            candidate.Trim(),
            origin,
            StringComparison.OrdinalIgnoreCase));
  }

  public static void AllowOrigin(HttpResponse response, string origin)
  {
    response.Headers.AccessControlAllowOrigin = origin;
    response.Headers.Append("Vary", "Origin");
  }
}
