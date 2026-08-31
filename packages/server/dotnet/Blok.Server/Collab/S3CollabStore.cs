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

  public Task<CollabWorkingSet?> ReadAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "read",
        async () =>
        {
          var document = await store.GetObjectAsync(
              KeyFor(docId),
              cancellationToken);

          return document is null
            ? null
            : CollabWorkingSetLaw.DecodeOrAbsent(docId, document, log);
        },
        cancellationToken);
  }

  /// <summary>
  /// No guard read: a write happens per edit, and a GET of the whole object
  /// before every PUT would double the traffic and the latency for a check
  /// the room already owns (see <see cref="ICollabWorkingSetStore"/>). S3
  /// cannot read a header cheaply the way the local driver can.
  /// </summary>
  public Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(updates);

    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "write",
        () => store.PutObjectAsync(
            KeyFor(docId),
            CollabWorkingSetCodec.EncodeDocument(tag, updates),
            cancellationToken),
        cancellationToken);
  }

  /// <summary>A reset is an operator lever, so it can afford the guard read a write cannot.</summary>
  public Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "reset",
        async () =>
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
        },
        cancellationToken);
  }

  private string KeyFor(string docId)
  {
    return $"{prefix}/{CollabDocKey.For(docId)}";
  }
}
