using System.Globalization;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The pure history functions, captured from C# into fixtures/collab-history/:
/// how records group into versions, what each record changed, and the edits
/// a restore plans. The Go server reads the same files
/// (internal/collab/room/history_fixture_test.go), so both list, diff and
/// restore a document alike. Times are .NET ticks, written as strings so the
/// one-tick cases survive a double. Set BLOK_WRITE_COLLAB_HISTORY=1 to rewrite
/// the files after an intended change.
/// </summary>
public sealed class CollabHistoryCaptureTests
{
  private static readonly DateTimeOffset T0 = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  [Fact]
  public void TheTimelineMatchesTheGrouping()
  {
    Check("collab-history/timeline.json", Timeline());
  }

  [Fact]
  public async Task TheChangesMatchTheReplay()
  {
    Check("collab-history/changes.json", await Changes());
  }

  [Fact]
  public async Task TheRestorePlansMatchThePlanner()
  {
    Check("collab-history/restore-plans.json", await RestorePlans());
  }

  private static void Check(string relative, JsonObject built)
  {
    var path = RichTextFixtures.PathOf(relative);
    var text = built.ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), $"{relative} is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static string Ticks(DateTimeOffset at) => at.UtcTicks.ToString(CultureInfo.InvariantCulture);

  private static JsonNode? Ticks(DateTimeOffset? at) => at is { } value ? Ticks(value) : null;

  // ---- timeline ----

  private sealed record TimelineCase(
      string Name,
      TimeSpan? Window,
      (string Lineage, DateTimeOffset? CreatedAt, (ulong Sequence, DateTimeOffset At, string? Actor)[] Headers)[] Lineages);

