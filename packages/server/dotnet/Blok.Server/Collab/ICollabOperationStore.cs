namespace Blok.Server.Collab;

/// <summary>How an open attempt resolved.</summary>
public enum CollabDocumentOpenOutcome
{
  /// <summary>The document is open and the session holds its fence.</summary>
  Opened,

  /// <summary>
  /// A LIVE process holds this document. One process per document is the
  /// standing rule; the caller refuses the join as unavailable rather than
  /// waiting or forcing the fence. See
  /// <see cref="ICollabOperationStore.OpenAsync"/> for what a store owes a
  /// holder that has died.
  /// </summary>
  DocumentOpenElsewhere,
}

/// <summary>The answer to <see cref="ICollabOperationStore.OpenAsync"/>.</summary>
public sealed record CollabDocumentOpen
{
  private CollabDocumentOpen(
      CollabDocumentOpenOutcome outcome,
      ICollabOperationSession? session)
  {
    Outcome = outcome;
    Session = session;
  }

  /// <summary>
  /// Another live process holds the document; no session was taken.
  /// </summary>
  public static CollabDocumentOpen DocumentOpenElsewhere { get; } =
      new(CollabDocumentOpenOutcome.DocumentOpenElsewhere, null);

  /// <summary>The document was opened and <paramref name="session"/> holds its fence.</summary>
  public static CollabDocumentOpen Opened(ICollabOperationSession session)
  {
    ArgumentNullException.ThrowIfNull(session);

    return new CollabDocumentOpen(CollabDocumentOpenOutcome.Opened, session);
  }

  /// <summary>Whether a session was taken.</summary>
  public CollabDocumentOpenOutcome Outcome { get; }

  /// <summary>
  /// Non-null exactly when <see cref="Outcome"/> is
  /// <see cref="CollabDocumentOpenOutcome.Opened"/>. The caller owns it and
  /// must dispose it.
  /// </summary>
  public ICollabOperationSession? Session { get; }
}

/// <summary>
/// The session no longer holds the document's fence: another process opened the
/// document, so this session may no longer write.
/// </summary>
/// <remarks>
/// A store throws this instead of failing quietly, because a session that keeps
/// "succeeding" after losing the fence is how two writers silently fork one
/// history. The caller's only correct response is to stop using the session,
/// dispose it, and reopen the document.
/// </remarks>
public sealed class CollabOperationFenceLostException : Exception
{
  /// <inheritdoc/>
  public CollabOperationFenceLostException()
      : base("collab: the operation-store session no longer holds the document fence")
  {
  }

  /// <inheritdoc/>
  public CollabOperationFenceLostException(string message)
      : base(message)
  {
  }

  /// <inheritdoc/>
  public CollabOperationFenceLostException(string message, Exception innerException)
      : base(message, innerException)
  {
  }
}

/// <summary>
/// Durable storage for a document's collaboration operation journal.
/// </summary>
/// <remarks>
/// <para>
/// The journal is authoritative. Every accepted edit is appended here and only
/// then broadcast, so whole-document JSON becomes a projection of this history
/// rather than the record of it.
/// </para>
/// <para>
/// Implement this to keep collaboration history in your own backend. A
/// relational implementation maps to one document-head row plus an operations
/// table with unique <c>(document, lineage, operationId)</c> and
/// <c>(document, lineage, serverSequence)</c> constraints.
/// </para>
/// <para>
/// There is deliberately no way to write a document from this interface. Every
/// mutation lives on <see cref="ICollabOperationSession"/>, so nothing can be
/// written without first holding the document's fence.
/// </para>
/// <para>
/// Register an implementation with
/// <c>AddBlokServer(…).UseCollabOperationStore&lt;T&gt;()</c>. It is resolved as
/// a singleton and must be safe to use from several documents at once.
/// </para>
/// </remarks>
public interface ICollabOperationStore
{
  /// <summary>
  /// Takes the document's fence and reads back everything needed to rebuild it.
  /// </summary>
  /// <param name="documentId">
  /// The document to open. It is caller-supplied text; treat it as untrusted
  /// when it becomes a path, a key or a query parameter.
  /// </param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <returns>
  /// An open session, or
  /// <see cref="CollabDocumentOpen.DocumentOpenElsewhere"/> when a live process
  /// holds the document. A held document is an ordinary answer, not an error.
  /// </returns>
  /// <remarks>
  /// <para>
  /// LIVENESS IS THE STORE'S JOB, and it is half of the fence rule. The other
  /// half is stated here because a stranger cannot derive it: a store MUST NOT
  /// take the fence from a holder that is still live, and it MUST be able to
  /// reclaim the fence of a holder that has died. Refusing whenever a holder
  /// record exists satisfies the first half and locks the document forever the
  /// first time a process is killed — nothing else in this seam releases a dead
  /// holder's fence. How liveness is decided is the implementation's own
  /// business: the built-in local store gets it from an OS file lock, which the
  /// kernel drops when the process ends; a store over SQL needs a lease with an
  /// expiry it renews. Whatever the mechanism, a holder that is merely slow can
  /// be judged dead, which is why the session re-verifies the fence on every
  /// call instead of trusting the open.
  /// </para>
  /// <para>
  /// THE READ-BACK IS LINEARIZABLE. The open must observe every operation,
  /// checkpoint and reset committed under any earlier fence — including one
  /// committed microseconds before the previous holder died. A store whose read
  /// may lag its own writes will hand back a stale head, and the caller will
  /// then reassign a sequence that is already taken and answer
  /// <see cref="CollabOperationLookupOutcome.NotCommitted"/> for an id that is
  /// committed. An eventually-consistent read is not sufficient here.
  /// </para>
  /// <para>
  /// A document that has never been seeded opens successfully with a null
  /// <see cref="CollabOperationOpenResult.Head"/>; the caller seeds it through
  /// <see cref="ICollabOperationSession.ResetAsync"/>.
  /// </para>
  /// </remarks>
  ValueTask<CollabDocumentOpen> OpenAsync(
      string documentId,
      CancellationToken cancellationToken = default);
}

