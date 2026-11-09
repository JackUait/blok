using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The history window hook, captured from C# into
/// fixtures/collab-history/window.json: the cut, each lineage's floor, and
/// what every route shows under it. Go and Rust read the same file. Set
/// BLOK_WRITE_COLLAB_HISTORY=1 to rewrite it after an intended change.
/// </summary>
public sealed class CollabHistoryWindowCaptureTests
{
  private static readonly DateTimeOffset T0 = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);
  private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);
  private static readonly TimeSpan Tick = TimeSpan.FromTicks(1);
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  private sealed record Lineage(string Name, DateTimeOffset? CreatedAt, (ulong Sequence, DateTimeOffset At)[] Headers);

  [Fact]
  public void TheWindowFixtureMatchesTheWindow()
  {
    var path = RichTextFixtures.PathOf("collab-history/window.json");
    var text = Window().ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), "collab-history/window.json is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static string Ticks(DateTimeOffset at) => at.UtcTicks.ToString(CultureInfo.InvariantCulture);

  private static string Number(ulong value) => value.ToString(CultureInfo.InvariantCulture);

  private static List<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> Build(Lineage[] lineages) =>
      [.. lineages.Select(entry => (
          new CollabLineageInfo(entry.Name, 1, 2, entry.CreatedAt, false),
          (IReadOnlyList<CollabRecordHeader>)[.. entry.Headers.Select(header => new CollabRecordHeader(header.Sequence, header.At, null))]))];

  private static JsonObject Point(string lineage, ulong sequence) =>
      new() { ["lineage"] = lineage, ["sequence"] = Number(sequence) };

  private static JsonObject Window()
  {
    (string Name, DateTimeOffset Now, TimeSpan Window)[] cuts =
    [
      ("an hour", T0, TimeSpan.FromHours(1)),
      ("a zero window hides everything before now", T0, TimeSpan.Zero),
      ("a negative window counts as zero", T0, -Minute),
      ("a window longer than time stops at tick 0", T0, TimeSpan.MaxValue),
      ("a window just past now stops at tick 0", new DateTimeOffset(5, TimeSpan.Zero), TimeSpan.FromTicks(6)),
    ];

    var later = T0 + TimeSpan.FromHours(1);
    Lineage one = new("L1", T0, [(1, T0 + Minute), (2, T0 + 2 * Minute), (3, T0 + 3 * Minute), (4, T0 + 4 * Minute)]);
    Lineage two = new("L2", later, [(1, later + Minute), (2, later + 2 * Minute)]);

    (string Name, Lineage[] Lineages, DateTimeOffset Cut)[] cases =
    [
      ("a cut before everything hides nothing", [one, two], T0 - Tick),
      ("a cut on the creation keeps the baseline", [one, two], T0),
      ("a cut one tick after the creation hides the baseline", [one, two], T0 + Tick),
      ("a record on the cut is kept", [one, two], T0 + 2 * Minute),
      ("a record one tick before the cut is hidden", [one, two], T0 + 2 * Minute + Tick),
      ("a cut after a reset hides the old lineage whole", [one, two], later + TimeSpan.FromSeconds(30)),
      ("a reset on the cut keeps the new baseline", [one, two], later),
      ("a cut after the head hides everything", [one, two], later + TimeSpan.FromDays(1)),
      ("a baseline with no created-at is hidden", [new("L1", null, [(1, T0 + Minute), (2, T0 + 2 * Minute)])], T0 + Minute),
      ("a record older than one before it hides everything below it",
          [new("L1", T0, [(1, T0 + 5 * Minute), (2, T0 + Minute), (3, T0 + 6 * Minute)])], T0 + 3 * Minute),
      ("a lineage with no records created after the cut hides nothing", [new("L1", later, [])], T0),
    ];

    var written = new JsonArray();

    foreach (var (name, lineages, cut) in cases)
    {
      var timeline = Build(lineages);
      var floors = CollabHistoryWindow.Floors(timeline, cut);
      var points = new JsonArray();
      var since = new JsonArray();

      foreach (var lineage in lineages)
      {
        var floor = floors[lineage.Name];

        foreach (var sequence in new ulong[] { 0 }.Concat(lineage.Headers.Select(header => header.Sequence)))
        {
          points.Add(new JsonObject
          {
            ["lineage"] = lineage.Name,
            ["sequence"] = Number(sequence),
            ["hidden"] = CollabHistoryWindow.Hides(floors, lineage.Name, sequence),
          });
        }

        since.Add(new JsonObject
        {
          ["lineage"] = lineage.Name,
          ["since"] = "0",
          ["from"] = Number(CollabHistoryWindow.Since(floor, 0)),
        });
      }

      var at = new JsonArray();

      foreach (var time in new[] { cut - Tick, cut, later + TimeSpan.FromDays(2) })
      {
        var point = CollabHistoryTime.ResolveAt(timeline, time);
        var hidden = point is not null && CollabHistoryWindow.Hides(floors, point.Lineage, point.Sequence);

        at.Add(new JsonObject
        {
          ["time"] = Ticks(time),
          ["point"] = point is null || hidden ? null : Point(point.Lineage, point.Sequence),
          ["reason"] = point is null ? "not_found" : hidden ? "retention" : null,
        });
      }

      var range = new JsonArray();
      var visible = CollabHistoryWindow.Visible(timeline, cut);
      (string, ulong)?[] befores = [null, .. lineages.SelectMany(l => l.Headers.Select(h => ((string, ulong)?)(l.Name, h.Sequence)))];

      foreach (var before in befores)
      {
        var hidden = before is { } b && CollabHistoryWindow.Hides(floors, b.Item1, b.Item2);
        var selection = CollabHistoryTime.SelectRange(visible, T0 - TimeSpan.FromDays(1), later + TimeSpan.FromDays(2), before, 200);

        range.Add(new JsonObject
        {
          ["before"] = before is { } p ? Point(p.Item1, p.Item2) : null,
          ["reason"] = hidden ? "retention" : null,
          ["records"] = hidden
            ? new JsonArray()
            : new JsonArray([.. selection.Records.Select(record => (JsonNode)Point(record.Lineage, record.Sequence))]),
        });
      }

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["lineages"] = new JsonArray([.. lineages.Select(entry => (JsonNode)new JsonObject
        {
          ["lineage"] = entry.Name,
          ["createdAt"] = entry.CreatedAt is { } created ? Ticks(created) : null,
          ["headers"] = new JsonArray([.. entry.Headers.Select(header => (JsonNode)new JsonObject
          {
            ["sequence"] = Number(header.Sequence),
            ["committedAt"] = Ticks(header.At),
          })]),
        })]),
        ["cut"] = Ticks(cut),
        ["floors"] = new JsonObject(lineages.Select(entry => KeyValuePair.Create(
            entry.Name,
            floors[entry.Name] is { } floor ? (JsonNode?)Number(floor) : null))),
        ["points"] = points,
        ["since"] = since,
        ["at"] = at,
        ["range"] = range,
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabHistoryWindow as C# answers it. Captured by CollabHistoryWindowCaptureTests; do not edit by hand. cuts: now minus the window as .NET UTC ticks, never below 0, a negative window counting as zero. cases: each lineage's floor, the highest sequence the cut hides (null: none). The baseline is hidden when created before the cut or with no created-at; a record when committed before the cut; and every point below a hidden one. points: hidden answers 404 retention on read, changes, restore and restore/preview. since: a changes read's since, raised to the floor. at: the point the full timeline resolves, retention when it is hidden. range: the records [from, to) of the visible timeline; a hidden before answers retention. answers: the two new refusals. delete: DELETE .../history/{lineage} with the hold hook, which is asked before the lineage is looked up.",
      ["cuts"] = new JsonArray([.. cuts.Select(c => (JsonNode)new JsonObject
      {
        ["name"] = c.Name,
        ["now"] = Ticks(c.Now),
        ["window"] = c.Window.Ticks.ToString(CultureInfo.InvariantCulture),
        ["cut"] = Ticks(CollabHistoryWindow.Cut(c.Now, c.Window)),
      })]),
      ["cases"] = written,
      ["answers"] = new JsonObject
      {
        ["retention"] = new JsonObject { ["status"] = 404, ["contentType"] = "application/json", ["body"] = "{\"reason\":\"retention\"}" },
        ["held"] = new JsonObject { ["status"] = 409, ["contentType"] = "application/json", ["body"] = "{\"reason\":\"held\"}" },
      },
      ["delete"] = new JsonArray(
        Delete("an old lineage nobody holds is deleted", false, "old", 204, null),
        Delete("a held lineage is refused", true, "old", 409, "{\"reason\":\"held\"}"),
        Delete("a hold is asked before the current lineage check", true, "current", 409, "{\"reason\":\"held\"}"),
        Delete("a hold is asked before the lineage is looked up", true, "unknown", 409, "{\"reason\":\"held\"}"),
        Delete("the current lineage nobody holds keeps its plain refusal", false, "current", 409,
            "the document is on this lineage; it cannot be deleted\n"),
        Delete("an unknown lineage nobody holds is not found", false, "unknown", 404, "no such version\n")),
    };
  }

  private static JsonObject Delete(string name, bool held, string lineage, int status, string? body) => new()
  {
    ["name"] = name,
    ["held"] = held,
    ["lineage"] = lineage,
    ["status"] = status,
    ["body"] = body,
  };
}