  private static JsonObject Timeline()
  {
    var minute = TimeSpan.FromMinutes(1);
    var tick = TimeSpan.FromTicks(1);
    var later = T0 + TimeSpan.FromHours(1);
    TimelineCase[] cases =
    [
      new("a lineage with no records is only its baseline", null, [("L1", T0, [])]),
      new("a baseline without a created-at has no times", null, [("L1", null, [])]),
      new("a gap of exactly the idle gap stays in the group", null,
          [("L1", T0, [(1, T0, null), (2, T0 + 2 * minute, null)])]),
      new("a gap one tick over the idle gap starts a group", null,
          [("L1", T0, [(1, T0, null), (2, T0 + 2 * minute + tick, null)])]),
      new("a span of exactly the max span starts a group at that record", null,
          [("L1", T0, [
              (1, T0, null), (2, T0 + 2 * minute, null), (3, T0 + 4 * minute, null), (4, T0 + 6 * minute, null),
              (5, T0 + 8 * minute, null), (6, T0 + 10 * minute, null), (7, T0 + 11 * minute, null)])]),
      new("a span one tick under the max span stays in the group", null,
          [("L1", T0, [
              (1, T0, null), (2, T0 + 2 * minute, null), (3, T0 + 4 * minute, null), (4, T0 + 6 * minute, null),
              (5, T0 + 8 * minute, null), (6, T0 + 10 * minute - tick, null)])]),
      new("a negative gap counts as no gap", null,
          [("L1", T0, [(1, T0 + 5 * minute, null), (2, T0, null)])]),
      new("actors are distinct, first seen first, nulls skipped", null,
          [("L1", T0, [(1, T0, "bob"), (2, T0, null), (3, T0, "alice"), (4, T0, "bob"), (5, T0, "carol"), (6, T0, "")])]),
      new("actors belong to their own group", null,
          [("L1", T0, [(1, T0, "bob"), (2, T0 + 5 * minute, "alice")])]),
      new("newest lineage first", null,
          [("old", T0, [(1, T0, null), (2, T0 + 5 * minute, null)]), ("new", later, [(1, later, "é😀")])]),
      new("each lineage groups on its own", null,
          [("old", T0, [(1, T0, null)]), ("new", T0, [(1, T0 + minute, null)])]),
      new("a 15 minute window is both the gap and the span", TimeSpan.FromMinutes(15),
          [("L1", T0, [
              (1, T0, null), (2, T0 + 14 * minute, null), (3, T0 + 15 * minute, null),
              (4, T0 + 30 * minute, null), (5, T0 + 45 * minute + tick, null)])]),
      new("a 1 minute window splits what the default keeps", minute,
          [("L1", T0, [(1, T0, null), (2, T0 + TimeSpan.FromSeconds(90), null)])]),
      new("the default keeps 90 seconds together", null,
          [("L1", T0, [(1, T0, null), (2, T0 + TimeSpan.FromSeconds(90), null)])]),
      new("a 60 minute window", TimeSpan.FromMinutes(60),
          [("L1", T0, [
              (1, T0, "a"), (2, T0 + 59 * minute, "b"), (3, T0 + 60 * minute, "c"),
              (4, T0 + 125 * minute, null), (5, T0 + 125 * minute, "a")])]),
      new("big sequences and the far ends of time", null,
          [("L1", DateTimeOffset.MinValue, [
              (ulong.MaxValue - 1, DateTimeOffset.MinValue, null), (ulong.MaxValue, DateTimeOffset.MaxValue, null)])]),
    ];

    var written = new JsonArray();

    foreach (var testCase in cases)
    {
      var lineages = testCase.Lineages
          .Select(entry => (
              Lineage: new CollabLineageInfo(entry.Lineage, 1, 2, entry.CreatedAt, false),
              Headers: (IReadOnlyList<CollabRecordHeader>)entry.Headers
                  .Select(header => new CollabRecordHeader(header.Sequence, header.At, header.Actor)).ToList()))
          .ToList();
      var versions = testCase.Window is { } window
          ? CollabVersionTimeline.Group(lineages, window, window)
          : CollabVersionTimeline.Group(lineages);

      written.Add(new JsonObject
      {
        ["name"] = testCase.Name,
        ["windowMinutes"] = testCase.Window is { } w ? (int)w.TotalMinutes : null,
        ["lineages"] = new JsonArray([.. lineages.Select(entry => (JsonNode)new JsonObject
        {
          ["lineage"] = entry.Lineage.Lineage,
          ["createdAt"] = Ticks(entry.Lineage.CreatedAt),
          ["headers"] = new JsonArray([.. entry.Headers.Select(header => (JsonNode)new JsonObject
          {
            ["sequence"] = header.ServerSequence.ToString(CultureInfo.InvariantCulture),
            ["committedAt"] = Ticks(header.CommittedAt),
            ["actor"] = header.ActorId,
          })]),
        })]),
        ["versions"] = new JsonArray([.. versions.Select(version => (JsonNode)new JsonObject
        {
          ["lineage"] = version.Lineage,
          ["sequence"] = version.Sequence.ToString(CultureInfo.InvariantCulture),
          ["startedAt"] = Ticks(version.StartedAt),
          ["savedAt"] = Ticks(version.SavedAt),
          ["actors"] = new JsonArray([.. version.Actors.Select(actor => (JsonNode)actor)]),
        })]),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabVersionTimeline.Group as C# answers it. Captured by CollabHistoryCaptureTests; do not edit by hand. Times are .NET UTC ticks; windowMinutes null is the default 2 min gap and 10 min span.",
      ["cases"] = written,
    };
  }

  // ---- changes ----

  private sealed record ChangesCase(
      string Name,
      byte[][] Baseline,
      (byte[] Update, string? Actor)[] Records,
      ulong FirstBefore = 0,
      long MaxBytes = long.MaxValue,
      ulong[]? Skip = null);

  private static async Task<JsonObject> Changes()
  {
    var cases = new List<ChangesCase>();

    {
      var live = Seeded("""{ "id": "a", "type": "paragraph", "data": { "text": "one" } }""");
      var baseline = live.EncodeStateAsUpdate();
      var updates = Edits(live,
          """{ "op": "update", "id": "a", "data": { "text": "two" } }""",
          """{ "op": "insert", "id": "b", "after": "a", "block": { "type": "paragraph", "data": { "text": "b" } } }""",
          """{ "op": "remove", "id": "a" }""");
      cases.Add(new("update, insert, remove", [baseline], [.. updates.Select((u, i) => (u, (string?)$"actor-{i + 1}"))]));
      cases.Add(new("from the first record", [baseline], [.. updates.Select(u => (u, (string?)null))], FirstBefore: 1));
      cases.Add(new("the byte budget keeps the newest", [baseline], [.. updates.Select(u => (u, (string?)null))], MaxBytes: 1));
      cases.Add(new("the byte budget drops the oldest past it", [baseline], [.. updates.Select(u => (u, (string?)null))], MaxBytes: 200));
      cases.Add(new("a missing first-before record yields no rows", [baseline], [.. updates.Select(u => (u, (string?)null))], FirstBefore: 2, Skip: [2]));
    }

    {
      var live = Seeded(
          """{ "id": "a", "type": "paragraph", "data": { "text": "a" } }""",
          """{ "id": "t", "type": "toggle", "data": { "text": "t" }, "content": ["k"] }""",
          """{ "id": "k", "type": "paragraph", "data": { "text": "k" }, "parent": "t" }""",
          """{ "id": "b", "type": "paragraph", "data": { "text": "b" } }""",
          """{ "id": "c", "type": "header", "data": { "text": "c", "level": 2 } }""");
      var baseline = live.EncodeStateAsUpdate();
      var updates = Edits(live,
          """{ "op": "remove", "id": "b" }""",
          """{ "op": "insert", "id": "b", "block": { "type": "paragraph", "data": { "text": "b" } } }""",
          """{ "op": "remove", "id": "k" }""",
          """{ "op": "insert", "id": "k", "after": "a", "block": { "type": "paragraph", "data": { "text": "k2" } } }""",
          """{ "op": "update", "id": "c", "data": { "text": "c", "level": 3 } }""");
      cases.Add(new("remove, reinsert and data", [baseline], [.. updates.Select(u => (u, (string?)"u"))]));
    }

    {
      var live = Seeded(
          """{ "id": "a", "type": "paragraph", "data": { "text": "a" } }""",
          """{ "id": "t", "type": "toggle", "data": { "text": "t" }, "content": ["k"] }""",
          """{ "id": "k", "type": "paragraph", "data": { "text": "k" }, "parent": "t" }""",
          """{ "id": "b", "type": "paragraph", "data": { "text": "b" } }""",
          """{ "id": "c", "type": "paragraph", "data": { "text": "c" } }""");
      var baseline = live.EncodeStateAsUpdate();
      var updates = Moves(live,
          new CollabEditOp.Move("c", null, null),
          new CollabEditOp.Move("k", "b", null),
          new CollabEditOp.Move("a", null, "t"),
          new CollabEditOp.Move("b", "t", null));
      cases.Add(new("moves and reparents", [baseline], [.. updates.Select(u => (u, (string?)null))]));
    }

    {
      // A parent of "" groups with the root, as the client's output-diff
      // does. Both blocks start in the unlisted tail, c first; listing r
      // moves it ahead of c.
      var live = new YDoc(7);
      var blocks = live.GetMap("blocks");
      var baseline = live.Transact(transaction =>
      {
        blocks.Set(transaction, "c", new YMap([new("id", "c"), new("type", "paragraph"), new("data", new YMap()), new("parentId", "")]));
        blocks.Set(transaction, "r", new YMap([new("id", "r"), new("type", "paragraph"), new("data", new YMap())]));
      })!;
      var reorder = live.Transact(transaction => live.GetArray("root").Insert(transaction, 0, ["r"]))!;
      cases.Add(new("a parent of \"\" is the root's group", [baseline], [(reorder, null)]));
    }

    {
      // A peer's bigint in block data does not make its block read as changed.
      var live = Seeded(P("a"), P("b"));
      SetData(live, "a", "o", Holding(new BigInteger(7)));
      var baseline = live.EncodeStateAsUpdate();
      var updates = Edits(live, """{ "op": "update", "id": "b", "data": { "text": "two" } }""");
      cases.Add(new("a peer bigint in block data is no change", [baseline], [.. updates.Select(u => (u, (string?)null))]));
    }

    {
      var client = new YDoc(1);
      var page = client.GetMap("page");
      var values = client.GetMap("values");
      var baseline = client.Transact(transaction => page.Set(transaction, "title", "A"))!;
      var updates = new List<byte[]>
      {
        client.Transact(transaction => page.Set(transaction, "title", "B"))!,
        client.Transact(transaction => values.Set(transaction, "k", true))!,
        client.Transact(transaction =>
        {
          values.Set(transaction, "z", 1.0);
          values.Set(transaction, "｡", "half");
          values.Set(transaction, "😀", "astral");
          page.Set(transaction, "icon", "x");
          page.Set(transaction, "Title", "upper");
        })!,
        client.Transact(transaction => values.Set(transaction, "z", 1.0))!,
        client.Transact(transaction =>
        {
          values.Remove(transaction, "k");
          page.Remove(transaction, "icon");
          values.Set(transaction, "nested", new YMap([new KeyValuePair<string, object?>("a", 1.0)]));
        })!,
      };
      cases.Add(new("page and values keys", [baseline], [.. updates.Select(u => (u, (string?)null))]));
    }

    {
      var client = new YDoc(1);
      var text = client.GetText("t");
      var u1 = client.Transact(transaction => text.Insert(transaction, 0, "a"))!;
      var u2 = client.Transact(transaction => text.Insert(transaction, 1, "b"))!;
      cases.Add(new("a record with nothing visible is still a row", [], [(u2, null), (u1, null)]));
    }

    var written = new JsonArray();

    foreach (var testCase in cases)
    {
      var records = RecordsOf(testCase).ToList();
      var changes = await CollabVersionChanges.ReplayAsync(
          [.. testCase.Baseline.Select(update => (ReadOnlyMemory<byte>)update)],
          Async(records),
          testCase.FirstBefore,
          new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader),
          CancellationToken.None,
          testCase.MaxBytes);

      written.Add(new JsonObject
      {
        ["name"] = testCase.Name,
        ["baseline"] = new JsonArray([.. testCase.Baseline.Select(update => (JsonNode)Convert.ToBase64String(update))]),
        ["records"] = new JsonArray([.. records.Select(record => (JsonNode)new JsonObject
        {
          ["sequence"] = record.ServerSequence.ToString(CultureInfo.InvariantCulture),
          ["committedAt"] = Ticks(record.CommittedAt),
          ["actor"] = record.ActorId,
          ["update"] = Convert.ToBase64String(record.Update.Span),
        })]),
        ["firstBefore"] = testCase.FirstBefore.ToString(CultureInfo.InvariantCulture),
        ["maxBytes"] = testCase.MaxBytes.ToString(CultureInfo.InvariantCulture),
        ["changes"] = new JsonArray([.. changes.Select(record => (JsonNode)new JsonObject
        {
          ["sequence"] = record.Sequence.ToString(CultureInfo.InvariantCulture),
          ["committedAt"] = Ticks(record.CommittedAt),
          ["actor"] = record.ActorId,
          ["blocks"] = new JsonArray([.. record.Blocks.Select(change => (JsonNode)new JsonObject
          {
            ["id"] = change.Id,
            ["type"] = change.Type,
            ["kind"] = change.Kind.ToString().ToLowerInvariant(),
            ["before"] = change.Before?.DeepClone(),
            ["after"] = change.After?.DeepClone(),
          })]),
          ["page"] = new JsonArray([.. record.Page.Select(key => (JsonNode)key)]),
        })]),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabVersionChanges.ReplayAsync as C# answers it. Captured by CollabHistoryCaptureTests; do not edit by hand. Updates are base64 Yjs v1 updates; times are .NET UTC ticks.",
      ["cases"] = written,
    };
  }

  private static IEnumerable<CollabOperationRecord> RecordsOf(ChangesCase testCase)
  {
    ulong sequence = 0;

    foreach (var (update, actor) in testCase.Records)
    {
      sequence++;

      if (testCase.Skip?.Contains(sequence) == true)
      {
        continue;
      }

      yield return new CollabOperationRecord(
          sequence.ToString("x32", CultureInfo.InvariantCulture),
          sequence,
          T0.AddMinutes(sequence).AddTicks((long)sequence),
          actor,
          CollabOperationSource.HttpEdit,
          update,
          new byte[32]);
    }
  }

  private static async IAsyncEnumerable<CollabOperationRecord> Async(
      IEnumerable<CollabOperationRecord> records,
      [EnumeratorCancellation] CancellationToken ct = default)
  {
    foreach (var record in records)
    {
      ct.ThrowIfCancellationRequested();
      await Task.Yield();
      yield return record;
    }
  }

  private static YDoc Seeded(params string[] blockJson)
  {
    var doc = new YDoc(7);

    RichTextRuntime.Seed(doc, new JsonArray([.. blockJson.Select(json => JsonNode.Parse(json))]));

    return doc;
  }

  private static List<byte[]> Edits(YDoc live, params string[] opJson) =>
      Moves(live, [.. opJson.Select(op => CollabEditOps.Parse(Encoding.UTF8.GetBytes($$"""{ "ops": [{{op}}] }""")).Single())]);

  private static List<byte[]> Moves(YDoc live, params CollabEditOp[] ops)
  {
    var emitted = new List<byte[]>();
    live.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        emitted.Add(update.Update);
      }
    };

    foreach (var op in ops)
    {
      var before = emitted.Count;

      RichTextRuntime.ApplyOps(live, [op]);
      Assert.Equal(before + 1, emitted.Count);
    }

    return emitted;
  }

  // ---- restore plans ----

  private static async Task<JsonObject> RestorePlans()
  {
    var cases = new List<(string Name, YDoc Current, YDoc Target)>
    {
      ("swaps roots", Doc(P("a"), P("b")), Doc(P("b"), P("a"))),
      ("moves a block with children to another parent",
          Doc(Parent("a", "toggle", ["c"]), Parent("c", "toggle", ["g"], "a"), P("g", "c", "grandchild"), Parent("b", "toggle", [])),
          Doc(Parent("a", "toggle", []), Parent("b", "toggle", ["c"]), Parent("c", "toggle", ["g"], "b"), P("g", "c", "grandchild"))),
      ("moves a parent after its sibling",
          Doc(Parent("a", "toggle", ["k1", "k2"]), P("k1", "a"), P("k2", "a"), P("b")),
          Doc(P("b"), Parent("a", "toggle", ["k1", "k2"]), P("k1", "a"), P("k2", "a"))),
      ("moves a parent whose children stay",
          Doc(Parent("a", "toggle", ["k1", "k2"]), P("k1", "a"), P("k2", "a"), Parent("b", "toggle", [])),
          Doc(P("k1"), P("k2"), Parent("b", "toggle", ["a"]), Parent("a", "toggle", [], "b"))),
      ("deletes a parent whose child moves to root",
          Doc(Parent("p", "toggle", ["c"]), Parent("c", "toggle", ["g"], "p"), P("g", "c", "deep"), P("x")),
          Doc(Parent("c", "toggle", ["g"]), P("g", "c", "deep"), P("x"))),
      ("changes the type of a block with children",
          Doc(Parent("t", "toggle", ["k"]), P("k", "t", "kid")),
          Doc(Parent("t", "callout", ["k"]), P("k", "t", "kid"))),
      ("changes tunes",
          Doc("""{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "left" } }""", P("b")),
          Doc("""{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "center" } }""", P("b"))),
      ("changes the data of a moved block",
          Doc(P("a"), Parent("b", "toggle", ["c"]), P("c", "b", "old")),
          Doc(P("a"), P("c", text: "new"), Parent("b", "toggle", []))),
      ("one update for a data-only change",
          Doc(Parent("a", "toggle", ["c"]), P("c", "a"), P("b", text: "before")),
          Doc(Parent("a", "toggle", ["c"]), P("c", "a"), P("b", text: "after"))),
      ("nothing for an identical document", Doc(P("a"), P("b")), Doc(P("a"), P("b"))),
      ("a target parent that is missing goes to root", Doc(P("a")), Doc(P("a"), P("x", "ghost"), P("y"))),
      ("reinserted blocks carry the target's stamps",
          Doc(P("a"), P("b")),
          Doc(
              """{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "lastEditedAt": 1700000000000, "lastEditedBy": "u1" }""",
              """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "lastEditedAt": 1700000000001.5, "lastEditedBy": "é😀" }""")),
    };

    {
      var current = Doc(P("a"));
      var target = Doc(P("a"));
      SetMap(current, "page", "title", "Old");
      SetMap(current, "page", "icon", Icon("🌿"));
      SetMap(current, "values", "gone", 5d);
      SetMap(current, "values", "same", "x");
      SetMap(target, "page", "title", "New");
      SetMap(target, "values", "same", "x");
      SetMap(target, "values", "｡", 1d);
      SetMap(target, "values", "😀", 2d);
      SetMap(target, "values", "Z", Icon("🌿"));
      SetMap(target, "values", "nested", new YMap([new KeyValuePair<string, object?>("a", 1.0)]));
      cases.Add(("page and values maps", current, target));
    }

    {
      var current = Doc(P("a"));
      var target = Doc(P("a"));
      SetMap(current, "values", "k", new YMap([new KeyValuePair<string, object?>("a", 1.0)]));
      SetMap(target, "values", "k", Icon("🌿"));
      cases.Add(("a plain value over a live nested type", current, target));
    }

    {
      // A peer's bigint in block data equals itself and the same double.
      var current = Doc(P("a"), P("b"));
      var same = Doc(P("a"), P("b"));
      var asDouble = Doc(P("a"), P("b"));
      SetData(current, "a", "o", Holding(new BigInteger(7)));
      SetData(same, "a", "o", Holding(new BigInteger(7)));
      SetData(asDouble, "a", "o", Holding(7d));
      cases.Add(("nothing for an identical document holding a peer bigint", current, same));
      cases.Add(("nothing for a peer bigint and the same double", current, asDouble));
    }

    {
      // A child its parent does not list, and a root block missing from the root order.
      var current = Doc(P("a"), P("r"));
      current.Transact(transaction =>
      {
        var root = current.GetArray("root");
        root.Delete(transaction, 1, 1);
        var orphan = new YMap(
        [
          new KeyValuePair<string, object?>("id", "o"),
          new KeyValuePair<string, object?>("type", "paragraph"),
          new KeyValuePair<string, object?>("parentId", "a"),
          new KeyValuePair<string, object?>("data", new YMap([])),
          new KeyValuePair<string, object?>("contentIds", new YArray([])),
        ]);
        current.GetMap("blocks").Set(transaction, "o", orphan);
      });
      cases.Add(("strays the structure does not reach", current, Doc(P("a"), P("r"), P("o"), P("n"))));
    }

    var written = new JsonArray();
    var converter = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);

    foreach (var (name, current, target) in cases)
    {
      var currentUpdate = current.EncodeStateAsUpdate();
      var targetUpdate = target.EncodeStateAsUpdate();
      var ops = CollabRestorePlanner.Plan(
          await Export(converter, current),
          YDocConverter.DescribeStructure(current),
          await Export(converter, target),
          YDocConverter.ReadPageMaps(current),
          YDocConverter.ReadPageMaps(target));

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["current"] = Convert.ToBase64String(currentUpdate),
        ["target"] = Convert.ToBase64String(targetUpdate),
        ["ops"] = new JsonArray([.. ops.Select(OpJson)]),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabRestorePlanner.Plan over the export, structure and page maps of current and target, as C# answers it. Captured by CollabHistoryCaptureTests; do not edit by hand. Updates are base64 Yjs v1 updates.",
      ["cases"] = written,
    };
  }

