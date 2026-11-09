namespace Blok.Server.Collab;

/// <summary>One version in a document's history: the point to read and when it was edited.</summary>
/// <remarks>
/// Sequence is the version's last record. Sequence 0 is a lineage baseline;
/// both its times are the lineage's created-at. Actors are distinct, in
/// first-seen order. ActorKinds is null without a record notes store; with
/// one it holds each actor's first note, in Actors order, skipping actors
/// that have none.
/// </remarks>
internal sealed record CollabVersion(
    string Lineage,
    ulong Sequence,
    DateTimeOffset? StartedAt,
    DateTimeOffset? SavedAt,
    IReadOnlyList<string> Actors,
    IReadOnlyList<CollabActorKind>? ActorKinds = null);

/// <summary>One actor of a version and the note of its first record there.</summary>
internal sealed record CollabActorKind(string Id, CollabRecordNote Note);

/// <summary>Groups journal record headers into versions by time.</summary>
internal static class CollabVersionTimeline
{
  public static readonly TimeSpan IdleGap = TimeSpan.FromMinutes(2);
  public static readonly TimeSpan MaxSpan = TimeSpan.FromMinutes(10);

  public static IReadOnlyList<CollabVersion> Group(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst) =>
      Group(lineagesOldestFirst, IdleGap, MaxSpan);

  public static IReadOnlyList<CollabVersion> Group(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst,
      TimeSpan idleGap,
      TimeSpan maxSpan,
      bool byActor = false,
      Func<string, ulong, CollabRecordNote?>? noteOf = null)
  {
    var versions = new List<CollabVersion>();
    for (var i = lineagesOldestFirst.Count - 1; i >= 0; i--)
    {
      var (lineage, headers) = lineagesOldestFirst[i];
      var groups = new List<CollabVersion>();
      var start = 0;
      for (var r = 1; r <= headers.Count; r++)
      {
        if (r < headers.Count &&
            !StartsGroup(headers[r], headers[r - 1], headers[start], idleGap, maxSpan) &&
            !(byActor && !string.Equals(headers[r].ActorId, headers[r - 1].ActorId, StringComparison.Ordinal)))
        {
          continue;
        }

        groups.Add(ToVersion(lineage.Lineage, headers, start, r, noteOf));
        start = r;
      }

      groups.Reverse();
      versions.AddRange(groups);
      versions.Add(new CollabVersion(
          lineage.Lineage, 0, lineage.CreatedAt, lineage.CreatedAt, [], noteOf is null ? null : []));
    }

    return versions;
  }

  // The store clock is wall time, so a record can be older than the one
  // before it. That negative gap never passes a limit, so it counts as 0.
  private static bool StartsGroup(
      CollabRecordHeader record,
      CollabRecordHeader previous,
      CollabRecordHeader first,
      TimeSpan idleGap,
      TimeSpan maxSpan) =>
      record.CommittedAt - previous.CommittedAt > idleGap
      || record.CommittedAt - first.CommittedAt >= maxSpan;

  private static CollabVersion ToVersion(
      string lineage,
      IReadOnlyList<CollabRecordHeader> headers,
      int start,
      int end,
      Func<string, ulong, CollabRecordNote?>? noteOf)
  {
    var actors = new List<string>();
    for (var r = start; r < end; r++)
    {
      if (headers[r].ActorId is { } actor && !actors.Contains(actor))
      {
        actors.Add(actor);
      }
    }

    List<CollabActorKind>? kinds = null;

    if (noteOf is not null)
    {
      kinds = [];

      foreach (var actor in actors)
      {
        for (var r = start; r < end; r++)
        {
          if (headers[r].ActorId == actor && noteOf(lineage, headers[r].ServerSequence) is { } note)
          {
            kinds.Add(new CollabActorKind(actor, note));

            break;
          }
        }
      }
    }

    return new CollabVersion(
        lineage,
        headers[end - 1].ServerSequence,
        headers[start].CommittedAt,
        headers[end - 1].CommittedAt,
        actors,
        kinds);
  }
}
