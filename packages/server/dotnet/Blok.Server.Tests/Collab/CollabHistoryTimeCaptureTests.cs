using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// History by time, captured from C# into fixtures/collab-history/: the time
/// format the routes take, the point a time reads (at-time.json) and the
/// records a time range lists (changes-range.json). Go and Rust read the same
/// files. Times are .NET ticks, written as strings. Set
/// BLOK_WRITE_COLLAB_HISTORY=1 to rewrite the files after an intended change.
/// </summary>
public sealed class CollabHistoryTimeCaptureTests
{
  private static readonly DateTimeOffset T0 = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);
  private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);
  private static readonly TimeSpan Tick = TimeSpan.FromTicks(1);
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  private sealed record Lineage(string Name, DateTimeOffset? CreatedAt, (ulong Sequence, DateTimeOffset At)[] Headers);

  [Fact]
  public void TheAtTimeFixtureMatchesTheResolver()
  {
    Check("collab-history/at-time.json", AtTime());
  }

  [Fact]
  public void TheChangesRangeFixtureMatchesTheSelection()
  {
    Check("collab-history/changes-range.json", ChangesRange());
  }

  private static void Check(string relative, JsonObject built)
  {
    var path = RichTextFixtures.PathOf(relative);
    var text = built.ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), $"{relative} is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static string Ticks(DateTimeOffset at) => at.UtcTicks.ToString(CultureInfo.InvariantCulture);

  private static JsonNode? Ticks(DateTimeOffset? at) => at is { } value ? Ticks(value) : null;

  private static List<(CollabLineageInfo, IReadOnlyList<CollabRecordHeader>)> Build(Lineage[] lineages) =>
      [.. lineages.Select(entry => (
          new CollabLineageInfo(entry.Name, 1, 2, entry.CreatedAt, false),
          (IReadOnlyList<CollabRecordHeader>)[.. entry.Headers.Select(header => new CollabRecordHeader(header.Sequence, header.At, null))]))];

  private static JsonArray Written(Lineage[] lineages) =>
      [.. lineages.Select(entry => (JsonNode)new JsonObject
      {
        ["lineage"] = entry.Name,
        ["createdAt"] = Ticks(entry.CreatedAt),
        ["headers"] = new JsonArray([.. entry.Headers.Select(header => (JsonNode)new JsonObject
        {
          ["sequence"] = header.Sequence.ToString(CultureInfo.InvariantCulture),
          ["committedAt"] = Ticks(header.At),
        })]),
      })];

  private static JsonNode? Point(CollabHistoryPoint? point) => point is null
      ? null
      : new JsonObject
      {
        ["lineage"] = point.Lineage,
        ["sequence"] = point.Sequence.ToString(CultureInfo.InvariantCulture),
        ["committedAt"] = Ticks(point.CommittedAt),
      };

  // ---- at-time ----

  private static JsonObject AtTime()
  {
    string[] texts =
    [
      "2026-10-07T12:00:00Z",
      "2026-10-07T12:00:00.1234567Z",
      "2026-10-07T12:00:00.5Z",
      "2026-10-07T15:30:00+03:30",
      "2026-10-07T08:00:00-04:00",
      "2026-10-07T12:00:00+14:00",
      "2026-10-07T12:00:00-14:00",
      "2024-02-29T00:00:00Z",
      "0001-01-01T00:00:00Z",
      "9999-12-31T23:59:59.9999999Z",
      "0001-01-01T00:00:00+00:01",
      "9999-12-31T23:59:59.9999999-00:01",
      "2026-10-07T12:00:00",
      "2026-10-07T12:00:00.12345678Z",
      "2026-10-07T12:00:00.Z",
      "2026-10-07t12:00:00Z",
      "2026-10-07T12:00:00z",
      "2026-10-07T12:00:60Z",
      "2026-10-07T24:00:00Z",
      "2026-10-07T12:00Z",
      "2026-10-07 12:00:00Z",
      "2026-10-07T12:00:00 03:00",
      "2026-10-07T12:00:00+0300",
      "2026-10-07T12:00:00+03",
      "2026-10-07T12:00:00+14:01",
      "2026-10-07T12:00:00+03:60",
      "2025-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-00-01T00:00:00Z",
      "2026-10-00T00:00:00Z",
      "0000-01-01T00:00:00Z",
      "+2026-10-07T12:00:00Z",
      "2026-10-07T12:00:00Z ",
      " 2026-10-07T12:00:00Z",
      "2026-10-07T12:00:00.1234567+01:00x",
      "2026-1０-07T12:00:00Z",
      "",
      "1791552000000",
    ];

    var parse = new JsonArray();

    foreach (var text in texts)
    {
      parse.Add(new JsonObject
      {
        ["text"] = text,
        ["ticks"] = CollabHistoryTime.TryParse(text, out var at) ? Ticks(at) : null,
      });
    }

    var later = T0 + TimeSpan.FromHours(1);
    Lineage one = new("L1", T0, [(1, T0 + Minute), (2, T0 + 2 * Minute), (3, T0 + 3 * Minute)]);
    Lineage reset = new("L2", later, [(1, later + Minute)]);

    (string Name, Lineage[] Lineages, DateTimeOffset Time)[] cases =
    [
      ("exactly on a record", [one], T0 + 2 * Minute),
      ("between two records", [one], T0 + 2 * Minute + 30 * TimeSpan.FromSeconds(1)),
      ("one tick before a record reads the one before it", [one], T0 + 2 * Minute - Tick),
      ("after the head", [one], T0 + TimeSpan.FromDays(3)),
      ("before everything", [one], T0 - Tick),
      ("exactly on the creation reads the baseline", [one], T0),
      ("between the creation and the first record reads the baseline", [one], T0 + 30 * TimeSpan.FromSeconds(1)),
      ("a lineage with no records reads its baseline", [new("L1", T0, [])], T0 + TimeSpan.FromDays(1)),
      ("after a reset, before the new first record, reads the new baseline", [one, reset], later + 30 * TimeSpan.FromSeconds(1)),
      ("after a reset and its first record", [one, reset], later + 2 * Minute),
      ("before a reset reads the old lineage", [one, reset], later - Tick),
      ("a reset at the same tick as the old last record: the later lineage wins",
          [one, new("L2", T0 + 3 * Minute, [])], T0 + 3 * Minute),
      ("equal record times: the higher sequence wins",
          [new("L1", T0, [(1, T0 + Minute), (2, T0 + Minute), (3, T0 + 2 * Minute)])], T0 + Minute),
      ("a record at the creation tick beats the baseline", [new("L1", T0, [(1, T0)])], T0),
      ("a baseline without a created-at is not a point", [new("L1", null, [])], T0),
      ("records still count when the created-at is unknown", [new("L1", null, [(1, T0), (2, T0 + Minute)])], T0 + Minute),
      ("a record older than the one before it",
          [new("L1", T0, [(1, T0 + 5 * Minute), (2, T0 + Minute)])], T0 + 2 * Minute),
      ("no lineages", [], T0),
    ];

    var written = new JsonArray();

    foreach (var (name, lineages, time) in cases)
    {
      written.Add(new JsonObject
      {
        ["name"] = name,
        ["lineages"] = Written(lineages),
        ["time"] = Ticks(time),
        ["point"] = Point(CollabHistoryTime.ResolveAt(Build(lineages), time)),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabHistoryTime as C# answers it. Captured by CollabHistoryTimeCaptureTests; do not edit by hand. parse: the time strings the routes take, as .NET UTC ticks, null when refused. cases: the newest point at or before the time; points are records and baselines with a created-at; equal times: the later lineage wins, then the higher sequence; point null answers 404. Times are .NET UTC ticks.",
      ["parse"] = parse,
      ["cases"] = written,
    };
  }

  // ---- changes-range ----

  private static JsonObject ChangesRange()
  {
    var later = T0 + TimeSpan.FromHours(1);
    Lineage one = new("L1", T0, [(1, T0 + Minute), (2, T0 + 2 * Minute), (3, T0 + 3 * Minute), (4, T0 + 4 * Minute)]);
    Lineage two = new("L2", later, [(1, later + Minute), (2, later + 2 * Minute)]);
    var all = T0 - TimeSpan.FromDays(1);
    var end = T0 + TimeSpan.FromDays(1);

    (string Name, Lineage[] Lineages, DateTimeOffset From, DateTimeOffset To, (string, ulong)? Before, int Max)[] cases =
    [
      ("the whole range, newest first", [one], all, end, null, 200),
      ("from is inclusive, to is exclusive", [one], T0 + 2 * Minute, T0 + 4 * Minute, null, 200),
      ("an empty range", [one], T0 + 2 * Minute, T0 + 2 * Minute, null, 200),
      ("the record cap cuts the oldest", [one], all, end, null, 2),
      ("a cap the range just fills is not a cut", [one], all, end, null, 4),
      ("before is exclusive", [one], all, end, ("L1", 3), 200),
      ("before with the cap pages on", [one], all, end, ("L1", 3), 1),
      ("before the first record leaves nothing", [one], all, end, ("L1", 1), 200),
      ("before past the head keeps the head", [one], all, end, ("L1", 9), 200),
      ("an unknown before lineage", [one], all, end, ("L9", 1), 200),
      ("two lineages, newest lineage first", [one, two], all, end, null, 200),
      ("a cut that spans lineages", [one, two], all, end, null, 3),
      ("before in the newer lineage", [one, two], all, end, ("L2", 2), 2),
      ("before in the older lineage skips the newer", [one, two], all, end, ("L1", 4), 200),
      ("a range inside one lineage of two", [one, two], later, end, null, 200),
      ("records outside the range in the middle are skipped",
          [new("L1", T0, [(1, T0 + Minute), (2, T0 + 9 * Minute), (3, T0 + 2 * Minute)])], T0, T0 + 5 * Minute, null, 200),
      ("no lineages", [], all, end, null, 200),
    ];

    Lineage three = new("L3", later + TimeSpan.FromHours(1), [(1, later + TimeSpan.FromHours(1) + Minute)]);

    (string Name, Lineage[] Lineages, int MaxLineages)[] lineageCases =
    [
      ("the lineage cap stops before the next lineage", [one, two, three], 2),
      ("one lineage at most", [one, two, three], 1),
      ("the lineage cap a range just fills is not a cut", [one, two, three], 3),
    ];

    var written = new JsonArray();
    var all8 = cases.Select(c => (c.Name, c.Lineages, c.From, c.To, c.Before, c.Max, MaxLineages: CollabHistoryTime.MaxRangeLineages));
    var capped = lineageCases.Select(c => (c.Name, c.Lineages, From: all, To: end, Before: ((string, ulong)?)null, Max: 200, c.MaxLineages));

    foreach (var (name, lineages, from, to, before, max, maxLineages) in all8.Concat(capped))
    {
      var selection = CollabHistoryTime.SelectRange(Build(lineages), from, to, before, max, maxLineages);

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["lineages"] = Written(lineages),
        ["from"] = Ticks(from),
        ["to"] = Ticks(to),
        ["before"] = before is { } point
          ? new JsonObject { ["lineage"] = point.Item1, ["sequence"] = point.Item2.ToString(CultureInfo.InvariantCulture) }
          : null,
        ["maxRecords"] = max,
        ["maxLineages"] = maxLineages,
        ["found"] = selection.Status == CollabHistoryStatus.Ready,
        ["records"] = new JsonArray([.. selection.Records.Select(Point)]),
        ["truncated"] = selection.Truncated,
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabHistoryTime.SelectRange as C# answers it. Captured by CollabHistoryTimeCaptureTests; do not edit by hand. Records committed in [from, to), older than before (lineage order, then sequence) when given, newest first, at most maxRecords from at most maxLineages lineages; truncated when an older one was left out; found false when before names an unknown lineage. fit: how many rows, newest first across lineages, one answer keeps under the byte cap; the first row always goes out. Times are .NET UTC ticks.",
      ["cases"] = written,
      ["fit"] = Fit(),
    };
  }

  /// <summary>Rows newest first across lineages, with their byte sizes, against the byte cap.</summary>
  private static JsonArray Fit()
  {
    const long cap = 4 * 1024 * 1024;
    (string Name, (string Lineage, ulong Sequence, long Bytes)[] Rows, long MaxBytes)[] cases =
    [
      ("everything fits", [("L2", 2, 10), ("L2", 1, 10), ("L1", 3, 10)], cap),
      ("several lineages whose rows together pass the cap",
          [("L3", 1, 3_000_000), ("L2", 2, 1_000_000), ("L2", 1, 500_000), ("L1", 9, 3_000_000), ("L1", 8, 10)], cap),
      ("a row exactly at the cap fits", [("L2", 1, cap - 10), ("L1", 1, 10), ("L1", 0, 1)], cap),
      ("the first row goes out even past the cap", [("L2", 1, cap + 1), ("L1", 1, 1)], cap),
      ("a first row of a later lineage that would pass the cap stays out", [("L2", 1, 10), ("L1", 5, cap)], cap),
      ("no rows", [], cap),
    ];

    return [.. cases.Select(c => (JsonNode)new JsonObject
    {
      ["name"] = c.Name,
      ["rows"] = new JsonArray([.. c.Rows.Select(row => (JsonNode)new JsonObject
      {
        ["lineage"] = row.Lineage,
        ["sequence"] = row.Sequence.ToString(CultureInfo.InvariantCulture),
        ["bytes"] = row.Bytes.ToString(CultureInfo.InvariantCulture),
      })]),
      ["maxBytes"] = c.MaxBytes.ToString(CultureInfo.InvariantCulture),
      ["kept"] = CollabHistoryTime.FitRows([.. c.Rows.Select(row => row.Bytes)], c.MaxBytes),
    })];
  }
}
