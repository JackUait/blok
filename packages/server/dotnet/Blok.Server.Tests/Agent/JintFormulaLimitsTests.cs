using System.Diagnostics;
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// The formula caps of src/shared/database/formula/limits.ts, as a server read sees them.
public sealed class JintFormulaLimitsTests
{
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");

  private static async Task<JsonObject> ComputedOf(params string[] expressions)
  {
    var schema = new JsonArray { JsonNode.Parse("""{"id":"t","name":"Name","type":"title","position":"a0"}""") };
    for (var i = 0; i < expressions.Length; i++)
    {
      schema.Add(new JsonObject
      {
        ["id"] = $"f{i}",
        ["name"] = $"F{i}",
        ["type"] = "formula",
        ["position"] = $"b{i}",
        ["formula"] = new JsonObject { ["expression"] = expressions[i] },
      });
    }
    var document = new JsonObject
    {
      ["blocks"] = new JsonArray
      {
        new JsonObject
        {
          ["id"] = "db",
          ["type"] = "database",
          ["content"] = new JsonArray { "r1" },
          ["data"] = new JsonObject
          {
            ["title"] = "Limits",
            ["activeViewId"] = "v1",
            ["views"] = JsonNode.Parse("""[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}]"""),
            ["schema"] = schema,
          },
        },
        JsonNode.Parse("""{"id":"r1","type":"database-row","parent":"db","data":{"position":"a0","properties":{"t":"One"}}}"""),
      },
    };
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        document.ToJsonString(), """{"commands":[{"name":"doc.read","args":{"ids":["r1"]}}]}""", Actor);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.True(result["results"] is JsonArray, execution.ResultJson[..Math.Min(2000, execution.ResultJson.Length)]);
    var view = Assert.IsType<JsonObject>(Assert.IsType<JsonArray>(result["results"])[0]);
    var row = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(view["blocks"])));

    return Assert.IsType<JsonObject>(row["computed"]);
  }

  [Fact]
  public async Task AFormulaNestedToTheCapReadsAndOnePastItIsACompileError()
  {
    var computed = await ComputedOf(
        $"{new string('(', 63)}1{new string(')', 63)}",
        string.Join(" + ", Enumerable.Repeat("1", 64)),
        $"\"A\"{string.Concat(Enumerable.Repeat(".lower()", 63))}",
        $"{new string('(', 64)}1{new string(')', 64)}",
        $"{new string('(', 100000)}1");

    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"f0":1,"f1":64,"f2":"a"}"""),
        new JsonObject { ["f0"] = computed["f0"]?.DeepClone(), ["f1"] = computed["f1"]?.DeepClone(), ["f2"] = computed["f2"]?.DeepClone() }),
        computed.ToJsonString());
    // Past the cap: the same compile error the editor shows, not a failed read.
    Assert.Contains("nest at most 64 levels deep", computed["f3"]?["unavailable"]?.GetValue<string>(), StringComparison.Ordinal);
    Assert.Contains("at most 10000 characters long", computed["f4"]?["unavailable"]?.GetValue<string>(), StringComparison.Ordinal);
  }

  [Fact]
  public async Task AnEvilPatternAndAHugeRepeatReadEmptyAtOnce()
  {
    var clock = Stopwatch.StartNew();
    var computed = await ComputedOf(
        $"test(\"{new string('a', 30)}b\", \"(a+)+$\")",
        "test(repeat(\"a\", 5000) + \"b\", \"a*a*a*$\")",
        "repeat(\"ab\", 1000000000)",
        "test(\"12-34\", \"^\\\\d+-\\\\d+$\")");

    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"f0":false,"f1":false,"f2":"","f3":true}"""),
        computed), computed.ToJsonString());
    Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), clock.Elapsed.ToString());
  }
}
