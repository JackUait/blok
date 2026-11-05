using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

internal static class OutboundCaller
{
  /// <summary>
  /// The key the guard charged, which the fetcher's per-caller lanes share;
  /// null when the rate limit is off, as there are no per-caller limits then.
  /// </summary>
  internal static string? Of(HttpContext context)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    return options.RateLimitPerMinute > 0
      ? context.Features.Get<RateLimitKeyFeature>()?.Key
      : null;
  }
}
