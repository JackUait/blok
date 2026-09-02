using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/*
 * The y-protocols framing in Blok.Server/Collab/SyncWire.cs is hand-rolled.
 * The fixtures in test/unit/server-conformance/fixtures/sync-frames.json come
 * from the REAL reference encoders (y-protocols 1.0.7 + lib0 0.2.117 + yjs
 * 13.6.32, scripts/generate-sync-frames.mjs), so these tests are the only
 * thing keeping the framing byte-compatible with stock clients.
 *
 * What SyncWire pins (C1 shapes around this):
 *   - exactly ONE message per WebSocket frame; trailing bytes are rejected, so
 *     the handshake reply (SyncStep2 then own SyncStep1) is two frames;
 *   - varuint = lib0 LEB128, at most 10 bytes, must fit 64 bits;
 *   - length prefixes must fit the remaining bytes; sync/awareness payloads
 *     must be non-empty;
 *   - unknown OUTER types decode to UnknownFrame (ignorable, like y-websocket);
 *     unknown sync/auth SUB-types are malformed;
 *   - control frame 100 = var-string JSON {"epoch":N,"format":N}, exactly those
 *     two keys in that order, format >= 1, epoch >= 0.
 */
public sealed class SyncWireFramingTests
{
  private static readonly SyncFramesFixture Fixture = LoadFixture();

  public static TheoryData<string> FrameNames
  {
    get
    {
      var names = new TheoryData<string>();

      foreach (var frame in Fixture.Frames)
      {
        names.Add(frame.Name);
      }

      return names;
    }
  }

  [Theory]
  [MemberData(nameof(FrameNames))]
  public void DecodesThenReEncodesEveryFixtureByteForByte(string name)
  {
    var frame = Frame(name);

    Assert.True(SyncWire.TryDecode(frame.Bytes, out var message, out var error), error);
    Assert.Equal(
        frame.Bytes,
        SyncWire.Encode(Assert.IsAssignableFrom<SyncWireMessage>(message)));
  }

  [Fact]
  public void SyncStep1CarriesTheSeedStateVector()
  {
    var message = Decode<SyncStep1Frame>("syncStep1");

    var seeded = SeededDoc();
    var advanced = SeededDoc();
    Apply(advanced, Fixture.IncrementalUpdate);

    Assert.Equal(seeded.EncodeStateVector(), message.StateVector);

    Apply(seeded, advanced.EncodeStateAsUpdate(message.StateVector));
    Assert.Equal(Fixture.Expected.TextAfterIncremental, ContentText(seeded));
  }

  [Fact]
  public void SyncStep2ReplaysTheSeededDocument()
  {
    var message = Decode<SyncStep2Frame>("syncStep2");

    var replica = new YDoc();
    Apply(replica, message.Update);

    Assert.Equal(Fixture.Expected.TextAfterSeed, ContentText(replica));
    Assert.True(replica.GetMap("meta").TryGet("kind", out var kind));
    Assert.Equal(Fixture.Expected.MetaKindAfterSeed, Assert.IsType<string>(kind));
  }

  [Fact]
  public void UpdateAppendsToTheSeededDocument()
  {
    var message = Decode<SyncUpdateFrame>("update");

    Assert.Equal(Fixture.IncrementalUpdate, message.Update);

    var seeded = SeededDoc();
    Apply(seeded, message.Update);

    Assert.Equal(Fixture.Expected.TextAfterIncremental, ContentText(seeded));
  }

  [Fact]
  public void AwarenessCarriesTheRecordedClientState()
  {
    var frame = Frame("awareness");
    var message = Decode<AwarenessFrame>("awareness");
    var expected = Assert.IsType<AwarenessFixture>(frame.Awareness);

    Assert.Equal(frame.Payload, message.Update);

    ReadOnlySpan<byte> update = message.Update;
    Assert.True(SyncWire.TryReadVarUint(ref update, out var clientCount));
    Assert.Equal(1UL, clientCount);
    Assert.True(SyncWire.TryReadVarUint(ref update, out var clientId));
    Assert.Equal(expected.ClientId, clientId);
    Assert.Equal(Fixture.ClientId, clientId);
    Assert.True(SyncWire.TryReadVarUint(ref update, out var clock));
    Assert.Equal(expected.Clock, clock);
    Assert.True(SyncWire.TryReadVarBytes(ref update, out var state));
    Assert.Equal(expected.StateJson, Encoding.UTF8.GetString(state));
    Assert.True(update.IsEmpty);
  }

