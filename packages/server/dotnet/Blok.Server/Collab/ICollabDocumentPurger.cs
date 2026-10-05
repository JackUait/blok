namespace Blok.Server.Collab;

/// <summary>Permanently deletes one document's collaboration state.</summary>
public interface ICollabDocumentPurger
{
  /// <summary>Authorizes deletion before changing any sidecar state.</summary>
  ValueTask<CollabDocumentPurgeOutcome> PurgeDocumentAsync(
      string documentId,
      Func<CancellationToken, ValueTask<bool>> authorize,
      CancellationToken cancellationToken = default);
}
