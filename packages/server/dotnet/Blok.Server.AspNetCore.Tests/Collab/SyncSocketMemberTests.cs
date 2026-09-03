using Blok.Server.AspNetCore.Collab;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>The room-facing side of a connection: enqueue-only, never blocks, bounded backlog.</summary>
public sealed class SyncSocketMemberTests
{
  [Fact]
  public void SendNeverBlocksAndAFrameAlwaysFitsWhenTheBacklogIsWithinBudget()
  {
    var member = new SyncSocketMember(canWrite: true, acceptsControlFrames: true, maxQueuedBytes: 10);

    member.Send(new byte[8]);
    member.Send(new byte[8]);

    Assert.Null(member.RequestedClose);
  }

  [Fact]
  public void ABacklogOverBudgetClosesTheSlowConsumerInsteadOfGrowingForever()
  {
    var member = new SyncSocketMember(canWrite: true, acceptsControlFrames: true, maxQueuedBytes: 10);

    member.Send(new byte[8]);
    member.Send(new byte[8]);
    member.Send(new byte[1]);

    Assert.Equal(SyncClose.SlowConsumer, member.RequestedClose);
  }

  [Fact]
  public void TheFirstCloseWinsAndMapsTheRoomReasons()
  {
    var reset = new SyncSocketMember(canWrite: false, acceptsControlFrames: false, maxQueuedBytes: 10);
    var draining = new SyncSocketMember(canWrite: false, acceptsControlFrames: false, maxQueuedBytes: 10);

    reset.Close(CollabCloseReason.Reset);
    reset.Close(CollabCloseReason.Draining);
    draining.Close(CollabCloseReason.Draining);
    draining.Send([1]);

    Assert.Equal(4409, (int)reset.RequestedClose!.Value.Status);
    Assert.Equal("document reset", reset.RequestedClose.Value.Reason);
    Assert.Equal(1001, (int)draining.RequestedClose!.Value.Status);
    Assert.Equal("server shutting down", draining.RequestedClose.Value.Reason);
  }

  [Fact]
  public void RepeatedBadAwarenessClosesAsAPolicyViolation()
  {
    var member = new SyncSocketMember(canWrite: false, acceptsControlFrames: true, maxQueuedBytes: 10);

    member.Close(CollabCloseReason.BadAwareness);

    Assert.Equal(1008, (int)member.RequestedClose!.Value.Status);
    Assert.Equal("malformed awareness", member.RequestedClose.Value.Reason);
  }

  /// <summary>A value outside the enum still closes 1011 instead of throwing inside the room's lane.</summary>
  [Fact]
  public void AnUnmappedReasonClosesAsAnInternalError()
  {
    var member = new SyncSocketMember(canWrite: false, acceptsControlFrames: true, maxQueuedBytes: 10);

    member.Close((CollabCloseReason)99);

    Assert.Equal(1011, (int)member.RequestedClose!.Value.Status);
  }

  [Fact]
  public void CommitUnavailableMapsToTheRetryableCommitStatusWithItsOwnText()
  {
    var frame = SyncClose.For(CollabCloseReason.CommitUnavailable);

    Assert.Equal(4503, (int)frame.Status);
    Assert.Equal("commit unavailable, retry", frame.Reason);
  }

  [Fact]
  public void CommitUnavailableSharesSeedFailedsStatusButNotItsText()
  {
    var frame = SyncClose.For(CollabCloseReason.CommitUnavailable);

    Assert.Equal(SyncClose.SeedFailed.Status, frame.Status);
    Assert.NotEqual(SyncClose.SeedFailed.Reason, frame.Reason);
  }

  [Fact]
  public void CommitUnavailableDoesNotFallThroughToTheInternalErrorFrame()
  {
    Assert.NotEqual(SyncClose.Internal, SyncClose.For(CollabCloseReason.CommitUnavailable));
  }

  [Fact]
  public void ResetKeepsItsOwnStatusAndText()
  {
    var frame = SyncClose.For(CollabCloseReason.Reset);

    Assert.Equal(4409, (int)frame.Status);
    Assert.Equal("document reset", frame.Reason);
  }
}