  private static JsonNode OpJson(CollabEditOp op) => op switch
  {
    CollabEditOp.Insert insert => new JsonObject
    {
      ["op"] = "insert",
      ["id"] = insert.Id,
      ["after"] = insert.After,
      ["parent"] = insert.Parent,
      ["block"] = insert.Block.DeepClone(),
    },
    CollabEditOp.Update update => new JsonObject
    {
      ["op"] = "update",
      ["id"] = update.Id,
      ["data"] = update.Data.DeepClone(),
    },
    CollabEditOp.Remove remove => new JsonObject { ["op"] = "remove", ["id"] = remove.Id },
    CollabEditOp.PatchMaps patch => new JsonObject
    {
      ["op"] = "patchMaps",
      ["patches"] = new JsonArray([.. patch.Patches.Select(entry => (JsonNode)new JsonObject
      {
        ["map"] = entry.Map,
        ["key"] = entry.Key,
        ["remove"] = entry.Remove,
        ["value"] = RichText.ToJsonNode(entry.Value),
      })]),
    },
    _ => throw new InvalidOperationException($"the planner made a {op.GetType().Name}"),
  };

  private static async Task<JsonArray> Export(CollabDocConverter converter, YDoc doc)
  {
    return (JsonArray)(await converter.ExportAsync(doc))["blocks"]!;
  }

