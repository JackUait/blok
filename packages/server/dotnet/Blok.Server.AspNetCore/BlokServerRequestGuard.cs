using Blok.Server.Tickets;
using Microsoft.AspNetCore.Http;

namespace Blok.Server.AspNetCore;

internal sealed class BlokServerRequestGuard
{
  private readonly BlokServerOptions _options;
  private readonly FixedWindowRateLimiter _rateLimiter;
  private readonly TimeProvider _timeProvider;

  public BlokServerRequestGuard(
      BlokServerOptions options,
      FixedWindowRateLimiter rateLimiter,
      TimeProvider timeProvider)
  {
    _options = options;
    _rateLimiter = rateLimiter;
    _timeProvider = timeProvider;
  }

  public async Task<bool> AllowAsync(HttpContext context)
  {
    var origin = BlokServerCors.RequestOrigin(context.Request);
    var originAllowed = BlokServerCors.IsAllowed(
        origin,
        _options.AllowedOrigins);

    if (_options.Auth == "ticket" && !originAllowed)
    {
      await RejectAsync(
          context,
          StatusCodes.Status403Forbidden,
          "origin not allowed\n");

      return false;
    }

    if (originAllowed)
    {
      BlokServerCors.AllowOrigin(context.Response, origin);
    }

    var rateLimitKey = AddressKey(context);

    if (_options.Auth == "ticket")
    {
      var authorization =
          context.Request.Headers.Authorization.FirstOrDefault() ?? "";
      var ticket = authorization.StartsWith("Bearer ", StringComparison.Ordinal)
        ? authorization["Bearer ".Length..]
        : authorization;

      if (ticket.Length == 0)
      {
        await RejectAsync(
            context,
            StatusCodes.Status401Unauthorized,
            "missing pass\n");

        return false;
      }

      if (!TicketVerifier.TryVerify(
            _options.Secret,
            ticket,
            _timeProvider.GetUtcNow(),
            out var claims))
      {
        await RejectAsync(
            context,
            StatusCodes.Status401Unauthorized,
            "invalid pass\n");

        return false;
      }

      if (claims.User.Length > 0)
      {
        rateLimitKey = $"user:{claims.User}";
      }
    }

    if (!_rateLimiter.Allow(rateLimitKey))
    {
      await RejectAsync(
          context,
          StatusCodes.Status429TooManyRequests,
          "rate limit exceeded\n");

      return false;
    }

    return true;
  }

  private static string AddressKey(HttpContext context)
  {
    return $"addr:{context.Connection.RemoteIpAddress}";
  }

  private static async Task RejectAsync(
      HttpContext context,
      int statusCode,
      string body)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync(body);
  }
}
