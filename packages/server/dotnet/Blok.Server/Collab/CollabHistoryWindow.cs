namespace Blok.Server.Collab;

/// <summary>
/// A host's history window: points older than the cut are hidden, never
/// deleted. Each lineage hides a prefix up to its floor sequence, so every
/// route draws the same line. Times compare as UTC ticks.
/// </summary>
internal static class CollabHistoryWindow
{
  /// <summary>now − window, never before tick 0. A negative window counts as zero.</summary>
  public static DateTimeOffset Cut(DateTimeOffset now, TimeSpan window) =>
      new(Math.Max(0, now.UtcTicks - Math.Max(0, window.Ticks)), TimeSpan.Zero);

  /// <summary>
  /// The highest sequence the cut hides, null when it hides none. The baseline
  /// (sequence 0) is hidden when its lineage was created before the cut, or
  /// has no created-at. A record is hidden when committed before the cut, and
  /// so is every point below a hidden one.
  /// </summary>
  public static ulong? Floor(DateTimeOffset? createdAt, IReadOnlyList<CollabRecordHeader> headers, DateTimeOffset cut)
  {
    ulong? floor = createdAt is not { } created || created.UtcTicks < cut.UtcTicks ? 0 : null;

    foreach (var header in headers)
    {
      if (header.CommittedAt.UtcTicks < cut.UtcTicks && (floor is not { } at || header.ServerSequence > at))
      {
        floor = header.ServerSequence;
      }
    }

    return floor;
  }

  public static bool Hides(ulong? floor, ulong sequence) => floor is { } at && sequence <= at;

  /// <summary>A changes read's since, raised to the floor so no hidden record is listed.</summary>
  public static ulong Since(ulong? floor, ulong since) => floor is { } at && at > since ? at : since;

  /// <summary>Each lineage's floor, by name; a repeated name keeps the newest.</summary>
  public static Dictionary<string, ulong?> Floors(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineages,
      DateTimeOffset cut)
  {
    var floors = new Dictionary<string, ulong?>(StringComparer.Ordinal);

    foreach (var (lineage, headers) in lineages)
    {
      floors[lineage.Lineage] = Floor(lineage.CreatedAt, headers, cut);
    }

    return floors;
  }

  /// <summary>Whether the point is hidden. A lineage the timeline lacks hides nothing: it answers not found.</summary>
  public static bool Hides(IReadOnlyDictionary<string, ulong?> floors, string lineage, ulong sequence) =>
      floors.TryGetValue(lineage, out var floor) && Hides(floor, sequence);

  /// <summary>The timeline as the window shows it: hidden records dropped, a hidden baseline without its created-at.</summary>
  public static List<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> Visible(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineages,
      DateTimeOffset cut)
  {
    var visible = new List<(CollabLineageInfo, IReadOnlyList<CollabRecordHeader>)>(lineages.Count);

    foreach (var (lineage, headers) in lineages)
    {
      var floor = Floor(lineage.CreatedAt, headers, cut);

      visible.Add((
          floor is null ? lineage : lineage with { CreatedAt = null },
          [.. headers.Where(header => !Hides(floor, header.ServerSequence))]));
    }

    return visible;
  }
}
