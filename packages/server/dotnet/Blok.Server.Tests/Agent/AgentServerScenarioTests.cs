using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// Reads test/fixtures/agent-server-scenarios/*.json, which the Go blokagent
/// package reads too. Each scenario runs the real bundle through the stored
/// executor, with a page host that keeps what it saves, and checks codes,
/// saved documents and host calls. The runner contract:
/// <list type="bullet">
/// <item>Actor <c>agent-cs</c> / <c>Server agent</c> for <c>human-1</c>.</item>
/// <item><c>run</c>: <c>plain</c>, <c>session:&lt;name&gt;</c>, or <c>contract:plain|session|room</c>.</item>
/// <item><c>document</c>: <c>@seed</c>, <c>@last</c> (the last document a step returned, at first the seed),
/// <c>@step:N</c>, or <c>{from, set:{pointer:value}}</c>.</item>
/// <item><c>times</c> repeats a step; <c>{i}</c> in the batch's strings is the repeat index.</item>
/// <item>Expected pointer values: a JSON value, <c>{"absent":true}</c> or <c>{"length":n}</c>.</item>
/// </list>
/// </summary>
public sealed class AgentServerScenarioTests
{
  private const string RelativeRoot = "test/fixtures/agent-server-scenarios";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");
  private static readonly Lazy<BlokAgentExecutor> Executor = new(() => new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(poolSize: 1)));
  private static readonly string ReadBatch = """{"commands":[{"name":"doc.read","args":{"detail":"outline"}}]}""";

  private static string Root => Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativeRoot);

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var file in Directory.GetFiles(Root, "*.json").Order(StringComparer.Ordinal))
    {
      names.Add(Path.GetFileNameWithoutExtension(file));
    }

    return names;
  }

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesTheScenario(string name)
  {
    var scenario = JsonNode.Parse(File.ReadAllText(Path.Combine(Root, name + ".json")))!.AsObject();
    var host = new Host(scenario);
    var options = Options(scenario["options"], host);
    var seed = scenario["seed"]!.ToJsonString();
    var last = seed;
    var byStep = new Dictionary<int, string>();
    var sessions = new Dictionary<string, BlokAgentSession>(StringComparer.Ordinal);
    var steps = scenario["steps"]!.AsArray();

    for (var index = 0; index < steps.Count; index++)
    {
      var step = steps[index]!.AsObject();
      var run = step["run"]!.GetValue<string>();
      var expect = step["expect"]!.AsObject();
      var times = step["times"]?.GetValue<int>() ?? 1;

      for (var repeat = 0; repeat < times; repeat++)
      {
        var where = $"{name} step {index}#{repeat}";

        if (run.StartsWith("contract:", StringComparison.Ordinal))
        {
          var contract = run switch
          {
            "contract:plain" => await Executor.Value.GetContractAsync(options),
            "contract:session" => await Executor.Value.OpenSession(Actor, options).GetContractAsync(),
            "contract:room" => await Executor.Value.GetRoomContractAsync(options),
            _ => throw new InvalidDataException(run),
          };
          CheckContract(where, JsonNode.Parse(contract)!.AsObject(), expect);
          continue;
        }

        var document = Document(step["document"]!, seed, last, byStep);
        var batch = Indexed(step["batch"]!, repeat).ToJsonString();
        var execution = run == "plain"
            ? await Executor.Value.ExecuteAsync(document, batch, Actor, options)
            : await Session(sessions, run, options).ExecuteAsync(document, batch);
        var result = JsonNode.Parse(execution.ResultJson)!.AsObject();

        if (expect["ok"] is JsonNode ok)
        {
          Assert.True(ok.GetValue<bool>() == result["ok"]!.GetValue<bool>(), $"{where}: ok\n{execution.ResultJson}");
        }
        if (expect["code"] is JsonNode code)
        {
          Assert.True(code.GetValue<string>() == result["error"]?["code"]?.GetValue<string>(), $"{where}: code\n{execution.ResultJson}");
        }
        if (expect["saved"] is JsonNode saved)
        {
          Assert.True(saved.GetValue<bool>() == execution.DocumentJson is not null, $"{where}: saved\n{execution.ResultJson}");
        }
        Assert.Equal(result["revision"]?.GetValue<string>() ?? string.Empty, execution.Revision);
        CheckPointers($"{where} result", result, expect["result"] as JsonObject);
        if (expect["document"] is JsonObject pointers)
        {
          CheckPointers($"{where} document", JsonNode.Parse(execution.DocumentJson!)!, pointers);
        }
        if (expect["revisionEqualsRead"]?.GetValue<bool>() == true)
        {
          var read = await Executor.Value.ExecuteAsync(document, ReadBatch, Actor);

          Assert.Equal(read.Revision, execution.Revision);
        }

        if (execution.DocumentJson is { } next)
        {
          last = next;
          byStep[index] = next;
        }
      }
    }

    host.Check(name, scenario["host"] as JsonObject);
  }

  private static BlokAgentSession Session(Dictionary<string, BlokAgentSession> sessions, string run, BlokAgentOptions? options)
  {
    if (!sessions.TryGetValue(run, out var session))
    {
      session = Executor.Value.OpenSession(Actor, options);
      sessions[run] = session;
    }

    return session;
  }

  private static string Document(JsonNode spec, string seed, string last, Dictionary<int, string> byStep)
  {
    string Reference(string name) => name switch
    {
      "@seed" => seed,
      "@last" => last,
      _ when name.StartsWith("@step:", StringComparison.Ordinal) => byStep[int.Parse(name["@step:".Length..], System.Globalization.CultureInfo.InvariantCulture)],
      _ => throw new InvalidDataException(name),
    };

    if (spec is JsonValue value)
    {
      return Reference(value.GetValue<string>());
    }

    var from = JsonNode.Parse(Reference(spec["from"]!.GetValue<string>()))!;

    foreach (var (pointer, replacement) in spec["set"]!.AsObject())
    {
      var parts = pointer.Split('/')[1..];
      var parent = parts[..^1].Aggregate(from, (node, part) => node[part]!);

      parent.AsObject()[parts[^1]] = replacement?.DeepClone();
    }

    return from.ToJsonString();
  }

  private static JsonNode Indexed(JsonNode node, int repeat) => node switch
  {
    JsonObject obj => new JsonObject(obj.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)(pair.Value is null ? null : Indexed(pair.Value, repeat))))),
    JsonArray array => new JsonArray([.. array.Select(item => item is null ? null : Indexed(item, repeat))]),
    JsonValue value when value.TryGetValue<string>(out var text) => JsonValue.Create(text.Replace("{i}", repeat.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal)),
    _ => node.DeepClone(),
  };

  /// <summary>Follows a JSON pointer; false when a step is missing.</summary>
  private static bool TryPointer(JsonNode root, string pointer, out JsonNode? found)
  {
    found = root;

    foreach (var part in pointer.Split('/')[1..])
    {
      switch (found)
      {
        case JsonObject obj when obj.TryGetPropertyValue(part, out var next):
          found = next;
          break;
        case JsonArray array when int.TryParse(part, out var at) && at >= 0 && at < array.Count:
          found = array[at];
          break;
        default:
          found = null;
          return false;
      }
    }

    return true;
  }

  private static void CheckPointers(string where, JsonNode root, JsonObject? pointers)
  {
    foreach (var (pointer, want) in pointers ?? [])
    {
      var exists = TryPointer(root, pointer, out var got);

      if (want is JsonObject spec && spec["absent"] is not null)
      {
        Assert.False(exists, $"{where}: {pointer} should be absent, got {got?.ToJsonString()}");
      }
      else if (want is JsonObject length && length["length"] is JsonNode count)
      {
        Assert.True(exists && got is JsonArray array && array.Count == count.GetValue<int>(), $"{where}: {pointer} length, got {got?.ToJsonString()}");
      }
      else
      {
        Assert.True(exists && JsonNode.DeepEquals(want, got), $"{where}: {pointer} = {got?.ToJsonString()}, want {want?.ToJsonString()}\n{root.ToJsonString()}");
      }
    }
  }

  private static void CheckContract(string where, JsonObject contract, JsonObject expect)
  {
    foreach (var (list, path) in new[] { ("commands", "commands"), ("blocks", "manifest") })
    {
      if (expect[list] is not JsonObject wanted)
      {
        continue;
      }

      var entries = (list == "commands" ? contract["commands"] : contract["manifest"]!["blocks"])!.AsArray().OfType<JsonObject>().ToList();

      foreach (var (name, fields) in wanted)
      {
        var entry = entries.SingleOrDefault(e => e["name"]?.GetValue<string>() == name);

        if (fields!["absent"] is not null)
        {
          Assert.True(entry is null, $"{where}: {path} {name} should be absent");
          continue;
        }

        Assert.True(entry is not null, $"{where}: {path} has no {name}");
        CheckPointers($"{where} {name}", entry!, new JsonObject(fields.AsObject().Select(pair => KeyValuePair.Create("/" + pair.Key, pair.Value?.DeepClone()))));
      }
    }
  }

  private static BlokAgentOptions? Options(JsonNode? node, Host host)
  {
    if (node is not JsonObject given)
    {
      return null;
    }

    IBlokPageTarget? target = given["target"]?.GetValue<string>() switch
    {
      null => null,
      "plain" => host,
      "creator" => new Creator(host),
      var other => throw new InvalidDataException(other),
    };

    return new BlokAgentOptions
    {
      PageTitles = given["pageTitles"]?.GetValue<bool>() ?? false,
      PageTarget = target,
      CustomToolsJson = given["customTools"]?.GetValue<string>(),
      OverridesJson = given["overrides"]?.GetValue<string>(),
      BuiltInComments = given["builtInComments"]?.GetValue<bool>() ?? true,
    };
  }

  private sealed class Host(JsonObject scenario) : IBlokPageTarget
  {
    private readonly Dictionary<string, string> stored = (scenario["pages"] as JsonObject ?? [])
        .Where(pair => pair.Value?["stored"] is not null)
        .ToDictionary(pair => pair.Key, pair => pair.Value!["stored"]!.ToJsonString(), StringComparer.Ordinal);

    internal List<string> Resolved { get; } = [];

    internal List<string> Saved { get; } = [];

    internal List<string> Created { get; } = [];

    internal JsonArray? CreateScript => scenario["create"] as JsonArray;

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Assert.Equal(Actor, actor);
      Resolved.Add(pageId);

      if (scenario["pages"]?[pageId]?["room"] is JsonNode room)
      {
        return ValueTask.FromResult<BlokPageLocation?>(new BlokPageLocation.Room(room.GetValue<string>()));
      }

      return ValueTask.FromResult<BlokPageLocation?>(stored.TryGetValue(pageId, out var initial)
          ? new BlokPageLocation.Stored(
              _ => ValueTask.FromResult(stored.GetValueOrDefault(pageId, initial)),
              (json, _) =>
              {
                stored[pageId] = json;
                Saved.Add(json);

                return ValueTask.CompletedTask;
              })
          : null);
    }

    internal void Check(string name, JsonObject? expect)
    {
      if (expect is null)
      {
        return;
      }

      foreach (var (key, list) in new[] { ("resolved", Resolved), ("created", Created) })
      {
        if (expect[key] is JsonArray wanted)
        {
          Assert.True(JsonNode.DeepEquals(wanted, new JsonArray([.. list.Select(item => JsonValue.Create(item))])), $"{name}: {key} [{string.Join(",", list)}]");
        }
      }

      if (expect["saved"] is JsonArray saves)
      {
        Assert.True(saves.Count == Saved.Count, $"{name}: {Saved.Count} saves");

        for (var index = 0; index < saves.Count; index++)
        {
          CheckPointers($"{name} save {index}", JsonNode.Parse(Saved[index])!, saves[index]!.AsObject());
        }
      }
    }
  }

  private sealed class Creator(Host host) : IBlokPageCreator
  {
    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default) =>
        host.ResolveAsync(pageId, actor, cancellationToken);

    public ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Assert.Equal(Actor, actor);
      var at = host.Created.Count;
      var script = host.CreateScript;
      var pageId = script is not null && at < script.Count ? script[at]?.GetValue<string>() : $"host-{at + 1}";

      if (!string.IsNullOrEmpty(pageId))
      {
        host.Created.Add(pageId);
      }

      return ValueTask.FromResult(pageId);
    }
  }
}
