using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// CollabDatabaseChanges, captured from C# into
/// fixtures/collab-history/property-changes.json. Go and Rust read the same
/// file. Set BLOK_WRITE_COLLAB_HISTORY=1 to rewrite it after an intended change.
/// </summary>
public sealed class CollabDatabaseChangesCaptureTests
{
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  [Fact]
  public void ThePropertyChangesFixtureMatchesTheDescription()
  {
    var path = RichTextFixtures.PathOf("collab-history/property-changes.json");
    var text = Build().ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), "collab-history/property-changes.json is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static string Row(string properties, string extra = "") =>
      "{\"id\":\"r1\",\"type\":\"database-row\",\"data\":{\"properties\":" + properties + extra + "},\"parent\":\"db\"}";

  private static string Db(string schema, string? views) =>
      "{\"id\":\"db\",\"type\":\"database\",\"data\":{\"schema\":" + schema +
      (views is null ? "" : ",\"views\":" + views) + ",\"activeViewId\":\"v1\"}}";

  private static string Many(int count, string name) =>
      "[" + string.Join(",", Enumerable.Range(0, count).Select(i => $"{{\"id\":\"p{i}\",\"name\":\"{name}\"}}")) + "]";

  private const string Title = """{"id":"title","name":"Name","type":"title","position":"a"}""";
  private const string Status = """{"id":"st","name":"Status","type":"status","position":"b"}""";
  private const string View = """{"id":"v1","name":"Table","type":"table","position":"a","sorts":[],"filters":[]}""";

