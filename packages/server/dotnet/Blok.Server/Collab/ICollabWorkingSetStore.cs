namespace Blok.Server.Collab;

/// <summary>
/// A decoded working set: the length-prefixed update-frame section (split it
/// with <see cref="CollabWorkingSetCodec.TryDecodeFrames"/>) plus its tag.
/// </summary>
internal sealed record CollabWorkingSet(byte[] Updates, CollabWorkingSetTag Tag);

/// <summary>
/// Durable storage for a doc's collaborative working set (the Yjs update log
/// between compactions).
///
/// Contract notes the room implementation relies on:
/// <list type="bullet">
/// <item>Blobs handed in and out are the FRAME SECTION only — the store owns
/// the on-disk container (magic + tag header + frames) via
/// <see cref="CollabWorkingSetCodec"/>.</item>
/// <item>The store performs no concurrency control. The collab room is a
/// single-lane actor and serializes all access per doc; append semantics are
/// read-modify-write at that layer.</item>
/// <item>An unreadable stored blob (bad magic, truncated frame, …) reads as
/// absent, with a log line — fail toward re-seed, never crash.</item>
/// <item>Epoch law, enforced here as a belt-and-suspenders guard (the room is
/// the serializing owner): WriteAsync may not lower the stored epoch (equal
/// is the normal append case); ResetAsync must raise it strictly. When the
/// stored blob is absent or unreadable the guard is vacuous by design — a
/// corrupt file loses its epoch and the doc re-seeds. Write/Reset therefore
/// read the stored tag internally; callers must not add their own guard
/// read on top.</item>
/// </list>
/// </summary>
internal interface ICollabWorkingSetStore
{
  /// <summary>Returns null when no readable working set exists.</summary>
  Task<CollabWorkingSet?> ReadAsync(
      string docId,
      CancellationToken cancellationToken = default);

  /// <summary>Atomically replaces the working set.</summary>
  Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Atomically rewrites the working set to an empty log carrying the new
  /// tag. There is no bare delete — a reset is the only way to discard
  /// updates, so the epoch always moves forward.
  /// </summary>
  Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default);
}