  [Fact]
  public void PermissionDeniedCarriesTheReason()
  {
    var frame = Frame("permissionDenied");
    var message = Decode<PermissionDeniedFrame>("permissionDenied");

    Assert.Equal(frame.Reason, message.Reason);
    Assert.Equal(frame.Payload, Encoding.UTF8.GetBytes(message.Reason));
  }

  [Fact]
  public void QueryAwarenessIsTheBareTypeByte()
  {
    var frame = Frame("queryAwareness");

    Decode<QueryAwarenessFrame>("queryAwareness");
    Assert.Equal(new byte[] { 0x03 }, frame.Bytes);
    Assert.Equal(SyncWire.MessageQueryAwareness, frame.MessageType);
  }

  [Fact]
  public void BlokControlCarriesTheEpochFormatAndLineage()
  {
    var frame = Frame("blokControl");
    var message = Decode<BlokControlFrame>("blokControl");
    var control = Assert.IsType<ControlFixture>(frame.Control);

    Assert.Equal(SyncWire.MessageBlokControl, frame.MessageType);
    Assert.Equal(
        new CollabWorkingSetTag(control.Format, control.Epoch, control.Lineage),
        message.Tag);
    Assert.Equal(CollabWorkingSetTag.SchemaV2, message.Tag.Format);
    Assert.Matches("^[0-9a-f]{32}$", message.Tag.Lineage);
  }

  [Fact]
  public void BlokLimitsCarriesTheMaxMessageBytes()
  {
    var frame = Frame("blokLimits");
    var message = Decode<BlokLimitsFrame>("blokLimits");
    var limits = Assert.IsType<LimitsFixture>(frame.Limits);

    Assert.Equal(SyncWire.MessageBlokLimits, frame.MessageType);
    Assert.Equal(limits.MaxMessageBytes, message.MaxMessageBytes);
    Assert.True(message.MaxMessageBytes > 0);
  }

  [Fact]
  public void FixtureMessageTypesMatchTheDecodedKinds()
  {
    Assert.Equal(SyncWire.MessageSync, Frame("syncStep1").MessageType);
    Assert.Equal(0UL, Frame("syncStep1").SyncType);
    Assert.Equal(SyncWire.MessageSync, Frame("syncStep2").MessageType);
    Assert.Equal(1UL, Frame("syncStep2").SyncType);
    Assert.Equal(SyncWire.MessageSync, Frame("update").MessageType);
    Assert.Equal(2UL, Frame("update").SyncType);
    Assert.Equal(SyncWire.MessageAwareness, Frame("awareness").MessageType);
    Assert.Equal(SyncWire.MessageAuth, Frame("permissionDenied").MessageType);
    Assert.Equal(0UL, Frame("permissionDenied").AuthType);
  }

  public static TheoryData<string> V2FrameNames
  {
    get
    {
      var names = new TheoryData<string>();

      foreach (var frame in Fixture.V2.Frames)
      {
        names.Add(frame.Name);
      }

      return names;
    }
  }

  public static TheoryData<string> CanonicalV2FrameNames
  {
    get
    {
      var names = new TheoryData<string>();

      foreach (var frame in Fixture.V2.Frames)
      {
        if (frame.Canonical)
        {
          names.Add(frame.Name);
        }
      }

      return names;
    }
  }

  public static TheoryData<string> V2NegativeNames
  {
    get
    {
      var names = new TheoryData<string>();

      foreach (var negative in Fixture.V2.Negative)
      {
        names.Add(negative.Name);
      }

      return names;
    }
  }

