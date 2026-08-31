using System.Security.Claims;
using Blok.Server.Tickets;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

internal abstract record SyncHandshakeResult;

/// <summary>Refused before the upgrade with a plain HTTP status; the client sees a failed connection.</summary>
internal sealed record SyncRefused(int StatusCode, string Body) : SyncHandshakeResult;

/// <summary>
/// Accepted (echoing the negotiated subprotocol) and closed at once with a
/// readable code — refusing the subprotocol would leave a browser with no
/// code at all (plan decision 7).
/// </summary>
internal sealed record SyncRejected(string? SubProtocol, SyncCloseFrame Close) : SyncHandshakeResult;

/// <summary>
/// <paramref name="Principal"/> is what the connection cap keys on. Ticket
/// mode (the public mode) always has one: the ticket's user, else the client
/// address. Otherwise it is the signed-in application user, else null —
/// uncapped, because in none/proxy mode every socket shares one loopback or
/// proxy address and a cap on it would be a per-doc cap for everyone.
/// </summary>
internal sealed record SyncAccepted(string? SubProtocol, bool CanWrite, string? Principal) : SyncHandshakeResult;

/// <summary>
/// The sync door (plan decisions 7, 9, 18). Order: WebSocket plumbing →
/// origin → ticket (from the Sec-WebSocket-Protocol offer) → doc claim →
/// application authorization → rate limit. As on the HTTP routes, only an
/// accepted handshake spends the rate limit.
/// </summary>
internal sealed class SyncHandshake(
    BlokServerOptions options,
    FixedWindowRateLimiter rateLimiter,
    TimeProvider timeProvider)
{
  internal const string Protocol = "blok-sync.v1";

  internal async ValueTask<SyncHandshakeResult> NegotiateAsync(HttpContext context, string doc)
  {
    if (context.Features.Get<IHttpWebSocketFeature>() is null)
    {
      return new SyncRefused(
          StatusCodes.Status500InternalServerError,
          "the sync endpoint needs WebSockets: call app.UseWebSockets() before MapBlokServer()\n");
    }

    if (!context.WebSockets.IsWebSocketRequest)
    {
      return new SyncRefused(
          StatusCodes.Status426UpgradeRequired,
          "WebSocket upgrade required\n");
    }

    var origin = BlokServerCors.RequestOrigin(context.Request);
    var originRequired =
        options.Auth == "ticket" ||
        context.Request.Headers.ContainsKey("Origin") ||
        string.Equals(
            context.Request.Headers["Sec-Fetch-Site"].FirstOrDefault(),
            "cross-site",
            StringComparison.OrdinalIgnoreCase);

    if (originRequired && !BlokServerCors.IsAllowed(origin, options.AllowedOrigins))
    {
      return new SyncRefused(StatusCodes.Status403Forbidden, "origin not allowed\n");
    }

    var offers = ProtocolOffers(context.Request);
    var subProtocol = offers.Contains(Protocol, StringComparer.Ordinal) ? Protocol : null;
    var addressKey = $"addr:{context.Connection.RemoteIpAddress}";
    var rateLimitKey = addressKey;
    string? principal = null;
    var canWrite = true;

    if (options.Auth == "ticket")
    {
      if (subProtocol is null)
      {
        return new SyncRejected(null, SyncClose.ProtocolRequired);
      }

      var candidates = offers.Where(offer => offer != Protocol).ToArray();

      if (candidates.Length == 0)
      {
        return new SyncRejected(subProtocol, SyncClose.MissingPass);
      }

      if (!TryVerifyAny(candidates, out var claims))
      {
        return new SyncRejected(subProtocol, SyncClose.InvalidPass);
      }

      // The ticket must name this document; an absent claim is a mismatch.
      if (!string.Equals(claims.Document, doc, StringComparison.Ordinal))
      {
        return new SyncRejected(subProtocol, SyncClose.OtherDocument);
      }

      canWrite = claims.Write;
      principal = addressKey;

      if (claims.User.Length > 0)
      {
        principal = $"user:{claims.User}";
        rateLimitKey = principal;
      }
    }

    principal ??= SignedInPrincipal(context);

    var authorization = context.RequestServices.GetService<IBlokAuthorization>();

    if (authorization is not null)
    {
      if (!await authorization.CanReadDocumentAsync(context.User, doc, context.RequestAborted))
      {
        return new SyncRejected(subProtocol, SyncClose.Forbidden);
      }

      canWrite = canWrite &&
          await authorization.CanWriteDocumentAsync(context.User, doc, context.RequestAborted);
    }

    if (!rateLimiter.Allow(rateLimitKey))
    {
      return new SyncRefused(StatusCodes.Status429TooManyRequests, "rate limit exceeded\n");
    }

    return new SyncAccepted(subProtocol, canWrite, principal);
  }

  /// <summary>The application's authenticated user (the RequireAuthorization path), if any.</summary>
  private static string? SignedInPrincipal(HttpContext context)
  {
    if (context.User.Identity is not { IsAuthenticated: true } identity)
    {
      return null;
    }

    var name = identity.Name ?? context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    return string.IsNullOrEmpty(name) ? null : $"app:{name}";
  }

  /// <summary>Both header shapes: one comma-joined value and repeated header lines.</summary>
  private static string[] ProtocolOffers(HttpRequest request)
  {
    return request.Headers.SecWebSocketProtocol
        .SelectMany(value => (value ?? "").Split(','))
        .Select(token => token.Trim())
        .Where(token => token.Length > 0)
        .ToArray();
  }

  private bool TryVerifyAny(string[] candidates, out TicketClaims claims)
  {
    var now = timeProvider.GetUtcNow();

    foreach (var candidate in candidates)
    {
      if (TicketVerifier.TryVerify(options.Secret, candidate, now, out claims))
      {
        return true;
      }
    }

    claims = default;

    return false;
  }
}
