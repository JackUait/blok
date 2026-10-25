using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

namespace Blok.Server.Tests.Agent;

internal sealed record ParityCaseData(
    string Name,
    JsonObject Seed,
    IReadOnlyList<JsonObject> Batches,
    JsonObject? Expect,
    JsonObject? ExpectByRunner);

/// <summary>
/// Reads test/fixtures/agent-commands, the corpus the TS runners read
/// (test/unit/agent/parity/corpus.ts). Keep the two readers in step.
/// </summary>
internal static partial class AgentParityCorpus
{
  private const string RelativeRoot = "test/fixtures/agent-commands";

  private static readonly Lazy<string> RootPath = new(LocateRoot);
  private static readonly Lazy<IReadOnlyList<ParityCaseData>> Cases = new(LoadAll);

  internal static string Root => RootPath.Value;

  internal static IReadOnlyList<ParityCaseData> Load() => Cases.Value;

  internal static TheoryData<string> Names()
  {
    var data = new TheoryData<string>();

    foreach (var c in Load())
    {
      data.Add(c.Name);
    }

    return data;
  }

  internal static ParityCaseData Get(string name) => Load().First(c => c.Name == name);

  /// <summary>The expected error code, or null for "ok". <c>"expect": "ok"</c> is a string, so it reads as null.</summary>
  internal static string? ExpectedError(ParityCaseData c, string runner)
  {
    var expectation = c.ExpectByRunner?[runner] as JsonObject ?? c.Expect;

    return expectation?["errorCode"]?.GetValue<string>();
  }

  internal static ISet<string> CallerChosenIds(ParityCaseData c)
  {
    var ids = new HashSet<string>(StringComparer.Ordinal);

    foreach (var block in c.Seed["blocks"]!.AsArray().OfType<JsonObject>())
    {
      if (block["id"] is JsonValue id && id.TryGetValue<string>(out var text))
      {
        ids.Add(text);
      }
    }

    foreach (var command in c.Batches.SelectMany(batch => batch["commands"]!.AsArray().OfType<JsonObject>()))
    {
      if (command["name"]?.GetValue<string>() == "block.insert")
      {
        CollectIds(command["args"], ids);
      }
    }

    return ids;
  }

  internal static JsonNode? Golden(string name)
  {
    var file = Path.Combine(Root, "goldens", $"{UnsafeNameChars().Replace(name, "__")}.json");

    return File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file))?["document"] : null;
  }

  [GeneratedRegex("[^a-zA-Z0-9_-]")]
  private static partial Regex UnsafeNameChars();

  private static void CollectIds(JsonNode? node, HashSet<string> ids)
  {
    if (node is JsonArray array)
    {
      foreach (var item in array)
      {
        CollectIds(item, ids);
      }
    }
    else if (node is JsonObject obj)
    {
      if (obj["id"] is JsonValue id && id.TryGetValue<string>(out var text))
      {
        ids.Add(text);
      }

      CollectIds(obj["children"], ids);
    }
  }

  private static List<ParityCaseData> LoadAll()
  {
    var list = new List<ParityCaseData>();

    foreach (var file in Directory.GetFiles(Path.Combine(Root, "cases"), "*.json").Order(StringComparer.Ordinal))
    {
      var json = JsonNode.Parse(File.ReadAllText(file))!.AsObject();

      // The Jint runtime gets service names but no host bridge, so it cannot answer a case's
      // fixed services. Each such case has a twin without services that the C# runners do run.
      if (json["services"] is not null)
      {
        continue;
      }

      list.Add(new ParityCaseData(
          json["name"]!.GetValue<string>(),
          json["seed"]!.AsObject(),
          json["batches"]!.AsArray().Select(b => b!.AsObject()).ToList(),
          json["expect"] as JsonObject,
          json["expectByRunner"] as JsonObject));
    }

    var evals = Path.Combine(Root, "evals");

    if (Directory.Exists(evals))
    {
      foreach (var file in Directory.GetFiles(evals, "*.json").Order(StringComparer.Ordinal))
      {
        var json = JsonNode.Parse(File.ReadAllText(file))!.AsObject();

        if (json["parityExcluded"] is not null)
        {
          continue;
        }

        list.Add(new ParityCaseData(
            $"eval:{json["id"]!.GetValue<string>()}",
            json["seed"]!.AsObject(),
            json["reference"]!.AsArray().Select(b => b!.AsObject()).ToList(),
            null,
            json["referenceExpectByRunner"] as JsonObject));
      }
    }

    return list;
  }

  private static string LocateRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, RelativeRoot);

      if (File.Exists(Path.Combine(candidate, "normalizer-cases.json")))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException($"agent corpus not found above {AppContext.BaseDirectory}");
  }
}
