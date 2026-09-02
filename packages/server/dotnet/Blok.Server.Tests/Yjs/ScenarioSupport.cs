using System.Globalization;
using System.Numerics;
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
  /// The op grammar the generator recorded, performed through the write API in
  /// one transaction, and answering the update that transaction emitted. Every
  /// op the generator writes changes something, so null is a bug.
  ///
  /// Only the ops the ENGINE performs are covered: a peer's op reaches the
  /// engine as bytes, never as a call.
  /// </summary>
  internal static byte[]? ApplyOp(YDoc doc, JsonObject op)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(op);

    var target = Target(doc, op);
    var kind = String(op["op"]);

    if (op["attributes"] is not null)
    {
      throw new NotSupportedException(
          $"\"{kind}\" carries attributes; the engine's Y.Text has no formatting API");
    }

    return doc.Transact(transaction =>
    {
      switch (kind)
      {
        case "map.set":
          Map(target).Set(transaction, String(op["key"]), BuildValue(op["value"]));
          break;

        case "map.delete":
          Map(target).Remove(transaction, String(op["key"]));
          break;

        case "array.insert":
          Array(target).Insert(
              transaction, Number(op["index"]), [.. Values(op["values"]).Select(BuildValue)]);
          break;

        case "array.delete":
          Array(target).Delete(transaction, Number(op["index"]), Number(op["length"]));
          break;

        case "text.insert":
          Text(target).Insert(transaction, Number(op["index"]), String(op["text"]));
          break;

        case "text.delete":
          Text(target).Delete(transaction, Number(op["index"]), Number(op["length"]));
          break;

        default:
          throw new NotSupportedException($"\"{kind}\" is not an op the engine performs");
      }
    });
  }

  /// <summary>
  /// The generator's value descriptors as engine values: JSON as it stands,
  /// plus the sentinels for what JSON cannot hold and for a nested shared
  /// type, which becomes a prelim instance the parent item integrates.
  /// </summary>
  internal static object? BuildValue(JsonNode? descriptor)
  {
    switch (descriptor)
    {
      case null:
        return null;

      case JsonArray items:
        var list = new AnyArray();

        foreach (var item in items)
        {
          list.Add(BuildValue(item));
        }

        return list;

      case JsonObject members:
        return BuildDescribedValue(members);

      case JsonValue value:
        return value.TryGetValue<string>(out var text) ? text
            : value.TryGetValue<bool>(out var flag) ? flag

            // Locked Decision 2: every JSON number is a double, so the Any tag
            // follows lib0's rule rather than what the parser guessed.
            : value.GetValue<double>();

      default:
        throw new InvalidDataException($"{descriptor.GetType().Name} is not a value descriptor");
    }
  }

  private static object? BuildDescribedValue(JsonObject members)
  {
    if (members["$num"] is { } number)
    {
      return String(number) switch
      {
        "NaN" => double.NaN,
        "-0" => -0d,
        "Infinity" => double.PositiveInfinity,
        "-Infinity" => double.NegativeInfinity,
        var other => throw new InvalidDataException($"\"{other}\" is not a $num sentinel"),
      };
    }

    if (members["$bigint"] is { } big)
    {
      return BigInteger.Parse(String(big), CultureInfo.InvariantCulture);
    }

    if (members["$u8"] is { } bytes)
    {
      return Convert.FromBase64String(String(bytes));
    }

    if (members["$undefined"] is not null)
    {
      return YUndefined.Instance;
    }

    if (members["$ymap"] is JsonObject nested)
    {
      return new YMap(nested.Select(
          entry => new KeyValuePair<string, object?>(entry.Key, BuildValue(entry.Value))));
    }

    if (members["$yarray"] is JsonArray items)
    {
      return new YArray(items.Select(BuildValue));
    }

    if (members["$ytext"] is { } characters)
    {
      return new YText(String(characters));
    }

    foreach (var key in members.Select(entry => entry.Key))
    {
      if (key.StartsWith("$yxml", StringComparison.Ordinal))
      {
        throw new NotSupportedException($"\"{key}\" is a placeholder type the engine never writes");
      }
    }

    var built = new AnyObject();

    foreach (var (key, value) in members)
    {
      built.Add(key, BuildValue(value));
    }

    return built;
  }

  /// <summary>The root the op names, walked down through its nested-map path.</summary>
  private static YAbstractType Target(YDoc doc, JsonObject op)
  {
    var root = String(op["root"]);
    YAbstractType target = String(op["rootKind"]) switch
    {
      "map" => doc.GetMap(root),
      "array" => doc.GetArray(root),
      "text" => doc.GetText(root),
      var other => throw new InvalidDataException($"\"{other}\" is not a root kind"),
    };

    foreach (var segment in op["path"]?.AsArray() ?? [])
    {
      var key = String(segment);

      target = Map(target).TryGet(key, out var nested) && nested is YAbstractType child
          ? child
          : throw new InvalidDataException($"\"{key}\" does not hold a nested shared type");
    }

    return target;
  }

  private static YMap Map(YAbstractType target)
  {
    return target as YMap ?? throw new InvalidDataException("the op's target is not a Y.Map");
  }

  private static YArray Array(YAbstractType target)
  {
    return target as YArray ?? throw new InvalidDataException("the op's target is not a Y.Array");
  }

  private static YText Text(YAbstractType target)
  {
    return target as YText ?? throw new InvalidDataException("the op's target is not a Y.Text");
  }

  private static JsonArray Values(JsonNode? node)
  {
    return node?.AsArray() ??
        throw new InvalidDataException("an insert op carries no values array");
  }

  private static int Number(JsonNode? node)
  {
    return node?.GetValue<int>() ??
        throw new InvalidDataException("a fixture field that must be a number is missing");
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

    // An engineWrites step registers what the ENGINE produced, not the
    // fixture's mirror copy, so a later delivery replays the engine's own
    // bytes; Write below files them.
    if (step is { Kind: not "engineWrites", Id: { } id, Update: { } bytes })
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
        Write(step);
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

  /// <summary>
  /// The engine performs the op itself. The fixture's <c>update</c> is the
  /// mirror document's copy — real yjs, the same pinned client id, the same
  /// state — so the two must be the same bytes; that equality is the tightest
  /// oracle this suite has for the write API.
  /// </summary>
  private void Write(ScenarioStep step)
  {
    var written = ScenarioSupport.ApplyOp(
        Doc,
        step.Op ?? throw new InvalidDataException($"step \"{step.Id}\" carries no op"));

    Assert.NotNull(written);
    AssertMirrorBytes(step, written);

    if (step.Id is { } id)
    {
      emitted[id] = written;
    }
  }

  private void AssertMirrorBytes(ScenarioStep step, byte[] written)
  {
    var mirror = step.Update ??
        throw new InvalidDataException($"step \"{step.Id}\" carries no mirror update");
    var where = $"{testCase.Name} step \"{step.Id}\" ({step.Op?.ToJsonString()})";

    for (var index = 0; index < Math.Min(mirror.Length, written.Length); index++)
    {
      if (mirror[index] != written[index])
      {
        Assert.Fail(
            $"{where}: byte {index} is 0x{written[index]:x2}, yjs wrote 0x{mirror[index]:x2} " +
            $"(engine {Convert.ToBase64String(written)}, yjs {Convert.ToBase64String(mirror)})");
      }
    }

    if (mirror.Length != written.Length)
    {
      Assert.Fail(
          $"{where}: the engine wrote {written.Length} bytes, yjs wrote {mirror.Length} " +
          $"(engine {Convert.ToBase64String(written)}, yjs {Convert.ToBase64String(mirror)})");
    }

    Checks++;
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
