using System.Runtime.CompilerServices;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>
/// Rebuilds the document as it stood at one point of a lineage: the baseline
/// frames, then records 1..N in journal order. Each update goes through the
/// same screen and apply as <c>CollabRoom.ApplyRemoteLocked</c>. A record
/// that arrives before its dependency is parked by the engine and lands with
/// the dependency, as it did live.
/// </summary>
internal static class CollabHistoryReplay
{
  public static async ValueTask<YDoc> BuildAsync(
      IReadOnlyList<ReadOnlyMemory<byte>> baseline,
      IAsyncEnumerable<CollabOperationRecord> records,
      CancellationToken ct)
  {
    var doc = new YDoc();

    for (var index = 0; index < baseline.Count; index++)
    {
      ct.ThrowIfCancellationRequested();
      Apply(doc, baseline[index], null, $"baseline frame {index}");
    }

    await foreach (var record in records.WithCancellation(ct).ConfigureAwait(false))
    {
      ct.ThrowIfCancellationRequested();
      Apply(doc, record.Update, record.ServerSequence, $"record {record.ServerSequence}");
    }

    return doc;
  }

  /// <summary>
  /// The same replay, one step at a time: the baseline (record null), then
  /// each record. Every step yields the same doc, changed in place, so read
  /// it before asking for the next step.
  /// </summary>
  public static async IAsyncEnumerable<(CollabOperationRecord? Record, YDoc Doc)> StepAsync(
      IReadOnlyList<ReadOnlyMemory<byte>> baseline,
      IAsyncEnumerable<CollabOperationRecord> records,
      [EnumeratorCancellation] CancellationToken ct)
  {
    var doc = new YDoc();

    for (var index = 0; index < baseline.Count; index++)
    {
      ct.ThrowIfCancellationRequested();
      Apply(doc, baseline[index], null, $"baseline frame {index}");
    }

    yield return (null, doc);

    await foreach (var record in records.WithCancellation(ct).ConfigureAwait(false))
    {
      ct.ThrowIfCancellationRequested();
      Apply(doc, record.Update, record.ServerSequence, $"record {record.ServerSequence}");

      yield return (record, doc);
    }
  }

  /// <summary>
  /// The live room drops a refused update; here it throws, because a point
  /// rebuilt without it is not the point the journal names.
  /// </summary>
  private static void Apply(YDoc doc, ReadOnlyMemory<byte> update, ulong? sequence, string name)
  {
    // The default depth equals YDocConverter.MaxValueDepth: the edit path
    // journals uninspected, and its deepest Any is exactly that deep.
    var inspection = UpdateInspector.Inspect(update.Span);

    if (inspection.Verdict != UpdateVerdict.Ok || inspection.Decoded is null)
    {
      throw new CollabHistoryReplayException(
          sequence, $"collab: history replay could not read {name}: {inspection.Reason}");
    }

    try
    {
      doc.ApplyUpdate(inspection.Decoded);
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      throw new CollabHistoryReplayException(
          sequence, $"collab: history replay could not apply {name}: {error.Message}", error);
    }
  }
}

/// <summary>A baseline frame or record that the replay could not read or apply.</summary>
internal sealed class CollabHistoryReplayException(
    ulong? sequence, string message, Exception? innerException = null)
    : Exception(message, innerException)
{
  /// <summary>The record's server sequence, or null for a baseline frame.</summary>
  public ulong? Sequence { get; } = sequence;
}
