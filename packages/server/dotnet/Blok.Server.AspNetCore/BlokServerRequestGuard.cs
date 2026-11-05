using Blok.Server.Tickets;
using Microsoft.AspNetCore.Http;

namespace Blok.Server.AspNetCore;

internal sealed class BlokServerRequestGuard
{
  private readonly BlokServerOptions _options;
  private readonly FixedWindowRateLimiter _rateLimiter;
  private readonly TimeProvider _timeProvider;
  private readonly bool _checkHost;

  public BlokServerRequestGuard(
      BlokServerOptions options,
      FixedWindowRateLimiter rateLimiter,
      TimeProvider timeProvider,
      IEnumerable<LoopbackHostCheck> hostCheck)
  {
    _options = options;
    _rateLimiter = rateLimiter;
    _timeProvider = timeProvider;
    _checkHost = hostCheck.Any();
  }

  public async Task<bool> AllowAsync(
      HttpContext context,
      bool requireWrite)
  {
    // Ticket mode needs an allowed Origin and a pass already, and a proxy in
    // front of it may forward the public Host.
    if (_checkHost &&
        _options.Auth != "ticket" &&
        !RequestHost.IsAllowed(
            context.Request.Headers.Host.FirstOrDefault() ?? "",
            RequestHost.Names(_options.AllowedOrigins, _options.PublicUrl)))
    {
      await RejectAsync(
          context,
          StatusCodes.Status421MisdirectedRequest,
          "host not allowed\n");

      return false;
    }

    var origin =BlokServerCors.RequestOrigin(context.Request);
    var originAllowed = BlokServerCors.IsAllowed(
        origin,
        _options.AllowedOrigins);

    var originRequired =
        _options.Auth == "ticket" ||
        context.Request.Headers.ContainsKey("Origin") ||
        string.Equals(
            context.Request.Headers["Sec-Fetch-Site"].FirstOrDefault(),
            "cross-site",
            StringComparison.OrdinalIgnoreCase);

    if (originRequired && !originAllowed)
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

      if (requireWrite && !claims.Write)
      {
        await RejectAsync(
            context,
            StatusCodes.Status403Forbidden,
            "write access required\n");

        return false;
      }

      if (claims.User.Length > 0)
      {
        rateLimitKey = $"user:{claims.User}";
      }

      context.Features.Set(new TicketClaimsFeature(claims));
    }

    if (!_rateLimiter.Allow(rateLimitKey))
    {
      await RejectAsync(
          context,
          StatusCodes.Status429TooManyRequests,
          "rate limit exceeded\n");

      return false;
    }

    var key = rateLimitKey;
    context.Features.Set(new HopBudgetFeature(() => _rateLimiter.Allow(key)));
    context.Features.Set(new RateLimitKeyFeature(key));

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

/// <summary>Registered by <see cref="BlokServerBuilderExtensions.UseLoopbackHostCheck"/>.</summary>
internal sealed class LoopbackHostCheck;

/// <summary>Charges each outbound redirect hop to the key the guard charged for the request.</summary>
internal sealed record HopBudgetFeature(Func<bool> AllowHop);

/// <summary>The key the guard charged; outbound fetches share a lane per key.</summary>
internal sealed record RateLimitKeyFeature(string Key);

/// <summary>The verified ticket of the current request; set only in ticket mode, after the guard passed it.</summary>
internal sealed record TicketClaimsFeature(TicketClaims Claims);
