using System.Globalization;
using System.Security.Cryptography;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class LocalCollabOperationHistoryTests : IDisposable
{
  private const string DocId = "doc-1";

  private readonly string root = Path.Combine(
      Path.GetTempPath(),
      $"blok-collab-history-{Guid.NewGuid():N}");
  private readonly List<string> logs = [];

  public void Dispose()
  {
    if (Directory.Exists(root))
    {
      Directory.Delete(root, recursive: true);
    }
  }

  [Fact]
  public async Task ListsEveryLineageOldestFirstWithOnlyTheLastCurrent()
  {
    var store = Store();
    var lineages = await SeedThreeLineagesAsync(store);

    var listed = await store.ListLineagesAsync(DocId);

    Assert.Equal(lineages, listed.Select(info => info.Lineage));
    Assert.Equal([1L, 2L, 3L], listed.Select(info => info.Epoch));
    Assert.All(listed, info => Assert.Equal(1, info.Format));
    Assert.Equal([false, false, true], listed.Select(info => info.Current));
    Assert.All(listed, info => Assert.NotNull(info.CreatedAt));
  }

  [Fact]
  public async Task ReadsTheHeadersOfAnOldLineage()
  {
    var store = Store();
    var before = DateTimeOffset.UtcNow;
    var lineages = await SeedThreeLineagesAsync(store);
    var after = DateTimeOffset.UtcNow;

    var headers = await ToListAsync(store.ReadHeadersAsync(DocId, lineages[0]));

    Assert.Equal([1UL, 2UL], headers.Select(header => header.ServerSequence));
    Assert.All(headers, header => Assert.Equal("user-1", header.ActorId));
    Assert.All(headers, header => Assert.InRange(header.CommittedAt, before, after));
    Assert.Empty(await ToListAsync(store.ReadHeadersAsync(DocId, CollabWorkingSetTag.NewLineage())));
    Assert.Empty(await ToListAsync(store.ReadHeadersAsync(DocId, "not-a-lineage")));
  }

  [Fact]
  public async Task ReadsTheBaselineAResetWasGiven()
  {
    var store = Store();
    var lineage = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(new CollabOperationReset(
          1,
          1,
          lineage,
          [new byte[] { 0xb1 }, new byte[] { 0xb2, 0xb3 }]));
      await session.ResetAsync(Reset(2, CollabWorkingSetTag.NewLineage(), 0xc1));
    }

    var baseline = await store.ReadBaselineAsync(DocId, lineage);

    Assert.NotNull(baseline);
    Assert.Equal(
        [[0xb1], [0xb2, 0xb3]],
        baseline.Select(frame => frame.ToArray()).ToList());
    Assert.Null(await store.ReadBaselineAsync(DocId, CollabWorkingSetTag.NewLineage()));
  }

  [Fact]
  public async Task ReadsRecordsThroughASequenceAndStopsAtTheEnd()
  {
    var store = Store();
    var lineage = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(Reset(1, lineage, 0xb1));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
      await session.AppendAsync(Candidate(OperationId(2), [0x02]));
      await session.AppendAsync(Candidate(OperationId(3), [0x03]));
    }

    var two = await ToListAsync(store.ReadRecordsAsync(DocId, lineage, 2));
    var all = await ToListAsync(store.ReadRecordsAsync(DocId, lineage, 99));

    Assert.Equal([1UL, 2UL], two.Select(record => record.ServerSequence));
    Assert.Equal([[0x01], [0x02]], two.Select(record => record.Update.ToArray()).ToList());
    Assert.Equal([1UL, 2UL, 3UL], all.Select(record => record.ServerSequence));
  }

  [Fact]
  public async Task ReadsWhileAnotherSessionHoldsTheDocumentAndAppends()
  {
    var store = Store();
    var lineage = CollabWorkingSetTag.NewLineage();
    await using var session = await OpenAsync(store);
    await session.ResetAsync(Reset(1, lineage, 0xb1));
    await session.AppendAsync(Candidate(OperationId(1), [0x01]));

    var first = await ToListAsync(store.ReadHeadersAsync(DocId, lineage));
    await session.AppendAsync(Candidate(OperationId(2), [0x02]));
    var second = await ToListAsync(store.ReadHeadersAsync(DocId, lineage));
    await session.AppendAsync(Candidate(OperationId(3), [0x03]));

    Assert.Single(first);
    Assert.Equal(2, second.Count);
    Assert.True(Assert.Single(await store.ListLineagesAsync(DocId)).Current);
  }

  [Fact]
  public async Task StopsBeforeATornJournalTailWithoutTruncatingIt()
  {
    var store = Store();
    var lineage = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(Reset(1, lineage, 0xb1));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
      await session.AppendAsync(Candidate(OperationId(2), [0x02]));
    }

    var torn = CollabJournalCodec.EncodeRecord(new CollabOperationRecord(
        OperationId(3),
        3,
        DateTimeOffset.UtcNow,
        "user-1",
        CollabOperationSource.ClientV2,
        new byte[] { 0x03 },
        SHA256.HashData(new byte[] { 0x03 })));
    var journalPath = JournalPath(1);
    AppendRaw(journalPath, torn[..(torn.Length - 5)]);
    var length = new FileInfo(journalPath).Length;

    var headers = await ToListAsync(store.ReadHeadersAsync(DocId, lineage));

    Assert.Equal([1UL, 2UL], headers.Select(header => header.ServerSequence));
    Assert.Equal(length, new FileInfo(journalPath).Length);
  }

  [Fact]
  public async Task ListsTheCurrentLineageOfADocumentNeverOpenedSinceTheUpgrade()
  {
    var lineage = await SeedWithoutLedgerAsync();

    var listed = Assert.Single(await Store().ListLineagesAsync(DocId));

    Assert.Equal(lineage, listed.Lineage);
    Assert.True(listed.Current);
    Assert.Null(listed.CreatedAt);
    Assert.False(File.Exists(LedgerPath));
  }

  [Fact]
  public async Task ReadsTheCurrentLineageOfADocumentNeverOpenedSinceTheUpgrade()
  {
    var lineage = await SeedWithoutLedgerAsync();
    var store = Store();

    var headers = await ToListAsync(store.ReadHeadersAsync(DocId, lineage));
    var baseline = await store.ReadBaselineAsync(DocId, lineage);

    Assert.Equal([1UL], headers.Select(header => header.ServerSequence));
    Assert.NotNull(baseline);
    Assert.Equal([0xb1], Assert.Single(baseline).ToArray());
    Assert.False(File.Exists(LedgerPath));
  }

  [Fact]
  public async Task OpenBackfillsTheLedgerWithTheCurrentGeneration()
  {
    var lineage = await SeedWithoutLedgerAsync();

    await (await OpenAsync(Store())).DisposeAsync();

    var entries = DecodeLedger();
    var entry = Assert.Single(entries);
    Assert.Equal(CollabLineageEntryKind.Published, entry.Kind);
    Assert.Equal(1UL, entry.Generation);
    Assert.Equal(lineage, entry.Lineage);
    Assert.Null(entry.CreatedAt);
  }

  [Fact]
  public async Task NeverListsAnOrphanGeneration()
  {
    var store = Store();
    var lineages = await SeedThreeLineagesAsync(store);
    File.WriteAllBytes(Path.Combine(DocDirectory, "journal.9.99"), []);
    File.WriteAllBytes(Path.Combine(DocDirectory, "baseline.9.99"), [0x01]);

    var listed = await store.ListLineagesAsync(DocId);

    Assert.Equal(lineages, listed.Select(info => info.Lineage));
  }

  [Fact]
  public async Task DeletesAnOldLineageAndRefusesTheCurrentOne()
  {
    var store = Store();
    var first = CollabWorkingSetTag.NewLineage();
    var second = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(Reset(1, first, 0xb1));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
      await session.WriteCheckpointAsync(new CollabOperationCheckpoint(1, new byte[] { 0xc1 }));
      await session.ResetAsync(Reset(2, second, 0xb2));
    }

    Assert.Equal(CollabLineageDeleteOutcome.Deleted, await store.DeleteLineageAsync(DocId, first));
    Assert.Empty(Directory.GetFiles(DocDirectory, "journal.1.*"));
    Assert.Empty(Directory.GetFiles(DocDirectory, "baseline.1.*"));
    Assert.Empty(Directory.GetFiles(DocDirectory, "checkpoint.1.*"));
    Assert.Equal([second], (await store.ListLineagesAsync(DocId)).Select(info => info.Lineage));
    Assert.Equal(CollabLineageDeleteOutcome.NotFound, await store.DeleteLineageAsync(DocId, first));
    Assert.Equal(CollabLineageDeleteOutcome.Current, await store.DeleteLineageAsync(DocId, second));
    Assert.Single(Directory.GetFiles(DocDirectory, "journal.2.*"));
    Assert.Equal(
        CollabLineageDeleteOutcome.NotFound,
        await store.DeleteLineageAsync(DocId, CollabWorkingSetTag.NewLineage()));
    Assert.Equal(
        CollabLineageDeleteOutcome.NotFound,
        await store.DeleteLineageAsync(DocId, "not-a-lineage"));
  }

  [Fact]
  public async Task RefusesToDeleteFromAPurgedDocument()
  {
    var store = Store();
    var lineages = await SeedThreeLineagesAsync(store);
    Assert.Equal(CollabDocumentPurgeOutcome.Purged, await store.PurgeAsync(DocId));

    Assert.Equal(
        CollabLineageDeleteOutcome.Purged,
        await store.DeleteLineageAsync(DocId, lineages[0]));
    Assert.False(File.Exists(LedgerPath));
    Assert.Empty(await store.ListLineagesAsync(DocId));
  }

  [Fact]
  public async Task IgnoresATornLastLedgerEntryAndKeepsAppendingAfterIt()
  {
    var store = Store();
    var lineages = await SeedThreeLineagesAsync(store);
    AppendRaw(LedgerPath, [0x01, 0x02, 0x03, 0x04, 0x05]);

    Assert.Equal(lineages, (await store.ListLineagesAsync(DocId)).Select(info => info.Lineage));

    // Two resets, so the first entry written after the torn tail is no longer
    // current and can only be listed from the ledger.
    var fourth = CollabWorkingSetTag.NewLineage();
    var fifth = CollabWorkingSetTag.NewLineage();
    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(Reset(4, fourth, 0xb4));
      await session.ResetAsync(Reset(5, fifth, 0xb5));
    }

    Assert.Equal(
        [.. lineages, fourth, fifth],
        (await store.ListLineagesAsync(DocId)).Select(info => info.Lineage));
  }

  [Fact]
  public async Task ConcurrentDeletesAndResetsLeaveEveryLedgerEntryReadable()
  {
    var store = Store();
    var lineages = new List<string>();
    await using var session = await OpenAsync(store);

    for (var epoch = 1; epoch <= 10; epoch++)
    {
      var lineage = CollabWorkingSetTag.NewLineage();
      lineages.Add(lineage);
      await session.ResetAsync(Reset(epoch, lineage, 0xb1));
    }

    var later = Enumerable.Range(0, 11).Select(_ => CollabWorkingSetTag.NewLineage()).ToList();
    var resets = Task.Run(async () =>
    {
      for (var index = 0; index < later.Count; index++)
      {
        await session.ResetAsync(Reset(11 + index, later[index], 0xb2));
      }
    });
    var deletes = lineages
        .Take(9)
        .Select(lineage => Task.Run(async () => await store.DeleteLineageAsync(DocId, lineage)))
        .ToList();

    await resets;
    var outcomes = await Task.WhenAll(deletes);

    Assert.All(outcomes, outcome => Assert.Equal(CollabLineageDeleteOutcome.Deleted, outcome));
    var bytes = File.ReadAllBytes(LedgerPath);
    Assert.Equal(0, bytes.Length % CollabLineageLedger.EntrySize);

    for (var offset = 0; offset < bytes.Length; offset += CollabLineageLedger.EntrySize)
    {
      Assert.True(CollabLineageLedger.TryDecode(
          bytes.AsSpan(offset, CollabLineageLedger.EntrySize),
          out _));
    }

    Assert.Equal(
        [lineages[9], .. later],
        (await store.ListLineagesAsync(DocId)).Select(info => info.Lineage));
  }

  [Fact]
  public async Task PurgeRemovesTheLedger()
  {
    var store = Store();
    await SeedThreeLineagesAsync(store);
    Assert.True(File.Exists(LedgerPath));

    Assert.Equal(CollabDocumentPurgeOutcome.Purged, await store.PurgeAsync(DocId));

    Assert.False(File.Exists(LedgerPath));
  }

  [Fact]
  public async Task AReusedLineageIsListedOnceAsTheNewerGeneration()
  {
    var store = Store();
    var reused = CollabWorkingSetTag.NewLineage();
    var last = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      await session.ResetAsync(Reset(1, reused, 0xb1));
      await session.ResetAsync(Reset(2, reused, 0xb2));
      await session.ResetAsync(Reset(3, last, 0xb3));
    }

    var listed = await store.ListLineagesAsync(DocId);

    Assert.Equal([reused, last], listed.Select(info => info.Lineage));
    Assert.Equal(2L, listed[0].Epoch);
    Assert.Equal([0xb2], Assert.Single((await store.ReadBaselineAsync(DocId, reused))!).ToArray());

    Assert.Equal(CollabLineageDeleteOutcome.Deleted, await store.DeleteLineageAsync(DocId, reused));
    Assert.Empty(Directory.GetFiles(DocDirectory, "journal.2.*"));
    Assert.Single(Directory.GetFiles(DocDirectory, "journal.1.*"));
    Assert.Single(Directory.GetFiles(DocDirectory, "baseline.1.*"));
    Assert.Equal([last], (await store.ListLineagesAsync(DocId)).Select(info => info.Lineage));
  }

  [Fact]
  public async Task ALedgerThatCannotBeWrittenNeverFailsAResetOrAnOpen()
  {
    await SeedWithoutLedgerAsync();
    Directory.CreateDirectory(LedgerPath);
    var store = Store();
    var next = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(store))
    {
      var head = await session.ResetAsync(Reset(2, next, 0xb2));
      Assert.Equal(next, head.Lineage);
    }

    await using (var reopened = await OpenAsync(store))
    {
      Assert.Equal(next, reopened.OpenResult.Head?.Lineage);
    }

    Assert.Contains(logs, line => line.Contains(CollabLineageLedger.FileName, StringComparison.Ordinal));
  }

  [Fact]
  public async Task SkipsABadLedgerEntryAndStillListsTheOnesAfterIt()
  {
    var store = Store();
    var lineages = await SeedThreeLineagesAsync(store);
    var bytes = File.ReadAllBytes(LedgerPath);
    Assert.Equal(3 * CollabLineageLedger.EntrySize, bytes.Length);
    // The first entry, so the second (not current) can only come from the ledger.
    bytes[3] ^= 0xff;
    File.WriteAllBytes(LedgerPath, bytes);
    logs.Clear();

    var listed = await store.ListLineagesAsync(DocId);

    Assert.Equal([lineages[1], lineages[2]], listed.Select(info => info.Lineage));
    Assert.Contains(logs, line => line.Contains(CollabLineageLedger.FileName, StringComparison.Ordinal));
  }

  private string DocDirectory =>
      Path.Combine(root, CollabDocKey.For(DocId) + ".journal");

  private string LedgerPath => Path.Combine(DocDirectory, CollabLineageLedger.FileName);

  private LocalCollabOperationStore Store()
  {
    return new LocalCollabOperationStore(root, log: Log);
  }

  private void Log(string line)
  {
    lock (logs)
    {
      logs.Add(line);
    }
  }

  private static async Task<List<string>> SeedThreeLineagesAsync(LocalCollabOperationStore store)
  {
    var lineages = new List<string>();

    await using var session = await OpenAsync(store);

    for (var epoch = 1; epoch <= 3; epoch++)
    {
      var lineage = CollabWorkingSetTag.NewLineage();
      lineages.Add(lineage);
      await session.ResetAsync(Reset(epoch, lineage, (byte)(0xb0 + epoch)));
      await session.AppendAsync(Candidate(OperationId((epoch * 10) + 1), [0x01]));
      await session.AppendAsync(Candidate(OperationId((epoch * 10) + 2), [0x02]));
    }

    return lineages;
  }

  /// <summary>A seeded document whose ledger is gone, as one written before the ledger existed.</summary>
  private async Task<string> SeedWithoutLedgerAsync()
  {
    var lineage = CollabWorkingSetTag.NewLineage();

    await using (var session = await OpenAsync(Store()))
    {
      await session.ResetAsync(Reset(1, lineage, 0xb1));
      await session.AppendAsync(Candidate(OperationId(1), [0x01]));
    }

    File.Delete(LedgerPath);

    return lineage;
  }

  private List<CollabLineageEntry> DecodeLedger()
  {
    var bytes = File.ReadAllBytes(LedgerPath);
    var entries = new List<CollabLineageEntry>();

    for (var offset = 0; offset + CollabLineageLedger.EntrySize <= bytes.Length; offset += CollabLineageLedger.EntrySize)
    {
      Assert.True(CollabLineageLedger.TryDecode(
          bytes.AsSpan(offset, CollabLineageLedger.EntrySize),
          out var entry));
      entries.Add(entry);
    }

    return entries;
  }

  private string JournalPath(int generation)
  {
    return Assert.Single(Directory.GetFiles(
        DocDirectory,
        string.Create(CultureInfo.InvariantCulture, $"journal.{generation}.*")));
  }

  private static async Task<ICollabOperationSession> OpenAsync(LocalCollabOperationStore store)
  {
    var opened = await store.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.Opened, opened.Outcome);

    return opened.Session!;
  }

  private static async Task<List<T>> ToListAsync<T>(IAsyncEnumerable<T> source)
  {
    var items = new List<T>();

    await foreach (var item in source)
    {
      items.Add(item);
    }

    return items;
  }

  private static CollabOperationReset Reset(long epoch, string lineage, byte baselineFrame)
  {
    return new CollabOperationReset(1, epoch, lineage, [new byte[] { baselineFrame }]);
  }

  private static CollabOperationCandidate Candidate(string operationId, byte[] update)
  {
    return new CollabOperationCandidate(
        operationId,
        "user-1",
        CollabOperationSource.ClientV2,
        update,
        SHA256.HashData(update));
  }

  private static string OperationId(int ordinal)
  {
    return ordinal.ToString("x32", CultureInfo.InvariantCulture);
  }

  private static void AppendRaw(string path, byte[] bytes)
  {
    using var file = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite);
    file.Seek(0, SeekOrigin.End);
    file.Write(bytes);
    file.Flush(flushToDisk: true);
  }
}
