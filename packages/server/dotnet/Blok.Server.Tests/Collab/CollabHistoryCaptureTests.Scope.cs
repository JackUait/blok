using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// restore-scope.json: a restore with <c>databases=keep</c> or <c>restore</c>.
/// With keep, every database, its rows and their bodies stay as they are now.
/// </summary>
public sealed partial class CollabHistoryCaptureTests
{
  [Fact]
  public async Task TheRestoreScopeMatchesThePlanner()
  {
    Check("collab-history/restore-scope.json", await RestoreScope());
  }

  /// <summary>A wide document with many kept databases stays fast: every lookup is by id, and each kept root is placed in one pass.</summary>
  [Fact]
  public void KeepDatabasesIsLinearInTheBlocks()
  {
    const int n = 100_000;
    var current = new JsonArray();
    var target = new JsonArray();

    for (var i = 0; i < n; i++)
    {
      current.Add(new JsonObject { ["id"] = $"p{i}", ["type"] = "paragraph" });
      current.Add(new JsonObject { ["id"] = $"d{i}", ["type"] = "database" });
      target.Add(new JsonObject { ["id"] = $"p{i}", ["type"] = "paragraph" });
    }

    var started = System.Diagnostics.Stopwatch.StartNew();
    var kept = CollabRestorePlanner.KeepDatabases(current, target);

    Assert.Equal(2 * n, kept.Target.Count);
    Assert.Equal(n, kept.Pinned.Count);
    Assert.True(started.Elapsed < TimeSpan.FromMinutes(1), $"took {started.Elapsed}");
  }

  /// <summary>restore-guards.json cases for <c>databases=keep</c>: a kept database raises no lock or share guard.</summary>
  private static JsonArray AddKeepGuardCases(JsonArray written)
  {
    var lockedSchema = """[{ "id": "t", "type": "title", "databaseLocked": true }]""";
    var publicView = $"""[{View("\"form\": { \"public\": true }")}]""";
    (string Name, string[] Current, string[] Target, string[] Expect)[] cases =
    [
      ("keep: a locked database the restore would unlock stays locked: no guard",
          [Db("d", lockedSchema)], [Db("d")], []),
      ("keep: a locked database the restore would remove stays: no guard",
          [Db("d", lockedSchema)], [P("a")], []),
      ("keep: a public form the restore would bring back stays as it is: no guard",
          [Db("d", views: $"[{View()}]")], [Db("d", views: publicView)], []),
      ("keep: a deleted database with a public form stays deleted: no guard",
          [P("a")], [P("a"), Db("d", views: publicView)], []),
      ("keep: a locked database whose parent the restore removes is refused",
          [Block("t", "toggle", content: ["d"]), Db("d", lockedSchema, parent: "t")], [P("a")], ["orphanedDatabase d"]),
      ("keep: a view with no id sharing a form stays as it is: no guard",
          [Db("d", views: $"""[{View("\"form\": { \"public\": true }", id: "")}]""")],
          [Db("d", views: $"""[{View("\"form\": { \"public\": true }", id: "")}]""")], []),
      ("keep: a repeated view id stays as it is: no guard",
          [Db("d", views: $"""[{View()}, {View("\"form\": { \"public\": true }")}]""")],
          [Db("d", views: $"""[{View()}, {View("\"form\": { \"public\": true }")}]""")], []),
      ("keep: a repeated current id whose first copy is the database keeps it: no guard",
          [Db("x", lockedSchema), P("x")], [P("a")], []),
      ("keep: a repeated current id whose second copy is the database restores the first: no guard",
          [P("x"), Db("x", lockedSchema)], [P("a")], []),
    ];

    foreach (var (name, current, target, expect) in cases)
    {
      var currentBlocks = new JsonArray([.. current.Select(ParseBlock)]);
      var kept = CollabRestorePlanner.KeepDatabases(currentBlocks, new JsonArray([.. target.Select(ParseBlock)]));
      var guards = CollabRestoreGuards.Kept(currentBlocks, kept);

      Assert.Equal(expect, guards.Select(guard => $"{guard.Kind} {guard.BlockId}"));
      written.Add(new JsonObject
      {
        ["name"] = name,
        ["databases"] = "keep",
        ["current"] = new JsonArray([.. current.Select(json => JsonNode.Parse(json))]),
        ["target"] = new JsonArray([.. target.Select(json => JsonNode.Parse(json))]),
        ["guards"] = new JsonArray([.. guards.Select(guard => (JsonNode)guard.ToJson())]),
      });
    }

    return written;
  }

