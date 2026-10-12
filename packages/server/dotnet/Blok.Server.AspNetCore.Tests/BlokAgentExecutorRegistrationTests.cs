using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Blok.Server.Storage;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class BlokAgentExecutorRegistrationTests
{
  private const string Document = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}""";
  private const string ReadBatch = """{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");
  private static readonly string[] ExpectedOperations = ["manifest", "agentExecute", "blocksToPlainText"];

  [Fact]
  public async Task DocumentsOnlyRegistrationResolvesAnExecutorThatRunsTheEmbeddedRuntime()
  {
    var services = new ServiceCollection();
    services.AddBlokDocuments(poolSize: 1, warmUp: false);

    using var provider = services.BuildServiceProvider();
    var executor = Assert.IsAssignableFrom<IBlokAgentExecutor>(provider.GetService<IBlokAgentExecutor>());
    Assert.DoesNotContain(services, descriptor => descriptor.ServiceType == typeof(IBlobStore));
    var contract = Assert.IsType<JsonObject>(JsonNode.Parse(await executor.GetContractAsync()));
    Assert.Contains(Assert.IsType<JsonArray>(contract["commands"]), node =>
        node is JsonObject command && command["name"] is JsonValue name
        && name.GetValue<string>() == "block.insert");

    var execution = await executor.ExecuteAsync(
        Document,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"Server title"}}]}""",
        Actor);

    var saved = Assert.IsType<JsonObject>(JsonNode.Parse(Assert.IsType<string>(execution.DocumentJson)));
    Assert.Equal("Server title", Assert.IsAssignableFrom<JsonValue>(saved["title"]).GetValue<string>());
    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.True(Assert.IsAssignableFrom<JsonValue>(result["ok"]).GetValue<bool>());
    Assert.Equal(Assert.IsAssignableFrom<JsonValue>(result["revision"]).GetValue<string>(), execution.Revision);
    Assert.Equal("Hello world", await provider.GetRequiredService<IBlokDocumentConverter>().ToPlainTextAsync(Document));
  }

  [Fact]
  public void RepeatedAndMixedRegistrationKeepsOneSingletonExecutor()
  {
    var services = new ServiceCollection();
    services.AddSingleton<IBlokRuntime>(new RecordingRuntime());
    services.AddBlokDocuments(warmUp: false);
    services.AddBlokDocuments(warmUp: false);
    services.AddBlokServer();

    var registration = Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IBlokAgentExecutor));
    Assert.Equal(ServiceLifetime.Singleton, registration.Lifetime);
    Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IBlokRuntime));
    Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IBlokDocumentConverter));
    using var provider = services.BuildServiceProvider();
    Assert.Same(provider.GetRequiredService<IBlokAgentExecutor>(), provider.GetRequiredService<IBlokAgentExecutor>());
  }

  [Fact]
  public void KeepsAHostExecutorRegisteredBeforeRepeatedAndMixedRegistration()
  {
    var services = new ServiceCollection();
    var hostExecutor = new HostExecutor();
    services.AddSingleton<IBlokAgentExecutor>(hostExecutor);
    services.AddBlokDocuments(warmUp: false);
    services.AddBlokDocuments(warmUp: false);
    services.AddBlokServer();

    using var provider = services.BuildServiceProvider();

    Assert.Same(hostExecutor, provider.GetRequiredService<IBlokAgentExecutor>());
    Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IBlokAgentExecutor));
  }

  [Fact]
  public async Task ExecutorAndConverterBothUseTheRegisteredRuntimeInsteadOfSeparatePools()
  {
    var services = new ServiceCollection();
    var runtime = new RecordingRuntime();
    services.AddSingleton<IBlokRuntime>(runtime);
    services.AddBlokDocuments(poolSize: 1, warmUp: false);
    using var provider = services.BuildServiceProvider();
    var executor = Assert.IsAssignableFrom<IBlokAgentExecutor>(provider.GetService<IBlokAgentExecutor>());
    using var cancellation = new CancellationTokenSource();

    var contract = await executor.GetContractAsync(cancellationToken: cancellation.Token);
    var execution = await executor.ExecuteAsync(Document, ReadBatch, Actor, cancellationToken: cancellation.Token);
    var plainText = await provider.GetRequiredService<IBlokDocumentConverter>()
        .ToPlainTextAsync(Document, cancellationToken: cancellation.Token);

    Assert.Equal(ExpectedOperations, runtime.Operations);
    Assert.All(runtime.Tokens, token => Assert.Equal(cancellation.Token, token));
    Assert.Equal("hregistered-contract", Assert.IsAssignableFrom<JsonValue>(
        Assert.IsType<JsonObject>(JsonNode.Parse(contract))["revision"]).GetValue<string>());
    Assert.Equal("hregistered-document", execution.Revision);
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"blocks":[{"id":"from-registered-runtime","type":"paragraph","data":{"text":[]}}]}"""),
        JsonNode.Parse(Assert.IsType<string>(execution.DocumentJson))));
    Assert.Equal("registered-runtime-text", plainText);
  }

  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public async Task ACollabServerGivesTheExecutorItsRoomsInEitherRegistrationOrder(bool documentsFirst)
  {
    var services = new ServiceCollection();
    var directory = Directory.CreateTempSubdirectory("blok-agent-rooms-");

    try
    {
      if (documentsFirst)
      {
        services.AddBlokDocuments(poolSize: 1, warmUp: false);
      }

      // Port 9 refuses at once, so the room fails its seed instead of hanging.
      services.AddBlokServer(options =>
      {
        options.CollabEnabled = true;
        options.DocEndpoint = "http://127.0.0.1:9/docs";
        options.CollabDirectory = directory.FullName;
      });

      using var provider = services.BuildServiceProvider();
      var executor = provider.GetRequiredService<IBlokAgentExecutor>();

      var execution = await executor.ExecuteInRoomAsync("doc", ReadBatch, Actor);

      var error = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson)!["error"]);
      Assert.Equal("APPLY_FAILED", error["code"]!.GetValue<string>());
      Assert.Equal("SeedFailed", error["details"]!["status"]!.GetValue<string>());
    }
    finally
    {
      directory.Delete(recursive: true);
    }
  }

  [Fact]
  public async Task WithoutCollabTheRoomPathIsUnavailable()
  {
    var services = new ServiceCollection();
    services.AddSingleton<IBlokRuntime>(new RecordingRuntime());
    services.AddBlokServer();

    using var provider = services.BuildServiceProvider();
    var execution = await provider.GetRequiredService<IBlokAgentExecutor>().ExecuteInRoomAsync("doc", ReadBatch, Actor);

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }

  private sealed class RecordingRuntime : IBlokRuntime
  {
    internal List<string> Operations { get; } = [];
    internal List<CancellationToken> Tokens { get; } = [];

    public ValueTask<string> InvokeAsync(
        string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      Operations.Add(operation);
      Tokens.Add(cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();

      return ValueTask.FromResult(operation switch
      {
        "manifest" => """
            {
              "manifest":{"formatVersion":1,"revision":"hregistered-manifest","blokVersion":"fixture","readOnly":false,"defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]},
              "contract":{
                "formatVersion":1,"revision":"hregistered-contract","commands":[],
                "manifest":{"formatVersion":1,"revision":"hregistered-manifest","blokVersion":"fixture","readOnly":false,"defaultBlock":"paragraph","blocks":[],"inlineTools":[],"tunes":[]},
                "guidance":{"general":"","commands":{},"tools":{}}
              }
            }
            """,
        "agentExecute" => """
            {
              "result":{"ok":true,"revision":"hregistered-document","results":[{"revision":"hregistered-document","blocks":[]}],"refs":{},"changed":{"created":[],"updated":[],"moved":[],"removed":[]},"warnings":[]},
              "document":{"blocks":[{"id":"from-registered-runtime","type":"paragraph","data":{"text":[]}}]},
              "edits":[]
            }
            """,
        "blocksToPlainText" => "registered-runtime-text",
        _ => throw new InvalidOperationException($"Unexpected runtime operation: {operation}"),
      });
    }
  }

  private sealed class HostExecutor : IBlokAgentExecutor
  {
    public ValueTask<BlokAgentExecution> ExecuteAsync(
        string documentJson, string batchJson, BlokAgentActor actor,
        BlokAgentOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<string> GetContractAsync(
        BlokAgentOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
        string docId, string batchJson, BlokAgentActor actor,
        BlokAgentOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
  }
}
