using System.Buffers;
using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;

namespace Blok.Server.Collab;

/// <summary>One y-protocols message as carried by one WebSocket frame.</summary>
internal abstract record SyncWireMessage;

internal sealed record SyncStep1Frame(byte[] StateVector) : SyncWireMessage;

internal sealed record SyncStep2Frame(byte[] Update) : SyncWireMessage;

internal sealed record SyncUpdateFrame(byte[] Update) : SyncWireMessage;

/// <summary>Awareness update, relayed verbatim (never parsed server-side).</summary>
internal sealed record AwarenessFrame(byte[] Update) : SyncWireMessage;

internal sealed record QueryAwarenessFrame : SyncWireMessage;

internal sealed record PermissionDeniedFrame(string Reason) : SyncWireMessage;

/// <summary>Blok-only working-set announcement: epoch, format and lineage (plan decision 6).</summary>
internal sealed record BlokControlFrame(CollabWorkingSetTag Tag) : SyncWireMessage;

/// <summary>A message type this codec does not know; the payload is left unread.</summary>
internal sealed record UnknownFrame(ulong MessageType) : SyncWireMessage;

/// <summary>
/// y-protocols framing as y-websocket puts it on the wire, one message per
/// frame. Integers are lib0 varuints (LEB128, low 7 bits first, high bit =
/// continuation); byte arrays and strings are a varuint length + raw bytes.
/// <code>
///   sync            [0][0|1|2][len][state vector | update]
///   awareness       [1][len][awareness update]
///   auth            [2][0][len][utf8 reason]
///   queryAwareness  [3]
///   blok control    [100][len]{"epoch":N,"format":N,"lineage":"<32 hex>"}
/// </code>
/// Pinned byte-for-byte by test/unit/server-conformance/fixtures/sync-frames.json.
/// </summary>
internal static class SyncWire
{
  internal const ulong MessageSync = 0;
  internal const ulong MessageAwareness = 1;
  internal const ulong MessageAuth = 2;
  internal const ulong MessageQueryAwareness = 3;
  internal const ulong MessageBlokControl = 100;

  private const ulong SyncStep1 = 0;
  private const ulong SyncStep2 = 1;
  private const ulong SyncUpdate = 2;
  private const ulong AuthPermissionDenied = 0;

  // lib0 varuints are unbounded; 64 bits is ten LEB128 bytes.
  private const int MaxVarUintBytes = 10;

  private static readonly UTF8Encoding StrictUtf8 = new(
      encoderShouldEmitUTF8Identifier: false,
      throwOnInvalidBytes: true);

  internal static byte[] Encode(SyncWireMessage message)
  {
    ArgumentNullException.ThrowIfNull(message);

    var writer = new ArrayBufferWriter<byte>();

    switch (message)
    {
      case SyncStep1Frame step1:
        WriteSync(writer, SyncStep1, step1.StateVector);
        break;
      case SyncStep2Frame step2:
        WriteSync(writer, SyncStep2, step2.Update);
        break;
      case SyncUpdateFrame update:
        WriteSync(writer, SyncUpdate, update.Update);
        break;
      case AwarenessFrame awareness:
        WriteVarUint(writer, MessageAwareness);
        WriteVarBytes(writer, RequirePayload(awareness.Update));
        break;
      case QueryAwarenessFrame:
        WriteVarUint(writer, MessageQueryAwareness);
        break;
      case PermissionDeniedFrame denied:
        WriteVarUint(writer, MessageAuth);
        WriteVarUint(writer, AuthPermissionDenied);
        WriteVarBytes(writer, Encoding.UTF8.GetBytes(denied.Reason));
        break;
      case BlokControlFrame control:
        WriteVarUint(writer, MessageBlokControl);
        WriteVarBytes(writer, EncodeControl(control.Tag));
        break;
      default:
        throw new ArgumentException(
            $"collab: {message.GetType().Name} cannot be put on the wire.",
            nameof(message));
    }

    return writer.WrittenSpan.ToArray();
  }

