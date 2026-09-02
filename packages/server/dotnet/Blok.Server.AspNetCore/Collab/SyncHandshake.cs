using System.Net.WebSockets;
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
/// mode (the public mode) always has one: the ticket's user. Otherwise it is
/// the signed-in application user, else null — uncapped, because in
/// none/proxy mode every socket shares one loopback or proxy address and a
/// cap on it would be a per-doc cap for everyone.
/// </summary>
internal sealed record SyncAccepted(string? SubProtocol, bool CanWrite, string? Principal) : SyncHandshakeResult;

/// <summary>
/// The sync door (plan decisions 7, 9, 18). Order: WebSocket plumbing →
/// origin → ticket (from the Sec-WebSocket-Protocol offer) → doc claim →
/// rate limit → application authorization. The limit runs BEFORE the hook
/// because the hook is the consumer's database call, the very cost the limit
/// exists to bound.
///
/// Unlike the HTTP routes, a REJECTED handshake spends the rate limit too: a
/// rejection still costs an accepted WebSocket and a close frame, so without
/// it a flood of bad passes would be free.
/// </summary>
internal sealed class SyncHandshake(
    BlokServerOptions options,
    FixedWindowRateLimiter rateLimiter,
    TimeProvider timeProvider)
{
  internal const string Protocol = "blok-sync.v1";

  internal async ValueTask<SyncHandshakeResult> NegotiateAsync(HttpContext context, string doc)
  {
    var (admission, rateLimitKey) = Admit(context, doc);

    // A refusal answers with a plain status and costs nothing to serve; an
    // accepted OR rejected handshake costs a socket, so both spend the window.
    if (admission is SyncRefused)
    {
      return admission;
    }

    if (!rateLimiter.Allow(rateLimitKey))
    {
      return new SyncRefused(StatusCodes.Status429TooManyRequests, "rate limit exceeded\n");
    }

    return admission is SyncCandidate candidate
      ? await AuthorizeAsync(context, doc, candidate)
      : admission;
  }

  /// <summary>Everything the door decides on its own, and the key its cost is billed to.</summary>
  private (SyncHandshakeResult Result, string RateLimitKey) Admit(HttpContext context, string doc)
  {
    var addressKey = $"addr:{context.Connection.RemoteIpAddress}";

    if (context.Features.Get<IHttpWebSocketFeature>() is null)
    {
      return (new SyncRefused(
          StatusCodes.Status500InternalServerError,
          "the sync endpoint needs WebSockets: call app.UseWebSockets() before MapBlokServer()\n"), addressKey);
    }

    if (!context.WebSockets.IsWebSocketRequest)
    {
      return (new SyncRefused(
          StatusCodes.Status426UpgradeRequired,
          "WebSocket upgrade required\n"), addressKey);
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
      return (new SyncRefused(StatusCodes.Status403Forbidden, "origin not allowed\n"), addressKey);
    }

    var offers = ProtocolOffers(context.Request);
    var subProtocol = offers.Contains(Protocol, StringComparer.Ordinal) ? Protocol : null;
    var rateLimitKey = addressKey;
    string? principal = null;
    var canWrite = true;
    var user = context.User;

    if (!SyncEndpoint.IsSingleSegment(doc))
    {
      return (new SyncRejected(subProtocol, SyncClose.BadDocument), rateLimitKey);
    }

    if (options.Auth == "ticket")
    {
      // A 101 echoing none of the offered protocols is failed by every
      // browser before any close code is delivered: a plain refusal instead.
      if (subProtocol is null)
      {
        return (new SyncRefused(
            StatusCodes.Status400BadRequest,
            "blok-sync.v1 must be offered in Sec-WebSocket-Protocol\n"), rateLimitKey);
      }

      var candidates = offers.Where(offer => offer != Protocol).ToArray();

      if (candidates.Length == 0)
      {
        return (new SyncRejected(subProtocol, SyncClose.MissingPass), rateLimitKey);
      }

      if (!TryVerifyAny(candidates, out var claims))
      {
        return (new SyncRejected(subProtocol, SyncClose.InvalidPass), rateLimitKey);
      }

      // The ticket must name this document; an absent claim is a mismatch.
      if (!string.Equals(claims.Document, doc, StringComparison.Ordinal))
      {
        return (new SyncRejected(subProtocol, SyncClose.OtherDocument), rateLimitKey);
      }

      if (claims.User.Length == 0)
      {
        return (new SyncRejected(subProtocol, SyncClose.UserlessPass), rateLimitKey);
      }

      canWrite = claims.Write;
      principal = $"user:{claims.User}";
      rateLimitKey = principal;
      user = TicketPrincipal.For(claims);
    }

    principal ??= SignedInPrincipal(context);

    return (new SyncCandidate(subProtocol, canWrite, principal, user), rateLimitKey);
  }

  private static async ValueTask<SyncHandshakeResult> AuthorizeAsync(
      HttpContext context,
      string doc,
      SyncCandidate candidate)
  {
    var authorization = context.RequestServices.GetService<IBlokAuthorization>();
    var canWrite = candidate.CanWrite;

    if (authorization is not null)
    {
      if (!await authorization.CanReadDocumentAsync(candidate.User, doc, context.RequestAborted))
      {
        return new SyncRejected(candidate.SubProtocol, SyncClose.Forbidden);
      }

      canWrite = canWrite &&
          await authorization.CanWriteDocumentAsync(candidate.User, doc, context.RequestAborted);
    }

    return new SyncAccepted(candidate.SubProtocol, canWrite, candidate.Principal);
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

  /// <summary>Past the door's own checks; only the application's hook is still to run.</summary>
  private sealed record SyncCandidate(
      string? SubProtocol,
      bool CanWrite,
      string? Principal,
      ClaimsPrincipal User) : SyncHandshakeResult;
}

/// <summary>
/// The principal the application's authorization hook is handed in ticket
/// mode. Without it the hook would see the request's EMPTY principal — a
/// consumer that authorizes per user would silently be authorizing anonymous.
/// </summary>
internal static class TicketPrincipal
{
  /// <summary>The document the pass names.</summary>
  internal const string DocumentClaim = "blok:doc";

  /// <summary>"true" when the pass carries write access.</summary>
  internal const string WriteClaim = "blok:write";

  private const string AuthenticationType = "blok-ticket";

  internal static ClaimsPrincipal For(TicketClaims claims)
  {
    // A non-null authentication type is what makes IsAuthenticated true, so
    // the hook can tell a verified pass from an anonymous request.
    var identity = new ClaimsIdentity(AuthenticationType);

    if (claims.User.Length > 0)
    {
      identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, claims.User));
      identity.AddClaim(new Claim(ClaimTypes.Name, claims.User));
    }

    identity.AddClaim(new Claim(DocumentClaim, claims.Document));
    identity.AddClaim(new Claim(WriteClaim, claims.Write ? "true" : "false"));

    return new ClaimsPrincipal(identity);
  }
}
