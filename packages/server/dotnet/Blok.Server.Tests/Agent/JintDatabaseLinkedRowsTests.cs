using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class JintDatabaseLinkedRowsTests(JintAgentRuntimeFixture fixture) : IClassFixture<JintAgentRuntimeFixture>
{
  private const string View = """{"id":"lv-v","name":"Red","type":"table","position":"a0","sorts":[],"visibleProperties":[],"filters":[{"id":"f","propertyId":"tag","operator":"equals","value":"red"}]}""";

  private static string Document(string source) => """
      {"blocks":[
        {"id":"db","type":"database","content":["r1"],"data":{"activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"},
            {"id":"tag","name":"Tag","type":"select","position":"a1","config":{"options":[{"id":"red","label":"Red","position":"a0"}]}}]}},
        {"id":"r1","type":"database-row","parent":"db","content":[],"data":{"position":"a1","title":"r1","properties":{"t":"r1"}}},
        {"id":"lv","type":"database","content":[],"data":{"source":SOURCE,"activeViewId":"lv-v","views":[VIEW],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}}]}
      """.Replace("SOURCE", source).Replace("VIEW", View);

  private const string AddRow = """{"commands":[{"name":"database.addRow","args":{"id":"lv"}}]}""";

  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");

  [Fact]
  public async Task ARowAddedInALinkedViewGoesToTheSourceWithTheViewsFilterValues()
  {
    var execution = await fixture.Executor.OpenSession(Actor).ExecuteAsync(Document("""{"databaseId":"db"}"""), AddRow);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.True(result["ok"]?.GetValue<bool>(), execution.ResultJson);
    var rowId = result["results"]![0]!["rowId"]!.GetValue<string>();
    var blocks = JsonNode.Parse(execution.DocumentJson!)!["blocks"]!.AsArray();
    var row = blocks.Single(block => block!["id"]!.GetValue<string>() == rowId)!;

    Assert.Equal("db", row["parent"]?.GetValue<string>());
    Assert.Equal("red", row["data"]!["properties"]!["tag"]?.GetValue<string>());
    var linked = blocks.Single(block => block!["id"]!.GetValue<string>() == "lv")!;
    Assert.Empty(linked["content"]?.AsArray() ?? []);
  }

  [Fact]
  public async Task ALinkedViewOfADatabaseInAnotherDocumentIsRefused()
  {
    var execution = await fixture.Executor.OpenSession(Actor).ExecuteAsync(Document("""{"databaseId":"db","documentId":"other"}"""), AddRow);

    Assert.Null(execution.DocumentJson);
    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.Equal("PRECONDITION_FAILED", result["error"]?["code"]?.GetValue<string>());
  }
}