  private static readonly string[] DigestKinds = ["restore", "keep"];

  private static string Block(string id, string type, string? parent = null, string[]? content = null, string data = "{}") =>
      new JsonObject
      {
        ["id"] = id,
        ["type"] = type,
        ["data"] = JsonNode.Parse(data),
        ["parent"] = parent,
        ["content"] = content is null ? null : new JsonArray([.. content.Select(child => (JsonNode?)child)]),
      }.ToJsonString().Replace(",\"parent\":null", "").Replace(",\"content\":null", "");

  private static string Database(string id, string[] rows, string? parent = null) =>
      Block(id, "database", parent, rows, """{ "schema": [{ "id": "t", "type": "title" }], "views": [] }""");

  private static string Row(string id, string database, string title, string[]? body = null) =>
      Block(id, "database-row", database, body, $$"""{ "properties": { "t": "{{title}}" } }""");

  private static async Task<JsonObject> RestoreScope()
  {
    var cases = new List<(string Name, string Databases, YDoc Current, YDoc Target)>
    {
      ("keep leaves an edited row as it is now", "keep",
          Doc(P("a", text: "now"), Database("d", ["r"]), Row("r", "d", "now")),
          Doc(P("a", text: "then"), Database("d", ["r"]), Row("r", "d", "then"))),
      ("restore brings the row back, as today", "restore",
          Doc(P("a", text: "now"), Database("d", ["r"]), Row("r", "d", "now")),
          Doc(P("a", text: "then"), Database("d", ["r"]), Row("r", "d", "then"))),
      ("keep leaves a row body as it is now", "keep",
          Doc(Database("d", ["r"]), Row("r", "d", "row", ["b"]), P("b", "r", "now")),
          Doc(Database("d", ["r"]), Row("r", "d", "row", ["b"]), P("b", "r", "then"))),
      ("keep leaves a row added since in place", "keep",
          Doc(Database("d", ["r", "s"]), Row("r", "d", "r"), Row("s", "d", "new")),
          Doc(Database("d", ["r"]), Row("r", "d", "r"))),
      ("a database deleted after the point stays deleted", "keep",
          Doc(P("a")),
          Doc(P("a"), Database("d", ["r"]), Row("r", "d", "gone"))),
      ("a database created after the point stays", "keep",
          Doc(P("a"), Database("d", ["r"]), Row("r", "d", "new")),
          Doc(P("a"))),
      ("a database whose parent the restore removes is refused", "keep",
          Doc(Block("t", "toggle", content: ["d"]), Database("d", ["r"], "t"), Row("r", "d", "row")),
          Doc(P("a"))),
      ("a database inside a block the restore keeps stays inside it", "keep",
          Doc(Block("t", "toggle", content: ["d"], data: """{ "text": "now" }"""), Database("d", [], "t")),
          Doc(Block("t", "toggle", content: [], data: """{ "text": "then" }"""))),
      ("siblings reordered around a kept database leave it where it is", "keep",
          Doc(P("a"), Database("d", []), P("b")),
          Doc(P("b"), P("a"))),
      ("a block that is a database only now stays a database", "keep",
          Doc(Database("x", [])),
          Doc(P("x", text: "then"))),
      ("a block that was a database only at the point stays as it is now", "keep",
          Doc(P("x", text: "now")),
          Doc(Database("x", []))),
    };
    // With the host's trash on, a later page pointer is trashed in place and a later database stays.
    var trashed = new List<(string Name, string Databases, YDoc Current, YDoc Target)>
    {
      ("keep with trash: a later page pointer is trashed and a later database stays", "keep",
          Doc(P("a"), Block("pg", "page", data: """{ "pageId": "sub" }"""), Database("d", ["r"]), Row("r", "d", "new")),
          Doc(P("a"))),
    };
    var trash = new CollabRestoreTrash("u9", 1700000999000);

    var written = new JsonArray();
    var converter = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);

