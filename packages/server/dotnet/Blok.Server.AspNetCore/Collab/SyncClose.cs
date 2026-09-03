using System.Net.WebSockets;
using Blok.Server.Collab;

namespace Blok.Server.AspNetCore.Collab;

internal readonly record struct SyncCloseFrame(WebSocketCloseStatus Status, string Reason);

/// <summary>Every close the sync endpoint can send, in one place so the codes cannot drift.</summary>
internal static class SyncClose
{
  internal static readonly SyncCloseFrame Normal =
      new(WebSocketCloseStatus.NormalClosure, "");

  internal static readonly SyncCloseFrame Draining =
      new(WebSocketCloseStatus.EndpointUnavailable, "server shutting down");

  internal static readonly SyncCloseFrame TooBig =
      new(WebSocketCloseStatus.MessageTooBig, "message too big");

  internal static readonly SyncCloseFrame InboundRateExceeded =
      new(WebSocketCloseStatus.PolicyViolation, "inbound rate exceeded");

  internal static readonly SyncCloseFrame SlowConsumer =
      new(WebSocketCloseStatus.PolicyViolation, "outbound queue overflow");

  internal static readonly SyncCloseFrame BadDocument =
      new((WebSocketCloseStatus)4400, "document ids must be a single path segment");

  internal static readonly SyncCloseFrame MissingPass =
      new((WebSocketCloseStatus)4401, "missing pass");

  internal static readonly SyncCloseFrame InvalidPass =
      new((WebSocketCloseStatus)4401, "invalid pass");

  internal static readonly SyncCloseFrame OtherDocument =
      new((WebSocketCloseStatus)4401, "pass is for another document");

  /// <summary>The wire is binary; a text frame can only come from a non-Blok client.</summary>
  internal static readonly SyncCloseFrame TextFrame =
      new(WebSocketCloseStatus.InvalidMessageType, "binary frames only");

  /// <summary>
  /// Ticket mode runs behind a proxy, so the client address is the proxy's:
  /// a pass naming nobody would share one cap and one rate window with
  /// every other such pass. Refused rather than keyed on the address.
  /// </summary>
  internal static readonly SyncCloseFrame UserlessPass =
      new((WebSocketCloseStatus)4401, "pass names no user");

  internal static readonly SyncCloseFrame Forbidden =
      new((WebSocketCloseStatus)4403, "forbidden");

  internal static readonly SyncCloseFrame Reset =
      new((WebSocketCloseStatus)4409, "document reset");

  internal static readonly SyncCloseFrame SeedFailed =
      new((WebSocketCloseStatus)4503, "document unavailable");

  /// <summary>
  /// Same 4503 as <see cref="SeedFailed"/> (come back later) but its own text,
  /// so an operator can tell a failed journal append from a failed seed. Not
  /// 4409: the client reads that status as a relineage and discards pending
  /// work, which a transient commit failure must not trigger.
  /// </summary>
  internal static readonly SyncCloseFrame CommitUnavailable =
      new((WebSocketCloseStatus)4503, "commit unavailable, retry");

  internal static readonly SyncCloseFrame BadAwareness =
      new(WebSocketCloseStatus.PolicyViolation, "malformed awareness");

  /// <summary>A value outside the enum: a close is still the right answer inside the room's lane, a throw is not.</summary>
  internal static readonly SyncCloseFrame Internal =
      new(WebSocketCloseStatus.InternalServerError, "internal error");

  /// <summary>
  /// <see cref="Map"/> below has no default arm, so it is exhaustive over the
  /// named enum: with TreatWarningsAsErrors, a new <see cref="CollabCloseReason"/>
  /// shipped without an arm fails the build (CS8509) instead of silently
  /// falling through to <see cref="Internal"/>. IsDefined covers what the
  /// compiler cannot see statically — a value outside the enum, e.g. a bad cast.
  /// </summary>
  internal static SyncCloseFrame For(CollabCloseReason reason)
  {
    return Enum.IsDefined(reason) ? Map(reason) : Internal;
  }

#pragma warning disable CS8524 // no default arm on purpose: For()'s IsDefined guard is what rules out a value outside the enum, not this switch.
  private static SyncCloseFrame Map(CollabCloseReason reason) => reason switch
  {
    CollabCloseReason.Reset => Reset,
    CollabCloseReason.Draining => Draining,
    CollabCloseReason.BadAwareness => BadAwareness,
    CollabCloseReason.CommitUnavailable => CommitUnavailable,
  };
#pragma warning restore CS8524
}
