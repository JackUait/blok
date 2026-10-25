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
}
