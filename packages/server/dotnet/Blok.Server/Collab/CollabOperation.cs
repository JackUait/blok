namespace Blok.Server.Collab;

/// <summary>
/// Where a committed operation came from. The server records it from the
/// connection that produced the operation; it is never inferred from the
/// update bytes, which are opaque.
/// </summary>
/// <remarks>
/// The numeric values are stable, so a store may persist them directly.
/// </remarks>
public enum CollabOperationSource
{
  /// <summary>
  /// A blok-sync.v2 client, which receives an exact acknowledgement carrying
  /// the assigned server sequence.
  /// </summary>
  ClientV2 = 0,

  /// <summary>
  /// A blok-sync.v1 or stock y-websocket client. Its writes are journalled
  /// like any other, but the client has no operation id of its own, so the
  /// SERVER mints one per update before the candidate is built. That id is
  /// never re-sent by the client, so a v1 write cannot be retried into the same
  /// id and gets no durability receipt.
  /// </summary>
  ClientV1 = 1,

  /// <summary>
  /// The HTTP block-edit endpoint. Its digest covers the canonical request
  /// body rather than the derived update, because the update bytes depend on
  /// the room's per-load random Yjs client id.
  /// </summary>
  HttpEdit = 2,
}

/// <summary>
/// Identity of a document's committed history.
/// </summary>
/// <param name="Format">
/// Schema the baseline frames and operation updates were produced against.
/// </param>
/// <param name="Epoch">
/// Counts resets. It never regresses WITHIN one lineage; a reset raises it and
/// mints a new lineage at the same time.
/// </param>
/// <param name="Lineage">
/// 32 lowercase hexadecimal characters, minted when the document is first
/// seeded and again on every reset. Clients compare it by equality: a
/// different lineage means "drop what you cached, this is not your history".
/// This is what tells a re-seeded history apart from a lost one, which the
/// epoch alone cannot do.
/// </param>
/// <param name="DurableThrough">
/// Highest server sequence committed on this lineage. Sequences start at 1, so
/// 0 means no operation has been committed on this lineage yet.
/// </param>
public sealed record CollabDocumentHead(
    int Format,
    long Epoch,
    string Lineage,
    ulong DurableThrough);

/// <summary>
/// A replay accelerator: the encoded document state through one committed
/// sequence.
/// </summary>
/// <remarks>
/// A checkpoint is never authoritative. Publishing one MUST NOT remove
/// operation history or the operation-id index that makes appends idempotent —
/// the journal stays the record of what happened, and the checkpoint only
/// shortens the replay.
/// </remarks>
/// <param name="Through">
/// The server sequence this state includes. It always names a committed
/// sequence and never moves backwards across publications; republishing at the
/// sequence already published is an accepted no-op.
/// </param>
/// <param name="State">
/// Encoded document state covering the baseline plus every operation up to and
/// including <paramref name="Through"/>.
/// </param>
public sealed record CollabOperationCheckpoint(
    ulong Through,
    ReadOnlyMemory<byte> State);

/// <summary>
/// One committed operation, as the store hands it back.
/// </summary>
/// <remarks>
/// The document id and lineage are deliberately absent: a session is scoped to
/// one document, and every record it returns belongs to the head's lineage.
/// Operations from a superseded lineage remain history but can never be
/// replayed into the current one, so they are never returned here.
/// </remarks>
/// <param name="OperationId">32 lowercase hexadecimal characters.</param>
/// <param name="ServerSequence">
/// Position in the total order of this lineage. The first committed operation
/// is 1.
/// </param>
/// <param name="CommittedAt">The store's clock at commit time.</param>
/// <param name="ActorId">
/// Server-derived identity of the writer, or null when the server could not
/// verify one. Never taken from awareness or from client-supplied metadata.
/// </param>
/// <param name="Source">Which producer the operation entered through.</param>
/// <param name="Update">The raw Yjs update, exactly as committed.</param>
/// <param name="Digest">The digest committed alongside the update.</param>
public sealed record CollabOperationRecord(
    string OperationId,
    ulong ServerSequence,
    DateTimeOffset CommittedAt,
    string? ActorId,
    CollabOperationSource Source,
    ReadOnlyMemory<byte> Update,
    ReadOnlyMemory<byte> Digest);

/// <summary>
/// An operation offered for commit. The store assigns the server sequence and
/// the commit time; everything else is decided by the server before the
/// candidate is built.
/// </summary>
/// <param name="OperationId">
/// 32 lowercase hexadecimal characters. It is the idempotency key: a v2 client
/// generates it once and re-sends it unchanged on every retry, and for a
/// producer that carries no id of its own
/// (<see cref="CollabOperationSource.ClientV1"/>) the server mints one per
/// update.
/// </param>
/// <param name="ActorId">
/// Server-derived identity of the writer, or null when none could be verified.
/// </param>
/// <param name="Source">Which producer the operation entered through.</param>
/// <param name="Update">The raw Yjs update to journal.</param>
/// <param name="Digest">
/// SHA-256 of the bytes this operation id stands for. The store persists it and
/// compares it on a repeated id, which is what separates a retry
/// (<see cref="CollabOperationAppendOutcome.Duplicate"/>) from a reused id
/// (<see cref="CollabOperationAppendOutcome.Conflict"/>). It is supplied rather
/// than computed because an <see cref="CollabOperationSource.HttpEdit"/> digest
/// covers the request body, not the derived update.
/// </param>
public sealed record CollabOperationCandidate(
    string OperationId,
    string? ActorId,
    CollabOperationSource Source,
    ReadOnlyMemory<byte> Update,
    ReadOnlyMemory<byte> Digest);

