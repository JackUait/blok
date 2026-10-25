using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class AgentRoomOpsTests
{
  [Fact]
  public void SetPageFieldMatchesPageFieldsTs()
  {
    var fixture = RichTextFixtures.ReadJson("agent-page-fields.json");
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, []);

    var steps = fixture["steps"]!.AsArray();
    var after = fixture["after"]!.AsArray();

    for (var i = 0; i < steps.Count; i++)
    {
      RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetPageField(steps[i]!["key"]!.GetValue<string>(), steps[i]!["value"]?.DeepClone())]);

      var page = YDocConverter.ExportPage(doc);

      Assert.True(JsonNode.DeepEquals(after[i], page), $"step {i}: {page.ToJsonString()}");
    }
  }

  [Fact]
  public void SetPageFieldRefusesABadIconAndAnUnknownKey()
  {
    var doc = new YDoc();

    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetPageField("icon", new JsonObject { ["type"] = "emoji" })]));
    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetPageField("cover", "x")]));
    Assert.Empty(YDocConverter.ExportPage(doc));
  }

  [Fact]
  public async Task SeedCarriesTitleAndIconIntoThePageRoot()
  {
    var converter = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);
    var doc = new YDoc();

    await converter.SeedAsync(doc, JsonNode.Parse("""{"title":"T","icon":{"type":"emoji","value":"x"},"blocks":[]}""")!);
    var exported = await converter.ExportAsync(doc);

    Assert.Equal("T", exported["title"]!.GetValue<string>());
    Assert.Equal("x", exported["icon"]!["value"]!.GetValue<string>());
  }

  public static TheoryData<string> MoveCases()
  {
    var cases = new TheoryData<string>();

    foreach (var c in RichTextFixtures.ReadJson("agent-moves.json")["cases"]!.AsArray())
    {
      cases.Add(c!["name"]!.GetValue<string>());
    }

    return cases;
  }

  [Theory]
  [MemberData(nameof(MoveCases))]
  public void MoveMatchesDocumentStore(string name)
  {
    var fixture = RichTextFixtures.ReadJson("agent-moves.json");
    var c = fixture["cases"]!.AsArray().Single(x => x!["name"]!.GetValue<string>() == name)!;
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, fixture["seed"]!.DeepClone().AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move(c["id"]!.GetValue<string>(), c["after"]?.GetValue<string>(), c["parent"]?.GetValue<string>())]);

    var exported = Structure(RichTextRuntime.Export(doc));
    var expected = Structure(c["expected"]!.AsArray());
    Assert.True(JsonNode.DeepEquals(expected, exported), $"{name}: {exported.ToJsonString()}");
  }

  [Fact]
  public void MoveRefusesItsOwnSubtree()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, RichTextFixtures.ReadJson("agent-moves.json")["seed"]!.DeepClone().AsArray());

    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move("a", null, "a1")]));
    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move("a", null, "a")]));
  }

  [Fact]
  public void AMovedChildSurvivesItsOldParentsRemovalInTheSameRequest()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, RichTextFixtures.ReadJson("agent-moves.json")["seed"]!.DeepClone().AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move("a1", "b", null), new CollabEditOp.Remove("a")]);

    var exported = RichTextRuntime.Export(doc);
    Assert.Equal(["b", "a1"], exported.Select(b => b!["id"]!.GetValue<string>()));
    Assert.Null(exported[1]!["parent"]);
  }

  [Fact]
  public void AMovedBlockCanBeAnAnchorLaterInTheSameRequest()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, RichTextFixtures.ReadJson("agent-moves.json")["seed"]!.DeepClone().AsArray());

    RichTextRuntime.ApplyOps(doc, [
      new CollabEditOp.Move("b", null, "a"),
      new CollabEditOp.Insert("n", new JsonObject { ["type"] = "paragraph", ["data"] = new JsonObject() }, "b", "a"),
      new CollabEditOp.Move("a2", "n", "a"),
    ]);

    var a = RichTextRuntime.Export(doc).Single(b => b!["id"]!.GetValue<string>() == "a")!;
    Assert.Equal("""["b","n","a2","a1"]""", a["content"]!.ToJsonString());
  }

  [Fact]
  public void RetypeKeepsTheBlockAndItsChildren()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, JsonNode.Parse("""[{"id":"t","type":"toggle","data":{"text":[{"text":"T"}]},"content":["k"],"tunes":{"align":{"value":"left"}}},{"id":"k","type":"paragraph","data":{},"parent":"t"}]""")!.AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Retype("t", "header", new JsonObject { ["text"] = JsonNode.Parse("""[{"text":"T"}]"""), ["level"] = 2 })]);

    var t = RichTextRuntime.Export(doc).Single(b => b!["id"]!.GetValue<string>() == "t")!;
    Assert.Equal("header", t["type"]!.GetValue<string>());
    Assert.Equal(2L, t["data"]!["level"]!.GetValue<long>());
    Assert.Equal("""[{"text":"T"}]""", t["data"]!["text"]!.ToJsonString());
    Assert.Equal("""["k"]""", t["content"]!.ToJsonString());
    Assert.Equal("left", t["tunes"]!["align"]!["value"]!.GetValue<string>());
  }

  [Fact]
  public void SetTunesAndMetadataLandOnTheBlock()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, JsonNode.Parse("""[{"id":"p","type":"paragraph","data":{},"tunes":{"gone":{"x":1}}}]""")!.AsArray());

    RichTextRuntime.ApplyOps(doc, [
      new CollabEditOp.SetTunes("p", new JsonObject { ["align"] = new JsonObject { ["value"] = "center" }, ["gone"] = null }),
      new CollabEditOp.SetMetadata("p", 42, "agent-cs"),
    ]);

    var p = RichTextRuntime.Export(doc).Single()!;
    Assert.Equal("""{"align":{"value":"center"}}""", p["tunes"]!.ToJsonString());
    Assert.Equal("agent-cs", p["lastEditedBy"]!.GetValue<string>());
    Assert.Equal(42L, p["lastEditedAt"]!.GetValue<long>());
  }

  [Fact]
  public void MetadataSetsTheCoEditorAndAnEditWithoutOneRemovesIt()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, JsonNode.Parse("""[{"id":"p","type":"paragraph","data":{}}]""")!.AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetMetadata("p", 42, "human-1", "agent-cs")]);
    var p = RichTextRuntime.Export(doc).Single()!;
    Assert.Equal(("human-1", "agent-cs"), (p["lastEditedBy"]!.GetValue<string>(), p["lastEditedWith"]!.GetValue<string>()));

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetMetadata("p", 43, "agent-cs")]);
    p = RichTextRuntime.Export(doc).Single()!;
    Assert.Equal("agent-cs", p["lastEditedBy"]!.GetValue<string>());
    Assert.False(p.AsObject().ContainsKey("lastEditedWith"));
  }

  [Fact]
  public void AnInsertCarriesTheCoAuthorIds()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, []);

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Insert(
        "n",
        JsonNode.Parse("""{"type":"paragraph","data":{},"createdBy":"human-1","createdWith":"agent-cs"}""")!.AsObject(),
        null,
        null)]);

    Assert.Equal("agent-cs", RichTextRuntime.Export(doc).Single()!["createdWith"]!.GetValue<string>());
  }

  [Fact]
  public void LiftThenRemoveKeepsTheChildrenInTheSlot()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, RichTextFixtures.ReadJson("agent-moves.json")["seed"]!.DeepClone().AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Lift("a"), new CollabEditOp.Remove("a")]);

    var exported = RichTextRuntime.Export(doc);
    Assert.Equal(["a1", "a2", "b"], exported.Select(b => b!["id"]!.GetValue<string>()));
    Assert.All(exported, b => Assert.Null(b!["parent"]));
  }

  [Fact]
  public void TheNewOpsRefuseAnUnknownBlock()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, []);

    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Retype("x", "header", [])]));
    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetTunes("x", [])]));
    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetMetadata("x", 1, "a")]));
    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Lift("x")]));
  }

  /// <summary>Ids, parents and children in order; data spelling differs between the two exports.</summary>
  private static JsonArray Structure(JsonArray blocks)
  {
    return new JsonArray(blocks.Select(block => (JsonNode)new JsonObject
    {
      ["id"] = block!["id"]!.DeepClone(),
      ["type"] = block["type"]!.DeepClone(),
      ["parent"] = block["parent"]?.DeepClone(),
      ["content"] = block["content"]?.DeepClone() ?? new JsonArray(),
    }).ToArray());
  }
}
