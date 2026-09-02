using System.Buffers;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
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

/// <summary>
/// Blok-only limits announcement: the message cap in bytes, sent right after
/// the control frame so a client can refuse an oversized frame before writing
/// it. Stock clients skip the unknown type (Phase 4 A1).
/// </summary>
internal sealed record BlokLimitsFrame(long MaxMessageBytes) : SyncWireMessage;

/// <summary>
/// Client-submitted operation: a Yjs update the server must journal before it
/// acknowledges it (blok-sync.v2 3.1). Lineage and OperationId are 32
/// lowercase-hex ids.
/// </summary>
internal sealed record OperationFrame(string Lineage, string OperationId, byte[] Update) : SyncWireMessage;

/// <summary>
/// Durable commit receipt: Lineage/OperationId are journaled at ServerSequence
/// (blok-sync.v2 3.2). ServerSequence is at least 1 — 0 means nothing has been
/// committed on the lineage yet, which an acknowledgement can never mean.
/// </summary>
internal sealed record AcknowledgementFrame(
    string Lineage,
    string OperationId,
    ulong ServerSequence) : SyncWireMessage;

/// <summary>
/// Operation refusal (blok-sync.v2 3.3, section 6). Code is an open set: the
/// six stable codes are not a closed enum, so this stays a string.
/// </summary>
internal sealed record RejectionFrame(string Lineage, string OperationId, string Code) : SyncWireMessage;

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
///   blok limits     [101][len]{"maxMessageBytes":N}
///   operation       [102][len]{"lineage":"<32 hex>","operationId":"<32 hex>"}[len][update]
///   acknowledgement [103][len]{"lineage":"<32 hex>","operationId":"<32 hex>","serverSequence":"<u64>"}
///   rejection       [104][len]{"lineage":"<32 hex>","operationId":"<32 hex>","code":"<code>"}
/// </code>
/// Pinned byte-for-byte by test/unit/server-conformance/fixtures/sync-frames.json
/// and, for 102-104, by its <c>v2</c> section (packages/server/protocol/blok-sync-v2.md).
/// </summary>
internal static class SyncWire
{
  internal const ulong MessageSync = 0;
  internal const ulong MessageAwareness = 1;
  internal const ulong MessageAuth = 2;
  internal const ulong MessageQueryAwareness = 3;
  internal const ulong MessageBlokControl = 100;
  internal const ulong MessageBlokLimits = 101;
  internal const ulong MessageOperation = 102;
  internal const ulong MessageAcknowledgement = 103;
  internal const ulong MessageRejection = 104;

  /// <summary>Internal because the inbound budget classifies frames by it.</summary>
  internal const ulong SyncStep1 = 0;

  private const ulong SyncStep2 = 1;
  private const ulong SyncUpdate = 2;
  private const ulong AuthPermissionDenied = 0;

  // lib0 varuints are unbounded; 64 bits is ten LEB128 bytes.
  private const int MaxVarUintBytes = 10;

  // Room for the JSON metadata of every fixed-shape v2/v1 frame; a rejection
  // at the 64-char code ceiling tops out near 170 bytes.
  private const int JsonPayloadBytes = 192;

  // Rule 11's required key set per message type: a decoded object with any
  // other key set (missing, unknown, or a duplicate) is rejected.
  private static readonly HashSet<string> OperationKeys = ["lineage", "operationId"];
  private static readonly HashSet<string> AcknowledgementKeys = ["lineage", "operationId", "serverSequence"];
  private static readonly HashSet<string> RejectionKeys = ["lineage", "operationId", "code"];

  private static readonly UTF8Encoding StrictUtf8 = new(
      encoderShouldEmitUTF8Identifier: false,
      throwOnInvalidBytes: true);

