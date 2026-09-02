using Blok.Server.Collab;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// One connection's inbound budget. Without it a single member — a read-only
/// one included — monopolizes the room: every SyncStep1 makes the room diff
/// the whole document back at the sender, every queryAwareness makes every
/// other member re-encode all the presence it holds, and every awareness
/// frame is relayed verbatim to everyone.
///
/// The numbers: a fast typist commits ~10 updates a second and moves the
/// cursor at about 10 Hz, so ~25 frames/s is the busiest legitimate
/// connection — the 50/s default is double that, and the 100-frame burst
/// absorbs a reconnect flurry or a big paste. Resyncs and presence re-queries
/// are rarer still (one resync per connect; the most eager clients re-ask
/// every 5 s, ~12/min, and no stock client ever sends a queryAwareness), so
/// they carry their own tighter budget on top. Presence is metered by BYTES
/// as well, because the frame budget cannot tell a cursor move from the
/// 683 KB of fabricated peers that also fits one legal frame.
///
/// Not thread-safe: only its connection's receive loop touches it.
/// </summary>
internal sealed class SyncInboundBudget
{
  /// <summary>A flaky reconnect can legitimately land a few resyncs at once.</summary>
  private const double AmplifierBurst = 10;

  /// <summary>
  /// Presence bytes admitted back-to-back — several times a full presence
  /// reply in a large room, so a client answering queryAwareness is never
  /// the one that gets closed. A single frame costing more than this can
  /// never be paid for, which is what a fabricated-peer frame is.
  /// </summary>
  private const double AwarenessBurstBytes = 512 * 1024;

  private const double SecondsPerMinute = 60;

  private readonly TokenBucket frames;
  private readonly TokenBucket amplifiers;
  private readonly TokenBucket awarenessBytes;

  internal SyncInboundBudget(BlokServerOptions options, TimeProvider timeProvider)
  {
    frames = new TokenBucket(
        timeProvider,
        options.CollabInboundFramesPerSecond,
        options.CollabInboundBurstFrames);
    amplifiers = new TokenBucket(
        timeProvider,
        options.CollabInboundResyncsPerMinute / SecondsPerMinute,
        AmplifierBurst);
    awarenessBytes = new TokenBucket(
        timeProvider,
        options.CollabInboundAwarenessBytesPerSecond,
        AwarenessBurstBytes);
  }

  /// <summary>What a frame costs beyond one slot of the frame budget.</summary>
  private enum FrameClass
  {
    /// <summary>Costs the sender alone.</summary>
    Plain,

    /// <summary>SyncStep1 or queryAwareness: cheap to send, answered room-wide.</summary>
    Amplifier,

    /// <summary>Awareness: relayed verbatim to every other member, byte for byte.</summary>
    Presence,
  }

  /// <summary>False when the frame is over budget; the caller closes the connection.</summary>
  internal bool Allows(byte[] frame)
  {
    if (!frames.TryTake())
    {
      return false;
    }

    return Classify(frame) switch
    {
      FrameClass.Amplifier => amplifiers.TryTake(),
      FrameClass.Presence => awarenessBytes.TryTake(frame.Length),
      _ => true,
    };
  }

  /// <summary>
  /// Reads the message type — and the sync sub-type behind it — with the
  /// codec's own varuint reader, never by comparing raw bytes: lib0 varuints
  /// are not canonical, so [0x80, 0x00] also decodes as 0 and a byte compare
  /// would wave a whole resync storm past its budget while the room answers
  /// every frame of it.
  /// </summary>
  private static FrameClass Classify(byte[] frame)
  {
    var head = (ReadOnlySpan<byte>)frame;

    if (!SyncWire.TryReadVarUint(ref head, out var type))
    {
      // Undecodable: the room drops it, so it costs nobody but the sender.
      return FrameClass.Plain;
    }

    if (type == SyncWire.MessageAwareness)
    {
      return FrameClass.Presence;
    }

    if (type == SyncWire.MessageQueryAwareness)
    {
      return FrameClass.Amplifier;
    }

    return type == SyncWire.MessageSync &&
        SyncWire.TryReadVarUint(ref head, out var subType) &&
        subType == SyncWire.SyncStep1
      ? FrameClass.Amplifier
      : FrameClass.Plain;
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

    /// <summary>A cost above the whole capacity can never be paid, so it is refused.</summary>
    internal bool TryTake(double cost = 1)
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

      if (tokens < cost)
      {
        return false;
      }

      tokens -= cost;

      return true;
    }
  }
}