  [Theory]
  [MemberData(nameof(V2FrameNames))]
  public void DecodesEveryV2FixtureIntoItsFields(string name)
  {
    var frame = V2Frame(name);

    Assert.True(SyncWire.TryDecode(frame.Bytes, out var message, out var error), error);

    switch (Assert.IsAssignableFrom<SyncWireMessage>(message))
    {
      case OperationFrame operation:
        Assert.Equal(frame.Metadata.Lineage, operation.Lineage);
        Assert.Equal(frame.Metadata.OperationId, operation.OperationId);
        Assert.Equal(frame.Update, operation.Update);
        break;
      case AcknowledgementFrame acknowledgement:
        Assert.Equal(frame.Metadata.Lineage, acknowledgement.Lineage);
        Assert.Equal(frame.Metadata.OperationId, acknowledgement.OperationId);
        Assert.Equal(ulong.Parse(frame.Metadata.ServerSequence!, CultureInfo.InvariantCulture), acknowledgement.ServerSequence);
        break;
      case RejectionFrame rejection:
        Assert.Equal(frame.Metadata.Lineage, rejection.Lineage);
        Assert.Equal(frame.Metadata.OperationId, rejection.OperationId);
        Assert.Equal(frame.Metadata.Code, rejection.Code);
        Assert.Matches(Fixture.V2.RejectionCodePattern, rejection.Code);
        break;
      default:
        Assert.Fail($"{name} decoded to an unexpected message type {message?.GetType()}");
        break;
    }
  }

  [Theory]
  [MemberData(nameof(CanonicalV2FrameNames))]
  public void ReEncodesCanonicalV2FixturesByteForByte(string name)
  {
    var frame = V2Frame(name);

    Assert.True(SyncWire.TryDecode(frame.Bytes, out var message, out var error), error);
    Assert.Equal(
        frame.Bytes,
        SyncWire.Encode(Assert.IsAssignableFrom<SyncWireMessage>(message)));
  }

  // Key order is an emitter rule only (blok-sync.v2 4.2): this frame carries
  // {operationId, serverSequence, lineage} and MUST still decode. It is the
  // one v2.frames entry with canonical: false, so it is deliberately absent
  // from CanonicalV2FrameNames above — asserting its re-encoding would wrongly
  // pin a foreign key order into the encoder.
  [Fact]
  public void AcknowledgementKeysOutOfOrderDecodesButIsNotReEncodeAsserted()
  {
    var frame = V2Frame("acknowledgementKeysOutOfOrder");
    Assert.False(frame.Canonical);

    Assert.True(SyncWire.TryDecode(frame.Bytes, out var message, out var error), error);
    var acknowledgement = Assert.IsType<AcknowledgementFrame>(message);

    Assert.Equal(frame.Metadata.Lineage, acknowledgement.Lineage);
    Assert.Equal(frame.Metadata.OperationId, acknowledgement.OperationId);
    Assert.Equal(ulong.Parse(frame.Metadata.ServerSequence!, CultureInfo.InvariantCulture), acknowledgement.ServerSequence);

    // The strongest pin of contract decision #1: an encoder fed this
    // foreign-order frame's decoded fields emits the SAME bytes as the
    // canonical fixture carrying the same field values in order.
    Assert.Equal(V2Frame("acknowledgement").Bytes, SyncWire.Encode(acknowledgement));
  }

  // The six named codes in section 6 are the stable set, not a closed one: a
  // decoder MUST accept any code matching the shape rule. Refusing an
  // unrecognised code is a liveness hole (blok-sync.v2 section 6).
  [Fact]
  public void RejectionAcceptsACodeOutsideTheStableSix()
  {
    var frame = V2Frame("rejectionUnrecognisedCode");
    Assert.DoesNotContain(frame.Metadata.Code, Fixture.V2.RejectionCodes);

    Assert.True(SyncWire.TryDecode(frame.Bytes, out var message, out var error), error);
    var rejection = Assert.IsType<RejectionFrame>(message);

    Assert.Equal(frame.Metadata.Code, rejection.Code);
  }