  internal static bool TryDecode(
      ReadOnlySpan<byte> frame,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error)
  {
    message = null;

    if (!TryReadVarUint(ref frame, out var type))
    {
      error = "the message type is missing or malformed";

      return false;
    }

    switch (type)
    {
      case MessageSync:
        return TryDecodeSync(frame, out message, out error);
      case MessageAwareness:
        if (!TryReadPayload(ref frame, out var update, out error))
        {
          return false;
        }

        message = new AwarenessFrame(update);
        break;
      case MessageAuth:
        return TryDecodeAuth(frame, out message, out error);
      case MessageQueryAwareness:
        message = new QueryAwarenessFrame();
        break;
      case MessageBlokControl:
        if (!TryReadVarBytes(ref frame, out var json))
        {
          error = "the control payload is missing or truncated";

          return false;
        }

        if (!TryDecodeControl(json, out var tag, out error))
        {
          return false;
        }

        message = new BlokControlFrame(tag);
        break;
      default:
        message = new UnknownFrame(type);
        error = "";

        return true;
    }

    return RequireEnd(frame, out error);
  }

  internal static bool TryReadVarUint(ref ReadOnlySpan<byte> input, out ulong value)
  {
    value = 0;

    for (var index = 0; index < MaxVarUintBytes && index < input.Length; index++)
    {
      var current = input[index];
      var bits = (ulong)(current & 0x7f);

      // The tenth byte may only carry the top bit of a 64-bit value.
      if (index == MaxVarUintBytes - 1 && bits > 1)
      {
        return false;
      }

      value |= bits << (7 * index);

      if ((current & 0x80) == 0)
      {
        input = input[(index + 1)..];

        return true;
      }
    }

    return false;
  }

  internal static bool TryReadVarBytes(
      ref ReadOnlySpan<byte> input,
      out ReadOnlySpan<byte> bytes)
  {
    bytes = default;
    var remaining = input;

    if (!TryReadVarUint(ref remaining, out var length) ||
        length > (ulong)remaining.Length)
    {
      return false;
    }

    bytes = remaining[..(int)length];
    input = remaining[(int)length..];

    return true;
  }

  private static bool TryDecodeSync(
      ReadOnlySpan<byte> input,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error)
  {
    message = null;

    if (!TryReadVarUint(ref input, out var subType))
    {
      error = "the sync sub-type is missing or malformed";

      return false;
    }

    if (subType > SyncUpdate)
    {
      error = $"unknown sync sub-type {subType}";

      return false;
    }

    if (!TryReadPayload(ref input, out var payload, out error))
    {
      return false;
    }

    message = subType switch
    {
      SyncStep1 => new SyncStep1Frame(payload),
      SyncStep2 => new SyncStep2Frame(payload),
      _ => new SyncUpdateFrame(payload),
    };

    return RequireEnd(input, out error);
  }

  private static bool TryDecodeAuth(
      ReadOnlySpan<byte> input,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error)
  {
    message = null;

    if (!TryReadVarUint(ref input, out var subType))
    {
      error = "the auth sub-type is missing or malformed";

      return false;
    }

    if (subType != AuthPermissionDenied)
    {
      error = $"unknown auth sub-type {subType}";

      return false;
    }

    if (!TryReadVarBytes(ref input, out var reasonBytes))
    {
      error = "the auth reason is missing or truncated";

      return false;
    }

    try
    {
      message = new PermissionDeniedFrame(StrictUtf8.GetString(reasonBytes));
    }
    catch (DecoderFallbackException)
    {
      error = "the auth reason is not valid UTF-8";

      return false;
    }

    return RequireEnd(input, out error);
  }

  private static bool TryReadPayload(
      ref ReadOnlySpan<byte> input,
      out byte[] payload,
      out string error)
  {
    payload = [];

    if (!TryReadVarBytes(ref input, out var bytes))
    {
      error = "the payload is missing or truncated";

      return false;
    }

    if (bytes.IsEmpty)
    {
      error = "the payload is empty";

      return false;
    }

    payload = bytes.ToArray();
    error = "";

    return true;
  }