  private static YDoc Doc(params string[] blockJson) => Seeded(blockJson);

  private static void SetMap(YDoc doc, string map, string key, object? value)
  {
    doc.Transact(transaction => doc.GetMap(map).Set(transaction, key, value));
  }

  private static void SetData(YDoc doc, string id, string key, object? value)
  {
    doc.Transact(transaction =>
    {
      Assert.True(doc.GetMap("blocks").TryGet(id, out var block));
      Assert.True(((YMap)block!).TryGet("data", out var data));
      ((YMap)data!).Set(transaction, key, value);
    });
  }

  private static AnyObject Holding(object value)
  {
    var held = new AnyObject();

    held.Add("n", value);

    return held;
  }

  private static AnyObject Icon(string emoji)
  {
    var icon = new AnyObject();

    icon.Add("type", "emoji");
    icon.Add("value", emoji);

    return icon;
  }

  private static string P(string id, string? parent = null, string? text = null)
  {
    var block = new JsonObject
    {
      ["id"] = id,
      ["type"] = "paragraph",
      ["data"] = new JsonObject { ["text"] = text ?? id },
    };

    if (parent is not null)
    {
      block["parent"] = parent;
    }

    return block.ToJsonString();
  }

  private static string Parent(string id, string type, string[] content, string? parent = null)
  {
    var block = new JsonObject
    {
      ["id"] = id,
      ["type"] = type,
      ["data"] = new JsonObject(),
      ["content"] = new JsonArray([.. content.Select(child => (JsonNode?)child)]),
    };

    if (parent is not null)
    {
      block["parent"] = parent;
    }

    return block.ToJsonString();
  }
}
