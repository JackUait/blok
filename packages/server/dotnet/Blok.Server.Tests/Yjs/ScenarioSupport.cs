using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>What a step says the engine document must look like once it has run.</summary>
internal sealed record ScenarioExpect(
    byte[]? StateVector, bool? HasPending, JsonNode? Json, string? JsonSha256);

/// <summary>
/// One step of a scenario or a fuzz seed, in the one shape both files reduce
/// to. <see cref="To"/> null means "the engine", which is how the fuzz seeds
/// spell a delivery; the scenarios name their recipients.
/// </summary>
internal sealed record ScenarioStep(
    string Kind,
    string? Id,
    string? Doc,
    JsonObject? Op,
    byte[]? Update,
    string? UpdateOf,
    IReadOnlyList<string>? To,
    ScenarioExpect? Expect);

internal sealed record ScenarioCase(
    string Name,
    bool Gc,
    IReadOnlyDictionary<string, string> Roots,
    string Engine,
    uint EngineClientId,
    IReadOnlyList<ScenarioStep> Steps);

/// <summary>
/// Reads scenarios.json and the fuzz seeds and replays them against the
/// engine. Both files describe the same thing — a delivery schedule between
/// real yjs documents, with the engine standing in for one of them — so both
/// are read into one step shape and run by one runner.
/// </summary>
internal static class ScenarioSupport
{
  internal static IReadOnlyList<ScenarioCase> Scenarios()
  {
    return [.. YjsEngineFixtures.Cases("scenarios.json").Select(ReadScenario)];
  }

  internal static IReadOnlyList<ScenarioCase> FuzzSeeds()
  {
    return
    [
      .. Directory
          .EnumerateFiles(Path.Combine(YjsEngineFixtures.Root, "fuzz"), "seed-*.json")
          .Order(StringComparer.Ordinal)
          .Select(path => ReadSeed(Path.GetFileName(path))),
    ];
  }

  /// <summary>
  /// The op grammar the generator recorded. Applying one is the write API,
  /// which lands in Task 4.1; until then a scenario substitutes the mirror
  /// document's bytes for the engine's own write.
  /// </summary>
  internal static void ApplyOp(YDoc doc, JsonObject op)
  {
    ArgumentNullException.ThrowIfNull(op);

    throw new NotSupportedException(
        $"the write API is Task 4.1; \"{op["op"]}\" cannot be performed on the engine yet");
  }

  /// <summary>
  /// JavaScript's JSON.stringify of the recursively key-sorted value, which
  /// is what the fuzz seeds hashed. Hand-written because no System.Text.Json
  /// encoder writes it: even UnsafeRelaxedJsonEscaping splits an astral
  /// character into two \u escapes, and the corpus is full of them.
  /// </summary>
  internal static string CanonicalJson(JsonNode? node)
  {
    var written = new StringBuilder();

    WriteCanonical(node, written);

    return written.ToString();
  }

