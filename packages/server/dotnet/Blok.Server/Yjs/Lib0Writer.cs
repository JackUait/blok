using System.Buffers;
using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace Blok.Server.Yjs;

/// <summary>
/// lib0's encoder, byte-for-byte: varuint (LEB128), varint (sign in bit 0x40
/// of the first byte), varstring, varuint8array and big-endian floats.
/// </summary>
internal sealed class Lib0Writer
{
  /// <summary>lib0 never writes a number above Number.MAX_SAFE_INTEGER.</summary>
  private const double MaxSafeInteger = 9007199254740991d;

  private static readonly UTF8Encoding StrictUtf8 = new(
      encoderShouldEmitUTF8Identifier: false,
      throwOnInvalidBytes: true);

  private readonly ArrayBufferWriter<byte> buffer = new();

  public void WriteUint8(byte value)
  {
    buffer.GetSpan(1)[0] = value;
    buffer.Advance(1);
  }

  public void WriteVarUint(ulong value)
  {
    while (value > 0x7F)
    {
      WriteUint8((byte)(0x80 | (value & 0x7F)));
      value >>= 7;
    }

    WriteUint8((byte)value);
  }

  /// <summary>
  /// Takes a double because lib0 writes JavaScript numbers: negative zero is
  /// a distinct input and writes 0x40, which no integral type can express.
  /// </summary>
  public void WriteVarInt(double integral)
  {
    if (!double.IsInteger(integral) || Math.Abs(integral) > MaxSafeInteger)
    {
      throw new ArgumentOutOfRangeException(
          nameof(integral),
          integral,
          "lib0: a varint is an integer no larger than 2^53-1.");
    }

    // IsNegative is lib0's isNegativeZero: the sign bit, so -0 counts.
    var negative = double.IsNegative(integral);
    var magnitude = (ulong)Math.Abs(integral);

    WriteUint8((byte)(
        (magnitude > 0x3F ? 0x80 : 0) |
        (negative ? 0x40 : 0) |
        (byte)(magnitude & 0x3F)));
    magnitude >>= 6;

    while (magnitude > 0)
    {
      WriteUint8((byte)((magnitude > 0x7F ? 0x80 : 0) | (byte)(magnitude & 0x7F)));
      magnitude >>= 7;
    }
  }

  public void WriteVarString(string value)
  {
    ArgumentNullException.ThrowIfNull(value);

    var length = StrictUtf8.GetByteCount(value);

    WriteVarUint((ulong)length);
    StrictUtf8.GetBytes(value, buffer.GetSpan(length));
    buffer.Advance(length);
  }

  public void WriteVarBytes(ReadOnlySpan<byte> value)
  {
    WriteVarUint((ulong)value.Length);
    value.CopyTo(buffer.GetSpan(value.Length));
    buffer.Advance(value.Length);
  }

  public void WriteFloat32BigEndian(float value)
  {
    BinaryPrimitives.WriteSingleBigEndian(buffer.GetSpan(4), value);
    buffer.Advance(4);
  }

  public void WriteFloat64BigEndian(double value)
  {
    BinaryPrimitives.WriteDoubleBigEndian(buffer.GetSpan(8), value);
    buffer.Advance(8);
  }

  public void WriteBigInt64BigEndian(BigInteger value)
  {
    BinaryPrimitives.WriteInt64BigEndian(buffer.GetSpan(8), (long)value);
    buffer.Advance(8);
  }

  public byte[] ToArray()
  {
    return buffer.WrittenSpan.ToArray();
  }
}
