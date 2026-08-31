namespace Blok.Server.Collab;

/// <summary>
/// The per-document sync rooms behind the collaboration endpoint.
/// Placeholder contract: the Phase 2 room task (C1) owns the
/// single-lane room actor implementation behind it.
/// </summary>
public interface ICollabRoomManager
{
  ValueTask DrainAsync(CancellationToken cancellationToken = default);
}
