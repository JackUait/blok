using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Well-formed bytes that describe an impossible document. Each of these
/// passes <see cref="UpdateInspector"/> — they are not malformed, they are
/// dishonest — and each used to escape as an exception the room reports as a
/// drop while the store had already changed underneath it.
///
/// The contract is that applying anything returns an <see cref="ApplyResult"/>
/// and leaves the document consistent with what it reports.
/// </summary>
public sealed class HostileUpdateTests
{
  /// <summary>
  /// Every case names a dependency on its OWN client that the store does not
  /// hold. yjs's three checks skip the store lookup for a same-client id
  /// because a well-formed update always carries the earlier clock first.
  /// </summary>
  public static TheoryData<string, string> SameClientDependencies()
  {
    return new TheoryData<string, string>
    {
      { "a parent that is the item itself", "AQEBACgAAQABawF+AA==" },
      { "a parent at a clock this client has not reached", "AQEBACgAAQkBawF+AA==" },
      { "an origin at a clock this client has not reached", "AQEBAIgBCQF+AA==" },
      { "a right origin at a clock this client has not reached", "AQEBAEgBCQF+AA==" },
    };
  }

  [Theory]
  [MemberData(nameof(SameClientDependencies))]
  public void AnUnreachableSameClientDependencyParksInsteadOfThrowing(string what, string update)
  {
    Assert.NotNull(what);

    var doc = new YDoc(1000);
    var bytes = Convert.FromBase64String(update);

    Assert.Equal(UpdateVerdict.Ok, UpdateInspector.Inspect(bytes).Verdict);

    var result = doc.ApplyUpdate(bytes);

    Assert.Equal(ApplyOutcome.Applied, result.Outcome);
    Assert.True(result.PendingRemains);
  }

  /// <summary>
  /// A live map head whose content holds no value for its own last tick. yjs
  /// indexes the same slot and JavaScript hands back undefined; indexing it
  /// here threw, and the converter reads every key of the blocks map through
  /// this call, so one such item made the whole document unexportable. The
  /// room treats a failed export as retryable, so it went on accepting and
  /// relaying edits while nothing was ever persisted again.
  /// </summary>
  [Theory]
  [InlineData("a formatting mark", "AQHoBwAmAQFtAWsEYm9sZAR0cnVlAA==")]
  [InlineData("an empty string", "AQHoBwAkAQFtAWsAAA==")]
  [InlineData("an empty value run", "AQHoBwAoAQFtAWsAAA==")]
  [InlineData("an empty JSON run", "AQHoBwAiAQFtAWsAAA==")]
  public void AMapKeyWithNoValueReadsAsUndefined(string what, string update)
  {
    Assert.NotNull(what);

    var doc = new YDoc(1000);

    Assert.Equal(
        ApplyOutcome.Applied,
        doc.ApplyUpdate(Convert.FromBase64String(update)).Outcome);

    // The key exists, as yjs's has() reports, and reading it yields nothing.
    Assert.True(doc.GetMap("m").TryGet("k", out var value));
    Assert.Same(YUndefined.Instance, value);

    // An empty run put {1000: 0} in the state vector; the sync answer must
    // still encode.
    Assert.NotEmpty(doc.EncodeStateAsUpdate());
  }

  /// <summary>
  /// The input that found the length-0 crash. Its full bytes hit the open
  /// parentSub-bit difference with yjs, so only the vector and a clean
  /// encode are pinned. Twin of Go TestTheFuzzCrashInputEncodes.
  /// </summary>
  [Fact]
  public void TheFuzzCrashInputEncodes()
  {
    var doc = new YDoc(4242);

    Assert.Equal(
        ApplyOutcome.Applied,
        doc.ApplyUpdate(Convert.FromHexString("0102e80700220101300130002100e8303001303000")).Outcome);
    Assert.NotEmpty(doc.EncodeStateAsUpdate());
    Assert.Equal("AegHAA==", Convert.ToBase64String(doc.EncodeStateVector()));
  }

  public static TheoryData<string, int> EmptyStructProbes()
  {
    var data = new TheoryData<string, int>();

    foreach (var golden in YjsEngineFixtures.Cases("empty-structs.json"))
    {
      var probes = golden!["probes"]?.AsArray();

      for (var index = 0; probes is not null && index < probes.Count; index++)
      {
        data.Add(golden["name"]!.GetValue<string>(), index);
      }
    }

    return data;
  }

  /// <summary>
  /// Each probe runs on a fresh doc as yjs ran it. yjs throws when a step
  /// deletes a length-0 item at clock 0, and then emits nothing.
  /// </summary>
  [Theory]
  [MemberData(nameof(EmptyStructProbes))]
  public void StepsAfterALengthZeroItemMatchYjs(string name, int index)
  {
    var golden = YjsEngineFixtures.Cases("empty-structs.json")
        .First(node => node!["name"]!.GetValue<string>() == name)!;
    var probe = golden["probes"]![index]!;
    var step = probe["step"]!.GetValue<string>();
    var own = step == "ownClient" ? probe["client"]!.GetValue<uint>() : 1001u;
    var doc = new YDoc(own) { Gc = false };

    foreach (var update in golden["updates"]!.AsArray())
    {
      doc.ApplyUpdate(Convert.FromBase64String(update!.GetValue<string>()));
    }

    if (step == "ownClient")
    {
      Assert.Equal(probe["clientIdChanged"]!.GetValue<bool>(), doc.ClientId != own);
      return;
    }

    var emitted = new List<string>();
    doc.UpdateEmitted += update => emitted.Add(Convert.ToBase64String(update.Update));
    var map = doc.GetMap("m");
    var key = probe["key"]?.GetValue<string>() ?? "";
    var threw = false;

    try
    {
      switch (step)
      {
        case "apply":
          doc.ApplyUpdate(Convert.FromBase64String(probe["update"]!.GetValue<string>()));
          break;
        case "map.set":
          doc.Transact(transaction => map.Set(transaction, key, ScenarioSupport.BuildValue(probe["value"])));
          break;
        default:
          doc.Transact(transaction => map.Remove(transaction, key));
          break;
      }
    }
    catch (InvalidOperationException)
    {
      threw = true;
    }

    Assert.Equal(probe["throws"] is not null, threw);
    Assert.Equal(probe["emitted"]!.AsArray().Select(node => node!.GetValue<string>()), emitted);
  }

