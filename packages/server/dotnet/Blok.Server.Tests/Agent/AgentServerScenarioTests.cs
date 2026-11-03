using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
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
/// A scenario with <c>room</c> runs on a live room (real converter, fake journal unless
/// <c>room.journal</c> is false), and every run uses the executor over it:
/// <list type="bullet">
/// <item><c>room.doc</c> (default <c>agent-room</c>) holds <c>seed</c>; <c>room.held</c> holds more documents.</item>
/// <item><c>run</c> also takes <c>room</c> (<c>doc</c>, <c>actor</c>), <c>peer</c> (an /edit body in <c>ops</c>,
/// written as <c>human-2</c>), <c>reset</c>, <c>purge</c>, <c>restore</c> (<c>version</c>) and <c>drain</c>.</item>
/// <item>Strings take <c>{lineage}</c> (the room's journal lineage) and <c>{rev:N}</c> (step N's revision).</item>
/// <item>The string <c>@head</c> in an expected value is the room's head after the step. <c>expect.revision</c>
/// is <c>@head</c> or <c>""</c>; <c>expect.state</c> holds pointers into the room's export;
/// <c>expect.committed</c> is how far the head sequence moved; <c>expect.blocksUnchanged</c> compares /blocks.</item>
/// </list>
/// </summary>
public sealed class AgentServerScenarioTests
{
  private const string RelativeRoot = "test/fixtures/agent-server-scenarios";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");
  private static readonly Lazy<JintBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
  private static readonly Lazy<BlokAgentExecutor> StoredExecutor = new(() => new BlokAgentExecutor(Runtime.Value));
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
    await using var live = scenario["room"] is JsonObject roomSpec ? Live.Open(roomSpec, scenario["seed"]!.AsObject()) : null;
    var executor = live?.Executor ?? StoredExecutor.Value;
    var revisions = new Dictionary<int, string>();
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
      var expect = step["expect"] as JsonObject ?? [];
      var times = step["times"]?.GetValue<int>() ?? 1;

