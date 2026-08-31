using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Transactions;
using YDotNet.Protocol;

namespace Blok.Server.Tests.Collab;

/*
 * R2a DECISION (spike B2, 2026-08-31): HAND-ROLL the y-protocols framing in
 * Blok.Server/Collab/SyncWire.cs. YDotNet.Protocol (YDotNet 0.6.0) is NOT
 * adopted for the wire.
 *
 * Evidence. Fixtures in test/unit/server-conformance/fixtures/sync-frames.json
 * are produced by the REAL reference encoders (y-protocols 1.0.7 + lib0
 * 0.2.117 + yjs 13.6.32, scripts/generate-sync-frames.mjs). Each was decoded
 * with YDotNet.Protocol's Decoder and re-encoded with its Encoder:
 *
 *   sync 0/0 SyncStep1   decode OK, re-encode byte-identical      PASS
 *   sync 0/1 SyncStep2   decode OK, re-encode byte-identical      PASS
 *   sync 0/2 Update      decode OK, re-encode byte-identical      PASS
 *   awareness 1          decode OK (client/clock/state match),
 *                        re-encode byte-identical                 PASS
 *   auth 2               ENCODE matches y-protocols ([2][0][str]),
 *                        DECODE -> UnknownMessage(2)              FAIL
 *   queryAwareness 3     DECODE -> UnknownMessage(3);
 *                        ENCODE writes [0x01] (the AWARENESS type;
 *                        QueryAwarenessMessage.Identifier = 1)
 *                        instead of [0x03]                        FAIL
 *   blok control 100     UnknownMessage(100), no typed support    FAIL (expected)
 *
 * The queryAwareness mis-encode is disqualifying on its own: plan decision 11
 * broadcasts queryAwareness on join, and a stock client would parse YDotNet's
 * [0x01] as an empty awareness update and never reply. Further gaps: no
 * buffer-backed Decoder in core (only BufferEncoder), varuint reading is
 * unbounded (no 64-bit cap), array lengths are trusted before the bytes exist,
 * and one-message-per-frame / trailing-byte rejection is not enforced.
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
 *
 * The YDotNet canaries at the bottom pin the observed mismatches; if a YDotNet
 * upgrade flips them, revisit this decision.
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

    using var seeded = SeededDoc();
    using var advanced = SeededDoc();
    Apply(advanced, Fixture.IncrementalUpdate);

    using (var transaction = seeded.ReadTransaction())
    {
      Assert.Equal(transaction.StateVectorV1(), message.StateVector);
    }

    byte[] diff;

    using (var transaction = advanced.ReadTransaction())
    {
      diff = transaction.StateDiffV1(message.StateVector);
    }

    Apply(seeded, diff);
    Assert.Equal(Fixture.Expected.TextAfterIncremental, ContentText(seeded));
  }

  [Fact]
  public void SyncStep2ReplaysTheSeededDocument()
  {
    var message = Decode<SyncStep2Frame>("syncStep2");

    using var replica = new Doc();
    Apply(replica, message.Update);

    Assert.Equal(Fixture.Expected.TextAfterSeed, ContentText(replica));

    // Resolve the root before opening the transaction: Doc.Map needs its own.
    var meta = replica.Map("meta");
    using var transaction = replica.ReadTransaction();
    Assert.Equal(
        Fixture.Expected.MetaKindAfterSeed,
        meta.Get(transaction, "kind")?.String);
  }

  [Fact]
  public void UpdateAppendsToTheSeededDocument()
  {
    var message = Decode<SyncUpdateFrame>("update");

    Assert.Equal(Fixture.IncrementalUpdate, message.Update);

    using var seeded = SeededDoc();
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
  public void BlokControlCarriesTheEpochAndFormat()
  {
    var frame = Frame("blokControl");
    var message = Decode<BlokControlFrame>("blokControl");
    var control = Assert.IsType<ControlFixture>(frame.Control);

    Assert.Equal(SyncWire.MessageBlokControl, frame.MessageType);
    Assert.Equal(new CollabWorkingSetTag(control.Format, control.Epoch), message.Tag);
    Assert.Equal(CollabWorkingSetTag.SchemaV2, message.Tag.Format);
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

  // ---- YDotNet.Protocol 0.6.0 canaries: the evidence behind the decision. ----

  [Theory]
  [InlineData("syncStep1")]
  [InlineData("syncStep2")]
  [InlineData("update")]
  [InlineData("awareness")]
  public async Task YDotNetProtocolRoundTripsSyncAndAwarenessFramesByteForByte(string name)
  {
    var frame = Frame(name);
    var decoder = new ArrayDecoder(frame.Bytes);
    var message = await decoder.ReadNextMessageAsync(CancellationToken.None);
    var encoder = new BufferEncoder();

    switch (message)
    {
      case SyncStep1Message step1:
        await encoder.WriteAsync(step1, CancellationToken.None);
        break;
      case SyncStep2Message step2:
        await encoder.WriteAsync(step2, CancellationToken.None);
        break;
      case SyncUpdateMessage update:
        await encoder.WriteAsync(update, CancellationToken.None);
        break;
      case AwarenessMessage awareness:
        var client = Assert.Single(awareness.Clients);
        Assert.Equal(frame.Awareness?.ClientId, client.ClientId);
        Assert.Equal(frame.Awareness?.Clock, client.Clock);
        Assert.Equal(frame.Awareness?.StateJson, client.State);
        await encoder.WriteAsync(awareness, CancellationToken.None);
        break;
      default:
        Assert.Fail($"YDotNet.Protocol decoded {name} as {message}");
        break;
    }

    Assert.True(decoder.AtEnd);
    Assert.Equal(frame.Bytes, encoder.ToArray());
  }

  [Fact]
  public async Task YDotNetProtocolMisencodesQueryAwarenessAsTheAwarenessType()
  {
    var encoder = new BufferEncoder();

    await encoder.WriteAsync(new QueryAwarenessMessage(), CancellationToken.None);

    Assert.Equal(new byte[] { 0x01 }, encoder.ToArray());
    Assert.Equal(new byte[] { 0x03 }, Frame("queryAwareness").Bytes);
  }

  [Theory]
  [InlineData("permissionDenied", 2UL)]
  [InlineData("queryAwareness", 3UL)]
  [InlineData("blokControl", 100UL)]
  public async Task YDotNetProtocolLeavesAuthQueryAndControlFramesUndecoded(
      string name,
      ulong identifier)
  {
    var decoder = new ArrayDecoder(Frame(name).Bytes);

    var message = await decoder.ReadNextMessageAsync(CancellationToken.None);

    Assert.Equal(new UnknownMessage(identifier), message);
  }

  [Fact]
  public async Task YDotNetProtocolEncodesPermissionDeniedLikeYProtocols()
  {
    var frame = Frame("permissionDenied");
    var encoder = new BufferEncoder();

    await encoder.WriteAsync(
        new AuthErrorMessage(frame.Reason ?? ""),
        CancellationToken.None);

    Assert.Equal(frame.Bytes, encoder.ToArray());
  }

  private static T Decode<T>(string name)
      where T : SyncWireMessage
  {
    Assert.True(SyncWire.TryDecode(Frame(name).Bytes, out var message, out var error), error);

    return Assert.IsType<T>(message);
  }

  private static Doc SeededDoc()
  {
    var doc = new Doc();
    Apply(doc, Fixture.SeedUpdate);

    return doc;
  }

  private static void Apply(Doc doc, byte[] update)
  {
    using var transaction = doc.WriteTransaction();
    Assert.Equal(TransactionUpdateResult.Ok, transaction.ApplyV1(update));
  }

  private static string ContentText(Doc doc)
  {
    var text = doc.Text("content");
    using var transaction = doc.ReadTransaction();

    return text.String(transaction);
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

  private sealed class ArrayDecoder(byte[] bytes) : YDotNet.Protocol.Decoder
  {
    private int position;

    public bool AtEnd => position == bytes.Length;

    protected override ValueTask<byte> ReadByteAsync(CancellationToken ct)
    {
      if (position >= bytes.Length)
      {
        throw new EndOfStreamException();
      }

      return ValueTask.FromResult(bytes[position++]);
    }

    protected override ValueTask ReadBytesAsync(Memory<byte> target, CancellationToken ct)
    {
      if (position + target.Length > bytes.Length)
      {
        throw new EndOfStreamException();
      }

      bytes.AsMemory(position, target.Length).CopyTo(target);
      position += target.Length;

      return ValueTask.CompletedTask;
    }
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
      [property: JsonPropertyName("control")] ControlFixture? Control)
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
      [property: JsonPropertyName("format")] int Format);
}