  public static TheoryData<string> EmptyStructCases()
  {
    return new TheoryData<string>(YjsEngineFixtures.Cases("empty-structs.json")
        .Select(node => node!["name"]!.GetValue<string>()));
  }

  /// <summary>
  /// yjs never writes a length-0 struct but accepts one, and then encodes the
  /// document: its findIndexSS tests the last struct for an exact clock
  /// first. Without that, every sync answer of the document threw.
  /// </summary>
  [Theory]
  [MemberData(nameof(EmptyStructCases))]
  public void ALengthZeroStructEncodesAsYjsDoes(string name)
  {
    var golden = YjsEngineFixtures.Cases("empty-structs.json")
        .First(node => node!["name"]!.GetValue<string>() == name)!;
    var doc = new YDoc(4242);

    foreach (var update in golden["updates"]!.AsArray())
    {
      doc.ApplyUpdate(Convert.FromBase64String(update!.GetValue<string>()));
    }

    Assert.Equal(golden["sv"]!.GetValue<string>(), Convert.ToBase64String(doc.EncodeStateVector()));
    Assert.Equal(golden["full"]!.GetValue<string>(), Convert.ToBase64String(doc.EncodeStateAsUpdate()));
    Assert.Equal(
        golden["diff"]!.GetValue<string>(),
        Convert.ToBase64String(doc.EncodeStateAsUpdate(
            Convert.FromBase64String(golden["behind"]!.GetValue<string>()))));
  }

  /// <summary>
  /// Two client groups where the second names an unreachable dependency. The
  /// integrator takes the higher client id first, so the first group is
  /// already in the store when the second is reached: a throw here left the
  /// document holding structs that were never emitted, so the room appended
  /// nothing to its log and told no peer.
  /// </summary>
  [Fact]
  public void APartlyImpossibleUpdateStillEmitsWhatItIntegrated()
  {
    var doc = new YDoc(1000);
    var emitted = new List<byte[]>();

    doc.UpdateEmitted += update => emitted.Add(update.Update);

    var result = doc.ApplyUpdate(
        Convert.FromBase64String("AgECACgBAW0EZ29vZAF4AQEAKAABAANiYWQBfgA="));

    Assert.Equal(ApplyOutcome.Applied, result.Outcome);
    Assert.Single(emitted);

    // What did integrate is readable, and what did not is parked rather than
    // silently present.
    Assert.True(doc.GetMap("m").TryGet("good", out var good));
    Assert.Equal(true, good);
    Assert.True(doc.HasPending);
  }

  /// <summary>
  /// A stacked struct whose own client integrates a later struct before the
  /// park. 2:0 copies clocks the store holds, with an origin on 1:0, so it is
  /// stacked; 1:0 waits on 2:10, so client 2's next struct, 2:3, integrates;
  /// then 1:0 still waits and the stack parks. Park steps client 2 back ONE
  /// struct from where it stood, so the parked tail is 2:3 — already
  /// integrated — and the copy 2:0 is gone, as in yjs. yjs then parks an
  /// encoded copy of 2:3, so a retry never rewires the live item.
  /// </summary>
  [Fact]
  public void AParkAfterTheStackedClientIntegratedKeepsTheIntegratedStructInItsTail()
  {
    var doc = new YDoc(1000);

    doc.ApplyUpdate(Convert.FromHexString("01010200040101740361626300"));
    var result = doc.ApplyUpdate(Convert.FromHexString(
        "020202008401000378797A840202016401010084020A017900"));

    Assert.True(result.PendingRemains);
    Assert.True(result.Changed);
    Assert.Equal("abcd", doc.GetText("t").ToString());
    Assert.Equal(
        ["1:0+1", "2:3+1"],
        (doc.Store.PendingStructs ?? []).Select(parked => $"{parked.Id.Client}:{parked.Id.Clock}+{parked.Length}"));
    Assert.Equal("010204", Convert.ToHexString(doc.EncodeStateVector()));
    Assert.Equal(
        "020202000401017403616263840202016401010084020A017900",
        Convert.ToHexString(doc.EncodeStateAsUpdate()));

    // The clocks 1:0 waits for arrive; the retry drops the parked 2:3 as held.
    var healed = doc.ApplyUpdate(Convert.FromHexString("010102048402030765666768696A6B00"));

    var replay = NodeReplay.Run(
        new Dictionary<string, string> { ["t"] = "text" },
        [
          Convert.FromHexString("01010200040101740361626300"),
          Convert.FromHexString("020202008401000378797A840202016401010084020A017900"),
          Convert.FromHexString("010102048402030765666768696A6B00"),
        ],
        null);

    // The retry must not touch the live 2:3: yjs parks an encoded copy.
    Assert.False(healed.PendingRemains);
    Assert.Equal("""{"t":{"$text":[{"insert":"abcdefghijky"}]}}""", replay.Json.ToJsonString());
    Assert.Equal("abcdefghijky", doc.GetText("t").ToString());
    Assert.Equal(replay.StateVector, doc.EncodeStateVector());
  }
}