  /// <summary>The hash the fuzz seeds carry instead of the whole JSON.</summary>
  internal static string JsonSha256(JsonNode? node)
  {
    return Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(node)))).ToLowerInvariant();
  }

  private static void WriteCanonical(JsonNode? node, StringBuilder written)
  {
    switch (node)
    {
      case null:
        written.Append("null");
        break;

      case JsonObject members:
        written.Append('{');

        var first = true;

        foreach (var key in members.Select(entry => entry.Key).Order(StringComparer.Ordinal))
        {
          if (!first)
          {
            written.Append(',');
          }

          first = false;
          WriteCanonicalString(key, written);
          written.Append(':');
          WriteCanonical(members[key], written);
        }

        written.Append('}');
        break;

      case JsonArray items:
        written.Append('[');

        for (var index = 0; index < items.Count; index++)
        {
          if (index > 0)
          {
            written.Append(',');
          }

          WriteCanonical(items[index], written);
        }

        written.Append(']');
        break;

      case JsonValue value when value.TryGetValue<string>(out var text):
        WriteCanonicalString(text, written);
        break;

      default:
        written.Append(node.ToJsonString());
        break;
    }
  }

  /// <summary>
  /// JSON.stringify's QuoteJSONString: the two structural characters, the
  /// five short control escapes, anything else below 0x20, and a lone
  /// surrogate. Everything else, non-ASCII included, is written as it is.
  /// </summary>
  private static void WriteCanonicalString(string text, StringBuilder written)
  {
    written.Append('"');

    for (var index = 0; index < text.Length; index++)
    {
      var character = text[index];

      switch (character)
      {
        case '"':
          written.Append("\\\"");
          break;

        case '\\':
          written.Append("\\\\");
          break;

        case '\b':
          written.Append("\\b");
          break;

        case '\f':
          written.Append("\\f");
          break;

        case '\n':
          written.Append("\\n");
          break;

        case '\r':
          written.Append("\\r");
          break;

        case '\t':
          written.Append("\\t");
          break;

        default:
          var lone = char.IsSurrogate(character) &&
              !(char.IsHighSurrogate(character) &&
                  index + 1 < text.Length &&
                  char.IsLowSurrogate(text[index + 1])) &&
              !(char.IsLowSurrogate(character) &&
                  index > 0 &&
                  char.IsHighSurrogate(text[index - 1]));

          if (character < ' ' || lone)
          {
            written.Append(CultureInfo.InvariantCulture, $"\\u{(int)character:x4}");
          }
          else
          {
            written.Append(character);
          }

          break;
      }
    }

    written.Append('"');
  }

  private static ScenarioCase ReadScenario(JsonNode? node)
  {
    var testCase = Object(node);
    var engine = String(testCase["engine"]);

    return new ScenarioCase(
        String(testCase["name"]),
        testCase["gc"]?.GetValue<bool>() ?? true,
        Roots(testCase["roots"]),
        engine,
        testCase["docs"]?[engine]?.GetValue<uint>() ??
            throw new InvalidDataException($"the case has no client id for \"{engine}\""),
        [.. testCase["steps"]?.AsArray().Select(ReadScenarioStep) ?? []]);
  }

  private static ScenarioStep ReadScenarioStep(JsonNode? node)
  {
    var step = Object(node);
    var kind = String(step["kind"]);

    return new ScenarioStep(
        kind,
        step["id"]?.GetValue<string>(),
        step["doc"]?.GetValue<string>(),
        step["op"] as JsonObject,
        Bytes(step["update"]),
        step["updateOf"]?.GetValue<string>(),
        Names(kind == "deliver" ? step["to"] : step["deliver"]),
        ReadExpect(step["expect"]));
  }

  private static ScenarioCase ReadSeed(string fileName)
  {
    var seed = Object(YjsEngineFixtures.ReadJson(Path.Combine("fuzz", fileName)));
    var engine = String(seed["engine"]);

    return new ScenarioCase(
        Path.GetFileNameWithoutExtension(fileName),
        seed["gc"]?.GetValue<bool>() ?? true,
        Roots(seed["roots"]),
        engine,
        seed["docs"]?[engine]?.GetValue<uint>() ??
            throw new InvalidDataException($"{fileName} has no client id for \"{engine}\""),
        [.. seed["steps"]?.AsArray().Select(ReadSeedStep) ?? []]);
  }

  private static ScenarioStep ReadSeedStep(JsonNode? node)
  {
    var step = Object(node);

    // A seed's deliveries always go to the engine, so they name no recipient.
    return new ScenarioStep(
        String(step["kind"]),
        step["id"]?.GetValue<string>(),
        step["doc"]?.GetValue<string>(),
        step["op"] as JsonObject,
        Bytes(step["update"]),
        step["updateOf"]?.GetValue<string>(),
        To: null,
        ReadExpect(step["expect"]));
  }

  private static ScenarioExpect? ReadExpect(JsonNode? node)
  {
    if (node is not JsonObject expect)
    {
      return null;
    }

    return new ScenarioExpect(
        Bytes(expect["sv"]),
        expect["hasPending"]?.GetValue<bool>(),
        expect["json"],
        expect["jsonSha256"]?.GetValue<string>());
  }

  private static Dictionary<string, string> Roots(JsonNode? node)
  {
    return Object(node).ToDictionary(
        entry => entry.Key, entry => String(entry.Value), StringComparer.Ordinal);
  }

  private static IReadOnlyList<string>? Names(JsonNode? node)
  {
    return node is JsonArray names ? [.. names.Select(String)] : null;
  }

  private static byte[]? Bytes(JsonNode? node)
  {
    return node is null ? null : Convert.FromBase64String(String(node));
  }

  private static string String(JsonNode? node)
  {
    return node?.GetValue<string>() ??
        throw new InvalidDataException("a fixture field that must be a string is missing");
  }

  private static JsonObject Object(JsonNode? node)
  {
    return node as JsonObject ??
        throw new InvalidDataException("a fixture node that must be an object is missing");
  }
}

