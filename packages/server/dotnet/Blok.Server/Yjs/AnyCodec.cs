using System.Numerics;
using System.Runtime.CompilerServices;

namespace Blok.Server.Yjs;

/// <summary>
/// lib0's <c>writeAny</c> / <c>readAny</c>: one tag byte, then the payload.
/// Values are plain CLR objects — string, bool, double (every JS number, so
/// -0 survives), BigInteger, byte[], <see cref="AnyObject"/>,
/// <see cref="AnyArray"/>, null and <see cref="YUndefined"/>.
/// </summary>
internal static class AnyCodec
{
  /// <summary>
  /// Stack guard, not policy: the codec recurses once per level. The room's
  /// own limit is the inspector's, and is far lower. 4096 frames do not fit
  /// in a default 1 MB thread stack, so every level also probes the stack and
  /// refuses before it would abort the process.
  /// </summary>
  internal const int MaxDepth = 4096;

  private const byte TagUint8Array = 116;
  private const byte TagArray = 117;
  private const byte TagObject = 118;
  private const byte TagString = 119;
  private const byte TagTrue = 120;
  private const byte TagFalse = 121;
  private const byte TagBigInt = 122;
  private const byte TagFloat64 = 123;
  private const byte TagFloat32 = 124;
  private const byte TagInteger = 125;
  private const byte TagNull = 126;
  private const byte TagUndefined = 127;

  /// <summary>Tag 125 covers integers up to this magnitude; larger ones are floats.</summary>
  private const double MaxTaggedInteger = 0x7FFFFFFF;

  // JavaScript's NaN is 0x7FF8...; .NET's double.NaN sets the sign bit too, so
  // writing it raw would emit bytes no yjs peer ever writes.
  private const long JavaScriptNaNBits = 0x7FF8000000000000L;

  public static object? Read(ref Lib0Reader reader, int depth = 0)
  {
    var tag = reader.ReadUint8();

    return tag switch
    {
      TagUndefined => (object?)YUndefined.Instance,
      TagNull => null,
      TagInteger => reader.ReadVarInt(),
      TagFloat32 => (double)reader.ReadFloat32BigEndian(),
      TagFloat64 => reader.ReadFloat64BigEndian(),
      TagBigInt => reader.ReadBigInt64BigEndian(),
      TagFalse => false,
      TagTrue => true,
      TagString => reader.ReadVarString(),
      TagObject => ReadObject(ref reader, depth),
      TagArray => ReadArray(ref reader, depth),
      TagUint8Array => reader.ReadVarBytes().ToArray(),
      _ => throw new Lib0FormatException(
          $"lib0: {tag} at {reader.Position - 1} is not an Any tag."),
    };
  }

  public static void Write(Lib0Writer writer, object? value)
  {
    ArgumentNullException.ThrowIfNull(writer);

    if (!RuntimeHelpers.TryEnsureSufficientExecutionStack())
    {
      throw new Lib0FormatException(
          "lib0: the Any value nests deeper than the stack allows.");
    }

    switch (value)
    {
      case null:
        writer.WriteUint8(TagNull);
        break;

      case string text:
        writer.WriteUint8(TagString);
        writer.WriteVarString(text);
        break;

      case bool flag:
        writer.WriteUint8(flag ? TagTrue : TagFalse);
        break;

      case double number:
        WriteNumber(writer, number);
        break;

      case BigInteger big:
        writer.WriteUint8(TagBigInt);
        writer.WriteBigInt64BigEndian(big);
        break;

      case byte[] bytes:
        writer.WriteUint8(TagUint8Array);
        writer.WriteVarBytes(bytes);
        break;

      case AnyObject members:
        writer.WriteUint8(TagObject);
        writer.WriteVarUint((ulong)members.Count);

        foreach (var pair in members)
        {
          writer.WriteVarString(pair.Key);
          Write(writer, pair.Value);
        }

        break;

      case AnyArray items:
        writer.WriteUint8(TagArray);
        writer.WriteVarUint((ulong)items.Count);

        foreach (var item in items)
        {
          Write(writer, item);
        }

        break;

      case YUndefined:
        writer.WriteUint8(TagUndefined);
        break;

      default:
        throw new ArgumentException(
            $"lib0: {value.GetType()} is not an Any value.",
            nameof(value));
    }
  }

  /// <summary>lib0's writeAny dispatch: integer, else float32 if it round-trips, else float64.</summary>
  private static void WriteNumber(Lib0Writer writer, double number)
  {
    if (double.IsNaN(number))
    {
      writer.WriteUint8(TagFloat64);
      writer.WriteFloat64BigEndian(BitConverter.Int64BitsToDouble(JavaScriptNaNBits));

      return;
    }

    if (double.IsInteger(number) && Math.Abs(number) <= MaxTaggedInteger)
    {
      writer.WriteUint8(TagInteger);
      writer.WriteVarInt(number);

      return;
    }

    // Infinity round-trips through float32, so it lands here, as in lib0.
    if ((double)(float)number == number)
    {
      writer.WriteUint8(TagFloat32);
      writer.WriteFloat32BigEndian((float)number);

      return;
    }

    writer.WriteUint8(TagFloat64);
    writer.WriteFloat64BigEndian(number);
  }

  private static AnyObject ReadObject(ref Lib0Reader reader, int depth)
  {
    var count = reader.ReadVarUint();
    var members = new AnyObject();

    for (ulong index = 0; index < count; index++)
    {
      var key = reader.ReadVarString();

      members.Add(key, ReadNested(ref reader, depth));
    }

    return members;
  }

  private static AnyArray ReadArray(ref Lib0Reader reader, int depth)
  {
    var count = reader.ReadVarUint();
    var items = new AnyArray();

    for (ulong index = 0; index < count; index++)
    {
      items.Add(ReadNested(ref reader, depth));
    }

    return items;
  }

  private static object? ReadNested(ref Lib0Reader reader, int depth)
  {
    if (depth >= MaxDepth)
    {
      throw new Lib0FormatException(
          $"lib0: the Any value at {reader.Position} nests past {MaxDepth} levels.");
    }

    if (!RuntimeHelpers.TryEnsureSufficientExecutionStack())
    {
      throw new Lib0FormatException(
          $"lib0: the Any value at {reader.Position} nests deeper than the stack allows.");
    }

    return Read(ref reader, depth + 1);
  }
}
