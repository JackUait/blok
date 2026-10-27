using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentLockedDeleteTests
{
  private const string Locked = """
      {"id":"L","type":"database","parent":"{{PARENT}}","content":["L-row"],"data":{"schema":[{"id":"Lt","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"Lv","name":"Table","type":"table","position":"a0"}],"activeViewId":"Lv"}},
      {"id":"L-row","type":"database-row","parent":"L","content":[],"data":{"properties":{"Lt":"Row"},"position":"a0"}}
      """;
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");
  private static readonly Lazy<IBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(1, null, null));

  private static readonly string RowHolding = "{\"blocks\":[" + """
      {"id":"D","type":"database","content":["r"],"data":{"schema":[{"id":"dt","name":"Name","type":"title","position":"a0"}],"views":[{"id":"Dv","name":"Table","type":"table","position":"a0"}],"activeViewId":"Dv"}},
      {"id":"r","type":"database-row","parent":"D","content":["L"],"data":{"properties":{"dt":"r"},"position":"a0"}},
      """ + Locked.Replace("{{PARENT}}", "r", StringComparison.Ordinal) + "]}";

  private static readonly string ColumnsHolding = "{\"blocks\":[" + """
      {"id":"cl","type":"column_list","content":["c1","c2","c3"],"data":{}},
      {"id":"c1","type":"column","parent":"cl","content":["L"],"data":{}},
      {"id":"c2","type":"column","parent":"cl","content":["p2"],"data":{}},
      {"id":"p2","type":"paragraph","parent":"c2","content":[],"data":{"text":"two"}},
      {"id":"c3","type":"column","parent":"cl","content":["p3"],"data":{}},
      {"id":"p3","type":"paragraph","parent":"c3","content":[],"data":{"text":"three"}},
      """ + Locked.Replace("{{PARENT}}", "c1", StringComparison.Ordinal) + "]}";

  public static TheoryData<string, string> Removals => new()
  {
    { "row", """{"commands":[{"name":"block.delete","args":{"id":"r"}}]}""" },
    { "row", """{"commands":[{"name":"database.deleteRow","args":{"id":"D","rowId":"r"}}]}""" },
    { "columns", """{"commands":[{"name":"column_list.removeColumn","args":{"id":"cl","index":0}}]}""" },
  };

  [Theory]
  [MemberData(nameof(Removals))]
  public async Task JintRefusesARemovalThatTakesALockedDatabaseWithIt(string seed, string batch)
  {
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(seed == "row" ? RowHolding : ColumnsHolding, batch, Actor);

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.False(result["ok"]!.GetValue<bool>(), execution.ResultJson);
    var error = result["error"]!;
    Assert.Equal("PRECONDITION_FAILED", error["code"]!.GetValue<string>());
    Assert.Equal("locked", error["details"]!["reason"]!.GetValue<string>());
    Assert.Null(execution.DocumentJson);
  }
}
