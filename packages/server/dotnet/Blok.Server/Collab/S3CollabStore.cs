using Blok.Server.Storage;

namespace Blok.Server.Collab;

/// <summary>
/// Stores working sets as objects named
/// "{prefix}/{doc key}" through <see cref="S3BlobStore"/>'s key-addressed
/// methods. The prefix comes from --collab-s3-prefix and the bucket must
/// not be publicly readable.
/// </summary>
internal sealed class S3CollabStore : ICollabWorkingSetStore
{
  private readonly S3BlobStore store;
  private readonly string prefix;
  private readonly Action<string>? log;

  internal S3CollabStore(
      S3BlobStore store,
      string prefix,
      Action<string>? log = null)
  {
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(prefix);

    var trimmedPrefix = prefix.Trim('/');

    if (trimmedPrefix == "")
    {
      throw new ArgumentException(
          "collab: the S3 prefix must not be empty.",
          nameof(prefix));
    }

    this.store = store;
    this.prefix = trimmedPrefix;
    this.log = log;
  }

  public async Task<CollabWorkingSet?> ReadAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    var document = await store.GetObjectAsync(
        KeyFor(docId),
        cancellationToken);

    return document is null
      ? null
      : CollabWorkingSetLaw.DecodeOrAbsent(docId, document, log);
  }

  public async Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(updates);

    var document = CollabWorkingSetCodec.EncodeDocument(tag, updates);
    CollabWorkingSetLaw.EnsureWriteDoesNotLowerEpoch(
        docId,
        await ReadAsync(docId, cancellationToken),
        tag);
    await store.PutObjectAsync(
        KeyFor(docId),
        document,
        cancellationToken);
  }

  public async Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    var document = CollabWorkingSetCodec.EncodeDocument(newTag, []);
    CollabWorkingSetLaw.EnsureResetRaisesEpoch(
        docId,
        await ReadAsync(docId, cancellationToken),
        newTag);
    await store.PutObjectAsync(
        KeyFor(docId),
        document,
        cancellationToken);
  }

  private string KeyFor(string docId)
  {
    return $"{prefix}/{CollabDocKey.For(docId)}";
  }
}
