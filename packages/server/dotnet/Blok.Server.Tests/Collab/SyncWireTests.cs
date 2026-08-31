using System.Text;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class SyncWireTests
{
  private const string Lineage = "0123456789abcdef0123456789abcdef";
  private static readonly CollabWorkingSetTag Tag = new(CollabWorkingSetTag.SchemaV2, 7, Lineage);

  // Keyed by name because SyncWireMessage is internal and xunit theory
  // parameters must be public.
  private static readonly Dictionary<string, (SyncWireMessage Message, byte[] Frame)> Layouts = new()
  {
    ["syncStep1"] = (new SyncStep1Frame([0x00]), [0x00, 0x00, 0x01, 0x00]),
    ["syncStep2"] = (new SyncStep2Frame([0x00, 0x00]), [0x00, 0x01, 0x02, 0x00, 0x00]),
    ["update"] = (new SyncUpdateFrame([0xaa, 0xbb, 0xcc]), [0x00, 0x02, 0x03, 0xaa, 0xbb, 0xcc]),
    ["awareness"] = (new AwarenessFrame([0x00]), [0x01, 0x01, 0x00]),
    ["permissionDenied empty"] = (new PermissionDeniedFrame(""), [0x02, 0x00, 0x00]),
    ["permissionDenied"] = (new PermissionDeniedFrame("no"), [0x02, 0x00, 0x02, (byte)'n', (byte)'o']),
    ["queryAwareness"] = (new QueryAwarenessFrame(), [0x03]),
    ["blokControl"] = (
      new BlokControlFrame(new CollabWorkingSetTag(1, 0, Lineage)),
      [
        0x64,
        0x43,
        .. "{\"epoch\":0,\"format\":1,\"lineage\":\"0123456789abcdef0123456789abcdef\"}"u8,
      ]),
  };

  public static TheoryData<string> LayoutNames
  {
    get
    {
      var names = new TheoryData<string>();

      foreach (var name in Layouts.Keys)
      {
        names.Add(name);
      }

      return names;
    }
  }

  [Theory]
  [MemberData(nameof(LayoutNames))]
  public void EncodesTheDocumentedByteLayout(string name)
  {
    var (message, frame) = Layouts[name];

    Assert.Equal(frame, SyncWire.Encode(message));
  }

  [Theory]
  [MemberData(nameof(LayoutNames))]
  public void DecodesTheDocumentedByteLayout(string name)
  {
    var (expected, frame) = Layouts[name];

    Assert.True(SyncWire.TryDecode(frame, out var message, out var error), error);
    AssertSameMessage(expected, Assert.IsAssignableFrom<SyncWireMessage>(message));
  }

  [Fact]
  public void RoundTripsAMultiBytePayloadLength()
  {
    var payload = new byte[300];
    Random.Shared.NextBytes(payload);

    var frame = SyncWire.Encode(new SyncUpdateFrame(payload));

    Assert.Equal(new byte[] { 0x00, 0x02, 0xac, 0x02 }, frame[..4]);
    Assert.True(SyncWire.TryDecode(frame, out var message, out var error), error);
    Assert.Equal(payload, Assert.IsType<SyncUpdateFrame>(message).Update);
  }

  [Fact]
  public void RoundTripsAControlFrameWithLargeValues()
  {
    var tag = new CollabWorkingSetTag(
        int.MaxValue,
        long.MaxValue,
        CollabWorkingSetTag.NewLineage());

    var frame = SyncWire.Encode(new BlokControlFrame(tag));

    Assert.True(SyncWire.TryDecode(frame, out var message, out var error), error);
    Assert.Equal(tag, Assert.IsType<BlokControlFrame>(message).Tag);
  }

  [Fact]
  public void RoundTripsANonAsciiReason()
  {
    const string reason = "доступ запрещён — read-only";

    var frame = SyncWire.Encode(new PermissionDeniedFrame(reason));

    Assert.Equal(
        Encoding.UTF8.GetByteCount(reason),
        frame[2]);
    Assert.True(SyncWire.TryDecode(frame, out var message, out var error), error);
    Assert.Equal(reason, Assert.IsType<PermissionDeniedFrame>(message).Reason);
  }

  [Fact]
  public void DecodesAnUnknownMessageTypeWithoutReadingItsPayload()
  {
    Assert.True(SyncWire.TryDecode(
        [0x04, 0xde, 0xad],
        out var message,
        out var error), error);
    Assert.Equal(4UL, Assert.IsType<UnknownFrame>(message).MessageType);
  }

  [Fact]
  public void RefusesToEncodeAnUnknownFrame()
  {
    Assert.Throws<ArgumentException>(() => SyncWire.Encode(new UnknownFrame(4)));
  }

  [Theory]
  [InlineData(0, 0L, Lineage)]
  [InlineData(-1, 0L, Lineage)]
  [InlineData(1, -1L, Lineage)]
  [InlineData(1, 0L, "")]
  [InlineData(1, 0L, "0123456789abcdef0123456789abcde")]
  [InlineData(1, 0L, "0123456789ABCDEF0123456789ABCDEF")]
  public void RefusesToEncodeAnInvalidControlTag(int format, long epoch, string lineage)
  {
    Assert.Throws<ArgumentException>(() =>
        SyncWire.Encode(new BlokControlFrame(new CollabWorkingSetTag(format, epoch, lineage))));
  }

  [Fact]
  public void RefusesToEncodeAnEmptyPayload()
  {
    Assert.Throws<ArgumentException>(() => SyncWire.Encode(new SyncStep1Frame([])));
    Assert.Throws<ArgumentException>(() => SyncWire.Encode(new SyncStep2Frame([])));
    Assert.Throws<ArgumentException>(() => SyncWire.Encode(new SyncUpdateFrame([])));
    Assert.Throws<ArgumentException>(() => SyncWire.Encode(new AwarenessFrame([])));
  }

  public static TheoryData<string, byte[]> MalformedFrames => new()
  {
    { "empty frame", [] },
    { "sync without sub-type", [0x00] },
    { "sync without length", [0x00, 0x00] },
    { "length beyond remaining bytes", [0x00, 0x00, 0x05, 0x01, 0x02] },
    { "trailing bytes", [0x00, 0x00, 0x01, 0x00, 0xff] },
    { "empty sync payload", [0x00, 0x02, 0x00] },
    { "empty awareness payload", [0x01, 0x00] },
    { "unknown sync sub-type", [0x00, 0x03, 0x01, 0x00] },
    { "unknown auth sub-type", [0x02, 0x01, 0x00] },
    { "auth without reason", [0x02, 0x00] },
    { "invalid utf-8 reason", [0x02, 0x00, 0x01, 0xff] },
    { "query awareness with payload", [0x03, 0x00] },
    { "unterminated varuint", [0x80, 0x80] },
    {
      "varuint longer than 64 bits",
      [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]
    },
    {
      "varuint overflowing 64 bits",
      [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02]
    },
    { "control without payload", [0x64] },
    { "control with malformed json", [0x64, 0x01, (byte)'{'] },
    { "control that is not an object", [0x64, 0x01, (byte)'7'] },
    { "control missing format", ControlFrame("{\"epoch\":7,\"lineage\":\"" + Lineage + "\"}") },
    { "control missing epoch", ControlFrame("{\"format\":1,\"lineage\":\"" + Lineage + "\"}") },
    { "control missing lineage", ControlFrame("{\"epoch\":7,\"format\":1}") },
    { "control with negative epoch", ControlFrame(Control(-1, 1, Lineage)) },
    { "control with zero format", ControlFrame(Control(7, 0, Lineage)) },
    { "control with fractional epoch", ControlFrame("{\"epoch\":7.5,\"format\":1,\"lineage\":\"" + Lineage + "\"}") },
    { "control with string epoch", ControlFrame("{\"epoch\":\"7\",\"format\":1,\"lineage\":\"" + Lineage + "\"}") },
    { "control with numeric lineage", ControlFrame("{\"epoch\":7,\"format\":1,\"lineage\":7}") },
    { "control with a short lineage", ControlFrame(Control(7, 1, "0123456789abcdef0123456789abcde")) },
    { "control with a long lineage", ControlFrame(Control(7, 1, Lineage + "0")) },
    { "control with an upper-case lineage", ControlFrame(Control(7, 1, "0123456789ABCDEF0123456789ABCDEF")) },
    { "control with a non-hex lineage", ControlFrame(Control(7, 1, "0123456789abcdef0123456789abcdeg")) },
    { "control with extra property", ControlFrame("{\"epoch\":7,\"format\":1,\"lineage\":\"" + Lineage + "\",\"x\":1}") },
    { "control with duplicate epoch", ControlFrame("{\"epoch\":7,\"format\":1,\"lineage\":\"" + Lineage + "\",\"epoch\":8}") },
    { "control with duplicate lineage", ControlFrame("{\"epoch\":7,\"format\":1,\"lineage\":\"" + Lineage + "\",\"lineage\":\"" + Lineage + "\"}") },
    { "control with trailing json", ControlFrame(Control(7, 1, Lineage) + "1") },
  };

  [Theory]
  [MemberData(nameof(MalformedFrames))]
  public void RejectsAMalformedFrame(string description, byte[] frame)
  {
    Assert.False(SyncWire.TryDecode(frame, out _, out var error), description);
    Assert.NotEqual("", error);
  }

  [Fact]
  public void ReadsATenByteVarUint()
  {
    var frame = SyncWire.Encode(new BlokControlFrame(Tag));
    ReadOnlySpan<byte> maximum =
    [
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x42,
    ];

    Assert.True(SyncWire.TryReadVarUint(ref maximum, out var value));
    Assert.Equal(ulong.MaxValue, value);
    Assert.Equal(1, maximum.Length);

    ReadOnlySpan<byte> input = frame;
    Assert.True(SyncWire.TryReadVarUint(ref input, out var type));
    Assert.Equal(SyncWire.MessageBlokControl, type);
    Assert.True(SyncWire.TryReadVarBytes(ref input, out var payload));
    Assert.Equal(Control(7, 1, Lineage), Encoding.UTF8.GetString(payload));
    Assert.True(input.IsEmpty);
  }

  private static string Control(long epoch, int format, string lineage)
  {
    return $"{{\"epoch\":{epoch},\"format\":{format},\"lineage\":\"{lineage}\"}}";
  }

  /// <summary>A control frame carrying <paramref name="json"/> verbatim (payloads here stay under 128 bytes).</summary>
  private static byte[] ControlFrame(string json)
  {
    var payload = Encoding.UTF8.GetBytes(json);

    return [(byte)SyncWire.MessageBlokControl, (byte)payload.Length, .. payload];
  }

  private static void AssertSameMessage(SyncWireMessage expected, SyncWireMessage actual)
  {
    Assert.IsType(expected.GetType(), actual);

    switch (expected)
    {
      case SyncStep1Frame step1:
        Assert.Equal(step1.StateVector, ((SyncStep1Frame)actual).StateVector);
        break;
      case SyncStep2Frame step2:
        Assert.Equal(step2.Update, ((SyncStep2Frame)actual).Update);
        break;
      case SyncUpdateFrame update:
        Assert.Equal(update.Update, ((SyncUpdateFrame)actual).Update);
        break;
      case AwarenessFrame awareness:
        Assert.Equal(awareness.Update, ((AwarenessFrame)actual).Update);
        break;
      default:
        Assert.Equal(expected, actual);
        break;
    }
  }
}
