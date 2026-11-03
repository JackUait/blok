using Blok.Server.Agent;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class RoomAgentHistoryTests
{
  private static readonly BlokAgentActor Actor = new("agent-cs", "Agent");

  // Only done steps are trimmed: with the redo side full, a page action (which keeps the
  // redo side) evicts the very step it adds. The Go room history has the same test.
  [Fact]
  public void AFullRedoSideEvictsThePageActionJustAdded()
  {
    var history = new RoomAgentHistory(TimeProvider.System);

    for (var index = 0; index < RoomAgentHistory.MaxSteps; index++)
    {
      history.Add("d", Actor, new RoomAgentHistory.Step());
    }
    for (var index = 0; index < RoomAgentHistory.MaxSteps; index++)
    {
      Assert.True(history.Replayed("d", Actor, history.Top("d", Actor, undo: true)!, undo: true, []));
    }

    history.Add("d", Actor, new RoomAgentHistory.Step { Other = true });

    Assert.Null(history.Top("d", Actor, undo: true));
    Assert.NotNull(history.Top("d", Actor, undo: false));

    var kept = new RoomAgentHistory.Step();
    history.Add("d", Actor, kept);

    Assert.Same(kept, history.Top("d", Actor, undo: true));
    Assert.Null(history.Top("d", Actor, undo: false));
  }
}
