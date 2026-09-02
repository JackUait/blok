using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The fake operation store is what Wave 3's room tests drive, so its
/// contract-shaped behaviour — sequences from 1, deduplication by operation id,
/// the fence — is pinned here rather than assumed.
/// </summary>
public sealed class FakeCollabOperationStoreTests
{
  private const string DocId = "doc";

  [Fact]
  public async Task AssignsSequencesFromOneAndExposesCommittedRecords()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);

    var first = await session.AppendAsync(Candidate("a", update: 1));
    var second = await session.AppendAsync(Candidate("b", update: 2));

    Assert.Equal(CollabOperationAppendOutcome.Committed, first.Outcome);
    Assert.Equal(1UL, first.ServerSequence);
    Assert.Equal(CollabOperationAppendOutcome.Committed, second.Outcome);
    Assert.Equal(2UL, second.ServerSequence);
    Assert.Equal(["a", "b"], store.Committed(DocId).Select(record => record.OperationId));
    Assert.Equal(2UL, store.Head(DocId)?.DurableThrough);
  }

  [Fact]
  public async Task ReportsWhetherAnOperationIdIsAlreadyCommitted()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);

    var unseen = await session.FindCommittedAsync("a", Digest(1));
    await session.AppendAsync(Candidate("a", update: 1));
    var retry = await session.FindCommittedAsync("a", Digest(1));
    var reused = await session.FindCommittedAsync("a", Digest(9));

    Assert.Equal(CollabOperationLookupOutcome.NotCommitted, unseen.Outcome);
    Assert.Equal(0UL, unseen.ServerSequence);
    Assert.Equal(CollabOperationLookupOutcome.Duplicate, retry.Outcome);
    Assert.Equal(1UL, retry.ServerSequence);
    Assert.Equal(CollabOperationLookupOutcome.Conflict, reused.Outcome);
    Assert.Equal(1UL, reused.ServerSequence);
    // The answer covers this session's own commit, not the state at open —
    // a lookup that lagged behind the append would not be worth making.
    Assert.Empty(session.OpenResult.Tail);
  }

  [Fact]
  public async Task DeduplicatesARetryAndConflictsOnADifferentDigest()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    await session.AppendAsync(Candidate("a", update: 1));

    var retry = await session.AppendAsync(Candidate("a", update: 1));
    var reused = await session.AppendAsync(Candidate("a", update: 9));

    Assert.Equal(CollabOperationAppendOutcome.Duplicate, retry.Outcome);
    Assert.Equal(1UL, retry.ServerSequence);
    Assert.Equal(CollabOperationAppendOutcome.Conflict, reused.Outcome);
    Assert.Equal(1UL, reused.ServerSequence);
    Assert.Single(store.Committed(DocId));
  }

  [Fact]
  public async Task FailsAnAppendWithoutJournallingIt()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    store.FailAppends = _ => new IOException("disk");

    await Assert.ThrowsAsync<IOException>(async () =>
        await session.AppendAsync(Candidate("a", update: 1)));

    Assert.Empty(store.Committed(DocId));
  }

  [Fact]
  public async Task KeepsAnUnknownOutcomeDurableSoTheRetryReadsAsADuplicate()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    store.FailAppends = _ => new IOException("acknowledgement lost");
    store.CommitBeforeFailing = true;

    await Assert.ThrowsAsync<IOException>(async () =>
        await session.AppendAsync(Candidate("a", update: 1)));

    // The caller saw a failure; the store is durable. That gap is the whole
    // point of retrying the same operation id.
    Assert.Single(store.Committed(DocId));
    store.FailAppends = null;
    store.CommitBeforeFailing = false;

    var retry = await session.AppendAsync(Candidate("a", update: 1));

    Assert.Equal(CollabOperationAppendOutcome.Duplicate, retry.Outcome);
    Assert.Equal(1UL, retry.ServerSequence);
  }

  [Fact]
  public async Task HoldsAnAppendUntilTheStoreIsReleased()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeAppend = () => release.Task;

    var append = session.AppendAsync(Candidate("a", update: 1)).AsTask();

    Assert.False(append.IsCompleted);
    Assert.Empty(store.Committed(DocId));
    release.SetResult();

    Assert.Equal(CollabOperationAppendOutcome.Committed, (await append).Outcome);
  }

  [Fact]
  public async Task ReportsASecondOpenAsHeldElsewhereUntilTheFirstIsDisposed()
  {
    var store = new FakeCollabOperationStore();
    var first = await store.OpenAsync(DocId);

    var second = await store.OpenAsync(DocId);

    Assert.Equal(CollabDocumentOpenOutcome.DocumentOpenElsewhere, second.Outcome);
    Assert.Null(second.Session);

    await first.Session!.DisposeAsync();

    Assert.Equal(
        CollabDocumentOpenOutcome.Opened,
        (await store.OpenAsync(DocId)).Outcome);
  }

  [Fact]
  public async Task RefusesEveryCallOnceTheFenceIsLost()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    store.StealFence(DocId);

    await Assert.ThrowsAsync<CollabOperationFenceLostException>(async () =>
        await session.AppendAsync(Candidate("a", update: 1)));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(async () =>
        await session.WriteCheckpointAsync(new CollabOperationCheckpoint(1, new byte[] { 7 })));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(async () =>
        await session.ResetAsync(Reset(epoch: 2)));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(async () =>
        await session.FindCommittedAsync("a", Digest(1)));
    Assert.Empty(store.Committed(DocId));
  }

  [Fact]
  public async Task OpensAnUnseededDocumentWithNoHead()
  {
    var store = new FakeCollabOperationStore();
    var open = await store.OpenAsync(DocId);
    await using var session = open.Session!;

    Assert.Null(session.OpenResult.Head);
    Assert.Empty(session.OpenResult.Baseline);
    Assert.Empty(session.OpenResult.Tail);
    Assert.Null(session.OpenResult.Checkpoint);

    var head = await session.ResetAsync(Reset(epoch: 0));

    Assert.Equal(0UL, head.DurableThrough);
    // OpenResult is the state at open and never moves with the session.
    Assert.Null(session.OpenResult.Head);
  }

  [Fact]
  public async Task HandsTheCheckpointAndTheTailAfterItToTheNextOpen()
  {
    var store = new FakeCollabOperationStore();
    await using (var writer = await OpenSeededAsync(store))
    {
      await writer.AppendAsync(Candidate("a", update: 1));
      await writer.AppendAsync(Candidate("b", update: 2));
      await writer.WriteCheckpointAsync(new CollabOperationCheckpoint(1, new byte[] { 42 }));
    }

    await using var session = (await store.OpenAsync(DocId)).Session!;

    Assert.Equal(1UL, session.OpenResult.Checkpoint?.Through);
    Assert.Equal(["b"], session.OpenResult.Tail.Select(record => record.OperationId));
    Assert.Equal(2UL, session.OpenResult.Head?.DurableThrough);
  }

  [Fact]
  public async Task RefusesACheckpointPastTheCommittedSequence()
  {
    var store = new FakeCollabOperationStore();
    await using var session = await OpenSeededAsync(store);
    await session.AppendAsync(Candidate("a", update: 1));

    await Assert.ThrowsAsync<ArgumentOutOfRangeException>(async () =>
        await session.WriteCheckpointAsync(new CollabOperationCheckpoint(2, new byte[] { 42 })));
  }

  private static async Task<ICollabOperationSession> OpenSeededAsync(
      FakeCollabOperationStore store)
  {
    var session = (await store.OpenAsync(DocId)).Session!;
    await session.ResetAsync(Reset(epoch: 0));

    return session;
  }

  private static CollabOperationReset Reset(long epoch)
  {
    return new CollabOperationReset(
        CollabWorkingSetTag.SchemaV2,
        epoch,
        new string('a', CollabWorkingSetTag.LineageLength),
        []);
  }

  private static CollabOperationCandidate Candidate(string operationId, byte update)
  {
    return new CollabOperationCandidate(
        operationId,
        ActorId: "actor",
        CollabOperationSource.ClientV2,
        new byte[] { update },
        Digest(update));
  }

  private static ReadOnlyMemory<byte> Digest(byte update)
  {
    return System.Security.Cryptography.SHA256.HashData([update]);
  }
}
