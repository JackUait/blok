namespace Blok.Server.Collab;

/// <summary>
/// The host's handle onto the per-document sync rooms behind the
/// collaboration endpoint. <see cref="DrainAsync"/> is the shutdown path:
/// it refuses new joins, flushes every room (working set and export) and
/// closes members as draining; the token bounds the flush, not the close.
/// </summary>
public interface ICollabRoomManager
{
  ValueTask DrainAsync(CancellationToken cancellationToken = default);
}