  private static bool RequireEnd(ReadOnlySpan<byte> input, out string error)
  {
    error = input.IsEmpty ? "" : $"{input.Length} trailing byte(s) after the message";

    return input.IsEmpty;
  }

  private static void WriteSync(
      ArrayBufferWriter<byte> writer,
      ulong subType,
      byte[] payload)
  {
    WriteVarUint(writer, MessageSync);
    WriteVarUint(writer, subType);
    WriteVarBytes(writer, RequirePayload(payload));
  }

  private static byte[] RequirePayload(byte[] payload)
  {
    ArgumentNullException.ThrowIfNull(payload);

    if (payload.Length == 0)
    {
      throw new ArgumentException("collab: sync payloads must not be empty.", nameof(payload));
    }

    return payload;
  }

  private static void WriteVarUint(ArrayBufferWriter<byte> writer, ulong value)
  {
    do
    {
      var current = (byte)(value & 0x7f);
      value >>= 7;

      if (value != 0)
      {
        current |= 0x80;
      }

      writer.GetSpan(1)[0] = current;
      writer.Advance(1);
    }
    while (value != 0);
  }

  private static void WriteVarBytes(ArrayBufferWriter<byte> writer, ReadOnlySpan<byte> bytes)
  {
    WriteVarUint(writer, (ulong)bytes.Length);
    writer.Write(bytes);
  }

  private static byte[] EncodeControl(CollabWorkingSetTag tag)
  {
    if (!tag.IsAnnounceable())
    {
      throw new ArgumentException(
          $"collab: the tag {tag} is not encodable.",
          nameof(tag));
    }

    var buffer = new ArrayBufferWriter<byte>();

    // Key order matters: the client writes {epoch, format, lineage} and the
    // fixture pins the bytes.
    using (var json = new Utf8JsonWriter(buffer))
    {
      json.WriteStartObject();
      json.WriteNumber("epoch", tag.Epoch);
      json.WriteNumber("format", tag.Format);
      json.WriteString("lineage", tag.Lineage);
      json.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  private static bool TryDecodeControl(
      ReadOnlySpan<byte> json,
      out CollabWorkingSetTag tag,
      out string error)
  {
    tag = default;
    long? epoch = null;
    int? format = null;
    string? lineage = null;

    try
    {
      var reader = new Utf8JsonReader(json);

      if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
      {
        error = "the control payload is not a JSON object";

        return false;
      }

      while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
      {
        var isEpoch = reader.ValueTextEquals("epoch"u8);
        var isFormat = reader.ValueTextEquals("format"u8);
        var isLineage = reader.ValueTextEquals("lineage"u8);

        if (!reader.Read())
        {
          error = "a control property has no value";

          return false;
        }

        if (isEpoch && epoch is null &&
            reader.TokenType == JsonTokenType.Number &&
            reader.TryGetInt64(out var epochValue))
        {
          epoch = epochValue;
        }
        else if (isFormat && format is null &&
            reader.TokenType == JsonTokenType.Number &&
            reader.TryGetInt32(out var formatValue))
        {
          format = formatValue;
        }
        else if (isLineage && lineage is null &&
            reader.TokenType == JsonTokenType.String)
        {
          lineage = reader.GetString();
        }
        else
        {
          error = "the control payload has an unknown, repeated or ill-typed property";

          return false;
        }
      }

      if (reader.TokenType != JsonTokenType.EndObject || reader.Read())
      {
        error = "the control payload has trailing content";

        return false;
      }
    }
    catch (JsonException)
    {
      error = "the control payload is not valid JSON";

      return false;
    }

    if (epoch is null || format is null || lineage is null)
    {
      error = "the control payload needs epoch, format and lineage";

      return false;
    }

    tag = new CollabWorkingSetTag(format.Value, epoch.Value, lineage);

    if (!tag.IsAnnounceable())
    {
      tag = default;
      error = "the control payload needs format >= 1, epoch >= 0 and a 32-hex lineage";

      return false;
    }

    error = "";

    return true;
  }
}
