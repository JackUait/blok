namespace Blok.Server.Collab;

/// <summary>
/// The host's handle onto the per-document sync rooms behind the
/// collaboration endpoint. <see cref="DrainAsync"/> is the shutdown path:
/// it refuses new joins, flushes every room (working set and export) and
/// closes members as draining; the token bounds the flush, not the close.
/// </summary>
public interface ICollabRoomManager
{
  /// <summary>Refuses new joins, then drains every live room.</summary>
  /// <param name="cancellationToken">
  /// Bounds the flush only. A room whose store or endpoint fails, or whose
  /// flush is cancelled, still closes — one sick room may not hold the whole
  /// shutdown open.
  /// </param>
  /// <returns>
  /// Completes once no room is left, including rooms opened by a join that
  /// raced the refusal.
  /// </returns>
  ValueTask DrainAsync(CancellationToken cancellationToken = default);
}
