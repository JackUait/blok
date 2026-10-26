using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentPageActionTests
{
  private const string Source = """
      {"id":"source","title":"Source title","blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}
      """;
  private const string Target = """
      {"id":"target","title":"Target title","icon":{"type":"emoji","value":"old"},"blocks":[{"id":"body","type":"paragraph","data":{"text":[{"text":"Keep this content"}]}}]}
      """;
  private const string ReadBatch = """{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}""";
  private const string RenameBatch = """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");
  private static readonly string[] StoredEvents = ["resolve:page-2", "load", "save"];
  private static readonly string[] ResolvedOnlyEvents = ["resolve:page-2"];
  private static readonly string[] LoadedOnlyEvents = ["resolve:page-2", "load"];

  [Fact]
  public async Task RenamesTheStoredTargetThroughEmbeddedJintWithoutExecutingTheHostActionInJint()
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    runtime.Calls.Clear();
    using var cancellation = new CancellationTokenSource();

    var execution = await executor.ExecuteAsync(
        Source, RenameBatch, Actor, Options(pages), cancellation.Token);

    var saved = ParseObject(Assert.Single(pages.Saved));
    Assert.Equal("Roadmap", Value<string>(saved["title"]));
    Assert.True(JsonNode.DeepEquals(ParseObject(Target)["blocks"], saved["blocks"]), saved.ToJsonString());
    Assert.True(JsonNode.DeepEquals(ParseObject(Target)["icon"], saved["icon"]));
    Assert.Equal("target", Value<string>(saved["id"]));
    Assert.Equal(StoredEvents, pages.Events);
    Assert.All(pages.Tokens, token => Assert.Equal(cancellation.Token, token));
    AssertSourceSuccess(execution, sourceRevision);
    Assert.DoesNotContain(runtime.Calls, call => ExecutesPageAction(call));
    var write = Assert.Single(runtime.Calls, call => IsTargetCommand(call, "doc.setTitle"));
    var input = ParseObject(write.InputJson);
    var targetBatch = Assert.IsType<JsonObject>(input["batch"]);
    var targetCommand = Assert.Single(Objects(targetBatch["commands"]));
    Assert.Equal("doc.setTitle", Value<string>(targetCommand["name"]));
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"title":"Roadmap"}"""), targetCommand["args"]), targetCommand.ToJsonString());
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"id":"agent-cs","name":"Server agent","kind":"agent"}"""), input["actor"]));
    var targetRevision = await ReadRevisionAsync(executor, saved.ToJsonString());
    Assert.NotEqual(targetRevision, execution.Revision);
  }

  [Theory]
  [InlineData("""{"type":"emoji","value":"🚀"}""")]
  [InlineData("""{"type":"image","url":"https://example.com/icon.png"}""")]
  [InlineData("null")]
  public async Task SetsOrClearsTheStoredTargetIconWithoutChangingTheSource(string iconJson)
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    runtime.Calls.Clear();
    var batch = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject
      {
        ["name"] = "page.setIcon",
        ["args"] = new JsonObject { ["id"] = "pg", ["icon"] = JsonNode.Parse(iconJson) },
      }),
      ["expectRevision"] = sourceRevision,
    };

    var execution = await executor.ExecuteAsync(Source, batch.ToJsonString(), Actor, Options(pages));

    var saved = ParseObject(Assert.Single(pages.Saved));
    if (iconJson == "null")
    {
      Assert.False(saved.ContainsKey("icon"));
    }
    else
    {
      Assert.True(JsonNode.DeepEquals(JsonNode.Parse(iconJson), saved["icon"]), saved.ToJsonString());
    }
    Assert.Equal("Target title", Value<string>(saved["title"]));
    Assert.True(JsonNode.DeepEquals(ParseObject(Target)["blocks"], saved["blocks"]));
    Assert.Equal(StoredEvents, pages.Events);
    AssertSourceSuccess(execution, sourceRevision);
    Assert.DoesNotContain(runtime.Calls, call => ExecutesPageAction(call));
    var write = Assert.Single(runtime.Calls, call => IsTargetCommand(call, "doc.setIcon"));
    var input = ParseObject(write.InputJson);
    var targetBatch = Assert.IsType<JsonObject>(input["batch"]);
    var targetCommand = Assert.Single(Objects(targetBatch["commands"]));
    Assert.Equal("doc.setIcon", Value<string>(targetCommand["name"]));
    var expectedArgs = new JsonObject { ["icon"] = JsonNode.Parse(iconJson) };
    Assert.True(JsonNode.DeepEquals(expectedArgs, targetCommand["args"]), targetCommand.ToJsonString());
    var targetRevision = await ReadRevisionAsync(executor, saved.ToJsonString());
    Assert.NotEqual(targetRevision, execution.Revision);
  }

  [Theory]
  [InlineData("page.rename", false, false)]
  [InlineData("page.rename", true, false)]
  [InlineData("page.rename", false, true)]
  [InlineData("page.setIcon", false, false)]
  [InlineData("page.setIcon", true, false)]
  [InlineData("page.setIcon", false, true)]
  public async Task RequiresBothPageOptInsBeforeAnyBackendCall(string name, bool pageTitles, bool hasTarget)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var options = new BlokAgentOptions { PageTitles = pageTitles, PageTarget = hasTarget ? pages : null };
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    var args = name == "page.rename"
        ? ParseObject("""{"id":"pg","title":"Roadmap"}""")
        : ParseObject("""{"id":"pg","icon":null}""");
    var batch = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject { ["name"] = name, ["args"] = args }),
    };

    var execution = await executor.ExecuteAsync(Source, batch.ToJsonString(), Actor, options);

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "COMMAND_UNAVAILABLE");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.Equal("/commands/0/name", Value<string>(error["path"]));
    var details = Assert.IsType<JsonObject>(error["details"]);
    Assert.Equal("service", Value<string>(details["reason"]));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""["pageBackend"]"""), details["requires"]));
    var contract = ParseObject(await executor.GetContractAsync(options));
    var command = Assert.Single(Objects(contract["commands"]), entry => Value<string>(entry["name"]) == name);
    Assert.False(Value<bool>(command["available"]));
    Assert.Equal("service", Value<string>(command["unavailableReason"]));
    Assert.Empty(pages.Events);
  }

  [Fact]
  public async Task RejectsAStaleSourceBeforeResolvingOrLoadingTheTarget()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    var batch = ParseObject(RenameBatch);
    batch["expectRevision"] = "not-the-source-revision";

    var execution = await executor.ExecuteAsync(Source, batch.ToJsonString(), Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "STALE", retryable: true);
    var details = Assert.IsType<JsonObject>(error["details"]);
    Assert.Equal(sourceRevision, Value<string>(details["revision"]));
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""[{"id":"pg","type":"page"}]"""), details["current"]), details.ToJsonString());
  }

  [Theory]
  [InlineData("""{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":1}]}""", "/commands/0")]
  [InlineData("""{"expectRevision":1,"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""", "/expectRevision")]
  [InlineData("""{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"},"ref":"created"}]}""", "/commands/0/ref")]
  public async Task ValidatesTheOriginalEnvelopeBeforeBackendWork(string batchJson, string path)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);

    var execution = await executor.ExecuteAsync(Source, batchJson, Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "INVALID_ARGS");
    Assert.Equal(path, Value<string>(error["path"]));
  }

  [Theory]
  [InlineData("""{"name":"page.rename","args":{"title":"Roadmap"}}""")]
  [InlineData("""{"name":"page.rename","args":{"id":"pg"}}""")]
  [InlineData("""{"name":"page.rename","args":{"id":"pg","title":7}}""")]
  [InlineData("""{"name":"page.rename","args":{"id":"pg","title":"Roadmap","extra":true}}""")]
  [InlineData("""{"name":"page.setIcon","args":{"id":"pg"}}""")]
  [InlineData("""{"name":"page.setIcon","args":{"id":"pg","icon":"🚀"}}""")]
  public async Task RejectsMalformedActionArgsBeforeBackendWork(string commandJson)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    var batch = new JsonObject { ["commands"] = new JsonArray(ParseObject(commandJson)) };

    var execution = await executor.ExecuteAsync(Source, batch.ToJsonString(), Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "INVALID_ARGS");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.StartsWith("/commands/0/args", Value<string>(error["path"]));
  }

  [Fact]
  public async Task RefusesAPageActionInAMixedBatchBeforeAnyBackendWork()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    const string batch = """
        {"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}},{"name":"doc.setTitle","args":{"title":"Never written"}}]}
        """;

    var execution = await executor.ExecuteAsync(Source, batch, Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "INVALID_ARGS");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.Equal("/commands/0/name", Value<string>(error["path"]));
  }

  [Theory]
  [InlineData("""{"page":{"hidden":true}}""")]
  [InlineData("""{"page":{"hiddenActions":["rename"]}}""")]
  public async Task HonorsTheSourceContractOverridesBeforeBackendWork(string overridesJson)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    var options = new BlokAgentOptions
    {
      PageTitles = true,
      PageTarget = pages,
      OverridesJson = overridesJson,
    };

    var execution = await executor.ExecuteAsync(Source, RenameBatch, Actor, options);

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "UNKNOWN_COMMAND");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.Equal("/commands/0/name", Value<string>(error["path"]));
  }

  [Fact]
  public async Task RefusesAMatchingPageIdOnTheWrongSourceToolBeforeBackendWork()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    const string source = """
        {"blocks":[{"id":"pg","type":"paragraph","data":{"text":[{"text":"Not a page"}],"pageId":"page-2"}}]}
        """;
    var sourceRevision = await ReadRevisionAsync(executor, source);

    var execution = await executor.ExecuteAsync(source, RenameBatch, Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "INVALID_ARGS");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.Equal("/commands/0/args/id", Value<string>(error["path"]));
  }

  [Fact]
  public async Task RefusesAMissingSourceBlockBeforeBackendWork()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target);
    const string source = """{"blocks":[]}""";
    var sourceRevision = await ReadRevisionAsync(executor, source);

    var execution = await executor.ExecuteAsync(source, RenameBatch, Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    var error = AssertSourceFailure(execution, sourceRevision, "BLOCK_NOT_FOUND");
    Assert.Equal(0, Value<int>(error["commandIndex"]));
    Assert.Equal("/commands/0/args/id", Value<string>(error["path"]));
  }

  [Fact]
  public async Task ReturnsAnUnresolvedTargetFailureWithTheSourceRevisionAndPageId()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var pages = new PageTarget(Target, resolves: false);
    var sourceRevision = await ReadRevisionAsync(executor, Source);

    var execution = await executor.ExecuteAsync(Source, RenameBatch, Actor, Options(pages));

    Assert.Empty(pages.Saved);
    Assert.Equal(ResolvedOnlyEvents, pages.Events);
    var error = AssertSourceFailure(execution, sourceRevision, "PRECONDITION_FAILED");
    Assert.Equal("page-2", Value<string>(Assert.IsType<JsonObject>(error["details"])["pageId"]));
  }

  [Fact]
  public async Task DoesNotSaveAStoredTargetFailureAndPreservesItsError()
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);
    var pages = new PageTarget(Target);
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    // Page icons allow extra keys; doc.setIcon's schema does not.
    const string iconJson = """{"type":"emoji","value":"🚀","hostMetadata":{"keep":"icon"}}""";
    var targetArgs = new JsonObject { ["icon"] = JsonNode.Parse(iconJson) };
    var targetBatch = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject
      {
        ["name"] = "doc.setIcon",
        ["args"] = targetArgs.DeepClone(),
      }),
    };
    var targetExecution = await executor.ExecuteAsync(Target, targetBatch.ToJsonString(), Actor);
    var originalFailure = ParseObject(targetExecution.ResultJson);
    Assert.False(Value<bool>(originalFailure["ok"]), targetExecution.ResultJson);
    Assert.Null(targetExecution.DocumentJson);
    var originalError = Assert.IsType<JsonObject>(originalFailure["error"]);
    Assert.Equal("INVALID_ARGS", Value<string>(originalError["code"]));
    Assert.False(Value<bool>(originalError["retryable"]));
    Assert.False(string.IsNullOrWhiteSpace(Value<string>(originalError["message"])));
    var originalDetails = Assert.IsType<JsonObject>(originalError["details"]);
    Assert.NotEmpty(Objects(originalDetails["problems"]));
    Assert.False(originalDetails.ContainsKey("pageId"));
    Assert.Empty(Assert.IsType<JsonArray>(originalFailure["warnings"]));
    Assert.NotEqual(sourceRevision, targetExecution.Revision);
    runtime.Calls.Clear();
    var batch = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject
      {
        ["name"] = "page.setIcon",
        ["args"] = new JsonObject { ["id"] = "pg", ["icon"] = JsonNode.Parse(iconJson) },
      }),
      ["expectRevision"] = sourceRevision,
    };

    var execution = await executor.ExecuteAsync(Source, batch.ToJsonString(), Actor, Options(pages));

    Assert.Empty(pages.Saved);
    Assert.Equal(LoadedOnlyEvents, pages.Events);
    Assert.Null(execution.DocumentJson);
    Assert.Equal(sourceRevision, execution.Revision);
    var expected = Assert.IsType<JsonObject>(originalFailure.DeepClone());
    expected["revision"] = sourceRevision;
    var expectedError = Assert.IsType<JsonObject>(expected["error"]);
    Assert.IsType<JsonObject>(expectedError["details"])["pageId"] = "page-2";
    Assert.True(JsonNode.DeepEquals(expected, JsonNode.Parse(execution.ResultJson)), execution.ResultJson);
    Assert.DoesNotContain(runtime.Calls, call => ExecutesPageAction(call));
    var write = Assert.Single(runtime.Calls, call => IsTargetCommand(call, "doc.setIcon"));
    var input = ParseObject(write.InputJson);
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(Target), input["document"]), write.InputJson);
    var innerBatch = Assert.IsType<JsonObject>(input["batch"]);
    var targetCommand = Assert.Single(Objects(innerBatch["commands"]));
    Assert.Equal("doc.setIcon", Value<string>(targetCommand["name"]));
    Assert.True(JsonNode.DeepEquals(targetArgs, targetCommand["args"]), targetCommand.ToJsonString());
  }

  [Fact]
  public async Task ReturnsTheRoomTargetRefusalWithTheSourceRevisionAndPageId()
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);
    var pages = new PageTarget(Target, roomDocId: "target-room");
    var sourceRevision = await ReadRevisionAsync(executor, Source);
    runtime.Calls.Clear();

    var execution = await executor.ExecuteAsync(Source, RenameBatch, Actor, Options(pages));

    Assert.Empty(pages.Saved);
    Assert.Equal(ResolvedOnlyEvents, pages.Events);
    var error = AssertSourceFailure(execution, sourceRevision, "COMMAND_UNAVAILABLE");
    var details = Assert.IsType<JsonObject>(error["details"]);
    Assert.Equal("runtime", Value<string>(details["reason"]));
    Assert.Equal("page-2", Value<string>(details["pageId"]));
    Assert.DoesNotContain(runtime.Calls, call => IsTargetCommand(call, "doc.setTitle"));
    Assert.DoesNotContain(runtime.Calls, call => ExecutesPageAction(call));
  }

  [Fact]
  public async Task RefusesARoomSourceWithoutCallingTheStoredRuntimeOrPageBackend()
  {
    var runtime = new ObservingRuntime(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
    var executor = new BlokAgentExecutor(runtime);
    var pages = new PageTarget(Target);

    var execution = await executor.ExecuteInRoomAsync("source-room", RenameBatch, Actor, Options(pages));

    Assert.Empty(pages.Events);
    Assert.Empty(pages.Saved);
    Assert.Empty(runtime.Calls);
    Assert.Null(execution.DocumentJson);
    Assert.Equal(string.Empty, execution.Revision);
    var result = ParseObject(execution.ResultJson);
    Assert.False(Value<bool>(result["ok"]));
    Assert.False(result.ContainsKey("revision"));
    Assert.Empty(Assert.IsType<JsonArray>(result["warnings"]));
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal("COMMAND_UNAVAILABLE", Value<string>(error["code"]));
    Assert.False(Value<bool>(error["retryable"]));
    Assert.False(string.IsNullOrWhiteSpace(Value<string>(error["message"])));
    Assert.Equal("runtime", Value<string>(Assert.IsType<JsonObject>(error["details"])["reason"]));
  }

  private static BlokAgentOptions Options(PageTarget pages) => new() { PageTitles = true, PageTarget = pages };

  private static async Task<string> ReadRevisionAsync(IBlokAgentExecutor executor, string documentJson)
  {
    var execution = await executor.ExecuteAsync(documentJson, ReadBatch, Actor);
    var result = ParseObject(execution.ResultJson);
    Assert.True(Value<bool>(result["ok"]), execution.ResultJson);
    var view = Assert.Single(Objects(result["results"]));
    Assert.Equal(execution.Revision, Value<string>(result["revision"]));
    Assert.Equal(execution.Revision, Value<string>(view["revision"]));
    Assert.Matches("^h[0-9a-f]+$", execution.Revision);

    return execution.Revision;
  }

  private static void AssertSourceSuccess(BlokAgentExecution execution, string sourceRevision)
  {
    Assert.Null(execution.DocumentJson);
    Assert.Equal(sourceRevision, execution.Revision);
    var expected = ParseObject("""
        {"ok":true,"results":[{"pageId":"page-2","applied":true}],"refs":{},"changed":{"created":[],"updated":[],"moved":[],"removed":[]},"warnings":[]}
        """);
    expected["revision"] = sourceRevision;
    Assert.True(JsonNode.DeepEquals(expected, JsonNode.Parse(execution.ResultJson)), execution.ResultJson);
  }

  private static JsonObject AssertSourceFailure(
      BlokAgentExecution execution, string sourceRevision, string code, bool retryable = false)
  {
    Assert.Null(execution.DocumentJson);
    Assert.Equal(sourceRevision, execution.Revision);
    var result = ParseObject(execution.ResultJson);
    Assert.False(Value<bool>(result["ok"]));
    Assert.Equal(sourceRevision, Value<string>(result["revision"]));
    Assert.Empty(Assert.IsType<JsonArray>(result["warnings"]));
    Assert.False(result.ContainsKey("results"));
    Assert.False(result.ContainsKey("refs"));
    Assert.False(result.ContainsKey("changed"));
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal(code, Value<string>(error["code"]));
    Assert.Equal(retryable, Value<bool>(error["retryable"]));
    Assert.False(string.IsNullOrWhiteSpace(Value<string>(error["message"])));

    return error;
  }

  private static bool ExecutesPageAction(Invocation call)
  {
    if (call.Operation != "agentExecute")
    {
      return false;
    }
    var batch = Assert.IsType<JsonObject>(ParseObject(call.InputJson)["batch"]);

    return Objects(batch["commands"]).Any(command =>
        Value<string>(command["name"]) is "page.rename" or "page.setIcon");
  }

  private static bool IsTargetCommand(Invocation call, string name)
  {
    if (call.Operation != "agentExecute")
    {
      return false;
    }
    var input = ParseObject(call.InputJson);
    var document = Assert.IsType<JsonObject>(input["document"]);
    if (document["id"] is not JsonValue id || id.GetValue<string>() != "target")
    {
      return false;
    }
    var batch = Assert.IsType<JsonObject>(input["batch"]);

    return Objects(batch["commands"]).Any(command => Value<string>(command["name"]) == name);
  }

  private static JsonObject ParseObject(string json) => Assert.IsType<JsonObject>(JsonNode.Parse(json));

  private static JsonObject[] Objects(JsonNode? node) =>
      Assert.IsType<JsonArray>(node).Select(item => Assert.IsType<JsonObject>(item)).ToArray();

  private static T Value<T>(JsonNode? node) => Assert.IsAssignableFrom<JsonValue>(node).GetValue<T>();

  private sealed record Invocation(string Operation, string InputJson);

  private sealed class ObservingRuntime(IBlokRuntime inner) : IBlokRuntime
  {
    internal List<Invocation> Calls { get; } = [];

    public async ValueTask<string> InvokeAsync(
        string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      Calls.Add(new Invocation(operation, inputJson));

      return await inner.InvokeAsync(operation, inputJson, timeout, cancellationToken);
    }
  }

  private sealed class PageTarget(string documentJson, bool resolves = true, string? roomDocId = null) : IBlokPageTarget
  {
    internal List<string> Events { get; } = [];
    internal List<string> Saved { get; } = [];
    internal List<CancellationToken> Tokens { get; } = [];

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Events.Add($"resolve:{pageId}");
      Tokens.Add(cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();
      BlokPageLocation? location = null;

      if (resolves && pageId == "page-2")
      {
        location = roomDocId is null ? new BlokPageLocation.Stored(LoadAsync, SaveAsync) : new BlokPageLocation.Room(roomDocId);
      }

      return ValueTask.FromResult(location);
    }

    private ValueTask<string> LoadAsync(CancellationToken cancellationToken)
    {
      Events.Add("load");
      Tokens.Add(cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();

      return ValueTask.FromResult(documentJson);
    }

    private ValueTask SaveAsync(string json, CancellationToken cancellationToken)
    {
      Events.Add("save");
      Tokens.Add(cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();
      Saved.Add(json);

      return ValueTask.CompletedTask;
    }
  }
}