    foreach (var (name, databases, current, target, caseTrash) in cases
        .Select(c => (c.Name, c.Databases, c.Current, c.Target, (CollabRestoreTrash?)null))
        .Concat(trashed.Select(c => (c.Name, c.Databases, c.Current, c.Target, (CollabRestoreTrash?)trash))))
    {
      var currentBlocks = await Export(converter, current);
      var targetBlocks = await Export(converter, target);
      var keep = databases == "keep" ? CollabRestorePlanner.KeepDatabases(currentBlocks, targetBlocks) : null;
      var ops = CollabRestorePlanner.Plan(
          currentBlocks,
          YDocConverter.DescribeStructure(current),
          keep?.Target ?? targetBlocks,
          YDocConverter.ReadPageMaps(current),
          YDocConverter.ReadPageMaps(target),
          caseTrash,
          keep?.Pinned);

      // The point of keep: no op names a kept block.
      var named = ops.Select(op => op switch
      {
        CollabEditOp.Insert insert => insert.Id,
        CollabEditOp.Update update => update.Id,
        CollabEditOp.Remove remove => remove.Id,
        _ => null,
      });
      Assert.DoesNotContain(named, id => id is not null && keep is not null && keep.Orphaned.Count == 0 && keep.Pinned.Contains(id));

      var entry = new JsonObject
      {
        ["name"] = name,
        ["databases"] = databases,
        ["current"] = Convert.ToBase64String(current.EncodeStateAsUpdate()),
        ["target"] = Convert.ToBase64String(target.EncodeStateAsUpdate()),
        ["ops"] = new JsonArray([.. ops.Select(OpJson)]),
        ["kept"] = new JsonArray([.. (keep?.Pinned ?? new HashSet<string>()).Order(StringComparer.Ordinal).Select(id => (JsonNode?)id)]),
        ["orphaned"] = new JsonArray([.. (keep?.Orphaned ?? []).Select(guard => (JsonNode)guard.ToJson())]),
      };

      if (caseTrash is not null)
      {
        entry["trash"] = new JsonObject { ["by"] = caseTrash.By, ["at"] = caseTrash.At };
      }

      written.Add(entry);
    }

    return new JsonObject
    {
      ["$comment"] = "CollabRestorePlanner.KeepDatabases then Plan, as C# answers it. Captured by CollabHistoryCaptureTests; do not edit by hand. databases: keep leaves every database on either side, and everything below it on either side, as it is now; restore is today's restore. kept: the blocks no op may name, sorted. orphaned: an orphanedDatabase guard per kept root whose parent the restore removes; the restore is then refused. trash, when set, is the restorer and the time in ms the planner trashes later page pointers with. digests: the restore key digest; keep adds \\nkeep to the line, restore keeps the old digest. Updates are base64 Yjs v1 updates.",
      ["cases"] = written,
      ["digests"] = new JsonArray([.. DigestKinds.Select(databases => (JsonNode)new JsonObject
      {
        ["lineage"] = "0123456789abcdef0123456789abcdef",
        ["sequence"] = "7",
        ["databases"] = databases,
        ["digestHex"] = Convert.ToHexStringLower(CollabRoomManager.RestoreDigest("0123456789abcdef0123456789abcdef", 7, databases == "keep")),
      })]),
    };
  }
}
