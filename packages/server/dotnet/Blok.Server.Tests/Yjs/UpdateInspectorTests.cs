using Blok.Server.Tests.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The pre-apply screen the room puts in front of the document. It refuses
/// bytes that do not parse and values that nest past the room's ceiling, and
/// it reports a NUL without refusing it — a NUL-bearing update is covered by
/// the sender's state vector, so dropping it would make every SyncStep2
/// resend it forever.
/// </summary>
public sealed class UpdateInspectorTests
{
  /// <summary>
  /// One block whose blocks-map key and id are "a\0b", written by yjs. Shared
  /// with YDocConverterHardeningTests.HostileNulUpdateExportsTheNulIntact.
  /// </summary>
  private const string NulCanary =
      "AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE" +
      "dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk" +
      "cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA";

  private const int DefaultMaxDepth = 256;

  public static TheoryData<string> CollabCases()
  {
    return new TheoryData<string>(YDocConverterFixtures.CaseNames());
  }

  public static TheoryData<string> NegativeCases()
  {
    return new TheoryData<string>(YjsEngineFixtures.Cases("negative.json")
        .Select(node => node?["name"]?.GetValue<string>() ??
            throw new InvalidDataException("negative.json holds a case with no name")));
  }

  [Theory]
  [MemberData(nameof(CollabCases))]
  public void OkForEveryCollabFixture(string name)
  {
    var inspection = UpdateInspector.Inspect(YDocConverterFixtures.Load(name).Update);

    Assert.Equal(UpdateVerdict.Ok, inspection.Verdict);
    Assert.Null(inspection.Reason);
    Assert.NotNull(inspection.Decoded);
  }

  [Fact]
  public void OkForTheNulCanaryAndReportsNul()
  {
    var inspection = UpdateInspector.Inspect(Convert.FromBase64String(NulCanary));

    Assert.Equal(UpdateVerdict.Ok, inspection.Verdict);
    Assert.True(inspection.Decoded!.ContainsNul());
  }

  [Theory]
  [MemberData(nameof(NegativeCases))]
  public void MalformedForEveryNegative(string name)
  {
    var golden = YjsEngineFixtures.Cases("negative.json")
        .FirstOrDefault(node => node?["name"]?.GetValue<string>() == name) ??
        throw new InvalidDataException($"negative.json has no case named {name}");

    var inspection = UpdateInspector.Inspect(
        Convert.FromBase64String(golden["update"]!.GetValue<string>()));

    Assert.Equal(UpdateVerdict.Malformed, inspection.Verdict);
    Assert.False(string.IsNullOrEmpty(inspection.Reason));
    Assert.Null(inspection.Decoded);
  }

  [Fact]
  public void TooDeepPastTheCap()
  {
    var atTheCap = UpdateInspector.Inspect(NestedArrayUpdate(DefaultMaxDepth));

    Assert.Equal(UpdateVerdict.Ok, atTheCap.Verdict);
    Assert.Equal(DefaultMaxDepth, atTheCap.Decoded!.MaxNestingDepth);

    var pastTheCap = UpdateInspector.Inspect(NestedArrayUpdate(DefaultMaxDepth + 1));

    Assert.Equal(UpdateVerdict.TooDeep, pastTheCap.Verdict);
    Assert.False(string.IsNullOrEmpty(pastTheCap.Reason));
    Assert.Null(pastTheCap.Decoded);

    // The cap is the caller's, not the codec's.
    Assert.Equal(
        UpdateVerdict.Ok,
        UpdateInspector.Inspect(NestedArrayUpdate(DefaultMaxDepth + 1), DefaultMaxDepth + 1)
            .Verdict);
  }

  /// <summary>One map key holding <paramref name="depth"/> nested Any arrays.</summary>
  private static byte[] NestedArrayUpdate(int depth)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint(1);
    writer.WriteVarUint(1);
    writer.WriteVarUint(1000);
    writer.WriteVarUint(0);
    // ContentAny with the parentSub bit; the parent is a root name.
    writer.WriteUint8(0x28);
    writer.WriteVarUint(1);
    writer.WriteVarString("m");
    writer.WriteVarString("k");
    writer.WriteVarUint(1);

    for (var level = 0; level < depth; level++)
    {
      writer.WriteUint8(117);
      writer.WriteVarUint(1);
    }

    writer.WriteUint8(126);
    writer.WriteVarUint(0);

    return writer.ToArray();
  }
}
