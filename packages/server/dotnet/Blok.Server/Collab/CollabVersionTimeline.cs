namespace Blok.Server.Collab;

/// <summary>One version in a document's history: the point to read and when it was edited.</summary>
/// <remarks>
/// Sequence is the version's last record. Sequence 0 is a lineage baseline;
/// both its times are the lineage's created-at. Actors are distinct, in
/// first-seen order.
/// </remarks>
internal sealed record CollabVersion(
    string Lineage,
    ulong Sequence,
    DateTimeOffset? StartedAt,
    DateTimeOffset? SavedAt,
    IReadOnlyList<string> Actors);

/// <summary>Groups journal record headers into versions by time.</summary>
internal static class CollabVersionTimeline
{
  public static readonly TimeSpan IdleGap = TimeSpan.FromMinutes(2);
  public static readonly TimeSpan MaxSpan = TimeSpan.FromMinutes(10);

  public static IReadOnlyList<CollabVersion> Group(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst)
  {
    var versions = new List<CollabVersion>();
    for (var i = lineagesOldestFirst.Count - 1; i >= 0; i--)
    {
      var (lineage, headers) = lineagesOldestFirst[i];
      var groups = new List<CollabVersion>();
      var start = 0;
      for (var r = 1; r <= headers.Count; r++)
      {
        if (r < headers.Count && !StartsGroup(headers[r], headers[r - 1], headers[start]))
        {
          continue;
        }

        groups.Add(ToVersion(lineage.Lineage, headers, start, r));
        start = r;
      }

      groups.Reverse();
      versions.AddRange(groups);
      versions.Add(new CollabVersion(lineage.Lineage, 0, lineage.CreatedAt, lineage.CreatedAt, []));
    }

    return versions;
  }

  // The store clock is wall time, so a record can be older than the one
  // before it. That negative gap never passes a limit, so it counts as 0.
  private static bool StartsGroup(CollabRecordHeader record, CollabRecordHeader previous, CollabRecordHeader first) =>
      record.CommittedAt - previous.CommittedAt > IdleGap
      || record.CommittedAt - first.CommittedAt >= MaxSpan;

  private static CollabVersion ToVersion(
      string lineage,
      IReadOnlyList<CollabRecordHeader> headers,
      int start,
      int end)
  {
    var actors = new List<string>();
    for (var r = start; r < end; r++)
    {
      if (headers[r].ActorId is { } actor && !actors.Contains(actor))
      {
        actors.Add(actor);
      }
    }

    return new CollabVersion(
        lineage,
        headers[end - 1].ServerSequence,
        headers[start].CommittedAt,
        headers[end - 1].CommittedAt,
        actors);
  }
}