/// <summary>
/// Replays one case against one engine document. The document is created with
/// the client id the generator pinned for the engine, so the bytes a step
/// attributes to the engine really are bytes it could have produced.
/// </summary>
internal sealed class ScenarioRunner
{
  private readonly ScenarioCase testCase;
  private readonly Dictionary<string, byte[]> emitted = new(StringComparer.Ordinal);

  internal ScenarioRunner(ScenarioCase testCase)
  {
    this.testCase = testCase;
    Doc = new YDoc(testCase.EngineClientId) { Gc = testCase.Gc };
  }

  internal YDoc Doc { get; }

  /// <summary>How many expectations were checked; a silent run is a broken test.</summary>
  internal int Checks { get; private set; }

  internal void RunAll()
  {
    foreach (var step in testCase.Steps)
    {
      Run(step);
    }
  }

  internal void Run(ScenarioStep step)
  {
    ArgumentNullException.ThrowIfNull(step);

    if (step is { Id: { } id, Update: { } bytes })
    {
      emitted[id] = bytes;
    }

    switch (step.Kind)
    {
      case "op":
        if (step.To?.Contains(testCase.Engine) == true)
        {
          Apply(step, step.Update);
        }

        break;

      case "engineWrites":
        // Task 4.1 performs step.Op through the write API instead. Until then
        // the mirror document's bytes stand in: it carries the engine's own
        // pinned client id, so they are the bytes the engine would have sent.
        Apply(step, step.Update);
        break;

      case "deliver":
        if (step.To is null || step.To.Contains(testCase.Engine))
        {
          Apply(step, step.Update ?? Emitted(step.UpdateOf));
        }

        break;

      case "expect":
        break;

      default:
        throw new InvalidDataException($"\"{step.Kind}\" is not a step kind");
    }

    if (step.Expect is { } expect && (step.Doc is null || step.Doc == testCase.Engine))
    {
      Check(expect);
    }
  }

  private void Apply(ScenarioStep step, byte[]? update)
  {
    var result = Doc.ApplyUpdate(
        update ?? throw new InvalidDataException($"step \"{step.Id}\" carries no update"));

    Assert.Equal(ApplyOutcome.Applied, result.Outcome);
  }

  private byte[] Emitted(string? id)
  {
    return id is not null && emitted.TryGetValue(id, out var update)
        ? update
        : throw new InvalidDataException($"no step has produced \"{id}\" yet");
  }

  private void Check(ScenarioExpect expect)
  {
    if (expect.StateVector is { } vector)
    {
      Assert.Equal(vector, Doc.EncodeStateVector());
      Checks++;
    }

    if (expect.HasPending is { } pending)
    {
      Assert.Equal(pending, Doc.HasPending);
      Checks++;
    }

    if (expect.Json is { } json)
    {
      Assert.Equal(
          YjsEngineFixtures.Canonicalize(json),
          YjsEngineFixtures.Canonicalize(JsonRenderer.Render(Doc, testCase.Roots)));
      Checks++;
    }

    if (expect.JsonSha256 is { } hash)
    {
      Assert.Equal(hash, ScenarioSupport.JsonSha256(JsonRenderer.Render(Doc, testCase.Roots)));
      Checks++;
    }
  }
}
