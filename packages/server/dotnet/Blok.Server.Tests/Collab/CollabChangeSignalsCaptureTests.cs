using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// CollabChangeSignals.Fold, captured from C# into
/// fixtures/collab-history/signals.json. Go and Rust read the same file. Set
/// BLOK_WRITE_COLLAB_HISTORY=1 to rewrite it after an intended change.
/// </summary>
public sealed class CollabChangeSignalsCaptureTests
{
  private const string Doc = "doc-1";
  private static readonly DateTimeOffset T0 = new(2026, 11, 9, 13, 51, 0, TimeSpan.Zero);
  private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  [Fact]
  public void TheSignalsFixtureMatchesTheFold()
  {
    var path = RichTextFixtures.PathOf("collab-history/signals.json");
    var text = Build().ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), "collab-history/signals.json is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  [Fact]
  public void AnAddedThenRemovedBlockYieldsNoSignal()
  {
    var signals = CollabChangeSignals.Fold(
        Doc,
        [R(1, 0, "u1", Blocks(("a", "added"))), R(2, 10, "u1", Blocks(("a", "removed")))],
        Minute);

    Assert.Empty(signals);
  }

  private static CollabSignalBlock[] Blocks(params (string Id, string Kind)[] blocks) =>
      [.. blocks.Select(block => new CollabSignalBlock(block.Id, block.Kind))];

  private static CollabSignalRecord R(
      ulong sequence,
      int seconds,
      string? actor,
      CollabSignalBlock[]? blocks = null,
      string lineage = "L1",
      CollabRecordNote? note = null,
      string[]? page = null,
      CollabSignalProperties[]? properties = null,
      CollabSignalSchema[]? schema = null) =>
      new(lineage, sequence, T0.AddSeconds(seconds), actor, note, blocks ?? [], page ?? [], properties ?? [], schema ?? []);

  private static readonly CollabRecordNote Person = new("person");
  private static readonly CollabRecordNote Agent = new("agent", "u1");

