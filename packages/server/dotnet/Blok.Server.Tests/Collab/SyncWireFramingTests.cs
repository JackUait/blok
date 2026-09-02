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
      [property: JsonPropertyName("frames")] IReadOnlyList<FrameFixture> Frames)
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
}