  internal static byte[] Encode(SyncWireMessage message)
  {
    ArgumentNullException.ThrowIfNull(message);

    var writer = new ArrayBufferWriter<byte>(SizeHint(message));

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
      case BlokLimitsFrame limits:
        WriteVarUint(writer, MessageBlokLimits);
        WriteVarBytes(writer, EncodeLimits(limits.MaxMessageBytes));
        break;
      case OperationFrame operation:
        WriteVarUint(writer, MessageOperation);
        WriteVarBytes(writer, EncodeOperationMetadata(operation.Lineage, operation.OperationId));
        WriteVarBytes(writer, RequireUpdate(operation.Update));
        break;
      case AcknowledgementFrame acknowledgement:
        WriteVarUint(writer, MessageAcknowledgement);
        WriteVarBytes(writer, EncodeAcknowledgementMetadata(
            acknowledgement.Lineage, acknowledgement.OperationId, acknowledgement.ServerSequence));
        break;
      case RejectionFrame rejection:
        WriteVarUint(writer, MessageRejection);
        WriteVarBytes(writer, EncodeRejectionMetadata(rejection.Lineage, rejection.OperationId, rejection.Code));
        break;
      default:
        throw new ArgumentException(
            $"collab: {message.GetType().Name} cannot be put on the wire.",
            nameof(message));
    }

