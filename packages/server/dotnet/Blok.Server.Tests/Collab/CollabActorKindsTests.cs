using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>A ticket's user is whatever the host minted, so its text never makes it an agent.</summary>
public sealed class CollabActorKindsTests
{
  [Theory]
  [InlineData("agent:alice:claude-code")]
  [InlineData("agent:alice")]
  [InlineData("agent:")]
  public void AnIdThatLooksLikeAnAgentIsStillAPerson(string actorId)
  {
    var note = CollabActorKinds.Classify(actorId);

    Assert.Equal(new CollabRecordNote("person"), note);
    Assert.Equal((actorId, (string?)null), CollabActorKinds.Attribution(actorId, note));
  }
}
