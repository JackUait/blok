using System.Security.Claims;

namespace Blok.Server.AspNetCore;

/// <summary>
/// The application's per-document access decision, consulted by the sync
/// upgrade and by the HTTP edit and reset endpoints.
/// </summary>
/// <remarks>
/// Optional, and resolved only if registered — with no implementation every
/// caller the transport already authenticated reaches every document. Register
/// one with <see cref="BlokServerBuilderExtensions.UseAuthorization{T}"/>; it
/// is a singleton and is called concurrently for many documents at once.
/// <para>
/// Both members NARROW what the transport already granted and can never widen
/// it: a read-only ticket stays read-only however
/// <see cref="CanWriteDocumentAsync"/> answers.
/// </para>
/// </remarks>
public interface IBlokAuthorization
{
  /// <summary>May this caller see the document at all?</summary>
  /// <param name="user">
  /// The caller's identity. In ticket mode this is built from the verified
  /// pass rather than from <c>HttpContext.User</c>, which is empty there.
  /// </param>
  /// <param name="documentId">The document id from the route.</param>
  /// <param name="cancellationToken">Aborted with the request.</param>
  /// <returns>
  /// False to refuse: the sync upgrade is closed as forbidden, and an edit or
  /// reset answers 403.
  /// </returns>
  ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default);

  /// <summary>May this caller change the document?</summary>
  /// <param name="user">
  /// The caller's identity, resolved the same way as for
  /// <see cref="CanReadDocumentAsync"/>.
  /// </param>
  /// <param name="documentId">The document id from the route.</param>
  /// <param name="cancellationToken">Aborted with the request.</param>
  /// <returns>
  /// False to admit the caller read-only. A sync connection still opens and
  /// still receives updates; it just cannot commit any. An edit or reset
  /// answers 403.
  /// </returns>
  ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default);

  /// <summary>May this caller read the document's version history?</summary>
  /// <remarks>
  /// Asked on the history list, a version read, its changes, <c>history/at</c>,
  /// <c>history/changes</c>, a restore and <c>restore/preview</c>, only after
  /// <see cref="CanReadDocumentAsync"/> (and <see cref="CanWriteDocumentAsync"/>
  /// on a restore) said yes: a restore reads the version it writes. A delete is
  /// decided by the write gate.
  /// The default is yes, so history is readable to whoever can read the document.
  /// The in-process agent asks it too, with a principal named by the person it
  /// acts for, else by the agent.
  /// </remarks>
  /// <returns>False to answer 403.</returns>
  ValueTask<bool> CanReadHistoryAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default) => ValueTask.FromResult(true);

  /// <summary>How far back this caller may see the document's history.</summary>
  /// <remarks>
  /// Asked on every history request except a delete. A point older than now
  /// minus the window is hidden, never deleted: reading it, its changes,
  /// <c>history/at</c> resolving to it, a <c>before</c> naming it, a restore
  /// to it and its preview answer 404 <c>{"reason":"retention"}</c>; the list
  /// and the range leave it out. A negative window counts as zero. The
  /// in-process agent asks it too, as for <see cref="CanReadHistoryAsync"/>.
  /// </remarks>
  /// <returns>The window, or null (the default) for the whole history.</returns>
  ValueTask<TimeSpan?> HistoryWindowAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default) => ValueTask.FromResult<TimeSpan?>(null);

  /// <summary>Is this lineage held, so that it must not be deleted?</summary>
  /// <remarks>
  /// Asked by <c>DELETE /sync/{doc}/history/{lineage}</c> before anything
  /// else about the lineage: true answers 409 <c>{"reason":"held"}</c>.
  /// Blok stores no bookmarks: a host that keeps named versions as
  /// (lineage, sequence) pairs holds their lineages here. A document purge
  /// does not ask. The default holds nothing.
  /// </remarks>
  ValueTask<bool> IsHistoryHeldAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken = default) => ValueTask.FromResult(false);
}