    return writer.WrittenSpan.ToArray();
  }

  /// <summary>
  /// Header varuints plus the payload, so a frame is written without the
  /// writer growing and copying a large update on the way.
  /// </summary>
  private static int SizeHint(SyncWireMessage message)
  {
    var payload = message switch
    {
      SyncStep1Frame step1 => step1.StateVector?.Length ?? 0,
      SyncStep2Frame step2 => step2.Update?.Length ?? 0,
      SyncUpdateFrame update => update.Update?.Length ?? 0,
      AwarenessFrame awareness => awareness.Update?.Length ?? 0,
      PermissionDeniedFrame denied => Encoding.UTF8.GetMaxByteCount(denied.Reason?.Length ?? 0),
      OperationFrame operation => JsonPayloadBytes + (operation.Update?.Length ?? 0),
      _ => JsonPayloadBytes,
    };

    return (3 * MaxVarUintBytes) + payload;
  }

  internal static bool TryDecode(
      ReadOnlySpan<byte> frame,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error)
  {
    return TryDecode(frame, out message, out error, out _);
  }

  /// <summary>
  /// Overload that also reports which blok-sync.v2 section-5 rule (1-12) a
  /// malformed v2 frame (type 102/103/104) violated, for conformance tests
  /// that assert the reason and not just the refusal. Always null for v1
  /// types (0-3, 100, 101), which this document does not add rules to.
  /// </summary>
  internal static bool TryDecode(
      ReadOnlySpan<byte> frame,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error,
      out int? rule)
  {
    message = null;
    rule = null;

    if (!TryReadVarUint(ref frame, out var type))
    {
      error = "the message type is missing or malformed";
      rule = 1;

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
      case MessageBlokLimits:
        if (!TryReadVarBytes(ref frame, out var limitsJson))
        {
          error = "the limits payload is missing or truncated";

          return false;
        }

        if (!TryDecodeLimits(limitsJson, out var maxMessageBytes, out error))
        {
          return false;
        }

        message = new BlokLimitsFrame(maxMessageBytes);
        break;
      case MessageOperation:
        return TryDecodeOperation(frame, out message, out error, out rule);
      case MessageAcknowledgement:
        return TryDecodeAcknowledgement(frame, out message, out error, out rule);
      case MessageRejection:
        return TryDecodeRejection(frame, out message, out error, out rule);
      default:
        message = new UnknownFrame(type);
        error = "";

        return true;
    }

    return RequireEnd(frame, out error);
  }

  /// <summary>
  /// The client-entry count from the head of an awareness payload
  /// (<c>[varuint clients]{[clientId][clock][varstring state]}*</c>), without
  /// decoding one entry: presence is relayed verbatim, never parsed
  /// (plan decision 11).
  /// </summary>
  internal static bool TryReadAwarenessClientCount(
      ReadOnlySpan<byte> update,
      out ulong clients)
  {
    return TryReadVarUint(ref update, out clients);
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

  /// <summary>
  /// Type 102: <c>varstring(metadata) varbytes(update)</c> (blok-sync.v2
  /// 3.1). Rules 1-5 (framing) are checked on the raw sections before the
  /// metadata bytes are ever interpreted as JSON, so a frame that breaks both
  /// a framing rule and a metadata rule (6-12) is attributed to the
  /// lower-numbered framing rule, per section 5's evaluation order.
  /// </summary>
  private static bool TryDecodeOperation(
      ReadOnlySpan<byte> input,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error,
      out int? rule)
  {
    message = null;

    var metadataRead = TryReadBoundedSection(ref input, out var metadataBytes);

    if (metadataRead == SectionRead.Missing)
    {
      rule = 3;
      error = "the operation metadata section is missing";

      return false;
    }

    if (metadataRead == SectionRead.Exceeds)
    {
      rule = 2;
      error = "the operation metadata length exceeds the remaining bytes";

      return false;
    }

    var updateRead = TryReadBoundedSection(ref input, out var updateBytes);

    if (updateRead == SectionRead.Missing)
    {
      rule = 3;
      error = "the operation update section is missing";

      return false;
    }

    if (updateRead == SectionRead.Exceeds)
    {
      rule = 2;
      error = "the operation update length exceeds the remaining bytes";

      return false;
    }

    if (updateBytes.IsEmpty)
    {
      rule = 4;
      error = "the operation update must not be empty";

      return false;
    }

    if (!input.IsEmpty)
    {
      rule = 5;
      error = $"{input.Length} trailing byte(s) after the operation frame";

      return false;
    }

    if (!TryDecodeOperationMetadata(metadataBytes, out var lineage, out var operationId, out rule, out error))
    {
      return false;
    }

    message = new OperationFrame(lineage, operationId, updateBytes.ToArray());

    return true;
  }

  /// <summary>Type 103: <c>varstring(metadata)</c> (blok-sync.v2 3.2). See <see cref="TryDecodeOperation"/> for the rule-order rationale.</summary>
  private static bool TryDecodeAcknowledgement(
      ReadOnlySpan<byte> input,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error,
      out int? rule)
  {
    message = null;

    var metadataRead = TryReadBoundedSection(ref input, out var metadataBytes);

    if (metadataRead == SectionRead.Missing)
    {
      rule = 3;
      error = "the acknowledgement metadata section is missing";

      return false;
    }

    if (metadataRead == SectionRead.Exceeds)
    {
      rule = 2;
      error = "the acknowledgement metadata length exceeds the remaining bytes";

      return false;
    }

    if (!input.IsEmpty)
    {
      rule = 5;
      error = $"{input.Length} trailing byte(s) after the acknowledgement frame";

      return false;
    }

    if (!TryDecodeAcknowledgementMetadata(
        metadataBytes, out var lineage, out var operationId, out var serverSequence, out rule, out error))
    {
      return false;
    }

    message = new AcknowledgementFrame(lineage, operationId, serverSequence);

    return true;
  }

  /// <summary>Type 104: <c>varstring(metadata)</c> (blok-sync.v2 3.3). See <see cref="TryDecodeOperation"/> for the rule-order rationale.</summary>
  private static bool TryDecodeRejection(
      ReadOnlySpan<byte> input,
      [MaybeNullWhen(false)] out SyncWireMessage message,
      out string error,
      out int? rule)
  {
    message = null;

    var metadataRead = TryReadBoundedSection(ref input, out var metadataBytes);

    if (metadataRead == SectionRead.Missing)
    {
      rule = 3;
      error = "the rejection metadata section is missing";

      return false;
    }

    if (metadataRead == SectionRead.Exceeds)
    {
      rule = 2;
      error = "the rejection metadata length exceeds the remaining bytes";

      return false;
    }

    if (!input.IsEmpty)
    {
      rule = 5;
      error = $"{input.Length} trailing byte(s) after the rejection frame";

      return false;
    }

    if (!TryDecodeRejectionMetadata(metadataBytes, out var lineage, out var operationId, out var code, out rule, out error))
    {
      return false;
    }

    message = new RejectionFrame(lineage, operationId, code);

    return true;
  }

  private enum SectionRead
  {
    Ok,
    Missing,
    Exceeds,
  }

  /// <summary>
  /// Reads one <c>varbytes</c> section, distinguishing "nothing left to read"
  /// (rule 3: a section missing entirely) from "a length prefix present but
  /// unreadable or larger than what remains" (rule 2). The bounds check
  /// happens before any slice, so a huge length prefix (e.g. the 2 GiB one on
  /// <c>operationHugeUpdateLength</c>) never allocates.
  /// </summary>
  private static SectionRead TryReadBoundedSection(ref ReadOnlySpan<byte> input, out ReadOnlySpan<byte> bytes)
  {
    bytes = default;

    if (input.IsEmpty)
    {
      return SectionRead.Missing;
    }

    var remaining = input;

    if (!TryReadVarUint(ref remaining, out var length) || length > (ulong)remaining.Length)
    {
      return SectionRead.Exceeds;
    }

    bytes = remaining[..(int)length];
    input = remaining[(int)length..];

    return SectionRead.Ok;
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

  private static byte[] RequireUpdate(byte[] update)
  {
    ArgumentNullException.ThrowIfNull(update);

    if (update.Length == 0)
    {
      throw new ArgumentException("collab: operation updates must not be empty.", nameof(update));
    }

    return update;
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

    var buffer = new ArrayBufferWriter<byte>(JsonPayloadBytes);

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

  private static byte[] EncodeLimits(long maxMessageBytes)
  {
    if (maxMessageBytes <= 0)
    {
      throw new ArgumentException(
          $"collab: the limit {maxMessageBytes} is not encodable.",
          nameof(maxMessageBytes));
    }

    var buffer = new ArrayBufferWriter<byte>(JsonPayloadBytes);

    using (var json = new Utf8JsonWriter(buffer))
    {
      json.WriteStartObject();
      json.WriteNumber("maxMessageBytes", maxMessageBytes);
      json.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  // Key order is an emitter rule only (blok-sync.v2 4.2): decoders validate
  // the key SET, never the order, so these three Encode*Metadata functions
  // are the only place the {lineage, operationId, ...} order is enforced.
  private static byte[] EncodeOperationMetadata(string lineage, string operationId)
  {
    RequireId(lineage, nameof(lineage));
    RequireId(operationId, nameof(operationId));

    var buffer = new ArrayBufferWriter<byte>(JsonPayloadBytes);

    using (var json = new Utf8JsonWriter(buffer))
    {
      json.WriteStartObject();
      json.WriteString("lineage", lineage);
      json.WriteString("operationId", operationId);
      json.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  private static byte[] EncodeAcknowledgementMetadata(string lineage, string operationId, ulong serverSequence)
  {
    RequireId(lineage, nameof(lineage));
    RequireId(operationId, nameof(operationId));

    // blok-sync.v2 4.1: 0 means "nothing committed on this lineage yet", a
    // value an acknowledgement can never carry (it always acknowledges a
    // committed operation).
    if (serverSequence == 0)
    {
      throw new ArgumentException(
          "collab: an acknowledgement cannot carry serverSequence 0.",
          nameof(serverSequence));
    }

    var buffer = new ArrayBufferWriter<byte>(JsonPayloadBytes);

    using (var json = new Utf8JsonWriter(buffer))
    {
      json.WriteStartObject();
      json.WriteString("lineage", lineage);
      json.WriteString("operationId", operationId);
      json.WriteString("serverSequence", serverSequence.ToString(CultureInfo.InvariantCulture));
      json.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  private static byte[] EncodeRejectionMetadata(string lineage, string operationId, string code)
  {
    RequireId(lineage, nameof(lineage));
    RequireId(operationId, nameof(operationId));

    if (!IsRejectionCode(code))
    {
      throw new ArgumentException($"collab: the rejection code {code} is not encodable.", nameof(code));
    }

    var buffer = new ArrayBufferWriter<byte>(JsonPayloadBytes);

    using (var json = new Utf8JsonWriter(buffer))
    {
      json.WriteStartObject();
      json.WriteString("lineage", lineage);
      json.WriteString("operationId", operationId);
      json.WriteString("code", code);
      json.WriteEndObject();
    }

    return buffer.WrittenSpan.ToArray();
  }

  private static void RequireId(string value, string paramName)
  {
    if (!CollabWorkingSetTag.IsLineage(value))
    {
      throw new ArgumentException($"collab: the id {value} is not 32 lowercase-hex characters.", paramName);
    }
  }

  private static bool TryDecodeLimits(
      ReadOnlySpan<byte> json,
      out long maxMessageBytes,
      out string error)
  {
    maxMessageBytes = 0;
    long? limit = null;

    try
    {
      var reader = new Utf8JsonReader(json);

      if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
      {
        error = "the limits payload is not a JSON object";

        return false;
      }

      while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
      {
        var isLimit = reader.ValueTextEquals("maxMessageBytes"u8);

        if (!reader.Read())
        {
          error = "a limits property has no value";

          return false;
        }

        if (isLimit && limit is null &&
            reader.TokenType == JsonTokenType.Number &&
            reader.TryGetInt64(out var value))
        {
          limit = value;
        }
        else
        {
          error = "the limits payload has an unknown, repeated or ill-typed property";

          return false;
        }
      }

      if (reader.TokenType != JsonTokenType.EndObject || reader.Read())
      {
        error = "the limits payload has trailing content";

        return false;
      }
    }
    catch (JsonException)
    {
      error = "the limits payload is not valid JSON";

      return false;
    }

    if (limit is not > 0)
    {
      error = "the limits payload needs a positive maxMessageBytes";

      return false;
    }

    maxMessageBytes = limit.Value;
    error = "";

    return true;
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

  private static bool TryDecodeOperationMetadata(
      ReadOnlySpan<byte> json,
      out string lineage,
      out string operationId,
      out int? rule,
      out string error)
  {
    lineage = "";
    operationId = "";

    if (!TryReadMetadataObject(json, out var properties, out rule, out error))
    {
      return false;
    }

    if (HasKeySetViolation(properties, OperationKeys))
    {
      rule = 11;
      error = "the operation metadata needs exactly lineage and operationId, each once";

      return false;
    }

    var lineageValue = MetadataValue(properties, "lineage");
    var operationIdValue = MetadataValue(properties, "operationId");

    if (!CollabWorkingSetTag.IsLineage(lineageValue) || !CollabWorkingSetTag.IsLineage(operationIdValue))
    {
      rule = 12;
      error = "the operation metadata has an ill-shaped lineage or operationId";

      return false;
    }

    lineage = lineageValue!;
    operationId = operationIdValue!;
    rule = null;
    error = "";

    return true;
  }

  private static bool TryDecodeAcknowledgementMetadata(
      ReadOnlySpan<byte> json,
      out string lineage,
      out string operationId,
      out ulong serverSequence,
      out int? rule,
      out string error)
  {
    lineage = "";
    operationId = "";
    serverSequence = 0;

    if (!TryReadMetadataObject(json, out var properties, out rule, out error))
    {
      return false;
    }

    if (HasKeySetViolation(properties, AcknowledgementKeys))
    {
      rule = 11;
      error = "the acknowledgement metadata needs exactly lineage, operationId and serverSequence, each once";

      return false;
    }

    var lineageValue = MetadataValue(properties, "lineage");
    var operationIdValue = MetadataValue(properties, "operationId");
    var sequenceValue = MetadataValue(properties, "serverSequence");

    // blok-sync.v2 4.1: an acknowledgement always acknowledges a committed
    // operation, so 0 ("nothing committed yet") is never valid here even
    // though the grammar allows it on other durable-through fields.
    if (!CollabWorkingSetTag.IsLineage(lineageValue) ||
        !CollabWorkingSetTag.IsLineage(operationIdValue) ||
        sequenceValue is null ||
        !TryParseServerSequence(sequenceValue, out var sequence) ||
        sequence == 0)
    {
      rule = 12;
      error = "the acknowledgement metadata has an ill-shaped field";

      return false;
    }

    lineage = lineageValue!;
    operationId = operationIdValue!;
    serverSequence = sequence;
    rule = null;
    error = "";

    return true;
  }

  private static bool TryDecodeRejectionMetadata(
      ReadOnlySpan<byte> json,
      out string lineage,
      out string operationId,
      out string code,
      out int? rule,
      out string error)
  {
    lineage = "";
    operationId = "";
    code = "";

    if (!TryReadMetadataObject(json, out var properties, out rule, out error))
    {
      return false;
    }

    if (HasKeySetViolation(properties, RejectionKeys))
    {
      rule = 11;
      error = "the rejection metadata needs exactly lineage, operationId and code, each once";

      return false;
    }

    var lineageValue = MetadataValue(properties, "lineage");
    var operationIdValue = MetadataValue(properties, "operationId");
    var codeValue = MetadataValue(properties, "code");

    if (!CollabWorkingSetTag.IsLineage(lineageValue) ||
        !CollabWorkingSetTag.IsLineage(operationIdValue) ||
        codeValue is null ||
        !IsRejectionCode(codeValue))
    {
      rule = 12;
      error = "the rejection metadata has an ill-shaped field";

      return false;
    }

    lineage = lineageValue!;
    operationId = operationIdValue!;
    code = codeValue;
    rule = null;
    error = "";

    return true;
  }

  private readonly record struct MetadataProperty(string Key, JsonTokenType ValueType, string? StringValue);

  /// <summary>
  /// Structural rules 6-10 of blok-sync.v2 section 5 for a type-102/103/104
  /// metadata section: strict UTF-8, no backslash or JSON whitespace
  /// anywhere (together these make a textual duplicate-key scan exact, since
  /// every key and value here is plain ASCII — section 4.2), exactly one
  /// JSON object with no trailing content. Key set/uniqueness (rule 11) and
  /// value shape (rule 12) are the caller's job, one per message type.
  /// </summary>
  private static bool TryReadMetadataObject(
      ReadOnlySpan<byte> json,
      out List<MetadataProperty> properties,
      out int? rule,
      out string error)
  {
    properties = [];
    rule = null;

    string text;

    try
    {
      text = StrictUtf8.GetString(json);
    }
    catch (DecoderFallbackException)
    {
      rule = 6;
      error = "the metadata is not valid UTF-8";

      return false;
    }

    if (text.Contains('\\'))
    {
      rule = 7;
      error = "the metadata contains a backslash";

      return false;
    }

    foreach (var character in text)
    {
      if (character is ' ' or '\t' or '\n' or '\r')
      {
        rule = 8;
        error = "the metadata contains JSON whitespace";

        return false;
      }
    }

    try
    {
      var reader = new Utf8JsonReader(json);

      if (!reader.Read())
      {
        rule = 9;
        error = "the metadata is empty";

        return false;
      }

      if (reader.TokenType != JsonTokenType.StartObject)
      {
        if (reader.TokenType is JsonTokenType.StartArray or JsonTokenType.StartObject)
        {
          reader.Skip();
        }

        if (reader.Read())
        {
          rule = 9;
          error = "content follows the metadata value";

          return false;
        }

        rule = 10;
        error = "the metadata top-level value is not an object";

        return false;
      }

      while (true)
      {
        if (!reader.Read())
        {
          rule = 9;
          error = "the metadata object is not terminated";

          return false;
        }

        if (reader.TokenType == JsonTokenType.EndObject)
        {
          break;
        }

        var key = reader.GetString() ?? "";

        if (!reader.Read())
        {
          rule = 9;
          error = "a metadata property has no value";

          return false;
        }

        var valueType = reader.TokenType;
        string? stringValue = null;

        if (valueType == JsonTokenType.String)
        {
          stringValue = reader.GetString();
        }
        else if (valueType is JsonTokenType.StartObject or JsonTokenType.StartArray)
        {
          reader.Skip();
        }

        properties.Add(new MetadataProperty(key, valueType, stringValue));
      }

      if (reader.Read())
      {
        rule = 9;
        error = "content follows the metadata object";

        return false;
      }
    }
    catch (JsonException)
    {
      rule = 9;
      error = "the metadata is not valid JSON";

      return false;
    }

    error = "";

    return true;
  }

  /// <summary>Rule 11: missing, unknown or repeated keys, checked as one set comparison against the message type's required keys.</summary>
  private static bool HasKeySetViolation(List<MetadataProperty> properties, HashSet<string> required)
  {
    var seen = new HashSet<string>();

    foreach (var property in properties)
    {
      if (!required.Contains(property.Key) || !seen.Add(property.Key))
      {
        return true;
      }
    }

    return seen.Count != required.Count;
  }

  /// <summary>The string value of <paramref name="key"/>, or null if absent or not a JSON string — either way a rule-12 failure for the caller.</summary>
  private static string? MetadataValue(List<MetadataProperty> properties, string key)
  {
    foreach (var property in properties)
    {
      if (property.Key == key)
      {
        return property.ValueType == JsonTokenType.String ? property.StringValue : null;
      }
    }

    return null;
  }

  /// <summary>
  /// blok-sync.v2 4.1: <c>^(0|[1-9][0-9]*)$</c>, at most
  /// <see cref="ulong.MaxValue"/>. Checked digit-by-digit because
  /// <see cref="ulong.TryParse(string, out ulong)"/> alone accepts a leading
  /// zero (e.g. "0042" -> 42), which the grammar forbids.
  /// </summary>
  private static bool TryParseServerSequence(string text, out ulong value)
  {
    value = 0;

    if (text.Length == 0)
    {
      return false;
    }

    if (text[0] == '0')
    {
      return text.Length == 1;
    }

    foreach (var character in text)
    {
      if (character is < '0' or > '9')
      {
        return false;
      }
    }

    return ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
  }

  /// <summary>blok-sync.v2 4.1: <c>^[a-z][a-z0-9-]{0,63}$</c>. The six named codes in section 6 are the stable set, not a closed one — any code matching this shape is accepted.</summary>
  private static bool IsRejectionCode(string text)
  {
    if (text.Length is 0 or > 64 || text[0] is < 'a' or > 'z')
    {
      return false;
    }

    for (var index = 1; index < text.Length; index++)
    {
      var character = text[index];

      if (character is (< 'a' or > 'z') and (< '0' or > '9') and not '-')
      {
        return false;
      }
    }

    return true;
  }

  /// <summary>
  /// Structural walk of an awareness payload
  /// (<c>[varuint clients]{[clientId][clock][varstring state]}*</c>) plus a
  /// skip-parse of every state as JSON. Presence is still relayed verbatim
  /// and never interpreted (plan decision 11); what is checked is exactly
  /// what a stock y-protocols client would throw on — its
  /// applyAwarenessUpdate JSON.parses each state, an empty one included, and
  /// the provider ends the session on a throw. <paramref name="clientCount"/>
  /// is the count the head claims, set as soon as it is read, so a caller can
  /// tell a frame over the cap from a malformed one.
  /// </summary>
  internal static bool TryValidateAwarenessUpdate(
      ReadOnlySpan<byte> payload,
      int maxClients,
      out int clientCount)
  {
    clientCount = 0;

    if (!TryReadVarUint(ref payload, out var claimed))
    {
      return false;
    }

    clientCount = claimed > int.MaxValue ? int.MaxValue : (int)claimed;

    if (claimed > (ulong)maxClients)
    {
      return false;
    }

    for (var entry = 0UL; entry < claimed; entry++)
    {
      if (!TryReadVarUint(ref payload, out _) ||
          !TryReadVarUint(ref payload, out _) ||
          !TryReadVarBytes(ref payload, out var state) ||
          !IsJsonDocument(state))
      {
        return false;
      }
    }

    return payload.IsEmpty;
  }

  private static bool IsJsonDocument(ReadOnlySpan<byte> json)
  {
    try
    {
      var reader = new Utf8JsonReader(json);

      if (!reader.Read())
      {
        return false;
      }

      reader.Skip();

      return !reader.Read();
    }
    catch (JsonException)
    {
      return false;
    }
  }
}
