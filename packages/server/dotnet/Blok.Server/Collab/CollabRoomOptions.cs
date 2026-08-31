namespace Blok.Server.Collab;

internal sealed class CollabRoomOptions
{
  /// <summary>Quiet time after the last applied update before an export.</summary>
  public TimeSpan ExportDebounce { get; init; } = TimeSpan.FromSeconds(2);

  /// <summary>Under continuous edits an export still happens this long after the first unexported one.</summary>
  public TimeSpan ExportMaxDelay { get; init; } = TimeSpan.FromSeconds(10);

  /// <summary>How long an empty room stays loaded before it is flushed and dropped.</summary>
  public TimeSpan EvictionLinger { get; init; } = TimeSpan.FromSeconds(30);

  /// <summary>A stored log with at least this many frames is compacted on load.</summary>
  public int CompactionFrameThreshold { get; init; } = 64;

  /// <summary>A stored log at least this large (frame section, bytes) is compacted on load.</summary>
  public long CompactionByteThreshold { get; init; } = 1L << 20;
}