/// <summary>
/// An exclusive, fenced handle on one document's journal.
/// </summary>
/// <remarks>
/// <para>
/// THE FENCE IS THE SAFETY PROPERTY OF THIS SEAM. While this session lives it
/// is the only writer of the document. If another process reclaims the fence —
/// which it may only do once this holder is judged dead, see
/// <see cref="ICollabOperationStore.OpenAsync"/> — this session is stale, and
/// every method here MUST then fail with
/// <see cref="CollabOperationFenceLostException"/> rather than write, or
/// answer, as if it still owned the document — a file lock is advisory, and a
/// holder with a stale descriptor can still reach the bytes, so the fence has
/// to be re-verified on every call rather than assumed from the open.
/// </para>
/// <para>
/// The session is a single lane: the caller serialises its own use of it. An
/// implementation MAY group-commit appends from several documents' sessions
/// into one write, as long as every completion still means durable.
/// </para>
/// <para>
/// After <see cref="System.IAsyncDisposable.DisposeAsync"/> every method throws
/// <see cref="ObjectDisposedException"/>. Disposal runs on the same single lane
/// as everything else — the caller never disposes while another call is in
/// flight, which is what the failure path (throw, discard the room, dispose)
/// already does. It releases the fence so another process may open the
/// document, and never throws because the fence was already lost. A session
/// that HAS lost the fence releases nothing: the fence it would release now
/// belongs to somebody else.
/// </para>
/// <para>
/// CANCELLATION: only the caller's own token being cancelled may produce an
/// <see cref="OperationCanceledException"/>. A store-side timeout or abort MUST
/// surface as some other exception — the caller reads a cancellation
/// it did not ask for as its own shutdown and stops cleanly instead of treating
/// the document as unavailable.
/// </para>
/// </remarks>
public interface ICollabOperationSession : IAsyncDisposable
{
  /// <summary>
  /// The document as it stood when this session opened. It does not change as
  /// the session writes.
  /// </summary>
  CollabOperationOpenResult OpenResult { get; }

