using Blok.Server.Agent;
using Blok.Server.Tests.Collab;
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

  // H7/T18: steps go after an hour with no call. Exactly an hour is not past it, and both
  // Add and Top count as a call. The Go executor has the same test.
  [Fact]
  public void StepsGoAfterAnHourWithoutACall()
  {
    var time = new ManualTimeProvider();
    var history = new RoomAgentHistory(time);
    var first = new RoomAgentHistory.Step();

    history.Add("d", Actor, first);
    time.Advance(RoomAgentHistory.IdleLimit);
    Assert.Same(first, history.Top("d", Actor, undo: true));
    time.Advance(RoomAgentHistory.IdleLimit);
    Assert.Same(first, history.Top("d", Actor, undo: true));

    var second = new RoomAgentHistory.Step();
    history.Add("d", Actor, second);
    time.Advance(RoomAgentHistory.IdleLimit);
    Assert.Same(second, history.Top("d", Actor, undo: true));

    time.Advance(RoomAgentHistory.IdleLimit + TimeSpan.FromMilliseconds(1));
    Assert.Null(history.Top("d", Actor, undo: true));
  }

  // T1: the char cap counts the escaped JSON text in UTF-16 units. The Go room history has the same test.
  [Fact]
  public void AStepCountsItsEscapedJsonText()
  {
    var step = new RoomAgentHistory.Step { Before = new System.Text.Json.Nodes.JsonObject { ["t"] = "\U0001F680<a>&'+\u00E9" } };

    Assert.Equal("{\"t\":\"\\uD83D\\uDE80\\u003Ca\\u003E\\u0026\\u0027\\u002B\\u00E9\"}", step.Before.ToJsonString());
    Assert.Equal(57 + 2, step.Chars);
  }
}
