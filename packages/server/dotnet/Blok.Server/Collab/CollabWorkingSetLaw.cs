namespace Blok.Server.Collab;

/// <summary>
/// Shared decode-or-absent handling, the cancellation guard every driver call
/// goes through, and the epoch law. See <see cref="ICollabWorkingSetStore"/>
/// for the contract wording.
/// </summary>
internal static class CollabWorkingSetLaw
{
  /// <summary>
  /// A store timeout surfaces as OperationCanceledException even though the
  /// CALLER never cancelled. Reported as-is, the room cannot tell it from its
  /// own shutdown token and skips its failure handling entirely — so every
  /// driver call funnels through here and a foreign cancellation comes out as
  /// an ordinary store failure.
  /// </summary>
  internal static async Task<T> GuardAsync<T>(
      string docId,
      string what,
      Func<Task<T>> operation,
      CancellationToken cancellationToken)
  {
    try
    {
      return await operation();
    }
    catch (OperationCanceledException error)
        when (!cancellationToken.IsCancellationRequested)
    {
      throw new CollabWorkingSetStoreException(docId, what, error);
    }
  }

  internal static async Task GuardAsync(
      string docId,
      string what,
      Func<Task> operation,
      CancellationToken cancellationToken)
  {
    await GuardAsync<object?>(
        docId,
        what,
        async () =>
        {
          await operation();

          return null;
        },
        cancellationToken);
  }

  internal static CollabWorkingSet? DecodeOrAbsent(
      string docId,
      byte[] document,
      Action<string>? log)
  {
    if (CollabWorkingSetCodec.TryDecodeDocument(
          document,
          out var tag,
          out var frameSection,
          out var error))
    {
      return new CollabWorkingSet(frameSection, tag);
    }

    log?.Invoke(
        $"collab: the working set for \"{docId}\" is unreadable " +
        $"({error}); treating it as absent");

    return null;
  }

  internal static void EnsureWriteDoesNotLowerEpoch(
      string docId,
      CollabWorkingSet? stored,
      CollabWorkingSetTag next)
  {
    if (stored is not null && next.Epoch < stored.Tag.Epoch)
    {
      throw new InvalidOperationException(
          $"collab: refusing to lower the working-set epoch for " +
          $"\"{docId}\" from {stored.Tag.Epoch} to {next.Epoch}.");
    }
  }

  internal static void EnsureResetRaisesEpoch(
      string docId,
      CollabWorkingSet? stored,
      CollabWorkingSetTag next)
  {
    if (stored is not null && next.Epoch <= stored.Tag.Epoch)
    {
      throw new InvalidOperationException(
          $"collab: a reset must raise the working-set epoch for " +
          $"\"{docId}\" above {stored.Tag.Epoch} (got {next.Epoch}).");
    }
  }
}
