using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentExecutorTests
{
  private const string Document = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}""";
  private const string NormalizedDocument = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello world"}]}}]}""";
  private const string ReadBatch = """{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");

  private const string SuccessOutput = """
      {
        "result":{
          "ok":true,"revision":"h41","results":[{}],"refs":{},
          "changed":{"created":[],"updated":["p"],"moved":[],"removed":[]},
          "lastRange":{"blockId":"p","field":"text","start":6,"end":11},
          "warnings":[{"code":"SANITIZED","message":"Removed unsafe markup.","commandIndex":0,"blockId":"p","field":"text"}]
        },
        "document":{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello "},{"text":"world","marks":{"bold":true}}]},"lastEditedBy":"agent-cs","lastEditedAt":1234}]},
        "edits":[{"op":"setRichText","id":"p","field":"text","value":[{"text":"Hello "},{"text":"world","marks":{"bold":true}}]}]
      }
      """;

  private const string ContractOutput = """
      {
        "manifest":{
          "formatVersion":1,"revision":"h10","blokVersion":"fixture","readOnly":false,
          "defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]
        },
        "contract":{
          "formatVersion":1,"revision":"h11","commands":[],
          "manifest":{
            "formatVersion":1,"revision":"h10","blokVersion":"fixture","readOnly":false,
            "defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]
          },
          "guidance":{"general":"","commands":{},"tools":{}}
        }
      }
      """;

  private const string CustomTools = """
      {
        "formatVersion":1,
        "blocks":[{
          "name":"quiz",
          "statics":{
            "toolbox":[],"richTextFields":[],"acceptsChildren":false,"ownsChildren":false,
            "isLayout":false,"deletesChildren":false,"selfPlacesChildren":false,
            "restrictedInTableCell":false,"conversion":{},
            "convertible":{"import":false,"export":false},"hasPrepareInsert":false
          },
          "description":{
            "summary":"A quiz.",
            "data":{"type":"object","properties":{"score":{"type":"integer"}},"required":["score"],"additionalProperties":false},
            "actions":[{"name":"grade","summary":"Grade the quiz.","target":"block","args":{"type":"object"}}]
          }
        }]
      }
      """;

  private const string Overrides = """{"spacer":{"hidden":true},"column_list":{"hiddenActions":["create"],"guidance":"Use the host layout."}}""";

  [Fact]
  public async Task FactoryRunsAStoredWriteThroughTheEmbeddedRuntime()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        Document,
        """{"commands":[{"name":"text.format","args":{"id":"p","range":{"find":"world"},"set":{"bold":true}}}]}""",
        Actor);

    var saved = ParseObject(Assert.IsType<string>(execution.DocumentJson));
    var block = Assert.Single(Objects(saved["blocks"]));
    var data = Assert.IsType<JsonObject>(block["data"]);
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""[{"text":"Hello "},{"text":"world","marks":{"bold":true}}]"""),
        data["text"]), data.ToJsonString());
    Assert.Equal("agent-cs", Value<string>(block["lastEditedBy"]));
    Assert.True(Value<long>(block["lastEditedAt"]) > 0);
    var result = ParseObject(execution.ResultJson);
    Assert.True(Value<bool>(result["ok"]));
    Assert.Equal(Value<string>(result["revision"]), execution.Revision);
    Assert.Matches("^h[0-9a-f]+$", execution.Revision);
    var changed = Assert.IsType<JsonObject>(result["changed"]);
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""["p"]"""), changed["updated"]));
  }

  [Fact]
  public async Task FactoryReturnsTheEmbeddedJintContractNotTheWireEnvelope()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var contract = ParseObject(await executor.GetContractAsync());

    Assert.True(Value<bool>(Command(contract, "block.insert")["available"]));
    Assert.Equal(1, Value<int>(contract["formatVersion"]));
    Assert.False(string.IsNullOrEmpty(Value<string>(contract["revision"])));
    // A plain call keeps no steps; a BlokAgentSession's contract offers history.
    foreach (var name in new[] { "history.undo", "history.redo" })
    {
      var command = Command(contract, name);
      Assert.False(Value<bool>(command["available"]));
      Assert.Equal("runtime", Value<string>(command["unavailableReason"]));
    }
    Assert.IsType<JsonObject>(contract["manifest"]);
    Assert.False(contract.ContainsKey("contract"));
  }

  [Fact]
  public async Task FailedStoredBatchReturnsNothingToSaveAndLeavesNoPartialWireWrites()
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);

    var execution = await executor.ExecuteAsync(
        NormalizedDocument,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"Never written"}},{"name":"block.delete","args":{"id":"missing"}}]}""",
        Actor);

    Assert.Null(execution.DocumentJson);
    var wire = ParseObject(Assert.IsType<string>(runtime.Output));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(NormalizedDocument), wire["document"]), wire.ToJsonString());
    Assert.Empty(Assert.IsType<JsonArray>(wire["edits"]));
    var result = ParseObject(execution.ResultJson);
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal("BLOCK_NOT_FOUND", Value<string>(error["code"]));
    Assert.Equal(1, Value<int>(error["commandIndex"]));
    Assert.False(Value<bool>(result["ok"]));
    Assert.Equal(Value<string>(result["revision"]), execution.Revision);
    Assert.True(JsonNode.DeepEquals(result, wire["result"]));
  }

  [Theory]
  [InlineData("history.undo")]
  [InlineData("history.redo")]
  public async Task APlainCallRefusesHistoryAndHasNothingToSave(string name)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var batch = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject { ["name"] = name, ["args"] = new JsonObject() }),
    };

    var execution = await executor.ExecuteAsync(Document, batch.ToJsonString(), Actor);

    Assert.Null(execution.DocumentJson);
    var result = ParseObject(execution.ResultJson);
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal("COMMAND_UNAVAILABLE", Value<string>(error["code"]));
    Assert.Equal("runtime", Value<string>(Assert.IsType<JsonObject>(error["details"])["reason"]));
    Assert.False(Value<bool>(result["ok"]));
    Assert.False(Value<bool>(error["retryable"]));
    Assert.False(string.IsNullOrWhiteSpace(Value<string>(error["message"])));
    Assert.Empty(Assert.IsType<JsonArray>(result["warnings"]));
    Assert.Equal(Value<string>(result["revision"]), execution.Revision);
  }

  [Fact]
  public async Task ReturnsOnlyTheResultAndSuccessfulDocumentWithTheResultRevision()
  {
    var runtime = new RecordingRuntime(SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);

    var execution = await executor.ExecuteAsync(Document, ReadBatch, Actor);

    Assert.Equal("h41", execution.Revision);
    var expected = ParseObject(SuccessOutput);
    Assert.True(JsonNode.DeepEquals(expected["result"], JsonNode.Parse(execution.ResultJson)), execution.ResultJson);
    Assert.True(JsonNode.DeepEquals(expected["document"], JsonNode.Parse(Assert.IsType<string>(execution.DocumentJson))));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("human-\"owner")]
  public async Task ForwardsParsedDocumentBatchAndAgentIdentityWithoutDoubleEncoding(string? onBehalfOf)
  {
    var runtime = new RecordingRuntime(SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);
    var actor = new BlokAgentActor("agent-\"cs", "Server \\ agent", onBehalfOf);
    const string batch = """{"expectRevision":"h0","commands":[{"name":"block.insert","args":{"id":"q","type":"paragraph","data":{"text":"Next"}},"ref":"next"}]}""";
    using var cancellation = new CancellationTokenSource();

    await executor.ExecuteAsync(Document, batch, actor, cancellationToken: cancellation.Token);

    var call = Assert.Single(runtime.Calls);
    Assert.Equal("agentExecute", call.Operation);
    Assert.Null(call.Timeout);
    Assert.Equal(cancellation.Token, call.CancellationToken);
    var input = ParseObject(call.InputJson);
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(Document), input["document"]));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(batch), input["batch"]));
    var expectedActor = new JsonObject { ["id"] = "agent-\"cs", ["name"] = "Server \\ agent", ["kind"] = "agent" };
    if (onBehalfOf is not null)
    {
      expectedActor["onBehalfOf"] = onBehalfOf;
    }
    Assert.True(JsonNode.DeepEquals(expectedActor, input["actor"]), input.ToJsonString());
    Assert.Empty(Assert.IsType<JsonArray>(input["services"]));
    Assert.False(input.ContainsKey("customTools"));
    Assert.False(input.ContainsKey("overrides"));
  }

  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public async Task FailedWireResultsSuppressTheDocumentAndKeepTheEntireFailure(bool withRevision)
  {
    var output = ParseObject("""
        {
          "result":{
            "ok":false,"error":{"code":"COMMAND_UNAVAILABLE","message":"This command needs another runtime.","commandIndex":0,"path":"/commands/0/name","retryable":false,"details":{"reason":"runtime"}},
            "warnings":[{"code":"DEMOTED","message":"A planned insertion was demoted.","commandIndex":0}]
          },
          "document":{"blocks":[{"id":"partial","type":"paragraph","data":{"text":[{"text":"Never save"}]}}]},
          "edits":[{"op":"setPageField","key":"title","value":"Never save"}]
        }
        """);
    var expectedResult = Assert.IsType<JsonObject>(output["result"]);
    if (withRevision)
    {
      expectedResult["revision"] = "hfailed";
    }
    var runtime = new RecordingRuntime(output.ToJsonString());
    var executor = new BlokAgentExecutor(runtime);

    var execution = await executor.ExecuteAsync(Document, ReadBatch, Actor);

    Assert.Null(execution.DocumentJson);
    Assert.Equal(withRevision ? "hfailed" : string.Empty, execution.Revision);
    Assert.True(JsonNode.DeepEquals(expectedResult, JsonNode.Parse(execution.ResultJson)), execution.ResultJson);
  }

  [Fact]
  public async Task ExtractsOnlyTheContractAndPassesCancellationToManifest()
  {
    var runtime = new RecordingRuntime(ContractOutput);
    var executor = new BlokAgentExecutor(runtime);
    using var cancellation = new CancellationTokenSource();

    var contract = await executor.GetContractAsync(cancellationToken: cancellation.Token);

    Assert.True(JsonNode.DeepEquals(ParseObject(ContractOutput)["contract"], JsonNode.Parse(contract)), contract);
    var call = Assert.Single(runtime.Calls);
    Assert.Equal("manifest", call.Operation);
    Assert.Null(call.Timeout);
    Assert.Equal(cancellation.Token, call.CancellationToken);
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"services":[]}"""), JsonNode.Parse(call.InputJson)));
  }

  [Theory]
  [InlineData("manifest", false, false)]
  [InlineData("manifest", true, false)]
  [InlineData("manifest", false, true)]
  [InlineData("manifest", true, true)]
  [InlineData("agentExecute", false, false)]
  [InlineData("agentExecute", true, false)]
  [InlineData("agentExecute", false, true)]
  [InlineData("agentExecute", true, true)]
  public async Task DeclaresPageBackendOnlyWithBothOptInsForEachWireOperation(
      string operation, bool pageTitles, bool hasTarget)
  {
    var runtime = new RecordingRuntime(operation == "manifest" ? ContractOutput : SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);
    var target = new NoPages();
    var options = new BlokAgentOptions { PageTitles = pageTitles, PageTarget = hasTarget ? target : null };

    if (operation == "manifest")
    {
      await executor.GetContractAsync(options);
    }
    else
    {
      await executor.ExecuteAsync(Document, ReadBatch, Actor, options);
    }

    var call = Assert.Single(runtime.Calls);
    var input = ParseObject(call.InputJson);
    var expected = pageTitles && hasTarget ? """["pageBackend"]""" : "[]";
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), input["services"]), input.ToJsonString());
    Assert.Equal(operation, call.Operation);
    Assert.Equal(0, target.Calls);
  }

  [Theory]
  [InlineData("manifest")]
  [InlineData("agentExecute")]
  public async Task ForwardsParsedCustomToolsAndOverridesToEachWireOperation(string operation)
  {
    var runtime = new RecordingRuntime(operation == "manifest" ? ContractOutput : SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);
    var options = new BlokAgentOptions { CustomToolsJson = CustomTools, OverridesJson = Overrides };

    if (operation == "manifest")
    {
      await executor.GetContractAsync(options);
    }
    else
    {
      await executor.ExecuteAsync(Document, ReadBatch, Actor, options);
    }

    var call = Assert.Single(runtime.Calls);
    var input = ParseObject(call.InputJson);
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(CustomTools), input["customTools"]), input.ToJsonString());
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(Overrides), input["overrides"]));
    Assert.Equal(operation, call.Operation);
  }

  [Fact]
  public async Task CustomToolsReachTheEmbeddedContractAndStoredInsertionWithoutCustomHandlers()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var options = new BlokAgentOptions { CustomToolsJson = CustomTools };

    var contract = ParseObject(await executor.GetContractAsync(options));
    var quiz = Assert.Single(Objects(Assert.IsType<JsonObject>(contract["manifest"])["blocks"]),
        block => Value<string>(block["name"]) == "quiz");
    Assert.Equal("described", Value<string>(quiz["level"]));
    var grade = Command(contract, "quiz.grade");
    Assert.False(Value<bool>(grade["available"]));
    Assert.Equal("runtime", Value<string>(grade["unavailableReason"]));

    var execution = await executor.ExecuteAsync(
        Document,
        """{"commands":[{"name":"block.insert","args":{"id":"q","type":"quiz","data":{"score":1}}}]}""",
        Actor, options);

    var saved = ParseObject(Assert.IsType<string>(execution.DocumentJson));
    var inserted = Assert.Single(Objects(saved["blocks"]), block => Value<string>(block["id"]) == "q");
    Assert.Equal("quiz", Value<string>(inserted["type"]));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""{"score":1}"""), inserted["data"]));
    Assert.Equal(Actor.Id, Value<string>(inserted["lastEditedBy"]));
    Assert.True(Value<bool>(ParseObject(execution.ResultJson)["ok"]));
  }

  [Fact]
  public async Task OverridesHideToolsAndActionsInTheEmbeddedContractAndRefuseExecution()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var baseline = ParseObject(await executor.GetContractAsync());
    Assert.True(Value<bool>(Command(baseline, "column_list.create")["available"]));
    Assert.Contains(Objects(Assert.IsType<JsonObject>(baseline["manifest"])["blocks"]),
        block => Value<string>(block["name"]) == "spacer");
    var options = new BlokAgentOptions { OverridesJson = Overrides };

    var contract = ParseObject(await executor.GetContractAsync(options));
    Assert.DoesNotContain(Objects(contract["commands"]), command => Value<string>(command["name"]) == "column_list.create");
    Assert.DoesNotContain(Objects(Assert.IsType<JsonObject>(contract["manifest"])["blocks"]),
        block => Value<string>(block["name"]) == "spacer");

    var hiddenTool = await executor.ExecuteAsync(
        Document, """{"commands":[{"name":"block.insert","args":{"type":"spacer","data":{}}}]}""", Actor, options);
    Assert.Null(hiddenTool.DocumentJson);
    Assert.Equal("UNKNOWN_TOOL", Value<string>(Assert.IsType<JsonObject>(ParseObject(hiddenTool.ResultJson)["error"])["code"]));

    var hiddenAction = await executor.ExecuteAsync(
        Document, """{"commands":[{"name":"column_list.create","args":{"count":2}}]}""", Actor, options);
    Assert.Null(hiddenAction.DocumentJson);
    Assert.Equal("UNKNOWN_COMMAND", Value<string>(Assert.IsType<JsonObject>(ParseObject(hiddenAction.ResultJson)["error"])["code"]));
  }

  [Theory]
  [InlineData(false, false)]
  [InlineData(true, false)]
  [InlineData(false, true)]
  [InlineData(true, true)]
  public async Task TheEmbeddedContractRevisionReflectsOnlyTheTwoPartPageOptIn(bool pageTitles, bool hasTarget)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var baseline = ParseObject(await executor.GetContractAsync());
    var target = new NoPages();

    var contract = ParseObject(await executor.GetContractAsync(
        new BlokAgentOptions { PageTitles = pageTitles, PageTarget = hasTarget ? target : null }));

    var revision = Value<string>(contract["revision"]);
    var original = Value<string>(baseline["revision"]);
    if (pageTitles && hasTarget)
    {
      Assert.NotEqual(original, revision);
    }
    else
    {
      Assert.Equal(original, revision);
    }
    Assert.Equal(0, target.Calls);
  }

  [Theory]
  [InlineData("manifest")]
  [InlineData("agentExecute")]
  public async Task CallerCancellationStaysCancellationRatherThanAnAgentResult(string operation)
  {
    var runtime = new RecordingRuntime(operation == "manifest" ? ContractOutput : SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);
    using var cancelled = new CancellationTokenSource();
    await cancelled.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
    {
      if (operation == "manifest")
      {
        await executor.GetContractAsync(cancellationToken: cancelled.Token);
      }
      else
      {
        await executor.ExecuteAsync(Document, ReadBatch, Actor, cancellationToken: cancelled.Token);
      }
    });

    var call = Assert.Single(runtime.Calls);
    Assert.Equal(operation, call.Operation);
    Assert.Equal(cancelled.Token, call.CancellationToken);
  }

  [Fact]
  public async Task RoomsReturnAStructuredRuntimeRefusalWithoutInvokingTheStoredRuntime()
  {
    var runtime = new RecordingRuntime(SuccessOutput);
    var executor = new BlokAgentExecutor(runtime);

    var execution = await executor.ExecuteInRoomAsync("doc", ReadBatch, Actor);

    var result = ParseObject(execution.ResultJson);
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal("COMMAND_UNAVAILABLE", Value<string>(error["code"]));
    Assert.Equal("runtime", Value<string>(Assert.IsType<JsonObject>(error["details"])["reason"]));
    Assert.False(Value<bool>(result["ok"]));
    Assert.False(Value<bool>(error["retryable"]));
    Assert.False(string.IsNullOrWhiteSpace(Value<string>(error["message"])));
    Assert.Empty(Assert.IsType<JsonArray>(result["warnings"]));
    Assert.Null(execution.DocumentJson);
    Assert.Equal(string.Empty, execution.Revision);
    Assert.False(result.ContainsKey("revision"));
    Assert.Empty(runtime.Calls);
  }

  [Theory]
  [InlineData("poolSize")]
  [InlineData("timeout")]
  [InlineData("allocationBudgetBytes")]
  public void FactoryForwardsPoolAndStartupConstraints(string parameter)
  {
    var refusal = Assert.Throws<ArgumentOutOfRangeException>(() => BlokDocuments.CreateAgentExecutor(
        poolSize: parameter == "poolSize" ? 0 : 1,
        timeout: parameter == "timeout" ? TimeSpan.FromMilliseconds(1) : null,
        allocationBudgetBytes: parameter == "allocationBudgetBytes" ? 1024 : null));

    Assert.Equal(parameter, refusal.ParamName);
  }

  private static JsonObject ParseObject(string json) => Assert.IsType<JsonObject>(JsonNode.Parse(json));

  private static IEnumerable<JsonObject> Objects(JsonNode? node) =>
      Assert.IsType<JsonArray>(node).Select(item => Assert.IsType<JsonObject>(item));

  private static T Value<T>(JsonNode? node) => Assert.IsAssignableFrom<JsonValue>(node).GetValue<T>();

  private static JsonObject Command(JsonObject contract, string name) =>
      Assert.Single(Objects(contract["commands"]), command => Value<string>(command["name"]) == name);

  private sealed record Invocation(string Operation, string InputJson, TimeSpan? Timeout, CancellationToken CancellationToken);

  private sealed class RecordingRuntime(string answer) : IBlokRuntime
  {
    internal List<Invocation> Calls { get; } = [];

    public ValueTask<string> InvokeAsync(
        string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      Calls.Add(new Invocation(operation, inputJson, timeout, cancellationToken));
      cancellationToken.ThrowIfCancellationRequested();

      return ValueTask.FromResult(answer);
    }
  }

  private sealed class ObservingRuntime(IBlokRuntime inner) : IBlokRuntime
  {
    internal string? Output { get; private set; }

    public async ValueTask<string> InvokeAsync(
        string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      var output = await inner.InvokeAsync(operation, inputJson, timeout, cancellationToken);
      Output = output;

      return output;
    }
  }

  private sealed class NoPages : IBlokPageTarget
  {
    internal int Calls { get; private set; }

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Calls++;

      return ValueTask.FromResult<BlokPageLocation?>(null);
    }
  }
}
