namespace Blok.Server.Collab;

/// <summary>
/// A decoded working set: the length-prefixed update-frame section (split it
/// with <see cref="CollabWorkingSetCodec.TryDecodeFrames"/>) plus its tag.
/// </summary>
internal sealed record CollabWorkingSet(byte[] Updates, CollabWorkingSetTag Tag);

/// <summary>
/// A working-set read or write failed. A store TIMEOUT arrives as this rather
/// than as an OperationCanceledException, which the room would otherwise read
/// as its own shutdown.
/// </summary>
internal sealed class CollabWorkingSetStoreException(
    string docId,
    string operation,
    Exception inner) : Exception(
        $"collab: the working-set {operation} for \"{docId}\" failed: " +
        $"{inner.Message}",
        inner);

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
/// absent, with a log line — fail toward re-seed, never crash. The lineage in
/// the tag is what tells the re-seeded history apart from the lost one.</item>
/// <item>Epoch law: the epoch never regresses WITHIN A LINEAGE. The room owns
/// it — it is the only writer for a doc, it carries the tag it loaded, and
/// only a reset raises the epoch. A driver may add a cheap guard on top
/// (LocalCollabStore reads the 32-byte header before a write); it may not pay
/// a whole-blob read per write, which is why S3CollabStore guards resets
/// only. When the stored blob is absent or unreadable the guard is vacuous by
/// design.</item>
/// <item>A cancellation the CALLER did not ask for (a store timeout) must be
/// reported as <see cref="CollabWorkingSetStoreException"/>, never as an
/// OperationCanceledException.</item>
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