/// <summary>What a store already holds for one operation id.</summary>
public enum CollabOperationLookupOutcome
{
  /// <summary>
  /// No operation with this id is committed on this lineage. An append would
  /// assign it a new sequence.
  /// </summary>
  NotCommitted,

  /// <summary>
  /// Already committed with the same digest — the producer is retrying work
  /// that is already durable.
  /// </summary>
  Duplicate,

  /// <summary>
  /// Already committed with a DIFFERENT digest, so it cannot mean the same
  /// work. The caller refuses the operation with <c>operation-id-conflict</c>.
  /// </summary>
  Conflict,
}

/// <summary>The answer to a lookup.</summary>
/// <param name="Outcome">What the store already holds for the id.</param>
/// <param name="ServerSequence">
/// The sequence at which the id is committed, or 0 for
/// <see cref="CollabOperationLookupOutcome.NotCommitted"/> — sequences start at
/// 1, so 0 can only mean "nothing".
/// </param>
public sealed record CollabOperationLookup(
    CollabOperationLookupOutcome Outcome,
    ulong ServerSequence);

/// <summary>How an append resolved.</summary>
public enum CollabOperationAppendOutcome
{
  /// <summary>The operation is new and is now durably journalled.</summary>
  Committed,

  /// <summary>
  /// This operation id is already committed with the same digest — a retry of
  /// work that was already durable. Nothing was written.
  /// </summary>
  Duplicate,

  /// <summary>
  /// This operation id is already committed with a DIFFERENT digest, so it
  /// cannot mean the same work. Nothing was written; the caller refuses the
  /// operation with <c>operation-id-conflict</c>.
  /// </summary>
  Conflict,
}

/// <summary>The answer to an append.</summary>
/// <param name="Outcome">Whether the operation was written, already there, or refused.</param>
/// <param name="ServerSequence">
/// The sequence at which this operation id is committed on this lineage —
/// newly assigned for <see cref="CollabOperationAppendOutcome.Committed"/>, and
/// the existing record's sequence for the other two. It is always at least 1.
/// </param>
public sealed record CollabOperationAppendResult(
    CollabOperationAppendOutcome Outcome,
    ulong ServerSequence);

/// <summary>
/// A new sequence-zero baseline, replacing whatever the document held.
/// </summary>
/// <remarks>
/// Reset is also the SEEDING path: a document whose
/// <see cref="CollabOperationOpenResult.Head"/> is null has no lineage yet, and
/// this is what gives it one.
/// </remarks>
/// <param name="Format">Schema the baseline frames were produced against.</param>
/// <param name="Epoch">
/// The new epoch. Above the old one when the document already had a head.
/// </param>
/// <param name="Lineage">
/// A freshly minted lineage — 32 lowercase hexadecimal characters, never one
/// this document has used before.
/// </param>
/// <param name="Baseline">
/// The ordered frames the new history starts from, stored byte for byte. It may
/// be empty for an empty document.
/// </param>
public sealed record CollabOperationReset(
    int Format,
    long Epoch,
    string Lineage,
    IReadOnlyList<ReadOnlyMemory<byte>> Baseline);

/// <summary>
/// Everything the caller needs to rebuild the document, read once when the
/// session was opened.
/// </summary>
/// <remarks>
/// This is a snapshot of the open, not a live view: it does not change when the
/// session appends, checkpoints or resets. Replay is
/// <see cref="Baseline"/>, then <see cref="Checkpoint"/> if there is one, then
/// <see cref="Tail"/> in order.
/// </remarks>
/// <param name="Head">
/// Null when this document has never been seeded — <see cref="Baseline"/> and
/// <see cref="Tail"/> are then empty and <see cref="Checkpoint"/> is null, and
/// the caller must call
/// <see cref="ICollabOperationSession.ResetAsync"/> before anything else.
/// </param>
/// <param name="Baseline">
/// The sequence-zero frames, byte for byte as they were written.
/// </param>
/// <param name="Checkpoint">
/// The most recently published checkpoint, or null when none exists.
/// </param>
/// <param name="Tail">
/// Committed operations after the checkpoint, in ascending sequence order with
/// no gaps — starting at <c>Checkpoint.Through + 1</c>, or at 1 when there is
/// no checkpoint. The last entry's sequence is <see cref="CollabDocumentHead.DurableThrough"/>;
/// when the tail is empty, <c>DurableThrough</c> is the checkpoint's
/// <c>Through</c>, or 0.
/// </param>
public sealed record CollabOperationOpenResult(
    CollabDocumentHead? Head,
    IReadOnlyList<ReadOnlyMemory<byte>> Baseline,
    CollabOperationCheckpoint? Checkpoint,
    IReadOnlyList<CollabOperationRecord> Tail);
