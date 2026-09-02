using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Blok.Server.Collab;
using Xunit;
using Xunit.Abstractions;

namespace Blok.Server.Tests.Collab;

public sealed class LocalCollabOperationStoreTests : IDisposable
{
  private const string DocId = "doc-1";

  // Offsets inside one encoded journal record, mirroring CollabJournalCodec's
  // layout. The tests craft bytes by hand, so they cannot go through the
  // encoder for the cases they exist to cover.
  private const int HeaderContentSize = 6;
  private const int HeaderSize = 38;
  private const int ChecksumSize = 32;
  private const int SequenceOffset = 16;
  private const int CommittedAtOffset = 24;
  private const int ActorIdLengthOffset = 32;

  private readonly string root = Path.Combine(
      Path.GetTempPath(),
      $"blok-collab-ops-{Guid.NewGuid():N}");
  private readonly List<string> logs = [];
  private readonly ITestOutputHelper output;

  public LocalCollabOperationStoreTests(ITestOutputHelper output)
  {
    this.output = output;
  }

  public void Dispose()
  {
    if (Directory.Exists(root))
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task AppendReopensAtTheAcknowledgedSequence()
  {
    var lineage = CollabWorkingSetTag.NewLineage();
    var acknowledged = new List<ulong>();
    byte[] manifestAtLastAck;
    long journalAtLastAck;

    await using (var session = await OpenAsync())
    {
      Assert.Null(session.OpenResult.Head);
      Assert.Empty(session.OpenResult.Baseline);
      Assert.Empty(session.OpenResult.Tail);

      var seeded = await session.ResetAsync(Reset(1, lineage, [0xb0]));
      Assert.Equal(0ul, seeded.DurableThrough);

      for (var n = 1; n <= 3; n++)
      {
        var result = await session.AppendAsync(Candidate(OperationId(n), [(byte)n]));
        Assert.Equal(CollabOperationAppendOutcome.Committed, result.Outcome);
        acknowledged.Add(result.ServerSequence);
      }

      manifestAtLastAck = File.ReadAllBytes(ManifestPath);
      journalAtLastAck = new FileInfo(JournalPath(1)).Length;
    }

    Assert.Equal<ulong[]>([1, 2, 3], [.. acknowledged]);

    // Disposal writes nothing, so what the reopen reads is exactly what the
    // last acknowledgement had already made durable.
    Assert.Equal(manifestAtLastAck, File.ReadAllBytes(ManifestPath));
    Assert.Equal(journalAtLastAck, new FileInfo(JournalPath(1)).Length);

    await using var reopened = await OpenAsync();
    var head = Assert.IsType<CollabDocumentHead>(reopened.OpenResult.Head);
    Assert.Equal(1, head.Format);
    Assert.Equal(1L, head.Epoch);
    Assert.Equal(lineage, head.Lineage);
    Assert.Equal(3ul, head.DurableThrough);
    Assert.Null(reopened.OpenResult.Checkpoint);
    Assert.Equal<byte[][]>(
        [[0xb0]],
        [.. reopened.OpenResult.Baseline.Select(frame => frame.ToArray())]);
    Assert.Equal<ulong[]>(
        [1, 2, 3],
        [.. reopened.OpenResult.Tail.Select(record => record.ServerSequence)]);
    Assert.Equal<byte[][]>(
        [[1], [2], [3]],
        [.. reopened.OpenResult.Tail.Select(record => record.Update.ToArray())]);
    Assert.Equal<string?[]>(
        ["user-1", "user-1", "user-1"],
        [.. reopened.OpenResult.Tail.Select(record => record.ActorId)]);
  }

  [Fact]
  public async Task DuplicateSameDigestReturnsTheOriginalCommit()
  {
    var update = new byte[] { 0x11, 0x22 };
    var digest = SHA256.HashData(update);

    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
      Assert.Equal(1ul, (await session.AppendAsync(Candidate(OperationId(1), update))).ServerSequence);
      Assert.Equal(2ul, (await session.AppendAsync(Candidate(OperationId(2), [0x33]))).ServerSequence);

      var lengthBefore = new FileInfo(JournalPath(1)).Length;
      var repeat = await session.AppendAsync(Candidate(OperationId(1), update));

      Assert.Equal(CollabOperationAppendOutcome.Duplicate, repeat.Outcome);
      Assert.Equal(1ul, repeat.ServerSequence);
      Assert.Equal(lengthBefore, new FileInfo(JournalPath(1)).Length);

      var lookup = await session.FindCommittedAsync(OperationId(1), digest);
      Assert.Equal(CollabOperationLookupOutcome.Duplicate, lookup.Outcome);
      Assert.Equal(1ul, lookup.ServerSequence);
    }

    await using var reopened = await OpenAsync();
    Assert.Equal(2ul, reopened.OpenResult.Head!.DurableThrough);

    var afterReopen = await reopened.AppendAsync(Candidate(OperationId(1), update));
    Assert.Equal(CollabOperationAppendOutcome.Duplicate, afterReopen.Outcome);
    Assert.Equal(1ul, afterReopen.ServerSequence);
  }