      for (var repeat = 0; repeat < times; repeat++)
      {
        var where = $"{name} step {index}#{repeat}";

        if (run.StartsWith("contract:", StringComparison.Ordinal))
        {
          var contract = run switch
          {
            "contract:plain" => await executor.GetContractAsync(options),
            "contract:session" => await executor.OpenSession(Actor, options).GetContractAsync(),
            "contract:room" => await executor.GetRoomContractAsync(options),
            _ => throw new InvalidDataException(run),
          };
          CheckContract(where, JsonNode.Parse(contract)!.AsObject(), expect);
          continue;
        }

        var current = live is null ? null : await live.HeadAsync(live.DocId);
        string Fill(string text) => live is null ? text : Live.Fill(text, revisions, current!);

        if (run is "peer" or "reset" or "purge" or "restore" or "drain")
        {
          await live!.HostStepAsync(where, run, step, Fill);
          continue;
        }

        var doc = step["doc"]?.GetValue<string>() ?? live?.DocId;
        var beforeHead = live is null ? null : await live.HeadAsync(doc!);
        var beforeBlocks = live is null ? null : (await live.ExportAsync(doc!))?["blocks"]?.ToJsonString();
        var batch = Fill(Indexed(step["batch"]!, repeat).ToJsonString());
        var execution = run switch
        {
          "room" => await executor.ExecuteInRoomAsync(doc!, batch, StepActor(step), options),
          "plain" => await executor.ExecuteAsync(Document(step["document"]!, seed, last, byStep), batch, Actor, options),
          _ => await Session(sessions, executor, run, options).ExecuteAsync(Document(step["document"]!, seed, last, byStep), batch),
        };
        var result = JsonNode.Parse(execution.ResultJson)!.AsObject();
        revisions[index] = execution.Revision;
        var head = live is null ? null : await live.HeadAsync(doc!);

        var want = live is null ? expect : JsonNode.Parse(Fill(expect.ToJsonString()))!.AsObject();

        if (want["ok"] is JsonNode ok)
        {
          Assert.True(ok.GetValue<bool>() == result["ok"]!.GetValue<bool>(), $"{where}: ok\n{execution.ResultJson}");
        }
        if (want["code"] is JsonNode code)
        {
          Assert.True(code.GetValue<string>() == result["error"]?["code"]?.GetValue<string>(), $"{where}: code\n{execution.ResultJson}");
        }
        if (want["saved"] is JsonNode saved)
        {
          Assert.True(saved.GetValue<bool>() == execution.DocumentJson is not null, $"{where}: saved\n{execution.ResultJson}");
        }
        Assert.Equal(result["revision"]?.GetValue<string>() ?? string.Empty, execution.Revision);
        CheckPointers($"{where} result", result, Headed(want["result"]?.DeepClone(), head) as JsonObject);
        if (want["document"] is JsonObject pointers)
        {
          CheckPointers($"{where} document", JsonNode.Parse(execution.DocumentJson!)!, pointers);
        }
        if (want["revisionEqualsRead"]?.GetValue<bool>() == true)
        {
          var read = await executor.ExecuteAsync(Document(step["document"]!, seed, last, byStep), ReadBatch, Actor);

          Assert.Equal(read.Revision, execution.Revision);
        }
        if (want["revision"] is JsonNode wantRevision)
        {
          Assert.True((wantRevision.GetValue<string>() == "@head" ? head : wantRevision.GetValue<string>()) == execution.Revision, $"{where}: revision {execution.Revision}, head {head}\n{execution.ResultJson}");
        }
        if (want["committed"] is JsonNode committed)
        {
          Assert.True(committed.GetValue<int>() == Sequence(head) - Sequence(beforeHead), $"{where}: committed {Sequence(head) - Sequence(beforeHead)}\n{execution.ResultJson}");
        }
        if (want["blocksUnchanged"]?.GetValue<bool>() == true)
        {
          Assert.True(beforeBlocks == (await live!.ExportAsync(doc!))?["blocks"]?.ToJsonString(), $"{where}: the blocks changed\n{execution.ResultJson}");
        }
        if (want["state"] is JsonObject statePointers)
        {
          var stateDoc = want["stateDoc"]?.GetValue<string>() ?? doc!;
          CheckPointers($"{where} state", (await live!.ExportAsync(stateDoc))!, Headed(statePointers.DeepClone(), head)!.AsObject());
        }
        if (want["stateMatchesSaved"] is JsonNode savedStep)
        {
          var ids = new HashSet<string>(scenario["seed"]!["blocks"]!.AsArray().Select(block => block!["id"]!.GetValue<string>()), StringComparer.Ordinal);
          Assert.Equal(
              AgentParityNormalizer.Stable(AgentParityNormalizer.Normalize(JsonNode.Parse(byStep[savedStep.GetValue<int>()])!.AsObject(), ids)),
              AgentParityNormalizer.Stable(AgentParityNormalizer.Normalize((await live!.ExportAsync(doc!))!, ids)));
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

  private static BlokAgentActor StepActor(JsonObject step) => step["actor"] is JsonObject actor
      ? new BlokAgentActor(actor["id"]!.GetValue<string>(), actor["name"]!.GetValue<string>(), actor["onBehalfOf"]?.GetValue<string>())
      : Actor;

  private static long Sequence(string? head) =>
      string.IsNullOrEmpty(head) ? 0 : long.Parse(head[(head.LastIndexOf(':') + 1)..], System.Globalization.CultureInfo.InvariantCulture);

  /// <summary>Puts the room head in place of every "@head" string.</summary>
  private static JsonNode? Headed(JsonNode? node, string? head)
  {
    switch (node)
    {
      case JsonObject obj:
        foreach (var key in obj.Select(pair => pair.Key).ToList())
        {
          if (Headed(obj[key], head) is var replaced && !ReferenceEquals(replaced, obj[key]))
          {
            obj[key] = replaced;
          }
        }

        return obj;
      case JsonArray array:
        for (var i = 0; i < array.Count; i++)
        {
          if (Headed(array[i], head) is var replaced && !ReferenceEquals(replaced, array[i]))
          {
            array[i] = replaced;
          }
        }

        return array;
      case JsonValue value when value.TryGetValue<string>(out var text) && text == "@head":
        return JsonValue.Create(head ?? string.Empty);
      default:
        return node;
    }
  }

  private static BlokAgentSession Session(Dictionary<string, BlokAgentSession> sessions, BlokAgentExecutor executor, string run, BlokAgentOptions? options)
  {
    if (!sessions.TryGetValue(run, out var session))
    {
      session = executor.OpenSession(Actor, options);
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
      else if (want is JsonObject spec2 && spec2["present"] is not null)
      {
        Assert.True(exists && got is not null, $"{where}: {pointer} should be present");
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

  /// <summary>A live room for a scenario: the real converter, fake stores, and an executor over them.</summary>
  private sealed class Live : IAsyncDisposable
  {
    private Live(string docId, CollabRoomManager manager, BlokAgentExecutor executor)
    {
      DocId = docId;
      Manager = manager;
      Executor = executor;
    }

    internal string DocId { get; }

    internal CollabRoomManager Manager { get; }

    internal BlokAgentExecutor Executor { get; }

    internal static Live Open(JsonObject spec, JsonObject seed)
    {
      var docId = spec["doc"]?.GetValue<string>() ?? "agent-room";
      var endpoint = new FakeDocEndpoint();
      endpoint.HoldsDocument(docId, (JsonObject)seed.DeepClone());

      foreach (var (held, document) in spec["held"] as JsonObject ?? [])
      {
        endpoint.HoldsDocument(held, (JsonObject)document!.DeepClone());
      }

      var converter = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(Runtime.Value));
      var manager = new CollabRoomManager(
          new FakeWorkingSetStore(),
          endpoint,
          converter,
          new CollabRoomOptions(),
          TimeProvider.System,
          operationStore: spec["journal"]?.GetValue<bool>() == false ? null : new FakeCollabOperationStore());

      return new Live(docId, manager, new BlokAgentExecutor(Runtime.Value, manager, converter));
    }

    internal async Task<string> HeadAsync(string docId)
    {
      var state = await Manager.StateAsync(docId);

      return state.Head is { } head ? $"{head.Tag.Lineage}:{head.ServerSequence}" : string.Empty;
    }

    internal async Task<JsonObject?> ExportAsync(string docId)
    {
      var state = await Manager.StateAsync(docId);

      return state.Status == CollabStateStatus.Ready ? JsonNode.Parse(state.Json)!.AsObject() : null;
    }

    internal static string Fill(string text, Dictionary<int, string> revisions, string head)
    {
      if (text.Contains("{lineage}", StringComparison.Ordinal))
      {
        text = text.Replace("{lineage}", head[..head.LastIndexOf(':')], StringComparison.Ordinal);
      }

      return System.Text.RegularExpressions.Regex.Replace(text, @"\{rev:(\d+)\}",
          match => revisions[int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture)]);
    }

    internal async Task HostStepAsync(string where, string run, JsonObject step, Func<string, string> fill)
    {
      var docId = step["doc"]?.GetValue<string>() ?? DocId;

      switch (run)
      {
        case "peer":
          var ops = CollabEditOps.Parse(System.Text.Encoding.UTF8.GetBytes(fill(step["ops"]!.ToJsonString())));
          var edit = await Manager.EditAsync(docId, ops, Guid.NewGuid().ToString("N"), Guid.NewGuid().ToByteArray(), "human-2");

          Assert.True(edit.Status == CollabEditStatus.Applied, $"{where}: peer edit {edit.Status}");
          break;
        case "reset":
          await Manager.ResetAsync(docId);
          break;
        case "drain":
          await Manager.DrainAsync();
          break;
        case "purge":
          await Manager.PurgeDocumentAsync(docId, _ => ValueTask.FromResult(true));
          break;
        case "restore":
          var version = fill(step["version"]!.GetValue<string>());
          var colon = version.LastIndexOf(':');
          var restored = await Manager.RestoreAsync(docId, version[..colon],
              ulong.Parse(version[(colon + 1)..], System.Globalization.CultureInfo.InvariantCulture), Guid.NewGuid().ToString("N"), "human-2");

          Assert.True(restored.Edit?.Status == CollabEditStatus.Applied, $"{where}: restore {restored.History} {restored.Edit?.Status}");
          break;
      }
    }

    public ValueTask DisposeAsync() => Manager.DrainAsync();
  }
}
