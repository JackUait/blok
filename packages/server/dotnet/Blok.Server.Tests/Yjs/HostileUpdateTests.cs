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
}
