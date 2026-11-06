using System.Text.Json.Nodes;
using Blok.Server.Mcp.Protocol;
using ModelContextProtocol.Protocol;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class McpWireFiltersTests
{
  private static JsonRpcRequest Initialize(string version)
  {
    return new JsonRpcRequest
    {
      Id = new RequestId(1),
      Method = "initialize",
      Params = new JsonObject { ["protocolVersion"] = version },
    };
  }

  private static JsonRpcResponse InitializeAnswer(string version)
  {
    return new JsonRpcResponse
    {
      Id = new RequestId(1),
      Result = new JsonObject
      {
        ["protocolVersion"] = version,
        ["capabilities"] = new JsonObject { ["logging"] = new JsonObject(), ["tools"] = new JsonObject() },
        ["serverInfo"] = new JsonObject { ["name"] = "blok-mcp" },
      },
    };
  }

  [Theory]
  [InlineData("2026-07-28", "2025-11-25")]
  [InlineData("2099-01-01", "2025-11-25")]
  [InlineData("2025-06-18", "2025-06-18")]
  public void AnswersAnInitializeVersionItDoesNotKnowWith20251125(string asked, string offered)
  {
    var request = Initialize(asked);

    new McpWireFilters().Incoming(request);

    Assert.Equal(offered, (string?)request.Params?["protocolVersion"]);
  }

  [Fact]
  public void Echoes20241007AsNodeDoes()
  {
    var filters = new McpWireFilters();
    var request = Initialize("2024-10-07");

    filters.Incoming(request);
    var answer = InitializeAnswer("2024-11-05");

    Assert.Equal("2024-11-05", (string?)request.Params?["protocolVersion"]);
    Assert.Null(filters.Outgoing(answer));
    Assert.Equal("2024-10-07", (string?)answer.Result?["protocolVersion"]);
  }

  [Fact]
  public void AdvertisesToolsAndPromptsOnlyAsNodeDoes()
  {
    var answer = InitializeAnswer("2025-11-25");

    new McpWireFilters().Outgoing(answer);

    Assert.Equal("""{"tools":{}}""", answer.Result?["capabilities"]?.ToJsonString());
  }

  [Fact]
  public void NamesAMissingMethodAsNodeDoes()
  {
    var replaced = new McpWireFilters().Outgoing(new JsonRpcError
    {
      Id = new RequestId(3),
      Error = new JsonRpcErrorDetail { Code = -32601, Message = "Method 'resources/list' is not available." },
    });

    var error = Assert.IsType<JsonRpcError>(replaced);

    Assert.Equal("Method not found", error.Error.Message);
  }

  [Fact]
  public void TurnsARefusedElicitationIntoAToolError()
  {
    var replaced = new McpWireFilters().Outgoing(new JsonRpcError
    {
      Id = new RequestId(2),
      Error = new JsonRpcErrorDetail { Code = -32603, Message = "Request failed (remote): no person here" },
    });

    var answer = Assert.IsType<JsonRpcResponse>(replaced);

    Assert.Equal("""{"content":[{"type":"text","text":"Request failed (remote): no person here"}],"isError":true}""", answer.Result?.ToJsonString());
  }

  [Fact]
  public void CountsProgressTokensFromZeroPerConnection()
  {
    var filters = new McpWireFilters();
    var first = new JsonRpcRequest { Id = new RequestId(7), Method = "elicitation/create", Params = new JsonObject() };
    var second = new JsonRpcRequest { Id = new RequestId(8), Method = "elicitation/create", Params = new JsonObject() };

    filters.Outgoing(first);
    filters.Outgoing(second);

    Assert.Equal(0, (long?)first.Params?["_meta"]?["progressToken"]);
    Assert.Equal(1, (long?)second.Params?["_meta"]?["progressToken"]);
  }
}
