namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// One connection's inbound budget. Without it a single member — a read-only
/// one included — monopolizes the room: every SyncStep1 makes the room diff
/// the whole document back at the sender, and every queryAwareness fans out
/// to everyone.
///
/// The numbers: a fast typist commits ~10 updates a second and moves the
/// cursor at about 10 Hz, so ~25 frames/s is the busiest legitimate
/// connection — the 50/s default is double that, and the 100-frame burst
/// absorbs a reconnect flurry or a big paste. Resyncs are rarer still (one
/// per connect; the most eager clients re-ask every 5 s, ~12/min), so they
/// carry their own tighter budget on top.
///
/// Not thread-safe: only its connection's receive loop touches it.
/// </summary>
internal sealed class SyncInboundBudget
{
  /// <summary>A flaky reconnect can legitimately land a few resyncs at once.</summary>
  private const double ResyncBurst = 10;

  private const double SecondsPerMinute = 60;

  private readonly TokenBucket frames;
  private readonly TokenBucket resyncs;

  internal SyncInboundBudget(BlokServerOptions options, TimeProvider timeProvider)
  {
    frames = new TokenBucket(
        timeProvider,
        options.CollabInboundFramesPerSecond,
        options.CollabInboundBurstFrames);
    resyncs = new TokenBucket(
        timeProvider,
        options.CollabInboundResyncsPerMinute / SecondsPerMinute,
        ResyncBurst);
  }

  /// <summary>False when the frame is over budget; the caller closes the connection.</summary>
  internal bool Allows(byte[] frame)
  {
    return frames.TryTake() && (!IsResync(frame) || resyncs.TryTake());
  }

  /// <summary>
  /// SyncWire grammar: message type 0 (sync), then sub-type 0 (SyncStep1),
  /// each a one-byte varuint. Pinned from both sides by the resync-storm and
  /// update-storm tests, which encode real frames.
  /// </summary>
  private static bool IsResync(byte[] frame)
  {
    return frame.Length >= 2 && frame[0] == 0 && frame[1] == 0;
  }

  /// <summary>Refills at <c>perSecond</c> up to <c>capacity</c>; a rate of zero is off.</summary>
  private sealed class TokenBucket
  {
    private readonly TimeProvider timeProvider;
    private readonly double perSecond;
    private readonly double capacity;
    private double tokens;
    private long stamp;

    internal TokenBucket(TimeProvider timeProvider, double perSecond, double capacity)
    {
      this.timeProvider = timeProvider;
      this.perSecond = perSecond;
      this.capacity = capacity;
      tokens = capacity;
      stamp = timeProvider.GetTimestamp();
    }

    internal bool TryTake()
    {
      if (perSecond <= 0)
      {
        return true;
      }

      var now = timeProvider.GetTimestamp();
      tokens = Math.Min(
          capacity,
          tokens + (timeProvider.GetElapsedTime(stamp, now).TotalSeconds * perSecond));
      stamp = now;

      if (tokens < 1)
      {
        return false;
      }

      tokens -= 1;

      return true;
    }
  }
}
