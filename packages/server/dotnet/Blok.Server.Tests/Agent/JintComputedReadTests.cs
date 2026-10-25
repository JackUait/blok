using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class JintComputedReadTests
{
  // Same engine as the editor cells: formula, rollup over a self-relation, prefixed ID, created time.
  private const string Document = """
      {"blocks":[
        {"id":"db","type":"database","content":["r1","r2"],"data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[
            {"id":"t","name":"Name","type":"title","position":"a0"},
            {"id":"n","name":"Est","type":"number","position":"a1"},
            {"id":"f","name":"Double","type":"formula","position":"a2","formula":{"expression":"prop(\"Est\") * 2"}},
            {"id":"rel","name":"Parent","type":"relation","position":"a3","relation":{"targetDatabaseId":"db"}},
            {"id":"ru","name":"Sum","type":"rollup","position":"a4","rollup":{"relationPropertyId":"rel","targetPropertyId":"n","function":"sum"}},
            {"id":"ct","name":"Created","type":"createdTime","position":"a5"},
            {"id":"uid","name":"ID","type":"uniqueId","position":"a6","uniqueId":{"prefix":"T"}}]}},
        {"id":"r1","type":"database-row","parent":"db","createdAt":1767323045000,
          "data":{"title":"One","position":"a0","properties":{"t":"One","n":21,"rel":[{"id":"r2"}]}}},
        {"id":"r2","type":"database-row","parent":"db","createdAt":1767398400000,
          "data":{"title":"Two","position":"a1","properties":{"t":"Two","n":5}}}]}
      """;

  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");

  [Fact]
  public async Task ADatabaseRowReadsWithTheComputedValuesItsCellsShow()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        Document, """{"commands":[{"name":"doc.read","args":{"ids":["r1"]}}]}""", Actor);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    var view = Assert.IsType<JsonObject>(Assert.IsType<JsonArray>(result["results"])[0]);
    var row = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(view["blocks"])));
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"f":42,"rel":[{"id":"r2"}],"ru":5,"ct":"2026-01-02T03:04:05.000Z","uid":"T-1"}"""),
        row["computed"]), row.ToJsonString());
  }

  // 3000 rows already brushes the 10 s default deadline on a loaded machine, and ~4900 rows
  // runs out of memory even without computed values: that limit is the runtime's.
  [Fact]
  public async Task AFullReadOfALargeDatabaseFinishes()
  {
    const int rows = 1500;
    var blocks = new JsonArray();
    var content = new JsonArray();
    for (var i = 0; i < rows; i++)
    {
      content.Add($"r{i}");
    }
    blocks.Add(JsonNode.Parse("""
        {"id":"db","type":"database","data":{"title":"Big","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[
            {"id":"t","name":"Name","type":"title","position":"a0"},
            {"id":"n","name":"Est","type":"number","position":"a1"},
            {"id":"f","name":"Double","type":"formula","position":"a2","formula":{"expression":"prop(\"Est\") * 2"}},
            {"id":"uid","name":"ID","type":"uniqueId","position":"a3"}]}}
        """));
    Assert.IsType<JsonObject>(blocks[0])["content"] = content;
    for (var i = 0; i < rows; i++)
    {
      blocks.Add(new JsonObject
      {
        ["id"] = $"r{i}",
        ["type"] = "database-row",
        ["parent"] = "db",
        ["data"] = new JsonObject
        {
          ["position"] = $"a{i:D5}",
          ["properties"] = new JsonObject { ["t"] = $"Row {i}", ["n"] = i },
        },
      });
    }
    var document = new JsonObject { ["blocks"] = blocks }.ToJsonString();
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        document, """{"commands":[{"name":"doc.read","args":{"ids":["r1499"]}}]}""", Actor);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.True(result["ok"]?.GetValue<bool>(), execution.ResultJson);
    var view = Assert.IsType<JsonObject>(Assert.IsType<JsonArray>(result["results"])[0]);
    var row = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(view["blocks"])));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"f":2998,"uid":1500}"""), row["computed"]), row.ToJsonString());
  }
}