  [Theory]
  [MemberData(nameof(V2NegativeNames))]
  public void RejectsOrIgnoresEveryV2NegativeFixtureForTheDocumentedReason(string name)
  {
    var negative = Fixture.V2.Negative.Single(n => n.Name == name);

    var decoded = SyncWire.TryDecode(negative.Bytes, out var message, out var error, out var rule);

    if (negative.Expect == "unknown")
    {
      Assert.True(decoded, error);
      Assert.IsType<UnknownFrame>(message);
      Assert.Null(negative.Rule);
      Assert.Null(rule);

      return;
    }

    Assert.Equal("malformed", negative.Expect);
    Assert.False(decoded, $"{name}: {negative.Description} decoded but should have been refused");
    Assert.NotEqual("", error);
    Assert.Equal(negative.Rule, rule);
  }

  // Covers the [JsonRequired] fix above: a canonical: true entry that lost
  // its "canonical" key must fail loudly (JsonException) rather than
  // silently deserialise to false and quietly drop out of
  // CanonicalV2FrameNames, disabling its byte-for-byte re-encode assertion
  // with no test failure anywhere.
  [Fact]
  public void V2FrameFixtureRequiresAnExplicitCanonicalValue()
  {
    const string withoutCanonical = """
      {
        "name": "operation",
        "messageType": 102,
        "description": "missing canonical on purpose",
        "frameHex": "00",
        "metadataJson": "{}",
        "metadata": {"lineage": "0", "operationId": "0"}
      }
      """;

    var exception = Assert.Throws<JsonException>(
        () => JsonSerializer.Deserialize<V2FrameFixture>(withoutCanonical));

    Assert.Contains("canonical", exception.Message, StringComparison.OrdinalIgnoreCase);
  }

  private static V2FrameFixture V2Frame(string name)
  {
    return Fixture.V2.Frames.Single(frame => frame.Name == name);
  }

  private static T Decode<T>(string name)
      where T : SyncWireMessage
  {
    Assert.True(SyncWire.TryDecode(Frame(name).Bytes, out var message, out var error), error);

    return Assert.IsType<T>(message);
  }

  private static YDoc SeededDoc()
  {
    var doc = new YDoc();
    Apply(doc, Fixture.SeedUpdate);

    return doc;
  }

