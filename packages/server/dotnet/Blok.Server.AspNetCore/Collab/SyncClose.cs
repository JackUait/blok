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

  internal static readonly SyncCloseFrame BadAwareness =
      new(WebSocketCloseStatus.PolicyViolation, "malformed awareness");

  /// <summary>A reason with no mapping: a close is still the right answer inside the room's lane, a throw is not.</summary>
  internal static readonly SyncCloseFrame Internal =
      new(WebSocketCloseStatus.InternalServerError, "internal error");

  internal static SyncCloseFrame For(CollabCloseReason reason)
  {
    return reason switch
    {
      CollabCloseReason.Reset => Reset,
      CollabCloseReason.Draining => Draining,
      CollabCloseReason.BadAwareness => BadAwareness,
      _ => Internal,
    };
  }
}
