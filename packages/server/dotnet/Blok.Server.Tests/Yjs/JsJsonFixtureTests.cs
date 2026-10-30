using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/jsjson, which the Go jsjson
/// package reads too. js.json is node's answer, so JsJson must match it.
/// dotnet.json was captured from System.Text.Json and is recomputed here, so a
/// stale capture fails this test. Regenerate with
/// node scripts/generate-jsjson-fixtures.mjs.
/// </summary>
public sealed class JsJsonFixtureTests
{
  private const string RelativeRoot = "test/unit/server-conformance/fixtures/jsjson";

  // CanonicalBody writes this around the data of one update op.
  private const string CanonicalPrefix = "{\"ops\":[{\"data\":{\"v\":";
  private const string CanonicalSuffix = "},\"id\":\"x\",\"op\":\"update\"}]}";

  private static JsonObject Read(string name)
  {
    var path = Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativeRoot, name);

    return JsonNode.Parse(File.ReadAllText(path))?.AsObject() ??
        throw new InvalidDataException($"{path} holds JSON null");
  }

  private static string FromUnits(string hex)
  {
    var text = new StringBuilder(hex.Length / 4);

    for (var index = 0; index < hex.Length; index += 4)
    {
      text.Append((char)ushort.Parse(hex.AsSpan(index, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
    }

    return text.ToString();
  }

  private static double FromBits(string hex)
  {
    return BitConverter.Int64BitsToDouble(
        (long)ulong.Parse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
  }

  private static object? Build(JsonNode? spec)
  {
    switch (spec)
    {
      case null:
        return null;

      case JsonValue value:
        return value.GetValue<bool>();

      case JsonObject map when map["n"] is { } bits:
        return FromBits(bits.GetValue<string>());

      case JsonObject map when map["s"] is { } units:
        return FromUnits(units.GetValue<string>());

      case JsonObject map when map.ContainsKey("u"):
        return YUndefined.Instance;

      case JsonObject map when map["a"] is JsonArray items:
        var array = new AnyArray();

        foreach (var item in items)
        {
          array.Add(Build(item));
        }

        return array;

      case JsonObject map when map["o"] is JsonArray pairs:
        var members = new AnyObject();

        foreach (var pair in pairs)
        {
          members.Add(FromUnits(pair![0]!.GetValue<string>()), Build(pair[1]));
        }

        return members;

      default:
        throw new InvalidDataException($"bad value spec {spec.ToJsonString()}");
    }
  }

  private static string ErrorKind(Exception failure)
  {
    return failure switch
    {
      JsonException json when json.Message.Contains("maximum configured depth", StringComparison.Ordinal) => "depth",
      JsonException json when json.Message.StartsWith("Duplicate property", StringComparison.Ordinal) => "duplicate",
      JsonException => "invalid",
      InvalidOperationException lone when lone.Message.Contains("surrogate", StringComparison.Ordinal) => "loneSurrogate",
      InvalidOperationException utf8 when utf8.Message.Contains("invalid UTF-8", StringComparison.Ordinal) => "invalidUtf8",
      ArgumentException duplicate when duplicate.Message.Contains("same key", StringComparison.Ordinal) => "duplicate",
      _ => $"other:{failure.GetType().Name}: {failure.Message}",
    };
  }

  private static JsonNode Outcome(Func<string> write)
  {
    try
    {
      return JsonValue.Create(write());
    }
    catch (Exception failure) when (failure is InvalidOperationException or ArgumentException)
    {
      return new JsonObject { ["error"] = ErrorKind(failure) };
    }
  }

  private static string Canonical(JsonNode? node)
  {
    var body = Encoding.UTF8.GetString(CollabEditOps.CanonicalBody(
        [new CollabEditOp.Update("x", new JsonObject { ["v"] = node })]));

    Assert.StartsWith(CanonicalPrefix, body, StringComparison.Ordinal);
    Assert.EndsWith(CanonicalSuffix, body, StringComparison.Ordinal);

    return body[CanonicalPrefix.Length..^CanonicalSuffix.Length];
  }

  [Fact]
  public void FormatsNumbersLikeNode()
  {
    var numbers = Read("js.json")["numbers"]!.AsArray();

    Assert.True(numbers.Count > 1000);

    foreach (var pair in numbers)
    {
      var number = FromBits(pair![0]!.GetValue<string>());
      var expected = double.IsFinite(number) ? pair[1]!.GetValue<string>() : "null";

      Assert.Equal(expected, JsJson.Stringify(number));
    }
  }

  [Fact]
  public void WritesTheNaNNodeWrites()
  {
    var bits = Read("js.json")["nanBits"]!.GetValue<string>();
    var writer = new Lib0Writer();

    AnyCodec.Write(writer, double.NaN);

    Assert.Equal(Convert.ToHexStringLower(writer.ToArray().AsSpan(1)), bits);
  }

  [Fact]
  public void StringifiesLikeNode()
  {
    foreach (var entry in Read("js.json")["stringify"]!.AsArray())
    {
      var name = entry!["name"]!.GetValue<string>();
      var value = Build(entry["value"]);

      if (entry["json"] is null)
      {
        Assert.Throws<ArgumentException>(() => JsJson.Stringify(value));

        continue;
      }

      Assert.True(
          entry["json"]!.GetValue<string>() == JsJson.Stringify(value),
          $"{name}: {JsJson.Stringify(value)}");
    }
  }

  [Fact]
  public void ParsesLikeNode()
  {
    foreach (var entry in Read("js.json")["parse"]!.AsArray())
    {
      var name = entry!["name"]!.GetValue<string>();
      var text = entry["text"]!.GetValue<string>();

      // JS has no depth limit; C# validates at 512 first, and Go matches C#.
      if (entry["json"] is null || name == "depth 513 (JS has no limit)")
      {
        Assert.ThrowsAny<JsonException>(() => JsJson.Parse(text));

        continue;
      }

      var json = JsJson.Stringify(JsJson.Parse(text));

      Assert.True(entry["json"]!.GetValue<string>() == json, $"{name}: {json}");
    }
  }

  [Fact]
  public void SystemTextJsonStillAnswersTheCapturedDocuments()
  {
    foreach (var entry in Read("dotnet.json")["documents"]!.AsArray())
    {
      var name = entry!["name"]!.GetValue<string>();
      var bytes = entry["text"] is { } text
          ? Encoding.UTF8.GetBytes(text.GetValue<string>())
          : Convert.FromHexString(entry["hex"]!.GetValue<string>());
      var options = new JsonDocumentOptions
      {
        MaxDepth = entry["maxDepth"]!.GetValue<int>(),
        AllowDuplicateProperties = !entry["refuseDuplicates"]!.GetValue<bool>(),
      };
      JsonNode? node;

      try
      {
        node = JsonNode.Parse(bytes, documentOptions: options);
      }
      catch (Exception failure) when (failure is JsonException or InvalidOperationException)
      {
        Assert.True(entry["parse"]!.GetValue<string>() == ErrorKind(failure), $"{name}: parse {ErrorKind(failure)}");

        continue;
      }

      Assert.True(entry["parse"]!.GetValue<string>() == "ok", $"{name}: parse ok");

      var written = Outcome(() => node?.ToJsonString() ?? "null");
      var canonical = Outcome(() => Canonical(node));

      Assert.True(JsonNode.DeepEquals(entry["write"], written), $"{name}: write {written.ToJsonString()}");
      Assert.True(JsonNode.DeepEquals(entry["canonical"], canonical), $"{name}: canonical {canonical.ToJsonString()}");
    }
  }

  [Fact]
  public void SystemTextJsonStillQuotesTheCapturedStrings()
  {
    foreach (var entry in Read("dotnet.json")["strings"]!.AsArray())
    {
      var name = entry!["name"]!.GetValue<string>();
      var json = Outcome(() => JsonValue.Create(FromUnits(entry["units"]!.GetValue<string>())).ToJsonString());

      Assert.True(JsonNode.DeepEquals(entry["json"], json), $"{name}: {json.ToJsonString()}");
    }
  }
}
