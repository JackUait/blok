using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace Blok.Server.Yjs;

/// <summary>
/// lib0's decoder over a borrowed span: varuint (LEB128, low 7 bits first,
/// high bit = continuation), varint (sign in bit 0x40 of the first byte),
/// varstring, varuint8array and big-endian floats. Every malformed or
/// truncated input raises <see cref="Lib0FormatException"/>, so a decoder
/// above never has to distinguish a bug from hostile bytes.
/// </summary>
internal ref struct Lib0Reader
{
  /// <summary>lib0 refuses a varuint above Number.MAX_SAFE_INTEGER.</summary>
  private const ulong MaxSafeInteger = 9007199254740991UL;

  // 2^53-1 needs 8 varuint bytes (8 * 7 = 56 bits) and 8 varint bytes
  // (6 + 7 * 7 = 55). A ninth byte can only carry an out-of-range value or
  // zero padding, which no lib0 encoder writes.
  private const int MaxVarUintBytes = 8;
  private const int MaxVarIntBytes = 8;

  private static readonly UTF8Encoding StrictUtf8 = new(
      encoderShouldEmitUTF8Identifier: false,
      throwOnInvalidBytes: true);

  private readonly ReadOnlySpan<byte> data;

  public Lib0Reader(ReadOnlySpan<byte> data)
  {
    this.data = data;
    Position = 0;
  }

  public int Position { get; private set; }

  public readonly bool AtEnd => Position >= data.Length;

  public readonly int Length => data.Length;

  public byte ReadUint8()
  {
    return Take(1)[0];
  }

  public ulong ReadVarUint()
  {
    ulong value = 0;
    var shift = 0;

    for (var read = 0; read < MaxVarUintBytes; read++)
    {
      var current = ReadUint8();

      value |= (ulong)(current & 0x7F) << shift;

      if ((current & 0x80) == 0)
      {
        return value <= MaxSafeInteger
            ? value
            : throw new Lib0FormatException(
                $"lib0: the varuint at {Position} is above 2^53-1.");
      }

      shift += 7;
    }

    throw new Lib0FormatException(
        $"lib0: the varuint at {Position} is above 2^53-1.");
  }

  /// <summary>
  /// Returns a double, not a long: lib0 writes JavaScript numbers, and the
  /// first byte's 0x40 over a zero magnitude is negative zero, which only a
  /// double can carry back.
  /// </summary>
  public double ReadVarInt()
  {
    var first = ReadUint8();
    var value = (ulong)(first & 0x3F);
    var negative = (first & 0x40) != 0;
    var shift = 6;

    if ((first & 0x80) != 0)
    {
      var read = 1;

      while (true)
      {
        if (read >= MaxVarIntBytes)
        {
          throw new Lib0FormatException(
              $"lib0: the varint at {Position} is above 2^53-1.");
        }

        var current = ReadUint8();

        value |= (ulong)(current & 0x7F) << shift;
        shift += 7;
        read++;

        if ((current & 0x80) == 0)
        {
          break;
        }
      }
    }

    if (value > MaxSafeInteger)
    {
      throw new Lib0FormatException(
          $"lib0: the varint at {Position} is above 2^53-1.");
    }

    return negative ? -(double)value : value;
  }

  public string ReadVarString()
  {
    var bytes = ReadVarBytes();

    try
    {
      return StrictUtf8.GetString(bytes);
    }
    catch (DecoderFallbackException invalid)
    {
      throw new Lib0FormatException(
          $"lib0: the varstring ending at {Position} is not UTF-8: {invalid.Message}");
    }
  }

  public ReadOnlySpan<byte> ReadVarBytes()
  {
    var length = ReadVarUint();

    if (length > (ulong)(data.Length - Position))
    {
      throw new Lib0FormatException(
          $"lib0: {length} bytes were announced at {Position}, " +
          $"{data.Length - Position} remain.");
    }

    return Take((int)length);
  }

  public float ReadFloat32BigEndian()
  {
    return BinaryPrimitives.ReadSingleBigEndian(Take(4));
  }

  public double ReadFloat64BigEndian()
  {
    return BinaryPrimitives.ReadDoubleBigEndian(Take(8));
  }

  public BigInteger ReadBigInt64BigEndian()
  {
    return new BigInteger(BinaryPrimitives.ReadInt64BigEndian(Take(8)));
  }

  private ReadOnlySpan<byte> Take(int count)
  {
    if (count > data.Length - Position)
    {
      throw new Lib0FormatException(
          $"lib0: {count} bytes were read at {Position}, " +
          $"{data.Length - Position} remain.");
    }

    var slice = data.Slice(Position, count);

    Position += count;

    return slice;
  }
}
