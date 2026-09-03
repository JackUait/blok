namespace Blok.Server.Yjs;

/// <summary>Whether an update reached the document at all.</summary>
internal enum ApplyOutcome
{
  Applied,
  Malformed,
}

/// <summary>
/// What <see cref="YDoc.ApplyUpdate(DecodedUpdate)"/> did.
/// <paramref name="PendingRemains"/> is the document's health signal after the
/// call: structs or deletions the update named but could not be applied yet.
/// <paramref name="Changed"/> is whether THIS update taught the document
/// anything: it integrated a struct, deleted something not already deleted,
/// or grew what the document has parked.
/// </summary>
/// <remarks>
/// <para>
/// <paramref name="Changed"/> exists because a caller CANNOT derive it from
/// the bytes, and both cheap guesses are wrong in opposite directions. "The
/// state vector moved" misses every deletion: a deletion creates no structs,
/// so the state vector is byte-identical across it. "The update carries
/// something" misses nothing but accepts far too much: yjs writes the delete
/// set WHOLE and never diffs it against the target, so an already-synced
/// peer's answer to SyncStep1 carries the document's entire deletion history
/// and is a no-op that grows with the document.
/// </para>
/// <para>
/// The engine is the only place that knows, because it is the only place that
/// tries: an already-deleted target is skipped rather than re-deleted, and a
/// struct the store already holds is not integrated again. Callers that
/// journal, relay or persist an update decide on this, never on its size.
/// </para>
/// <para>
/// WHAT IT CANNOT SEE: the parked half counts how many distinct clocks are
/// parked (<c>ParkedCoverage</c>), so parked content that rearranges itself
/// over the same clocks does not register. A false TRUE is safe here — a
/// caller journals a no-op — and a false FALSE is not: the update is applied
/// to the live document and then journalled nowhere and relayed to nobody. Any
/// doubt is resolved towards reporting a change, and a cheaper measure than a
/// union has twice turned out to be a false FALSE.
/// </para>
/// </remarks>
internal readonly record struct ApplyResult(
    ApplyOutcome Outcome, bool PendingRemains, bool Changed, string? Reason);