  private static void Apply(YDoc doc, byte[] update)
  {
    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  private static string ContentText(YDoc doc)
  {
    return doc.GetText("content").ToString();
  }

  private static FrameFixture Frame(string name)
  {
    return Fixture.Frames.Single(frame => frame.Name == name);
  }

  private static SyncFramesFixture LoadFixture()
  {
    var path = Path.GetFullPath(Path.Combine(
        FindDotnetRoot(),
        "..", "..", "..",
        "test", "unit", "server-conformance", "fixtures",
        "sync-frames.json"));
    var fixture = JsonSerializer.Deserialize<SyncFramesFixture>(
        File.ReadAllText(path));

    return fixture ?? throw new InvalidDataException(path);
  }

  private static string FindDotnetRoot()
  {
    for (var current = new DirectoryInfo(AppContext.BaseDirectory);
         current is not null;
         current = current.Parent)
    {
      if (File.Exists(Path.Combine(current.FullName, "Blok.Server.slnx")))
      {
        return current.FullName;
      }
    }

    throw new DirectoryNotFoundException(
        "Could not locate the Blok.Server solution root.");
  }

  private sealed record SyncFramesFixture(
      [property: JsonPropertyName("clientId")] ulong ClientId,
      [property: JsonPropertyName("seedUpdateHex")] string SeedUpdateHex,
      [property: JsonPropertyName("incrementalUpdateHex")] string IncrementalUpdateHex,
      [property: JsonPropertyName("expected")] ExpectedContent Expected,
      [property: JsonPropertyName("frames")] IReadOnlyList<FrameFixture> Frames,
      [property: JsonPropertyName("v2")] V2Fixture V2)
  {
    public byte[] SeedUpdate => Convert.FromHexString(SeedUpdateHex);

    public byte[] IncrementalUpdate => Convert.FromHexString(IncrementalUpdateHex);
  }

  private sealed record ExpectedContent(
      [property: JsonPropertyName("textAfterSeed")] string TextAfterSeed,
      [property: JsonPropertyName("metaKindAfterSeed")] string MetaKindAfterSeed,
      [property: JsonPropertyName("textAfterIncremental")] string TextAfterIncremental);

  private sealed record FrameFixture(
      [property: JsonPropertyName("name")] string Name,
      [property: JsonPropertyName("messageType")] ulong MessageType,
      [property: JsonPropertyName("syncType")] ulong? SyncType,
      [property: JsonPropertyName("authType")] ulong? AuthType,
      [property: JsonPropertyName("frameHex")] string FrameHex,
      [property: JsonPropertyName("payloadHex")] string PayloadHex,
      [property: JsonPropertyName("awareness")] AwarenessFixture? Awareness,
      [property: JsonPropertyName("reason")] string? Reason,
      [property: JsonPropertyName("control")] ControlFixture? Control,
      [property: JsonPropertyName("limits")] LimitsFixture? Limits)
  {
    public byte[] Bytes => Convert.FromHexString(FrameHex);

    public byte[] Payload => Convert.FromHexString(PayloadHex);
  }

  private sealed record AwarenessFixture(
      [property: JsonPropertyName("clientId")] ulong ClientId,
      [property: JsonPropertyName("clock")] ulong Clock,
      [property: JsonPropertyName("stateJson")] string StateJson);

  private sealed record ControlFixture(
      [property: JsonPropertyName("epoch")] long Epoch,
      [property: JsonPropertyName("format")] int Format,
      [property: JsonPropertyName("lineage")] string Lineage);

  private sealed record LimitsFixture(
      [property: JsonPropertyName("maxMessageBytes")] long MaxMessageBytes);

  private sealed record V2Fixture(
      [property: JsonPropertyName("protocol")] string Protocol,
      [property: JsonPropertyName("lineage")] string Lineage,
      [property: JsonPropertyName("operationId")] string OperationId,
      [property: JsonPropertyName("rejectionCodes")] IReadOnlyList<string> RejectionCodes,
      [property: JsonPropertyName("rejectionCodePattern")] string RejectionCodePattern,
      [property: JsonPropertyName("frames")] IReadOnlyList<V2FrameFixture> Frames,
      [property: JsonPropertyName("negative")] IReadOnlyList<V2NegativeFixture> Negative);

  private sealed record V2FrameFixture(
      [property: JsonPropertyName("name")] string Name,
      [property: JsonPropertyName("messageType")] ulong MessageType,
      // [JsonRequired] is what actually enforces presence: plain non-nullable
      // bool with no default still deserialises a MISSING key to false with
      // no exception (verified on net10.0 with the plain Deserialize call
      // this file uses), which would silently drop a canonical: true entry
      // out of CanonicalV2FrameNames below instead of failing loudly.
      [property: JsonPropertyName("canonical"), JsonRequired] bool Canonical,
      [property: JsonPropertyName("description")] string Description,
      [property: JsonPropertyName("frameHex")] string FrameHex,
      [property: JsonPropertyName("metadataJson")] string MetadataJson,
      [property: JsonPropertyName("metadata")] V2Metadata Metadata,
      [property: JsonPropertyName("updateHex")] string? UpdateHex)
  {
    public byte[] Bytes => Convert.FromHexString(FrameHex);

    public byte[]? Update => UpdateHex is null ? null : Convert.FromHexString(UpdateHex);
  }

  private sealed record V2Metadata(
      [property: JsonPropertyName("lineage")] string Lineage,
      [property: JsonPropertyName("operationId")] string OperationId,
      [property: JsonPropertyName("serverSequence")] string? ServerSequence,
      [property: JsonPropertyName("code")] string? Code);

  private sealed record V2NegativeFixture(
      [property: JsonPropertyName("name")] string Name,
      [property: JsonPropertyName("messageType")] ulong? MessageType,
      [property: JsonPropertyName("expect")] string Expect,
      [property: JsonPropertyName("rule")] int? Rule,
      [property: JsonPropertyName("description")] string Description,
      [property: JsonPropertyName("frameHex")] string FrameHex,
      [property: JsonPropertyName("metadataJson")] string? MetadataJson)
  {
    public byte[] Bytes => Convert.FromHexString(FrameHex);
  }
}
