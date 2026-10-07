namespace Blok.Server.Collab;

/// <summary>One lineage a history store still holds for a document.</summary>
/// <param name="Lineage">The same text form as <see cref="CollabDocumentHead.Lineage"/>.</param>
/// <param name="Epoch">The epoch the lineage was published under.</param>
/// <param name="Format">The document format its records are written in.</param>
/// <param name="CreatedAt">When the lineage began. Null when the store never recorded it.</param>
/// <param name="Current">True for the lineage the document is on now.</param>
public sealed record CollabLineageInfo(
    string Lineage,
    long Epoch,
    int Format,
    DateTimeOffset? CreatedAt,
    bool Current);

/// <summary>A committed record without its update bytes.</summary>
public sealed record CollabRecordHeader(
    ulong ServerSequence,
    DateTimeOffset CommittedAt,
    string? ActorId);

/// <summary>How a lineage delete resolved.</summary>
public enum CollabLineageDeleteOutcome
{
  /// <summary>The lineage and its payloads are gone.</summary>
  Deleted,

  /// <summary>The store holds no such lineage.</summary>
  NotFound,

  /// <summary>The lineage is the document's current one; nothing was deleted.</summary>
  Current,

  /// <summary>The document was purged; nothing was deleted.</summary>
  Purged,
}

/// <summary>
/// Optional history reads for an <see cref="ICollabOperationStore"/>: every
/// lineage of a document, current and superseded, so a host can list, read
/// and restore versions.
/// </summary>
/// <remarks>
/// A store without this interface keeps working; only the history routes
/// refuse. Reads take no fence and no document lock, so a live room keeps
/// writing while history is read. Reads return the store's durable records:
/// a record is durable before it is acknowledged, and the next holder adopts
/// every complete record. Lineage ids are unique in
/// <see cref="ListLineagesAsync"/>; if two entries ever share one, the newest
/// wins.
/// </remarks>
public interface ICollabOperationHistoryStore
{
  /// <summary>
  /// True when the document was purged. Takes no fence and no lock, so it
  /// answers while another process holds the document.
  /// </summary>
  ValueTask<bool> IsPurgedAsync(
      string documentId,
      CancellationToken cancellationToken = default);

  /// <summary>Every lineage still held for the document, oldest first.</summary>
  ValueTask<IReadOnlyList<CollabLineageInfo>> ListLineagesAsync(
      string documentId,
      CancellationToken cancellationToken = default);

  /// <summary>The lineage's baseline frames, or null when the lineage is unknown.</summary>
  ValueTask<IReadOnlyList<ReadOnlyMemory<byte>>?> ReadBaselineAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken = default);

  /// <summary>Record headers in sequence order. Empty for an unknown lineage.</summary>
  IAsyncEnumerable<CollabRecordHeader> ReadHeadersAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken = default);

  /// <summary>Records 1..<paramref name="through"/> in sequence order; stops early if the lineage holds fewer.</summary>
  IAsyncEnumerable<CollabOperationRecord> ReadRecordsAsync(
      string documentId,
      string lineage,
      ulong through,
      CancellationToken cancellationToken = default);

  /// <summary>Deletes a lineage that is not current.</summary>
  ValueTask<CollabLineageDeleteOutcome> DeleteLineageAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken = default);
}