  private static JsonObject Build()
  {
    (string Name, TimeSpan Window, CollabSignalRecord[] Records)[] cases =
    [
      ("one window: two records by one person", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "changed")), note: Person),
        R(2, 20, "u1", Blocks(("b", "added")), note: Person),
      ]),
      ("a record at or past the window's end starts the next window", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "changed"))),
        R(2, 59, "u1", Blocks(("b", "changed"))),
        R(3, 60, "u1", Blocks(("c", "changed"))),
        R(4, 130, "u1", Blocks(("d", "changed"))),
      ]),
      ("the window runs from its first record, not from the last", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "changed"))),
        R(2, 40, "u1", Blocks(("a", "changed"))),
        R(3, 80, "u1", Blocks(("a", "changed"))),
      ]),
      ("a block added and removed in one window yields nothing", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "added"))),
        R(2, 10, "u1", Blocks(("a", "removed"))),
      ]),
      ("a block added in one window and removed in the next is in both", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "added"))),
        R(2, 70, "u1", Blocks(("a", "removed"))),
      ]),
      ("each block keeps the kind of the whole window", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "added"), ("b", "changed"), ("c", "moved"), ("d", "moved"), ("e", "changed"))),
        R(2, 10, "u1", Blocks(("a", "changed"), ("b", "removed"), ("c", "moved"), ("d", "changed"), ("e", "moved"))),
      ]),
      ("a block removed, then added back with the same id, is changed", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "removed"))),
        R(2, 10, "u1", Blocks(("a", "added"))),
      ]),
      ("added, removed and added again is added", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "added"))),
        R(2, 10, "u1", Blocks(("a", "removed"))),
        R(3, 20, "u1", Blocks(("a", "added"))),
      ]),
      ("a lineage change closes the window", Minute,
      [
        R(1, 0, "u1", Blocks(("a", "changed"))),
        R(1, 10, "u1", Blocks(("b", "changed")), lineage: "L2"),
        R(2, 20, "u1", Blocks(("c", "changed")), lineage: "L2"),
      ]),
      ("records that change nothing make no signal and no author", Minute,
      [
        R(1, 0, "u1"),
        R(2, 10, "u2", Blocks(("a", "changed"))),
        R(3, 20, "u3"),
        R(4, 70, null),
      ]),
      ("authors: distinct, first seen first, no null actor, kind from the first note", Minute,
      [
        R(1, 0, "u2", Blocks(("a", "changed"))),
        R(2, 5, null, Blocks(("b", "changed"))),
        R(3, 10, "agent-1", Blocks(("c", "changed")), note: Agent),
        R(4, 15, "u2", Blocks(("d", "changed")), note: Person),
        R(5, 20, "u2", Blocks(("e", "changed")), note: Agent),
      ]),
      ("page keys, first seen first", Minute,
      [
        R(1, 0, "u1", page: ["title"]),
        R(2, 10, "u1", page: ["values.k", "title"]),
      ]),
      ("property ids per row, first seen first", Minute,
      [
        R(1, 0, "u1", Blocks(("r1", "changed")), properties: [new("r1", ["st", "title"])]),
        R(2, 10, "u1", Blocks(("r2", "changed"), ("r1", "changed")),
            properties: [new("r2", ["st"]), new("r1", ["due", "st"])]),
      ]),
      ("a row added and removed in one window drops its properties", Minute,
      [
        R(1, 0, "u1", Blocks(("r1", "added"))),
        R(2, 10, "u1", Blocks(("r1", "changed"), ("r2", "changed")),
            properties: [new("r1", ["st"]), new("r2", ["st"])]),
        R(3, 20, "u1", Blocks(("r1", "removed"))),
      ]),
      ("schema entries per database: created then deleted is gone, created then updated is created", Minute,
      [
        R(1, 0, "u1", Blocks(("db", "changed")), schema:
        [
          new("db", "p1", "Due", "created"),
          new("db", "p2", "Status", "updated"),
          new("db", "p3", "Tags", "created"),
          new("db", "p4", "Owner", "updated"),
        ]),
        R(2, 10, "u1", Blocks(("db", "changed"), ("db2", "changed")), schema:
        [
          new("db", "p1", "Due date", "updated"),
          new("db", "p2", null, "deleted"),
          new("db", "p3", "Tags", "deleted"),
          new("db", "p4", null, "updated"),
          new("db2", "p1", "Due", "created"),
        ]),
      ]),
      ("a longer window from the host", TimeSpan.FromMinutes(5),
      [
        R(1, 0, "u1", Blocks(("a", "changed"))),
        R(2, 240, "u1", Blocks(("b", "changed"))),
        R(3, 299, "u1", Blocks(("c", "changed"))),
        R(4, 300, "u1", Blocks(("d", "changed"))),
      ]),
      ("a record whose clock reads earlier stays in the window", Minute,
      [
        R(1, 30, "u1", Blocks(("a", "changed"))),
        R(2, 0, "u1", Blocks(("b", "changed"))),
      ]),
    ];

    return new JsonObject
    {
      ["$comment"] =
          "CollabChangeSignals.Fold as C# answers it. Captured by CollabChangeSignalsCaptureTests; do not edit by hand. " +
          "Records are in commit order. A window starts at its first record and holds each next record on the same lineage " +
          "committed before windowStart plus windowMs. Each window collapses to one signal, or none when nothing is left: " +
          "a block keeps the kind of the whole window (added then removed is gone, with its properties and schema entries); " +
          "authors are the actors of records that changed something, first seen first, with the kind of their first note. " +
          "Times are Unix milliseconds.",
      ["cases"] = new JsonArray([.. cases.Select(entry => (JsonNode)new JsonObject
      {
        ["name"] = entry.Name,
        ["windowMs"] = (long)entry.Window.TotalMilliseconds,
        ["records"] = new JsonArray([.. entry.Records.Select(RecordJson)]),
        ["signals"] = new JsonArray([.. CollabChangeSignals.Fold(Doc, entry.Records, entry.Window).Select(SignalJson)]),
      })]),
    };
  }

  private static JsonNode RecordJson(CollabSignalRecord record) => new JsonObject
  {
    ["lineage"] = record.Lineage,
    ["sequence"] = record.Sequence,
    ["committedAt"] = record.CommittedAt.ToUnixTimeMilliseconds(),
    ["actor"] = record.Actor,
    ["note"] = record.Note is { } note ? new JsonObject { ["kind"] = note.Kind, ["onBehalfOf"] = note.OnBehalfOf } : null,
    ["blocks"] = BlocksJson(record.Blocks),
    ["page"] = new JsonArray([.. record.Page.Select(key => (JsonNode)key)]),
    ["properties"] = PropertiesJson(record.Properties),
    ["schema"] = SchemaJson(record.Schema),
  };

  /// <summary>The signal as a host's adapter would write it.</summary>
  internal static JsonNode SignalJson(CollabChangeSignal signal) => new JsonObject
  {
    ["doc"] = signal.DocumentId,
    ["lineage"] = signal.Lineage,
    ["fromSequence"] = signal.FromSequence,
    ["toSequence"] = signal.ToSequence,
    ["windowStart"] = signal.WindowStart.ToUnixTimeMilliseconds(),
    ["windowEnd"] = signal.WindowEnd.ToUnixTimeMilliseconds(),
    ["blocks"] = BlocksJson(signal.Blocks),
    ["page"] = new JsonArray([.. signal.Page.Select(key => (JsonNode)key)]),
    ["properties"] = PropertiesJson(signal.Properties),
    ["schema"] = SchemaJson(signal.Schema),
    ["authors"] = new JsonArray([.. signal.Authors.Select(author => (JsonNode)new JsonObject
    {
      ["id"] = author.Id,
      ["kind"] = author.Kind,
    })]),
  };

  private static JsonArray BlocksJson(IEnumerable<CollabSignalBlock> blocks) =>
      new([.. blocks.Select(block => (JsonNode)new JsonObject { ["id"] = block.Id, ["kind"] = block.Kind })]);

  private static JsonArray PropertiesJson(IEnumerable<CollabSignalProperties> rows) =>
      new([.. rows.Select(row => (JsonNode)new JsonObject
      {
        ["rowId"] = row.RowId,
        ["ids"] = new JsonArray([.. row.Ids.Select(id => (JsonNode)id)]),
      })]);

  private static JsonArray SchemaJson(IEnumerable<CollabSignalSchema> entries) =>
      new([.. entries.Select(entry => (JsonNode)new JsonObject
      {
        ["databaseId"] = entry.DatabaseId,
        ["id"] = entry.Id,
        ["name"] = entry.Name,
        ["action"] = entry.Action,
      })]);
}
