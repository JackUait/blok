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
}
