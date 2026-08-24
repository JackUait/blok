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
    if (origin.Length == 0)
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
