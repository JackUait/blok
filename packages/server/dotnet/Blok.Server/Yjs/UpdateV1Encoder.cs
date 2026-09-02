namespace Blok.Server.Yjs;

/// <summary>
/// yjs's v1 update writer: client groups of structs, then a delete set.
///
/// Two callers, one body. A transaction writes the store's diff against its
/// own before-state; a state-as-update writes the store's diff against a
/// peer's vector, with everything still parked folded in by
/// <see cref="PendingNormalizer"/>.
/// </summary>
internal static class UpdateV1Encoder
{
  /// <summary>
  /// The update one transaction produced, or null when it changed nothing —
  /// yjs's writeUpdateMessageFromTransaction. Only INTEGRATED structs are
  /// written: a transaction that merely parked something changed no clock.
  /// </summary>
  public static byte[]? FromTransaction(YTransaction transaction)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    var store = transaction.Doc.Store;
    var after = transaction.AfterState ?? store.GetStateVector();

    if (transaction.DeleteSet.Count == 0 && !Advanced(transaction.BeforeState, after))
    {
      return null;
    }

    transaction.DeleteSet.SortAndMerge();

    var writer = new Lib0Writer();

    WriteRuns(writer, PendingNormalizer.StoreRuns(store, transaction.BeforeState));
    transaction.DeleteSet.Write(writer);

    return writer.ToArray();
  }

  /// <summary>Dispatches to the struct's own writer; yjs's virtual write.</summary>
  public static void WriteStruct(Lib0Writer writer, YStruct current, int offset)
  {
    switch (current)
    {
      case YItem item:
        item.Write(writer, offset);
        break;

      case YGc collected:
        collected.Write(writer, offset);
        break;

      case YSkip gap:
        gap.Write(writer, offset);
        break;

      default:
        throw new InvalidOperationException(
            $"yjs: {current?.GetType().Name ?? "null"} has no wire form.");
    }
  }

  /// <summary>
  /// yjs's LazyStructWriter: one group per client, the group's clock being
  /// the first struct's clock plus the offset it is written at.
  /// </summary>
  public static void WriteRuns(Lib0Writer writer, IReadOnlyList<EncodedRun> runs)
  {
    ArgumentNullException.ThrowIfNull(writer);
    ArgumentNullException.ThrowIfNull(runs);

    writer.WriteVarUint((ulong)runs.Count);

    foreach (var run in runs)
    {
      writer.WriteVarUint((ulong)run.Structs.Count);
      writer.WriteVarUint(run.Client);
      writer.WriteVarUint(run.Clock);

      foreach (var (current, offset) in run.Structs)
      {
        WriteStruct(writer, current, offset);
      }
    }
  }

  private static bool Advanced(StateVector before, StateVector after)
  {
    foreach (var (client, clock) in after)
    {
      if (before.Get(client) != clock)
      {
        return true;
      }
    }

    return false;
  }
}