  [Fact]
  public async Task DuplicateDifferentDigestConflicts()
  {
    await using var session = await OpenAsync();
    await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
    await session.AppendAsync(Candidate(OperationId(1), [0x11]));

    var lengthBefore = new FileInfo(JournalPath(1)).Length;
    var reusedId = Candidate(OperationId(1), [0x11], digest: SHA256.HashData([0x99]));

    var conflict = await session.AppendAsync(reusedId);
    Assert.Equal(CollabOperationAppendOutcome.Conflict, conflict.Outcome);
    Assert.Equal(1ul, conflict.ServerSequence);
    Assert.Equal(lengthBefore, new FileInfo(JournalPath(1)).Length);

    var lookup = await session.FindCommittedAsync(OperationId(1), SHA256.HashData([0x99]));
    Assert.Equal(CollabOperationLookupOutcome.Conflict, lookup.Outcome);
    Assert.Equal(1ul, lookup.ServerSequence);
  }

  [Fact]
  public async Task AppendAndDedupeIndexShareOneDurabilityBoundary()
  {
    var snapshot = root + "-snapshot";
    var update = new byte[] { 0x42 };
    var digest = SHA256.HashData(update);

    try
    {
      await using (var session = await OpenAsync())
      {
        await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));

        var manifestBefore = File.ReadAllBytes(ManifestPath);
        var committed = await session.AppendAsync(Candidate(OperationId(1), update));
        Assert.Equal(CollabOperationAppendOutcome.Committed, committed.Outcome);

        // The acknowledgement crossed exactly one durability boundary: the
        // journal flush. Nothing else was written, so there is no second
        // record that a crash could lose while keeping the first.
        Assert.Equal(manifestBefore, File.ReadAllBytes(ManifestPath));

        // Disk exactly as it stood when the acknowledgement returned.
        CopyTree(root, snapshot);

        // A write that landed while its completion did not: the record is
        // durable and this session's memo of what it appended does not have it.
        // The retry that follows an unknown outcome is the one lookup that must
        // be answered from the bytes.
        AppendRaw(JournalPath(1), CollabJournalCodec.EncodeRecord(new CollabOperationRecord(
            OperationId(2),
            2,
            DateTimeOffset.UnixEpoch,
            "user-1",
            CollabOperationSource.ClientV2,
            new byte[] { 0x43 },
            SHA256.HashData([0x43]))));

        var readThrough = await session.FindCommittedAsync(OperationId(2), SHA256.HashData([0x43]));
        Assert.Equal(CollabOperationLookupOutcome.Duplicate, readThrough.Outcome);
        Assert.Equal(2ul, readThrough.ServerSequence);

        var afterTheUnknownOutcome = await session.AppendAsync(Candidate(OperationId(2), [0x43]));
        Assert.Equal(CollabOperationAppendOutcome.Duplicate, afterTheUnknownOutcome.Outcome);
        Assert.Equal(2ul, afterTheUnknownOutcome.ServerSequence);

        // The next real append continues after it instead of reusing sequence 2.
        var next = await session.AppendAsync(Candidate(OperationId(3), [0x44]));
        Assert.Equal(3ul, next.ServerSequence);
      }

      var recovered = new LocalCollabOperationStore(snapshot, log: logs.Add);
      var opened = await recovered.OpenAsync(DocId, CancellationToken.None);
      Assert.Equal(CollabDocumentOpenOutcome.Opened, opened.Outcome);

      await using var session2 = opened.Session!;
      Assert.Equal(1ul, session2.OpenResult.Head!.DurableThrough);
      Assert.Equal<byte[][]>(
          [update],
          [.. session2.OpenResult.Tail.Select(record => record.Update.ToArray())]);

      var lookup = await session2.FindCommittedAsync(OperationId(1), digest);
      Assert.Equal(CollabOperationLookupOutcome.Duplicate, lookup.Outcome);
      Assert.Equal(1ul, lookup.ServerSequence);

