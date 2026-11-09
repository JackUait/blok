namespace Blok.Server.Collab;

/// <summary>The point a time reads. <paramref name="Point"/> is set only when Ready.</summary>
internal sealed record CollabHistoryAtResult(CollabHistoryStatus Status, CollabHistoryPoint? Point);

/// <summary>One record's edits in a changes-by-time answer.</summary>
internal sealed record CollabRangeRecord(string Lineage, CollabRecordChanges Changes);

/// <summary>The changes-by-time answer, newest first. <paramref name="Truncated"/>: older records in the range were left out.</summary>
internal sealed record CollabHistoryRangeResult(
    CollabHistoryStatus Status,
    IReadOnlyList<CollabRangeRecord> Records,
    bool Truncated);

internal sealed partial class CollabRoomManager
{
  /// <summary>Every lineage, oldest first, with its record headers.</summary>
  private async ValueTask<(CollabHistoryStatus Status, List<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> Lineages)>
      ReadTimelineAsync(string docId, CancellationToken cancellationToken)
  {
    var lineages = new List<(CollabLineageInfo, IReadOnlyList<CollabRecordHeader>)>();

    if (operationStore is not ICollabOperationHistoryStore history)
    {
      return (CollabHistoryStatus.NoHistory, lineages);
    }

    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return (CollabHistoryStatus.Purged, lineages);
    }

    try
    {
      foreach (var lineage in await history.ListLineagesAsync(docId, cancellationToken))
      {
        var headers = new List<CollabRecordHeader>();

        await foreach (var header in history.ReadHeadersAsync(docId, lineage.Lineage, cancellationToken))
        {
          headers.Add(header);
        }

        lineages.Add((lineage, headers));
      }
    }
    catch (InvalidDataException error)
    {
      log?.Invoke($"collab: the history of \"{docId}\" could not be read: {error.Message}");

      return (CollabHistoryStatus.Corrupt, []);
    }

    // A purge that raced the reads leaves them empty.
    return await IsPurgedAsync(history, docId, cancellationToken)
      ? (CollabHistoryStatus.Purged, [])
      : (CollabHistoryStatus.Ready, lineages);
  }

  /// <summary>The newest point at or before <paramref name="time"/>. NotFound when the history starts later.</summary>
  internal async ValueTask<CollabHistoryAtResult> AtAsync(
      string docId,
      DateTimeOffset time,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    var (status, lineages) = await ReadTimelineAsync(docId, cancellationToken);

    if (status != CollabHistoryStatus.Ready)
    {
      return new CollabHistoryAtResult(status, null);
    }

    return CollabHistoryTime.ResolveAt(lineages, time) is { } point
      ? new CollabHistoryAtResult(CollabHistoryStatus.Ready, point)
      : new CollabHistoryAtResult(CollabHistoryStatus.NotFound, null);
  }

  /// <summary>
  /// The edits of each record committed in [<paramref name="from"/>, <paramref name="to"/>),
  /// older than <paramref name="before"/> when given, newest first across
  /// lineages. Each lineage replays on its own, under the same caps as
  /// <see cref="ChangesAsync"/>.
  /// </summary>
  internal async ValueTask<CollabHistoryRangeResult> ChangesBetweenAsync(
      string docId,
      DateTimeOffset from,
      DateTimeOffset to,
      (string Lineage, ulong Sequence)? before,
      int maxRecords = MaxChangeRecords,
      int maxBytes = MaxChangeBytes,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    var (status, lineages) = await ReadTimelineAsync(docId, cancellationToken);

    if (status != CollabHistoryStatus.Ready)
    {
      return new CollabHistoryRangeResult(status, [], false);
    }

    var selection = CollabHistoryTime.SelectRange(lineages, from, to, before, maxRecords);

    if (selection.Status != CollabHistoryStatus.Ready)
    {
      return new CollabHistoryRangeResult(selection.Status, [], false);
    }

    var records = new List<CollabRangeRecord>();
    var truncated = selection.Truncated;
    // One record and byte budget for the whole answer: each lineage replays
    // with what the newer ones left.
    long consumed = 0;

    for (var start = 0; start < selection.Records.Count;)
    {
      if (records.Count > 0 && consumed >= maxBytes)
      {
        truncated = true;

        break;
      }

      var lineage = selection.Records[start].Lineage;
      var end = start;
      var picked = new HashSet<ulong>();

      while (end < selection.Records.Count && selection.Records[end].Lineage == lineage)
      {
        picked.Add(selection.Records[end].Sequence);
        end++;
      }

      var result = await ChangesAsync(
          docId,
          lineage,
          selection.Records[start].Sequence,
          selection.Records[end - 1].Sequence - 1,
          maxRecords - records.Count,
          (int)Math.Max(1, maxBytes - consumed),
          cancellationToken);

      if (result.Status != CollabHistoryStatus.Ready)
      {
        return new CollabHistoryRangeResult(result.Status, [], false);
      }

      for (var i = result.Changes.Count - 1; i >= 0; i--)
      {
        if (!picked.Contains(result.Changes[i].Sequence))
        {
          continue;
        }

        var size = CollabVersionChanges.RecordBytes(result.Changes[i]);

        if (!CollabHistoryTime.Fits(records.Count, consumed, size, maxBytes))
        {
          return new CollabHistoryRangeResult(CollabHistoryStatus.Ready, records, true);
        }

        records.Add(new CollabRangeRecord(lineage, result.Changes[i]));
        consumed += size;
      }

      // Older records were dropped inside this lineage: anything older still is past the cut.
      if (result.Truncated)
      {
        truncated = true;

        break;
      }

      start = end;
    }

    return new CollabHistoryRangeResult(CollabHistoryStatus.Ready, records, truncated);
  }
}
