namespace Blok.Server.Collab;

internal sealed class CollabRoomOptions
{
  /// <summary>Quiet time after the last applied update before an export.</summary>
  public TimeSpan ExportDebounce { get; init; } = TimeSpan.FromSeconds(2);

  /// <summary>Under continuous edits an export still happens this long after the first unexported one.</summary>
  public TimeSpan ExportMaxDelay { get; init; } = TimeSpan.FromSeconds(10);

  /// <summary>How long an empty room stays loaded before it is flushed and dropped.</summary>
  public TimeSpan EvictionLinger { get; init; } = TimeSpan.FromSeconds(30);

  /// <summary>A log with at least this many frames is compacted (on load, and in place while the room is open).</summary>
  public int CompactionFrameThreshold { get; init; } = 64;

  /// <summary>A log at least this large (frame section, bytes) is compacted the same way.</summary>
  public long CompactionByteThreshold { get; init; } = 1L << 20;

  /// <summary>
  /// Client entries one awareness frame may claim before the room refuses to
  /// relay it. A room holds tens of participants, not thousands, and
  /// y-protocols never checks that a sender owns the client ids it encodes.
  /// </summary>
  public int MaxAwarenessClients { get; init; } = 256;

  /// <summary>
  /// Message cap (bytes) announced to negotiated members as a limits frame
  /// right after the control frame, so a client can refuse an oversized frame
  /// before writing it. The transport layer owns ENFORCEMENT; null or 0 means
  /// announce nothing.
  /// </summary>
  public long? AnnouncedMaxMessageBytes { get; init; }

  /// <summary>First wait before a failed blob write or export is retried; it doubles per failure.</summary>
  public TimeSpan RetryBackoff { get; init; } = TimeSpan.FromSeconds(2);

  /// <summary>Longest the doubling backoff may reach.</summary>
  public TimeSpan RetryBackoffCap { get; init; } = TimeSpan.FromSeconds(60);

  /// <summary>
  /// How long the room waits for ONE operation-store call on the commit path —
  /// the id lookup, the append, and the session disposal that follows a
  /// failure. Each runs with the room's lane held, so an unbounded wait wedges
  /// that document. When it ends an append, the outcome is UNKNOWN (the write
  /// may still land), so it is a commit failure rather than a refusal of the
  /// operation. It bounds nothing outside that path: the load and reset paths
  /// still run their store and endpoint calls on the room's lifetime alone.
  /// </summary>
  public TimeSpan CommitTimeout { get; init; } = TimeSpan.FromSeconds(10);

  /// <summary>Doubling wait after <paramref name="failures"/> failures, capped.</summary>
  internal TimeSpan Backoff(int failures)
  {
    var steps = Math.Min(Math.Max(failures - 1, 0), 16);
    var delay = RetryBackoff * Math.Pow(2, steps);

    return delay < RetryBackoffCap ? delay : RetryBackoffCap;
  }
}