  private static JsonObject Build()
  {
    (string Name, string? Type, string? Before, string? After)[] cases =
    [
      ("a status change", "database-row",
          Row("""{"title":[{"text":"Row A"}],"st":"todo"}"""),
          Row("""{"title":[{"text":"Row A"}],"st":"done"}""")),
      ("a title edit", "database-row",
          Row("""{"title":[{"text":"—"}]}"""),
          Row("""{"title":[{"text":"Row A"}]}""")),
      ("a value set for the first time and one cleared", "database-row",
          Row("""{"title":[],"gone":"x"}"""),
          Row("""{"title":[],"new":3}""")),
      ("a value set to null is not a cleared one", "database-row",
          Row("""{"st":"todo"}"""),
          Row("""{"st":null}""")),
      ("several changes keep after's order, then the cleared ones", "database-row",
          Row("""{"a":1,"b":2,"c":3,"d":4}"""),
          Row("""{"d":5,"b":2,"a":0,"e":6}""")),
      ("a nested value compares deeply", "database-row",
          Row("""{"people":[{"id":"u1"}]}"""),
          Row("""{"people":[{"id":"u1"},{"id":"u2"}]}""")),
      ("only other row data changed", "database-row",
          Row("""{"st":"todo"}"""),
          Row("""{"st":"todo"}""", ""","pageId":"p1" """.Trim())),
      ("a row moved with the same data", "database-row",
          Row("""{"st":"todo"}"""),
          Row("""{"st":"todo"}""").Replace("\"parent\":\"db\"", "\"parent\":\"db2\"", StringComparison.Ordinal)),
      ("properties that are not an object read as none", "database-row",
          Row("""[1]"""),
          Row("""{"st":"todo"}""")),
      ("an id outside the BMP", "database-row",
          Row("""{"😀":"a","é":"x"}"""),
          Row("""{"é":"x","😀":"b"}""")),
      ("an added row has no breakdown", "database-row", null, Row("""{"st":"todo"}""")),
      ("a removed row has no breakdown", "database-row", Row("""{"st":"todo"}"""), null),
      ("a property added", "database",
          Db($"[{Title}]", $"[{View}]"),
          Db($"[{Title},{Status}]", $"[{View}]")),
      ("a property renamed", "database",
          Db($"[{Title},{Status}]", $"[{View}]"),
          Db($"[{Title},{Status.Replace("Status", "Stage", StringComparison.Ordinal)}]", $"[{View}]")),
      ("a property deleted keeps its old name", "database",
          Db($"[{Title},{Status}]", $"[{View}]"),
          Db($"[{Title}]", $"[{View}]")),
      ("a property type change", "database",
          Db($"[{Title},{Status}]", $"[{View}]"),
          Db($"[{Title},{Status.Replace("\"status\"", "\"select\"", StringComparison.Ordinal)}]", $"[{View}]")),
      ("a property moved is an update", "database",
          Db($"[{Title},{Status}]", $"[{View}]"),
          Db($"[{Status},{Title.Replace("\"a\"", "\"c\"", StringComparison.Ordinal)}]", $"[{View}]")),
      ("a view filter change", "database",
          Db($"[{Title}]", $"[{View}]"),
          Db($"[{Title}]", $"[{View.Replace("\"filters\":[]", "\"filters\":[{\"propertyId\":\"st\",\"operator\":\"is\",\"value\":\"done\"}]", StringComparison.Ordinal)}]")),
      ("a view created and one deleted", "database",
          Db($"[{Title}]", $"[{View}]"),
          Db($"[{Title}]", """[{"id":"v2","name":"Board","type":"board","position":"b","sorts":[],"filters":[]}]""")),
      ("missing views read as none", "database",
          Db($"[{Title}]", null),
          Db($"[{Title}]", $"[{View}]")),
      ("schema and views change together", "database",
          Db($"[{Title}]", $"[{View}]"),
          Db($"[{Title},{Status}]", $"[{View.Replace("Table", "All", StringComparison.Ordinal)}]")),
      ("entries without a string id are skipped, a repeated id keeps the first", "database",
          Db($$"""[{{Title}},{"id":7,"name":"n"},"x",{"id":"st","name":"A"},{"id":"st","name":"B"}]""", "[]"),
          Db($$"""[{{Title}},{"id":"st","name":"A"},{"name":"no id"}]""", "[]")),
      ("a repeated id keeps the first entry on both sides", "database",
          Db("""[{"id":"st","name":"A"},{"id":"st","name":"B"}]""", "[]"),
          Db("""[{"id":"st","name":"B"},{"id":"st","name":"A"}]""", "[]")),
      ("a repeated id after the first is ignored", "database",
          Db("""[{"id":"st","name":"A"}]""", "[]"),
          Db("""[{"id":"st","name":"A"},{"id":"st","name":"B"}]""", "[]")),
      ("a schema past the entry cap has no breakdown, views still do", "database",
          Db(Many(CollabDatabaseChanges.MaxEntries + 1, "a"), $"[{View}]"),
          Db(Many(CollabDatabaseChanges.MaxEntries + 1, "b"), "[]")),
      ("a schema at the entry cap still has one", "database",
          Db(Many(CollabDatabaseChanges.MaxEntries, "a"), "[]"),
          Db(Many(CollabDatabaseChanges.MaxEntries, "a").Replace("\"p0\",\"name\":\"a\"", "\"p0\",\"name\":\"b\"", StringComparison.Ordinal), "[]")),
      ("views past the entry cap on one side have no breakdown", "database",
          Db($"[{Title}]", "[]"),
          Db($"[{Title}]", Many(CollabDatabaseChanges.MaxEntries + 1, "v"))),
      ("a name that is not a string is left out", "database",
          Db("""[{"id":"p","name":1}]""", "[]"),
          Db("""[{"id":"p","name":2}]""", "[]")),
      ("only the title changed", "database",
          Db($"[{Title}]", $"[{View}]"),
          Db($"[{Title}]", $"[{View}]").Replace("\"activeViewId\":\"v1\"", "\"activeViewId\":\"v1\",\"title\":\"Tasks\"", StringComparison.Ordinal)),
      ("another block type has no breakdown", "paragraph",
          """{"id":"p","type":"paragraph","data":{"text":"a","properties":{"x":1}}}""",
          """{"id":"p","type":"paragraph","data":{"text":"b","properties":{"x":2}}}"""),
      ("a block without data", "database-row",
          """{"id":"r1","type":"database-row"}""",
          Row("""{"st":"todo"}""")),
    ];

    var written = new JsonArray();

    foreach (var (name, type, before, after) in cases)
    {
      var beforeNode = before is null ? null : JsonNode.Parse(before)!.AsObject();
      var afterNode = after is null ? null : JsonNode.Parse(after)!.AsObject();

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["type"] = type,
        ["before"] = beforeNode?.DeepClone(),
        ["after"] = afterNode?.DeepClone(),
        ["fields"] = CollabDatabaseChanges.Describe(type, beforeNode, afterNode),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabDatabaseChanges.Describe as C# answers it. Captured by CollabDatabaseChangesCaptureTests; do not edit by hand. fields are what a changes row adds to one block with detail=properties: properties [{id, before?, after?}] for a database-row, schema [{id, name?, action}] and views [{id, action}] for a database; each left out when empty, and left out when either side holds more than MaxEntries (500) entries. A repeated id keeps its first entry. A side is left out when the key is absent; null is a value.",
      ["cases"] = written,
    };
  }
}
