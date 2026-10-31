using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/agent/host.json, which the Go
/// blokagent package reads too. Each case drives the executor over a scripted
/// runtime and a scripted page host, and pins every runtime request, every
/// host call and every answer, byte for byte. C# is the reference: run with
/// BLOK_CAPTURE_AGENT_FIXTURE=1 to rewrite the expectations from it.
/// </summary>
public sealed class AgentHostFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/agent/host.json";

  // Longer strings are pinned by length and hash, so the file stays small.
  private const int MaxInline = 65536;

  private static string FixturePath => Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

  private static JsonArray ReadCases() =>
      JsonNode.Parse(File.ReadAllText(FixturePath))?.AsArray()
          ?? throw new InvalidDataException($"{FixturePath} holds JSON null");

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in ReadCases())
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesTheSharedFixture(string name)
  {
    var entry = ReadCases().Single(entry => entry!["name"]!.GetValue<string>() == name)!.AsObject();
    var actual = await Run(entry);

    foreach (var key in new[] { "events", "results" })
    {
      Assert.True(
          JsonNode.DeepEquals(entry[key], actual[key]),
          $"{key}\n got {actual[key]?.ToJsonString()}\nwant {entry[key]?.ToJsonString()}");
    }
  }

  [Fact]
  public async Task CapturesTheFixtureWhenAsked()
  {
    if (Environment.GetEnvironmentVariable("BLOK_CAPTURE_AGENT_FIXTURE") != "1")
    {
      return;
    }

    var cases = ReadCases();

    foreach (var entry in cases)
    {
      var actual = await Run(entry!.AsObject());

      entry["events"] = actual["events"]?.DeepClone();
      entry["results"] = actual["results"]?.DeepClone();
    }

    var options = new JsonSerializerOptions
    {
      WriteIndented = true,
      IndentSize = 2,
      Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    await File.WriteAllTextAsync(FixturePath, cases.ToJsonString(options) + "\n");
  }

  /// <summary>A string as the fixture pins it: inline, or by length and SHA-256 of its UTF-8.</summary>
  internal static JsonNode? Pinned(string? text)
  {
    if (text is null)
    {
      return null;
    }

    if (text.Length <= MaxInline)
    {
      return text;
    }

    return new JsonObject
    {
      ["length"] = text.Length,
      ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text))),
    };
  }

  /// <summary>A scripted string: text, or <c>{template, fill:{marker, unit, count}}</c>.</summary>
  private static string Scripted(JsonNode node)
  {
    if (node is JsonValue)
    {
      return node.GetValue<string>();
    }

    var text = node["template"]!.GetValue<string>();

    foreach (var fill in node["fill"]!.AsArray())
    {
      var unit = fill!["unit"]!.GetValue<string>();
      var count = fill["count"]!.GetValue<int>();

      text = text.Replace(fill["marker"]!.GetValue<string>(), string.Concat(Enumerable.Repeat(unit, count)), StringComparison.Ordinal);
    }

    return text;
  }

  private static async Task<JsonObject> Run(JsonObject entry)
  {
    using var cancellation = new CancellationTokenSource();
    var events = new JsonArray();
    var runtime = new FixtureRuntime(entry["runtime"]?.AsArray() ?? [], events, cancellation);
    var executor = new BlokAgentExecutor(runtime);
    var actorNode = entry["actor"]!.AsObject();
    var actor = new BlokAgentActor(
        actorNode["id"]!.GetValue<string>(),
        actorNode["name"]!.GetValue<string>(),
        actorNode["onBehalfOf"]?.GetValue<string>());
    var host = entry["host"] as JsonObject ?? [];
    var options = Options(entry["options"], host, events, cancellation);
    var results = new JsonArray();

    if (entry["cancelled"]?.GetValue<bool>() == true)
    {
      await cancellation.CancelAsync();
    }

    var call = entry["call"]!.GetValue<string>();
    var session = call == "Session" ? executor.OpenSession(actor, options) : null;

    foreach (var step in entry["calls"]?.AsArray() ?? [new JsonObject()])
    {
      results.Add(await Outcome(async () =>
      {
        switch (call)
        {
          case "Execute":
            return Shape(await executor.ExecuteAsync(
                Scripted(step!["document"]!), Scripted(step["batch"]!), actor, options, cancellation.Token));
          case "Session":
            return Shape(await session!.ExecuteAsync(
                Scripted(step!["document"]!), Scripted(step["batch"]!), cancellation.Token));
          case "ExecuteInRoom":
            return Shape(await executor.ExecuteInRoomAsync(
                step!["docId"]!.GetValue<string>(), Scripted(step["batch"]!), actor, options, cancellation.Token));
          case "Contract":
            return new JsonObject { ["contract"] = await executor.GetContractAsync(options, cancellation.Token) };
          case "SessionContract":
            return new JsonObject { ["contract"] = await executor.OpenSession(actor, options).GetContractAsync(cancellation.Token) };
          case "RoomContract":
            return new JsonObject { ["contract"] = await executor.GetRoomContractAsync(options, cancellation.Token) };
          default:
            throw new InvalidDataException($"Unknown call {call}");
        }
      }));
    }

    Assert.True(runtime.Exhausted, "the case scripts more runtime answers than were asked for");

    return new JsonObject { ["events"] = events, ["results"] = results };
  }

  private static JsonObject Shape(BlokAgentExecution execution) => new()
  {
    ["result"] = Pinned(execution.ResultJson),
    ["document"] = Pinned(execution.DocumentJson),
    ["revision"] = execution.Revision,
  };

  private static async Task<JsonObject> Outcome(Func<Task<JsonObject>> run)
  {
    try
    {
      return await run();
    }
    catch (OperationCanceledException)
    {
      return Error("cancelled");
    }
    catch (BlokDocumentConversionException exception)
    {
      return Error("conversion", ("reason", exception.Reason.ToString()));
    }
    catch (HostFailure)
    {
      return Error("host");
    }
    catch (ArgumentException exception)
    {
      var suffix = $" (Parameter '{exception.ParamName}')";

      Assert.EndsWith(suffix, exception.Message, StringComparison.Ordinal);

      return Error("argument", ("param", exception.ParamName), ("message", exception.Message[..^suffix.Length]));
    }
    catch (JsonException)
    {
      return Error("json");
    }
    catch (InvalidOperationException exception)
    {
      return Error("invalidOperation", ("message", exception.Message));
    }
  }

  private static JsonObject Error(string kind, params (string Key, string? Value)[] fields)
  {
    var error = new JsonObject { ["kind"] = kind };

    foreach (var (key, value) in fields)
    {
      error[key] = value;
    }

    return new JsonObject { ["error"] = error };
  }

  private static BlokAgentOptions? Options(JsonNode? node, JsonObject host, JsonArray events, CancellationTokenSource cancellation)
  {
    if (node is not JsonObject given)
    {
      return null;
    }

    IBlokPageTarget? target = given["target"]?.GetValue<string>() switch
    {
      null => null,
      "plain" => new PageTarget(host, events, cancellation),
      "creator" => new PageCreator(host, events, cancellation),
      var other => throw new InvalidDataException($"Unknown target {other}"),
    };

    return given["builtInComments"] is JsonNode comments
        ? new BlokAgentOptions
        {
          PageTitles = given["pageTitles"]?.GetValue<bool>() ?? false,
          PageTarget = target,
          CustomToolsJson = given["customTools"]?.GetValue<string>(),
          OverridesJson = given["overrides"]?.GetValue<string>(),
          BuiltInComments = comments.GetValue<bool>(),
        }
        : new BlokAgentOptions
        {
          PageTitles = given["pageTitles"]?.GetValue<bool>() ?? false,
          PageTarget = target,
          CustomToolsJson = given["customTools"]?.GetValue<string>(),
          OverridesJson = given["overrides"]?.GetValue<string>(),
        };
  }

  private static JsonObject ActorNode(BlokAgentActor actor) => new()
  {
    ["id"] = actor.Id,
    ["name"] = actor.Name,
    ["onBehalfOf"] = actor.OnBehalfOf,
  };

  /// <summary>A failure the scripted host raises itself.</summary>
  private sealed class HostFailure : Exception
  {
    public HostFailure()
        : base("The host's page store is down.")
    {
    }
  }

  /// <summary>
  /// Plays one scripted host step: <c>"cancel"</c> as a hook name cancels the call's token
  /// and carries on; <c>{"throw":"cancel"|"error"}</c> throws.
  /// </summary>
  private static void Hook(JsonObject host, string name, CancellationTokenSource cancellation)
  {
    if (host["cancelOn"]?.GetValue<string>() == name)
    {
      cancellation.Cancel();
    }

    switch (host["throwOn"]?[name]?.GetValue<string>())
    {
      case "cancel":
        throw new OperationCanceledException();
      case "error":
        throw new HostFailure();
    }
  }

  private class PageTarget(JsonObject host, JsonArray events, CancellationTokenSource cancellation) : IBlokPageTarget
  {
    protected JsonObject Host => host;

    protected JsonArray Events => events;

    protected CancellationTokenSource Cancellation => cancellation;

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      events.Add(new JsonObject { ["host"] = "resolve", ["pageId"] = pageId, ["actor"] = ActorNode(actor) });
      Hook(host, "resolve", cancellation);

      BlokPageLocation? location = host["pages"]?[pageId] switch
      {
        JsonObject page when page["stored"] is JsonNode stored => new BlokPageLocation.Stored(
            _ =>
            {
              events.Add(new JsonObject { ["host"] = "load" });
              Hook(host, "load", cancellation);

              return ValueTask.FromResult(Scripted(stored));
            },
            (json, _) =>
            {
              events.Add(new JsonObject { ["host"] = "save", ["document"] = Pinned(json) });
              Hook(host, "save", cancellation);

              return ValueTask.CompletedTask;
            }),
        JsonObject page when page["room"] is JsonNode room => new BlokPageLocation.Room(room.GetValue<string>()),
        _ => null,
      };

      return ValueTask.FromResult(location);
    }
  }

  private sealed class PageCreator(JsonObject host, JsonArray events, CancellationTokenSource cancellation)
      : PageTarget(host, events, cancellation), IBlokPageCreator
  {
    private int index;

    public ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      var at = index++;

      Events.Add(new JsonObject { ["host"] = "create", ["actor"] = ActorNode(actor) });
      Hook(Host, $"create:{at}", Cancellation);

      var created = Host["create"]?.AsArray();

      return ValueTask.FromResult(created is not null && at < created.Count ? created[at]?.GetValue<string>() : $"host-{at + 1}");
    }
  }

  /// <summary>
  /// Answers each call with the next scripted step: <c>answer</c>, or <c>throw</c>
  /// (<c>cancel</c> or a <see cref="BlokConversionFailure"/> name). <c>cancelAfter</c>
  /// cancels the token once the answer is given.
  /// </summary>
  private sealed class FixtureRuntime(JsonArray script, JsonArray events, CancellationTokenSource cancellation) : IBlokRuntime
  {
    private int next;

    internal bool Exhausted => next == script.Count;

    public ValueTask<string> InvokeAsync(
        string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      events.Add(new JsonObject { ["op"] = operation, ["input"] = Pinned(inputJson) });
      Assert.Null(timeout);
      Assert.Equal(cancellation.Token, cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();
      Assert.True(next < script.Count, $"no scripted answer for call {next + 1} ({operation})");

      var step = script[next++]!.AsObject();

      if (step["throw"]?.GetValue<string>() is { } kind)
      {
        throw kind == "cancel"
            ? new OperationCanceledException()
            : new BlokDocumentConversionException(Enum.Parse<BlokConversionFailure>(kind), new InvalidOperationException("fake runtime failure"));
      }

      if (step["cancelAfter"]?.GetValue<bool>() == true)
      {
        cancellation.Cancel();
      }

      return ValueTask.FromResult(Scripted(step["answer"]!));
    }
  }
}
