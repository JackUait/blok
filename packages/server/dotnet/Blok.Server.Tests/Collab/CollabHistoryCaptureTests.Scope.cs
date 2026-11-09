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

    var written = new JsonArray();
    var converter = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);

    foreach (var (name, databases, current, target) in cases)
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
          null,
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

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["databases"] = databases,
        ["current"] = Convert.ToBase64String(current.EncodeStateAsUpdate()),
        ["target"] = Convert.ToBase64String(target.EncodeStateAsUpdate()),
        ["ops"] = new JsonArray([.. ops.Select(OpJson)]),
        ["kept"] = new JsonArray([.. (keep?.Pinned ?? new HashSet<string>()).Order(StringComparer.Ordinal).Select(id => (JsonNode?)id)]),
        ["orphaned"] = new JsonArray([.. (keep?.Orphaned ?? []).Select(guard => (JsonNode)guard.ToJson())]),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabRestorePlanner.KeepDatabases then Plan, as C# answers it. Captured by CollabHistoryCaptureTests; do not edit by hand. databases: keep leaves every database on either side, and everything below it on either side, as it is now; restore is today's restore. kept: the blocks no op may name, sorted. orphaned: an orphanedDatabase guard per kept root whose parent the restore removes; the restore is then refused. digests: the restore key digest; keep adds \\nkeep to the line, restore keeps the old digest. Updates are base64 Yjs v1 updates.",
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
