using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The lib0 primitives against goldens real lib0 wrote (varint.json), plus the
/// edges a golden cannot carry: a value past lib0's 2^53 ceiling, truncated
/// and invalid input, and negative zero.
/// </summary>
public sealed class Lib0CodecTests
{
  public static TheoryData<int> VarUintCases()
  {
    return Indices("varuint");
  }

  public static TheoryData<int> VarIntCases()
  {
    return Indices("varint");
  }

  [Theory]
  [MemberData(nameof(VarUintCases))]
  public void ReadsEveryVarUintGolden(int index)
  {
    var (value, bytes) = Golden("varuint", index);
    var reader = new Lib0Reader(bytes);

    Assert.Equal(value!.GetValue<ulong>(), reader.ReadVarUint());
    Assert.True(reader.AtEnd, $"varuint[{index}] left {reader.Length - reader.Position} bytes unread");
  }

  [Theory]
  [MemberData(nameof(VarUintCases))]
  public void WritesEveryVarUintGolden(int index)
  {
    var (value, bytes) = Golden("varuint", index);
    var writer = new Lib0Writer();

    writer.WriteVarUint(value!.GetValue<ulong>());

    Assert.Equal(bytes, writer.ToArray());
  }

  [Theory]
  [MemberData(nameof(VarIntCases))]
  public void ReadsEveryVarIntGolden(int index)
  {
    var (value, bytes) = Golden("varint", index);
    var reader = new Lib0Reader(bytes);

    AssertSameDouble(ExpectedVarInt(value), reader.ReadVarInt());
    Assert.True(reader.AtEnd, $"varint[{index}] left {reader.Length - reader.Position} bytes unread");
  }

  [Theory]
  [MemberData(nameof(VarIntCases))]
  public void WritesEveryVarIntGolden(int index)
  {
    var (value, bytes) = Golden("varint", index);
    var writer = new Lib0Writer();

    writer.WriteVarInt(ExpectedVarInt(value));

    Assert.Equal(bytes, writer.ToArray());
  }

  [Fact]
  public void RejectsVarUintPast2Pow53()
  {
    // 2^53, one past lib0's ceiling: seven empty groups then 16 << 49.
    byte[] tooLarge = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10];

    Assert.Throws<Lib0FormatException>(() =>
    {
      var reader = new Lib0Reader(tooLarge);

      _ = reader.ReadVarUint();
    });
  }

  [Fact]
  public void RejectsTruncatedVarString()
  {
    // Length five, two bytes of payload.
    byte[] truncated = [0x05, 0x61, 0x62];

    Assert.Throws<Lib0FormatException>(() =>
    {
      var reader = new Lib0Reader(truncated);

      _ = reader.ReadVarString();
    });
  }

  [Fact]
  public void RejectsInvalidUtf8()
  {
    // 0xC3 starts a two-byte sequence; 0x28 is not a continuation byte.
    byte[] invalid = [0x02, 0xC3, 0x28];

    Assert.Throws<Lib0FormatException>(() =>
    {
      var reader = new Lib0Reader(invalid);

      _ = reader.ReadVarString();
    });
  }

  [Fact]
  public void RoundTripsANulBearingString()
  {
    const string WithNul = "a\0b";
    var writer = new Lib0Writer();

    writer.WriteVarString(WithNul);

    var bytes = writer.ToArray();

    Assert.Equal(new byte[] { 0x03, 0x61, 0x00, 0x62 }, bytes);

    var reader = new Lib0Reader(bytes);

    Assert.Equal(WithNul, reader.ReadVarString());
  }

  /// <summary>
  /// lib0 encodes through TextEncoder, which substitutes U+FFFD for an
  /// unpaired surrogate rather than refusing the string. Refusing it here made
  /// a diff throw whenever a peer's state vector landed in the middle of an
  /// astral character — and the exception was not one the sync answer catches.
  /// </summary>
  [Fact]
  public void WritesALoneSurrogateAsTheReplacementCharacter()
  {
    var writer = new Lib0Writer();

    writer.WriteVarString("\ud800");

    Assert.Equal(new byte[] { 0x03, 0xEF, 0xBF, 0xBD }, writer.ToArray());
  }

  [Fact]
  public void ReadsFloatsBigEndian()
  {
    byte[] bytes =
    [
      0x3F, 0x00, 0x00, 0x00,
      0x3F, 0xB9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9A,
      0xFF, 0xDF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    ];
    var reader = new Lib0Reader(bytes);

    Assert.Equal(0.5f, reader.ReadFloat32BigEndian());
    Assert.Equal(0.1d, reader.ReadFloat64BigEndian());
    Assert.Equal(new BigInteger(-9007199254740993L), reader.ReadBigInt64BigEndian());
    Assert.True(reader.AtEnd);
  }

  [Fact]
  public void NegativeZeroRoundTrips()
  {
    var writer = new Lib0Writer();

    writer.WriteVarInt(-0d);

    var bytes = writer.ToArray();

    // The sign lives in bit 0x40 of the first byte; the magnitude is zero.
    Assert.Equal(new byte[] { 0x40 }, bytes);

    var reader = new Lib0Reader(bytes);

    AssertSameDouble(-0d, reader.ReadVarInt());
  }

  /// <summary>Bit-exact, because -0.0 == 0.0 in every ordinary comparison.</summary>
  private static void AssertSameDouble(double expected, double actual)
  {
    Assert.Equal(
        BitConverter.DoubleToInt64Bits(expected),
        BitConverter.DoubleToInt64Bits(actual));
  }

  private static double ExpectedVarInt(JsonNode? value)
  {
    // varint.json carries negative zero as the {"$num":"-0"} sentinel.
    return value is JsonObject sentinel
        ? sentinel["$num"]!.GetValue<string>() == "-0"
            ? -0d
            : throw new InvalidDataException($"varint.json holds {sentinel.ToJsonString()}")
        : value!.GetValue<double>();
  }

  private static TheoryData<int> Indices(string section)
  {
    return new TheoryData<int>(Enumerable.Range(0, Section(section).Count));
  }

  private static (JsonNode? Value, byte[] Bytes) Golden(string section, int index)
  {
    var entry = Section(section)[index]!;

    return (entry["value"], Convert.FromBase64String(entry["bytes"]!.GetValue<string>()));
  }

  private static JsonArray Section(string section)
  {
    return YjsEngineFixtures.ReadJson("varint.json")[section]?.AsArray() ??
        throw new InvalidDataException($"varint.json has no {section} array");
  }
}
