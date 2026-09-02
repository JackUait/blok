using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The lib0 Any codec against the goldens real lib0 wrote (any.json), in both
/// directions, plus the number-tag edges and the nesting cap. Fixture values
/// speak the sentinel vocabulary the generator emits ({"$undefined":true},
/// {"$num":"NaN"}, {"$bigint":"1"}, {"$u8":"<base64>"}), so the test converts
/// between that vocabulary and engine values.
/// </summary>
public sealed class AnyCodecTests
{
  public static TheoryData<string> ReadCases()
  {
    return new TheoryData<string>(CaseNames(writable: false));
  }

  public static TheoryData<string> WriteCases()
  {
    return new TheoryData<string>(CaseNames(writable: true));
  }

  [Theory]
  [MemberData(nameof(ReadCases))]
  public void ReadsEveryAnyGolden(string name)
  {
    var (expected, tag, bytes) = Golden(name);
    var reader = new Lib0Reader(bytes);

    var value = AnyCodec.Read(ref reader);

    Assert.Equal(tag, bytes[0]);
    Assert.True(reader.AtEnd, $"{name} left {reader.Length - reader.Position} bytes unread");
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(expected),
        YjsEngineFixtures.Canonicalize(ToFixtureJson(value)));
  }

  [Theory]
  [MemberData(nameof(WriteCases))]
  public void WritesEveryAnyGolden(string name)
  {
    var (expected, tag, bytes) = Golden(name);
    var writer = new Lib0Writer();

    AnyCodec.Write(writer, ToEngineValue(expected));

    var written = writer.ToArray();

    Assert.Equal(tag, written[0]);
    Assert.Equal(bytes, written);
  }

  [Fact]
  public void NegativeZeroWritesTheSignBit()
  {
    var writer = new Lib0Writer();

    AnyCodec.Write(writer, -0d);

    // Tag 125 (integer), then the varint whose only content is the sign bit.
    Assert.Equal(new byte[] { 0x7D, 0x40 }, writer.ToArray());
  }

  [Fact]
  public void NanWritesFloat64()
  {
    var writer = new Lib0Writer();

    AnyCodec.Write(writer, double.NaN);

    Assert.Equal(
        new byte[] { 0x7B, 0x7F, 0xF8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
        writer.ToArray());
  }

  [Fact]
  public void InfinityWritesFloat32()
  {
    var writer = new Lib0Writer();

    AnyCodec.Write(writer, double.PositiveInfinity);

    Assert.Equal(new byte[] { 0x7C, 0x7F, 0x80, 0x00, 0x00 }, writer.ToArray());
  }

  [Fact]
  public void TwoPow31WritesFloat32()
  {
    var writer = new Lib0Writer();

    // 2147483648 is one past the |n| <= 0x7FFFFFFF bound of tag 125.
    AnyCodec.Write(writer, 2147483648d);

    Assert.Equal(new byte[] { 0x7C, 0x4F, 0x00, 0x00, 0x00 }, writer.ToArray());
  }

  [Fact]
  public void ObjectKeysKeepInsertionOrder()
  {
    var (_, _, bytes) = Golden("object-order");
    var reader = new Lib0Reader(bytes);

    var value = Assert.IsType<AnyObject>(AnyCodec.Read(ref reader));

    Assert.Equal(["b", "a"], value.Select(pair => pair.Key));
    Assert.True(value.TryGet("a", out var second));
    Assert.Equal(2d, second);
  }

  [Fact]
  public void UndefinedInsideAnObjectRoundTrips()
  {
    var (_, _, bytes) = Golden("object-undefined-member");
    var reader = new Lib0Reader(bytes);

    var value = Assert.IsType<AnyObject>(AnyCodec.Read(ref reader));

    Assert.True(value.TryGet("u", out var undefined));
    Assert.Same(YUndefined.Instance, undefined);

    var writer = new Lib0Writer();

    AnyCodec.Write(writer, value);

    Assert.Equal(bytes, writer.ToArray());
  }

  [Fact]
  public void NestedDepthPast4096Rejects()
  {
    // The room's own ceiling is 256 levels, which still decodes.
    var shallow = new Lib0Reader(NestedArrays(256));

    Assert.IsType<AnyArray>(AnyCodec.Read(ref shallow));

    Assert.Throws<Lib0FormatException>(() =>
    {
      var reader = new Lib0Reader(NestedArrays(4097));

      _ = AnyCodec.Read(ref reader);
    });
  }

  /// <summary>Tag 117 with one element, <paramref name="depth"/> times, around a null.</summary>
  private static byte[] NestedArrays(int depth)
  {
    var bytes = new byte[(depth * 2) + 1];

    for (var index = 0; index < depth; index++)
    {
      bytes[index * 2] = 117;
      bytes[(index * 2) + 1] = 1;
    }

    bytes[^1] = 126;

    return bytes;
  }

  private static IEnumerable<string> CaseNames(bool writable)
  {
    return YjsEngineFixtures.Cases("any.json")
        .Select(node => node ?? throw new InvalidDataException("any.json holds a null case"))
        .Where(node => !writable || node["decodeOnly"]?.GetValue<bool>() != true)
        .Select(node => node["name"]!.GetValue<string>());
  }

  private static (JsonNode? Value, byte Tag, byte[] Bytes) Golden(string name)
  {
    var entry = YjsEngineFixtures.Cases("any.json")
        .FirstOrDefault(node => node?["name"]?.GetValue<string>() == name) ??
        throw new InvalidDataException($"any.json has no case named {name}");

    return (
        entry["value"],
        (byte)entry["tag"]!.GetValue<int>(),
        Convert.FromBase64String(entry["bytes"]!.GetValue<string>()));
  }

  private static object? ToEngineValue(JsonNode? node)
  {
    switch (node)
    {
      case null:
        return null;

      case JsonObject json:
        if (Sentinel(json, "$undefined") is not null)
        {
          return YUndefined.Instance;
        }

        if (Sentinel(json, "$num") is { } number)
        {
          return number.GetValue<string>() switch
          {
            "NaN" => double.NaN,
            "-0" => -0d,
            "Infinity" => double.PositiveInfinity,
            "-Infinity" => double.NegativeInfinity,
            var other => throw new InvalidDataException($"any.json holds $num {other}"),
          };
        }

        if (Sentinel(json, "$bigint") is { } big)
        {
          return BigInteger.Parse(big.GetValue<string>(), CultureInfo.InvariantCulture);
        }

        if (Sentinel(json, "$u8") is { } bytes)
        {
          return Convert.FromBase64String(bytes.GetValue<string>());
        }

        var members = new AnyObject();

        foreach (var pair in json)
        {
          members.Add(pair.Key, ToEngineValue(pair.Value));
        }

        return members;

      case JsonArray array:
        var items = new AnyArray();

        foreach (var item in array)
        {
          items.Add(ToEngineValue(item));
        }

        return items;

      case JsonValue value:
        if (value.TryGetValue(out bool flag))
        {
          return flag;
        }

        return value.TryGetValue(out string? text) ? text : value.GetValue<double>();

      default:
        throw new InvalidDataException($"any.json holds {node.ToJsonString()}");
    }
  }

  private static JsonNode? ToFixtureJson(object? value)
  {
    switch (value)
    {
      case null:
        return null;

      case YUndefined:
        return new JsonObject { ["$undefined"] = true };

      case bool flag:
        return JsonValue.Create(flag);

      case string text:
        return JsonValue.Create(text);

      case double number:
        return NumberToFixtureJson(number);

      case BigInteger big:
        return new JsonObject { ["$bigint"] = big.ToString(CultureInfo.InvariantCulture) };

      case byte[] bytes:
        return new JsonObject { ["$u8"] = Convert.ToBase64String(bytes) };

      case AnyObject members:
        var json = new JsonObject();

        foreach (var pair in members)
        {
          json[pair.Key] = ToFixtureJson(pair.Value);
        }

        return json;

      case AnyArray items:
        var array = new JsonArray();

        foreach (var item in items)
        {
          array.Add(ToFixtureJson(item));
        }

        return array;

      default:
        throw new InvalidDataException($"{value.GetType()} is not an Any value");
    }
  }

  private static JsonNode NumberToFixtureJson(double number)
  {
    if (double.IsNaN(number))
    {
      return new JsonObject { ["$num"] = "NaN" };
    }

    if (double.IsInfinity(number))
    {
      return new JsonObject { ["$num"] = number > 0 ? "Infinity" : "-Infinity" };
    }

    // -0 and 0 canonicalize to the same JSON number, so it needs the sentinel.
    return number == 0 && double.IsNegative(number)
        ? new JsonObject { ["$num"] = "-0" }
        : JsonValue.Create(number);
  }

  private static JsonValue? Sentinel(JsonObject json, string key)
  {
    return json.Count == 1 && json.TryGetPropertyValue(key, out var value)
        ? value as JsonValue
        : null;
  }
}