  /// <summary>
  /// Reports what this lineage already holds for an operation id, without
  /// writing anything.
  /// </summary>
  /// <param name="operationId">32 lowercase hexadecimal characters.</param>
  /// <param name="digest">
  /// The digest the caller would commit under that id — the same value it would
  /// put on a <see cref="CollabOperationCandidate"/>. It is what separates a
  /// retry from a reused id.
  /// </param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <returns>
  /// <see cref="CollabOperationLookupOutcome.NotCommitted"/> with sequence 0 for
  /// an id this lineage has never committed;
  /// <see cref="CollabOperationLookupOutcome.Duplicate"/> or
  /// <see cref="CollabOperationLookupOutcome.Conflict"/> with the committed
  /// sequence otherwise. A store that answers Duplicate or Conflict here must
  /// answer the same for an <see cref="AppendAsync"/> of the same id.
  /// </returns>
  /// <remarks>
  /// <para>
  /// THE ANSWER COMES FROM THE DURABLE INDEX, never from a memo of what this
  /// session has appended. Those differ in exactly the case this method exists
  /// for: an append that threw may still have committed, so the session's own
  /// idea of what it wrote is precisely what is wrong after an unknown outcome,
  /// and the retry that follows is the one lookup that must not be answered
  /// from memory. Reading through to storage also covers the ordinary case (an
  /// id committed a moment ago through this same session) for free.
  /// </para>
  /// <para>
  /// This exists so the caller can settle an operation id BEFORE it mutates the
  /// live document. Learning about a conflict only from
  /// <see cref="AppendAsync"/> is too late: the document has already been
  /// changed with bytes the journal then refuses, and the room's only exit is
  /// to discard itself and reload — which would turn a per-operation refusal
  /// into a close for everyone in the room, on any writer's say-so.
  /// </para>
  /// <para>
  /// The lookup covers the CURRENT lineage only. Operations from a superseded
  /// lineage remain history but can never be replayed, so their ids are not
  /// answered for here.
  /// </para>
  /// </remarks>
  ValueTask<CollabOperationLookup> FindCommittedAsync(
      string operationId,
      ReadOnlyMemory<byte> digest,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Appends one operation, assigning the next server sequence, or reports that
  /// the operation id is already committed.
  /// </summary>
  /// <param name="candidate">The operation to commit.</param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <returns>
  /// <see cref="CollabOperationAppendOutcome.Committed"/> with the newly
  /// assigned sequence, <see cref="CollabOperationAppendOutcome.Duplicate"/>
  /// when the same id is already committed with the same digest, or
  /// <see cref="CollabOperationAppendOutcome.Conflict"/> when it is already
  /// committed with a different digest.
  /// </returns>
  /// <remarks>
  /// <para>
  /// DURABLE MEANS DURABLE: when this task completes with
  /// <see cref="CollabOperationAppendOutcome.Committed"/>, the record must
  /// survive the process dying immediately afterwards — flushed to stable
  /// storage, or committed in the database sense. The caller broadcasts the
  /// update and tells the writer "saved" on the strength of that completion, so
  /// returning before the write is durable turns into a false save receipt.
  /// </para>
  /// <para>
  /// Sequence assignment and the id check are one atomic step: no two
  /// operations may ever receive the same sequence on one lineage, and no id may
  /// be committed twice.
  /// </para>
  /// <para>
  /// Appending to a document that has never been seeded is a caller error: the
  /// document needs a lineage from <see cref="ResetAsync"/> first, and a store
  /// reports the mistake with <see cref="InvalidOperationException"/>.
  /// </para>
  /// <para>
  /// A failure — including an outcome the store cannot determine, such as a
  /// write that may or may not have landed — must be thrown, not swallowed. The
  /// caller then broadcasts nothing, acknowledges nothing, and reloads the
  /// document from committed data; the producer retries the same operation id,
  /// which resolves the unknown outcome through the duplicate check above.
  /// </para>
  /// </remarks>
  ValueTask<CollabOperationAppendResult> AppendAsync(
      CollabOperationCandidate candidate,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Publishes a checkpoint so later opens replay less history.
  /// </summary>
  /// <param name="checkpoint">The state and the sequence it covers.</param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <remarks>
  /// Completion means the checkpoint is durable and will be handed back by the
  /// next open. History is not touched: the operations it covers, and their ids,
  /// stay in the journal. A store rejects a
  /// <see cref="CollabOperationCheckpoint.Through"/> that is not a committed
  /// sequence, or that is strictly BELOW an already published one, with
  /// <see cref="ArgumentOutOfRangeException"/>. Republishing at the sequence
  /// already published succeeds and changes nothing: it is the natural retry
  /// after a checkpoint whose outcome was unknown, and what a periodic
  /// checkpointer does when nothing has advanced, so it must not force every
  /// caller to track state it should not need.
  /// </remarks>
  ValueTask WriteCheckpointAsync(
      CollabOperationCheckpoint checkpoint,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Atomically replaces the document with a new epoch, a new lineage and a new
  /// sequence-zero baseline. This is also how an unseeded document is seeded.
  /// </summary>
  /// <param name="reset">The new baseline and the identity it carries.</param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <returns>
  /// The new head. Its <see cref="CollabDocumentHead.DurableThrough"/> is 0 —
  /// nothing has been committed on the new lineage yet.
  /// </returns>
  /// <remarks>
  /// <para>
  /// Completion means the new baseline is durable. Operations from the old
  /// lineage remain history and keep their ids, but they can never be replayed
  /// into the new one; an open after a reset returns only the new lineage.
  /// </para>
  /// <para>
  /// The caller owns the epoch law and passes an epoch above the current head's.
  /// A store MAY verify that from the head it already holds and refuse a
  /// regression with <see cref="ArgumentOutOfRangeException"/>; it MUST NOT
  /// invent an epoch of its own. Lineage novelty is not something a store can
  /// check, and is not checked.
  /// </para>
  /// </remarks>
  ValueTask<CollabDocumentHead> ResetAsync(
      CollabOperationReset reset,
      CancellationToken cancellationToken = default);
}