      var retry = await session2.AppendAsync(Candidate(OperationId(1), update));
      Assert.Equal(CollabOperationAppendOutcome.Duplicate, retry.Outcome);
      Assert.Equal(1ul, retry.ServerSequence);
    }
    finally
    {
      if (Directory.Exists(snapshot))
      {
        Directory.Delete(snapshot, recursive: true);
      }
    }
  }

  [Theory]
  [InlineData(1)] // fewer bytes than a complete header
  [InlineData(HeaderSize - 1)] // one byte short of a complete header
  [InlineData(HeaderSize)] // header complete, body absent
  [InlineData(HeaderSize + 7)] // header complete, body partial
  public async Task RecoveryTruncatesOnlyATornTail(int bytesOfTheKilledWrite)
  {
    var digests = new List<byte[]>();

    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));

      for (var n = 1; n <= 2; n++)
      {
        var candidate = Candidate(OperationId(n), [(byte)n]);
        digests.Add(candidate.Digest.ToArray());
        await session.AppendAsync(candidate);
      }
    }

    var intactLength = new FileInfo(JournalPath(1)).Length;

    // What a process killed mid-append leaves behind: the leading bytes of a
    // record whose write never finished, so nothing was ever acknowledged for
    // it.
    var neverAcknowledged = CollabJournalCodec.EncodeRecord(new CollabOperationRecord(
        OperationId(3),
        3,
        DateTimeOffset.UnixEpoch,
        "user-1",
        CollabOperationSource.ClientV2,
        new byte[] { 3 },
        SHA256.HashData([3])));
    AppendRaw(JournalPath(1), neverAcknowledged.AsSpan(0, bytesOfTheKilledWrite).ToArray());

    await using (var recovered = await OpenAsync())
    {
      Assert.Equal(2ul, recovered.OpenResult.Head!.DurableThrough);
      Assert.Equal<ulong[]>(
          [1, 2],
          [.. recovered.OpenResult.Tail.Select(record => record.ServerSequence)]);

      // Both acknowledged records survive with their dedupe entries.
      Assert.Equal(
          CollabOperationLookupOutcome.Duplicate,
          (await recovered.FindCommittedAsync(OperationId(1), digests[0])).Outcome);
      Assert.Equal(
          CollabOperationLookupOutcome.Duplicate,
          (await recovered.FindCommittedAsync(OperationId(2), digests[1])).Outcome);

      // The torn record was never acknowledged, so it is correctly absent.
      Assert.Equal(
          CollabOperationLookupOutcome.NotCommitted,
          (await recovered.FindCommittedAsync(OperationId(3), SHA256.HashData([3]))).Outcome);

      // The tail is gone from the file, so the next append lands at the right
      // offset rather than after a hole.
      Assert.Equal(intactLength, new FileInfo(JournalPath(1)).Length);

      var next = await recovered.AppendAsync(Candidate(OperationId(3), [3]));
      Assert.Equal(CollabOperationAppendOutcome.Committed, next.Outcome);
      Assert.Equal(3ul, next.ServerSequence);
    }

    await using var reopened = await OpenAsync();
    Assert.Equal(3ul, reopened.OpenResult.Head!.DurableThrough);
    Assert.Equal<ulong[]>(
        [1, 2, 3],
        [.. reopened.OpenResult.Tail.Select(record => record.ServerSequence)]);
  }

  [Theory]
  [InlineData("header-checksum", "the header checksum does not match its content")]
  [InlineData("version", "unsupported codec version 2")]
  [InlineData("source", "unknown operation source 200")]
  [InlineData("sequence-zero", "server sequence 0 means nothing was committed on this lineage")]
  [InlineData("committed-at", "committedAt is out of range")]
  [InlineData("actor-id-length", "the actor id length is invalid")]
  [InlineData("digest-truncated", "the digest is truncated")]
  [InlineData("update-length-missing", "the update length is missing")]
  [InlineData("trailing-bytes", "trailing byte(s) inside the record body")]
  [InlineData("body-checksum", "the body checksum does not match its content")]
  [InlineData("sequence-jump", "jumps from sequence 1 to 5")]
  [InlineData("duplicate-id", "commits the operation id 00000000000000000000000000000001 twice")]
  public async Task MiddleCorruptionFailsClosed(string mode, string expectedError)
  {
    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));

      // A null actor and a printable 32-byte digest keep every hand-crafted
      // length mutation below inside valid UTF-8, so each one reaches the
      // decode branch it is written for instead of failing earlier.
      await session.AppendAsync(new CollabOperationCandidate(
          OperationId(2),
          ActorId: null,
          CollabOperationSource.ClientV2,
          new byte[] { 0x0a, 0x0b, 0x0c, 0x0d },
          Encoding.ASCII.GetBytes("0123456789abcdef0123456789abcdef")));
      await session.AppendAsync(Candidate(OperationId(3), [0x03]));
    }

    var journal = File.ReadAllBytes(JournalPath(1));
    var offsets = RecordOffsets(journal);
    Assert.Equal(3, offsets.Count);
    Corrupt(journal, offsets[1].Offset, offsets[1].Length, mode);
    File.WriteAllBytes(JournalPath(1), journal);

    var failure = await Assert.ThrowsAsync<InvalidDataException>(
        async () => await new LocalCollabOperationStore(root, log: logs.Add)
            .OpenAsync(DocId, CancellationToken.None));
    Assert.Contains(expectedError, failure.Message, StringComparison.Ordinal);

    // Nothing is repaired, resynchronised, or discarded: the record after the
    // corrupt one cannot be located by any linear scanner, so the only safe
    // answer is to leave the bytes alone and refuse.
    Assert.Equal(journal, File.ReadAllBytes(JournalPath(1)));

    // The refused open released its hold, so a retry reports the corruption
    // again rather than reporting the document as held elsewhere.
    var retry = await Assert.ThrowsAsync<InvalidDataException>(
        async () => await new LocalCollabOperationStore(root, log: logs.Add)
            .OpenAsync(DocId, CancellationToken.None));
    Assert.Contains(expectedError, retry.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task SecondOpenFencesTheFirstSession()
  {
    await using var first = await OpenAsync();
    await first.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
    Assert.Equal(1ul, (await first.AppendAsync(Candidate(OperationId(1), [0x01]))).ServerSequence);

    // Losing the lock file is NOT losing the fence. Nobody has opened, so the
    // manifest's fence is untouched and this session keeps writing. An
    // implementation whose fence was really "is my lock file still the inode at
    // lockPath" is red here, which is the only thing separating the two.
    File.Delete(LockPath);

    var stillMine = await first.AppendAsync(Candidate(OperationId(2), [0x02]));
    Assert.Equal(CollabOperationAppendOutcome.Committed, stillMine.Outcome);
    Assert.Equal(2ul, stillMine.ServerSequence);

    // Now a second open takes a fresh inode's lock while the first session is
    // still alive — what a lock-less filesystem or a stale descriptor looks
    // like — and THAT is what fences it, by raising the manifest's fence.
    await using var second = await OpenAsync();
    Assert.Equal(2ul, second.OpenResult.Head!.DurableThrough);

    await Assert.ThrowsAsync<CollabOperationFenceLostException>(
        async () => await first.AppendAsync(Candidate(OperationId(3), [0x03])));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(
        async () => await first.FindCommittedAsync(OperationId(1), SHA256.HashData([0x01])));

    var winner = await second.AppendAsync(Candidate(OperationId(3), [0x03]));
    Assert.Equal(CollabOperationAppendOutcome.Committed, winner.Outcome);
    Assert.Equal(3ul, winner.ServerSequence);
  }

  [Fact]
  public async Task MissingJournalFileFailsClosed()
  {
    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
    }

    File.Delete(JournalPath(1));

    // Opening it OpenOrCreate would RECREATE it empty, and an empty lineage is
    // indistinguishable from a fresh one: the store would reassign sequence 1
    // and answer NotCommitted for an id that is committed — the exact failure
    // the seam's linearizability paragraph names.
    var failure = await Assert.ThrowsAsync<InvalidDataException>(
        async () => await new LocalCollabOperationStore(root, log: logs.Add)
            .OpenAsync(DocId, CancellationToken.None));
    Assert.Contains("journal.1", failure.Message, StringComparison.Ordinal);
    Assert.False(File.Exists(JournalPath(1)));

    // The refusal released its hold, so the retry reports the same loss.
    await Assert.ThrowsAsync<InvalidDataException>(
        async () => await new LocalCollabOperationStore(root, log: logs.Add)
            .OpenAsync(DocId, CancellationToken.None));
  }

  [Fact]
  public async Task StaleSessionCannotAppendCheckpointOrReset()
  {
    await using var stale = await OpenAsync();
    await stale.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
    await stale.AppendAsync(Candidate(OperationId(1), [0x01]));

    File.Delete(LockPath);
    await using var winner = await OpenAsync();

    var journalBefore = File.ReadAllBytes(JournalPath(1));
    var manifestBefore = File.ReadAllBytes(ManifestPath);

    await Assert.ThrowsAsync<CollabOperationFenceLostException>(
        async () => await stale.AppendAsync(Candidate(OperationId(2), [0x02])));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(
        async () => await stale.WriteCheckpointAsync(
            new CollabOperationCheckpoint(1, new byte[] { 0xcc })));
    await Assert.ThrowsAsync<CollabOperationFenceLostException>(
        async () => await stale.ResetAsync(Reset(9, CollabWorkingSetTag.NewLineage())));

    Assert.Equal(journalBefore, File.ReadAllBytes(JournalPath(1)));
    Assert.Equal(manifestBefore, File.ReadAllBytes(ManifestPath));
    Assert.Single(Directory.GetFiles(DocDirectory, "journal.*"));
    Assert.Empty(Directory.GetFiles(DocDirectory, "baseline.2"));
  }

  [Fact]
  public async Task AStaleSessionCannotAppendEvenWithItsFileHandleStillOpen()
  {
    byte[] journalBefore;

    await using (var stale = await OpenAsync())
    {
      await stale.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));

      // The append opens the journal handle the session would write through
      // next, and the session keeps it.
      await stale.AppendAsync(Candidate(OperationId(1), [0x01]));

      // A descriptor opened before the fence moved, standing in for the one the
      // stale session still holds.
      await using var descriptorFromBeforeTheFence = new FileStream(
          JournalPath(1),
          new FileStreamOptions
          {
            Access = FileAccess.ReadWrite,
            Mode = FileMode.Open,
            Share = FileShare.ReadWrite,
          });

      File.Delete(LockPath);

      await using (var winner = await OpenAsync())
      {
        journalBefore = File.ReadAllBytes(JournalPath(1));

        // Nothing at the OS level revoked write access from the stale side: the
        // old descriptor still reaches the bytes. Only the fence stops the
        // session.
        descriptorFromBeforeTheFence.Seek(0, SeekOrigin.End);
        descriptorFromBeforeTheFence.Write([0xff]);
        descriptorFromBeforeTheFence.Flush(flushToDisk: true);
        Assert.Equal(journalBefore.Length + 1, new FileInfo(JournalPath(1)).Length);
        descriptorFromBeforeTheFence.SetLength(journalBefore.Length);
        descriptorFromBeforeTheFence.Flush(flushToDisk: true);

        await Assert.ThrowsAsync<CollabOperationFenceLostException>(
            async () => await stale.AppendAsync(Candidate(OperationId(2), [0x02])));

        Assert.Equal(journalBefore, File.ReadAllBytes(JournalPath(1)));

        await winner.AppendAsync(Candidate(OperationId(3), [0x03]));
      }
    }

    await using var reopened = await OpenAsync();
    Assert.Equal<ulong[]>(
        [1, 2],
        [.. reopened.OpenResult.Tail.Select(record => record.ServerSequence)]);
    Assert.Equal<string[]>(
        [OperationId(1), OperationId(3)],
        [.. reopened.OpenResult.Tail.Select(record => record.OperationId)]);
  }

  [Fact]
  public async Task OpenWhileAnotherLiveProcessHoldsTheDocumentReportsOpenElsewhere()
  {
    await using (var seeder = await OpenAsync())
    {
      await seeder.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
    }

    // A live holder — a different open file description on the same lock, the
    // exact primitive another process would take.
    await using (var holder = await OpenAsync())
    {
      var refused = await new LocalCollabOperationStore(root, log: logs.Add)
          .OpenAsync(DocId, CancellationToken.None);
      Assert.Equal(CollabDocumentOpenOutcome.DocumentOpenElsewhere, refused.Outcome);
      Assert.Null(refused.Session);
    }

    // A holder that left: the lock FILE it leaves behind must not lock the
    // document forever.
    Assert.True(File.Exists(LockPath));
    await using (var reclaimed = await OpenAsync())
    {
      Assert.Equal(0ul, reclaimed.OpenResult.Head!.DurableThrough);
    }

    if (OperatingSystem.IsWindows())
    {
      output.WriteLine(
          "The killed-process half did not run: flock(2) and the python3 " +
          "holder are POSIX-only.");

      return;
    }

    var python = ResolvePython3();

    if (python is null)
    {
      // xunit 2.9.3 has no Assert.Skip and adding a package would mean editing
      // the csproj, so the gap is made loud instead of silent. Linux is where
      // CI runs: a missing python3 THERE means the killed-holder half did not
      // run at all, and reporting green for it would be a lie. Elsewhere it is
      // a developer's machine, and the in-process half still exercises the same
      // kernel primitive.
      Assert.False(
          OperatingSystem.IsLinux(),
          "no python3 to hold the lock from a genuinely separate process, so " +
          "the killed-holder half of this test did not run.");
      output.WriteLine(
          "The killed-process half did not run: no python3 on this machine.");

      return;
    }

    // A genuinely separate process holding the OS lock, then genuinely killed.
    using var live = StartLockHolder(python, LockPath);

    try
    {
      var heldElsewhere = await new LocalCollabOperationStore(root, log: logs.Add)
          .OpenAsync(DocId, CancellationToken.None);
      Assert.Equal(CollabDocumentOpenOutcome.DocumentOpenElsewhere, heldElsewhere.Outcome);
    }
    finally
    {
      live.Kill(entireProcessTree: true);
      live.WaitForExit(30_000);
    }

    await using var afterTheProcessDied = await OpenAsync();
    Assert.NotNull(afterTheProcessDied.OpenResult.Head);
  }

  [Fact]
  public async Task ResetSealsTheOldLineage()
  {
    var oldLineage = CollabWorkingSetTag.NewLineage();
    var newLineage = CollabWorkingSetTag.NewLineage();
    var firstDigest = SHA256.HashData([0x01]);

    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, oldLineage, [0xb0]));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
      await session.AppendAsync(Candidate(OperationId(2), [0x02]));

      var head = await session.ResetAsync(Reset(2, newLineage, [0xb1]));
      Assert.Equal(newLineage, head.Lineage);
      Assert.Equal(2L, head.Epoch);
      Assert.Equal(0ul, head.DurableThrough);

      // Old-lineage ids belong to history, not to the lineage in force.
      Assert.Equal(
          CollabOperationLookupOutcome.NotCommitted,
          (await session.FindCommittedAsync(OperationId(1), firstDigest)).Outcome);

      // The new lineage restarts the sequence and the id space.
      var recommitted = await session.AppendAsync(Candidate(OperationId(1), [0x01]));
      Assert.Equal(CollabOperationAppendOutcome.Committed, recommitted.Outcome);
      Assert.Equal(1ul, recommitted.ServerSequence);

      await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await session.ResetAsync(Reset(2, CollabWorkingSetTag.NewLineage())));
      await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage())));
    }

    // The superseded lineage stays on disk as history; it is sealed, not erased.
    Assert.True(File.Exists(JournalPath(1)));
    Assert.True(new FileInfo(JournalPath(1)).Length > 0);

    await using var reopened = await OpenAsync();
    var reopenedHead = Assert.IsType<CollabDocumentHead>(reopened.OpenResult.Head);
    Assert.Equal(newLineage, reopenedHead.Lineage);
    Assert.Equal(2L, reopenedHead.Epoch);
    Assert.Equal(1ul, reopenedHead.DurableThrough);
    Assert.Equal<byte[][]>(
        [[0xb1]],
        [.. reopened.OpenResult.Baseline.Select(frame => frame.ToArray())]);
    Assert.Equal<ulong[]>(
        [1],
        [.. reopened.OpenResult.Tail.Select(record => record.ServerSequence)]);
  }

  [Fact]
  public async Task CheckpointPublicationPreservesJournalHistory()
  {
    var state = new byte[] { 0xc0, 0xc1, 0xc2 };
    var firstDigest = SHA256.HashData([0x01]);

    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));

      for (var n = 1; n <= 5; n++)
      {
        await session.AppendAsync(Candidate(OperationId(n), [(byte)n]));
      }

      var journalBefore = File.ReadAllBytes(JournalPath(1));
      await session.WriteCheckpointAsync(new CollabOperationCheckpoint(3, state));

      // A checkpoint is a replay accelerator, never a compaction.
      Assert.Equal(journalBefore, File.ReadAllBytes(JournalPath(1)));
      Assert.Equal(
          CollabOperationLookupOutcome.Duplicate,
          (await session.FindCommittedAsync(OperationId(1), firstDigest)).Outcome);

      // Republishing at the sequence already published is an accepted no-op and
      // does not swap the state.
      await session.WriteCheckpointAsync(
          new CollabOperationCheckpoint(3, new byte[] { 0xff }));

      await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await session.WriteCheckpointAsync(
              new CollabOperationCheckpoint(2, state)));
      await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await session.WriteCheckpointAsync(
              new CollabOperationCheckpoint(6, state)));
      await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await session.WriteCheckpointAsync(
              new CollabOperationCheckpoint(0, state)));
    }

    await using var reopened = await OpenAsync();
    var checkpoint = Assert.IsType<CollabOperationCheckpoint>(reopened.OpenResult.Checkpoint);
    Assert.Equal(3ul, checkpoint.Through);
    Assert.Equal(state, checkpoint.State.ToArray());
    Assert.Equal(5ul, reopened.OpenResult.Head!.DurableThrough);
    Assert.Equal<ulong[]>(
        [4, 5],
        [.. reopened.OpenResult.Tail.Select(record => record.ServerSequence)]);
    Assert.Equal(
        CollabOperationLookupOutcome.Duplicate,
        (await reopened.FindCommittedAsync(OperationId(1), firstDigest)).Outcome);
  }

  [Fact]
  public async Task CoexistsWithTodaysWholeDocumentFileInOneDirectory()
  {
    // The suffix is what makes this possible: LocalCollabStore's file sits at
    // the unsuffixed key, and a directory cannot share a name with a file, so
    // an unsuffixed journal directory would throw for every document that
    // already has a working set — and Task 2.4's migration would have nothing
    // to read the old bytes from.
    var workingSet = new LocalCollabStore(root, logs.Add);
    var frames = CollabWorkingSetCodec.EncodeFrames([[0x0a, 0x0b]]);
    await workingSet.WriteAsync(DocId, frames, new CollabWorkingSetTag(
        CollabWorkingSetTag.SchemaV2,
        3,
        CollabWorkingSetTag.NewLineage()), CancellationToken.None);

    await using (var session = await OpenAsync())
    {
      await session.ResetAsync(Reset(1, CollabWorkingSetTag.NewLineage()));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
    }

    // The old file is untouched and still readable.
    var stored = await workingSet.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(frames, stored.Updates);

    Assert.Equal(
        Path.Combine(root, CollabDocKey.For(DocId)),
        Assert.Single(Directory.GetFiles(root)));
    Assert.Equal(DocDirectory, Assert.Single(Directory.GetDirectories(root)));

    await using var reopened = await OpenAsync();
    Assert.Equal(1ul, reopened.OpenResult.Head!.DurableThrough);
  }

  private string DocDirectory =>
      Path.Combine(root, CollabDocKey.For(DocId) + ".journal");

  private string ManifestPath => Path.Combine(DocDirectory, "manifest");

  private string LockPath => Path.Combine(DocDirectory, "lock");

  private string JournalPath(int generation)
  {
    return Path.Combine(
        DocDirectory,
        string.Create(CultureInfo.InvariantCulture, $"journal.{generation}"));
  }

  private async Task<ICollabOperationSession> OpenAsync()
  {
    var store = new LocalCollabOperationStore(root, log: logs.Add);
    var opened = await store.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.Opened, opened.Outcome);

    return opened.Session!;
  }

  private static CollabOperationReset Reset(
      long epoch,
      string lineage,
      params byte[] baselineFrame)
  {
    return new CollabOperationReset(
        1,
        epoch,
        lineage,
        baselineFrame.Length == 0 ? [] : [new ReadOnlyMemory<byte>(baselineFrame)]);
  }

  private static CollabOperationCandidate Candidate(
      string operationId,
      byte[] update,
      byte[]? digest = null)
  {
    return new CollabOperationCandidate(
        operationId,
        "user-1",
        CollabOperationSource.ClientV2,
        update,
        digest ?? SHA256.HashData(update));
  }

  private static string OperationId(int ordinal)
  {
    return ordinal.ToString("x32", CultureInfo.InvariantCulture);
  }

  private static void AppendRaw(string path, byte[] bytes)
  {
    using var file = new FileStream(
        path,
        FileMode.Open,
        FileAccess.Write,
        FileShare.ReadWrite);
    file.Seek(0, SeekOrigin.End);
    file.Write(bytes);
    file.Flush(flushToDisk: true);
  }

  private static void CopyTree(string source, string destination)
  {
    Directory.CreateDirectory(destination);

    foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
    {
      Directory.CreateDirectory(
          Path.Combine(destination, Path.GetRelativePath(source, directory)));
    }

    foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
    {
      var copy = Path.Combine(destination, Path.GetRelativePath(source, file));

      if (Path.GetFileName(file) == "lock")
      {
        // The live session holds it exclusively, so it cannot be read. A killed
        // process leaves an empty lock file holding nothing, which is what the
        // snapshot needs it to be.
        File.WriteAllBytes(copy, []);

        continue;
      }

      File.Copy(file, copy, overwrite: true);
    }
  }

  private static List<(int Offset, int Length)> RecordOffsets(byte[] journal)
  {
    var offsets = new List<(int, int)>();
    var offset = 0;

    while (offset < journal.Length)
    {
      var status = CollabJournalCodec.TryDecodeRecord(
          journal.AsSpan(offset),
          out _,
          out var consumed,
          out var error);
      Assert.Equal(CollabJournalRecordStatus.Ok, status);
      Assert.Equal("", error);
      offsets.Add((offset, consumed));
      offset += consumed;
    }

    return offsets;
  }

  /// <summary>
  /// Rewrites one record in place so it decodes as Invalid through a chosen
  /// branch. Any field a checksum covers is followed by recomputing that
  /// checksum, so the mutation reaches the branch under test rather than
  /// stopping at the checksum in front of it.
  /// </summary>
  private static void Corrupt(byte[] journal, int offset, int length, string mode)
  {
    var record = journal.AsSpan(offset, length);
    var body = record[HeaderSize..];
    var bodyToHash = body[..^ChecksumSize];
    var actorIdLengthTarget = bodyToHash[ActorIdLengthOffset..];
    var updateLength = BinaryPrimitives.ReadInt32LittleEndian(
        bodyToHash[(ActorIdLengthOffset + sizeof(int) + ChecksumSize)..]);

    switch (mode)
    {
      case "header-checksum":
        record[HeaderContentSize] ^= 0xff;

        return;

      case "version":
        record[4] = 2;

        break;

      case "source":
        record[5] = 200;

        break;

      case "sequence-zero":
        BinaryPrimitives.WriteUInt64LittleEndian(bodyToHash[SequenceOffset..], 0);
        ReChecksumBody(body);

        return;

      case "committed-at":
        BinaryPrimitives.WriteInt64LittleEndian(bodyToHash[CommittedAtOffset..], -1);
        ReChecksumBody(body);

        return;

      case "actor-id-length":
        // One past everything that remains after the length field itself.
        BinaryPrimitives.WriteInt32LittleEndian(
            actorIdLengthTarget,
            bodyToHash.Length - ActorIdLengthOffset - sizeof(int) + 1);
        ReChecksumBody(body);

        return;

      case "digest-truncated":
        // Swallows enough of the digest that fewer than 32 bytes remain for it.
        BinaryPrimitives.WriteInt32LittleEndian(actorIdLengthTarget, updateLength + 5);
        ReChecksumBody(body);

        return;

      case "update-length-missing":
        // Swallows the update so the length field itself runs off the end.
        BinaryPrimitives.WriteInt32LittleEndian(actorIdLengthTarget, updateLength + 4);
        ReChecksumBody(body);

        return;

      case "trailing-bytes":
        BinaryPrimitives.WriteInt32LittleEndian(
            bodyToHash[(ActorIdLengthOffset + sizeof(int) + ChecksumSize)..],
            updateLength - 1);
        ReChecksumBody(body);

        return;

      case "body-checksum":
        body[^1] ^= 0xff;

        return;

      // The two below are whole-file damage rather than one bad record: every
      // record still decodes, so only the store's own walk can catch them.
      case "sequence-jump":
        BinaryPrimitives.WriteUInt64LittleEndian(bodyToHash[SequenceOffset..], 5);
        ReChecksumBody(body);

        return;

      case "duplicate-id":
        Convert.FromHexString(OperationId(1)).CopyTo(bodyToHash);
        ReChecksumBody(body);

        return;

      default:
        throw new ArgumentOutOfRangeException(nameof(mode), mode, "unknown corruption mode");
    }

    SHA256.HashData(record[..HeaderContentSize], record.Slice(HeaderContentSize, ChecksumSize));
  }

  private static void ReChecksumBody(Span<byte> body)
  {
    SHA256.HashData(body[..^ChecksumSize], body[^ChecksumSize..]);
  }

  private static string? ResolvePython3()
  {
    foreach (var candidate in new[] { "/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3" })
    {
      if (File.Exists(candidate))
      {
        return candidate;
      }
    }

    return null;
  }

  private static Process StartLockHolder(string python, string lockPath)
  {
    // .NET's FileShare.None is flock(2) on Unix, so a plain flock from any
    // process is the same hold the store takes.
    const string Script = """
      import fcntl, sys, time
      handle = open(sys.argv[1], 'a+')
      fcntl.flock(handle, fcntl.LOCK_EX)
      print('locked', flush=True)
      time.sleep(300)
      """;

    var start = new ProcessStartInfo(python)
    {
      ArgumentList = { "-c", Script, lockPath },
      RedirectStandardOutput = true,
    };
    var holder = Process.Start(start)!;
    var ready = holder.StandardOutput.ReadLineAsync()
        .WaitAsync(TimeSpan.FromSeconds(30))
        .GetAwaiter()
        .GetResult();
    Assert.Equal("locked", ready);

    return holder;
  }
}
