using System.Net.WebSockets;
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
  public void ABacklogExactlyAtTheBudgetStillAdmitsTheNextFrame()
  {
    var member = new SyncSocketMember(canWrite: true, acceptsControlFrames: true, maxQueuedBytes: 10);

    member.Send(new byte[10]);
    member.Send(new byte[1]);

    Assert.Null(member.RequestedClose);

    member.Send(new byte[1]);

    Assert.Equal(SyncClose.SlowConsumer, member.RequestedClose);
  }

  [Fact]
  public void TheFirstNonForbiddenCloseWinsAndMapsTheRoomReasons()
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

  [Fact]
  public async Task RevocationOverridesAQueuedSlowConsumerClose()
  {
    var member = new SyncSocketMember(canWrite: false, acceptsControlFrames: true, maxQueuedBytes: 1);
    member.Send([1]);
    member.Send([2]);
    member.Send([3]);
    var queuedClose = member.RequestedClose;
    member.Close(CollabCloseReason.Forbidden);
    using var socket = new RecordingSocket();

    await member.RunAsync(socket, null, 1024, null, CancellationToken.None);

    Assert.Empty(socket.SentFrames);
    Assert.Equal((WebSocketCloseStatus)4403, socket.CloseStatus);
    Assert.Equal("forbidden", socket.CloseStatusDescription);
    Assert.Equal(SyncClose.SlowConsumer, queuedClose);
  }

  /// <summary>
  /// A refused frame leaves the runtime's socket Aborted with its close still
  /// on the way out. The connection stays counted against its user until the
  /// peer ends its side, so faulting sockets cannot pass the per-user cap.
  /// </summary>
  [Fact]
  public async Task AFaultedSocketKeepsItsLeaseUntilThePeerEndsItsSide()
  {
    var member = new SyncSocketMember(
        canWrite: false, acceptsControlFrames: false, maxQueuedBytes: 10, closeGrace: TimeSpan.FromMinutes(1));
    var lease = new RecordingLease();
    using var socket = new FaultedSocket(new WebSocketException(WebSocketError.Faulted), lease);
    using var peer = new CancellationTokenSource();

    var run = member.RunAsync(socket, null, 1024, lease, peer.Token);
    await socket.CloseSent.WaitAsync(Deadline.Token());

    Assert.False(socket.LeaseDisposedAtClose);
    Assert.False(lease.Disposed);

    await peer.CancelAsync();
    await run.WaitAsync(Deadline.Token());

    Assert.True(lease.Disposed);
  }

  /// <summary>A peer that never ends its side holds the socket only briefly, however long the close grace.</summary>
  [Fact]
  public async Task AFaultedSocketWaitsOnlyBrieflyForAPeerThatStays()
  {
    var member = new SyncSocketMember(
        canWrite: false, acceptsControlFrames: false, maxQueuedBytes: 10, closeGrace: TimeSpan.FromMinutes(1));
    var lease = new RecordingLease();
    using var socket = new FaultedSocket(new WebSocketException(WebSocketError.Faulted), lease);

    await member.RunAsync(socket, null, 1024, lease, CancellationToken.None).WaitAsync(Deadline.Token());

    Assert.True(lease.Disposed);
  }

  /// <summary>Our own abort surfaces as a cancelled receive: the connection is already torn down, so nothing waits.</summary>
  [Fact]
  public async Task ASocketAbortedByTheServerDoesNotWait()
  {
    var member = new SyncSocketMember(
        canWrite: false, acceptsControlFrames: false, maxQueuedBytes: 10, closeGrace: TimeSpan.FromMinutes(1));
    var lease = new RecordingLease();
    using var socket = new FaultedSocket(new OperationCanceledException(), lease);
    var started = DateTime.UtcNow;

    await member.RunAsync(socket, null, 1024, lease, CancellationToken.None).WaitAsync(Deadline.Token());

    Assert.True(DateTime.UtcNow - started < TimeSpan.FromMilliseconds(500));
    Assert.True(lease.Disposed);
  }

  private sealed class RecordingLease : IDisposable
  {
    internal bool Disposed { get; private set; }

    public void Dispose() => Disposed = true;
  }

  /// <summary>A socket whose receive fails the way the runtime's does, then reports Aborted.</summary>
  private sealed class FaultedSocket(Exception receiveError, RecordingLease lease) : WebSocket
  {
    private readonly TaskCompletionSource closeSent = new(TaskCreationOptions.RunContinuationsAsynchronously);

    internal Task CloseSent => closeSent.Task;

    internal bool LeaseDisposedAtClose { get; private set; }

    public override WebSocketCloseStatus? CloseStatus => null;

    public override string? CloseStatusDescription => null;

    public override WebSocketState State => WebSocketState.Aborted;

    public override string? SubProtocol => null;

    public override void Abort()
    {
    }

    public override Task CloseAsync(
        WebSocketCloseStatus closeStatus,
        string? statusDescription,
        CancellationToken cancellationToken) => throw new NotSupportedException();

    public override Task CloseOutputAsync(
        WebSocketCloseStatus closeStatus,
        string? statusDescription,
        CancellationToken cancellationToken)
    {
      LeaseDisposedAtClose = lease.Disposed;
      closeSent.TrySetResult();

      return Task.CompletedTask;
    }

    public override void Dispose()
    {
    }

    public override Task<WebSocketReceiveResult> ReceiveAsync(
        ArraySegment<byte> buffer,
        CancellationToken cancellationToken) => Task.FromException<WebSocketReceiveResult>(receiveError);

    public override Task SendAsync(
        ArraySegment<byte> buffer,
        WebSocketMessageType messageType,
        bool endOfMessage,
        CancellationToken cancellationToken) => Task.CompletedTask;
  }

  private sealed class RecordingSocket : WebSocket
  {
    private WebSocketCloseStatus? closeStatus;
    private string? closeStatusDescription;

    internal List<byte[]> SentFrames { get; } = [];

    public override WebSocketCloseStatus? CloseStatus => closeStatus;

    public override string? CloseStatusDescription => closeStatusDescription;

    public override WebSocketState State => WebSocketState.Open;

    public override string? SubProtocol => null;

    public override void Abort() => throw new NotSupportedException();

    public override Task CloseAsync(
        WebSocketCloseStatus closeStatus,
        string? statusDescription,
        CancellationToken cancellationToken) => throw new NotSupportedException();

    public override Task CloseOutputAsync(
        WebSocketCloseStatus closeStatus,
        string? statusDescription,
        CancellationToken cancellationToken)
    {
      this.closeStatus = closeStatus;
      closeStatusDescription = statusDescription;

      return Task.CompletedTask;
    }

    public override void Dispose()
    {
    }

    public override Task<WebSocketReceiveResult> ReceiveAsync(
        ArraySegment<byte> buffer,
        CancellationToken cancellationToken) =>
        Task.FromResult(new WebSocketReceiveResult(0, WebSocketMessageType.Close, true));

    public override Task SendAsync(
        ArraySegment<byte> buffer,
        WebSocketMessageType messageType,
        bool endOfMessage,
        CancellationToken cancellationToken)
    {
      SentFrames.Add(buffer.ToArray());

      return Task.CompletedTask;
    }
  }
}
