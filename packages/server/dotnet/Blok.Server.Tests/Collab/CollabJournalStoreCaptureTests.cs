using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The journal store, captured from C# into fixtures/collab-journal/scenarios.json.
/// Each scenario is a list of steps run against one store with a fixed clock:
/// store calls with what they answered, and file edits that stage crashes and
/// damage. The capture records every answer, the store's log, every file the
/// scenario leaves (exact bytes), and what a fresh store opens from those files.
/// Go replays the steps and must answer the same and write the same bytes, and
/// opens the captured files to the same result. Same bytes both ways is what
/// lets either server open the other's journal directory.
/// Set BLOK_WRITE_COLLAB_JOURNAL=1 to rewrite the file after an intended change.
/// </summary>
public sealed class CollabJournalStoreCaptureTests
{
  private const string FileName = "collab-journal/scenarios.json";
  private const string DocId = "doc-1";

  private static readonly DateTimeOffset Start = new(2026, 10, 31, 12, 0, 0, TimeSpan.Zero);

  [Fact]
  public async Task TheCaptureMatchesTheStore()
  {
    var scenarios = new JsonArray();

    foreach (var scenario in Scenarios())
    {
      scenarios.Add(await RunAsync(scenario));
    }

    var built = new JsonObject
    {
      ["$comment"] = "Captured from C# by CollabJournalStoreCaptureTests. Do not edit by hand. " +
          "Sequences and ticks are strings. {doc} in a path is the doc key of docId.",
      ["docId"] = DocId,
      ["startTicks"] = Ticks(Start),
      ["scenarios"] = scenarios,
    }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_JOURNAL") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_JOURNAL=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static string Lineage(int n) => n.ToString("x32", CultureInfo.InvariantCulture);

  private static string OpId(int n) => n.ToString("x32", CultureInfo.InvariantCulture);

  private static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(bytes);

  private static string Ticks(DateTimeOffset value) =>
      value.UtcTicks.ToString(CultureInfo.InvariantCulture);

  private static string Digest(params byte[] update) => Hex(SHA256.HashData(update));

  private const string Journal1 = "{doc}.journal/journal.1.1";
  private const string Manifest = "{doc}.journal/manifest";
  private const string Lock = "{doc}.journal/lock";
  private const string Ledger = "{doc}.journal/lineages";
  private const string WorkingSet = "{doc}";

  private static IEnumerable<Scenario> Scenarios()
  {
    yield return new Scenario("seed-append-find-reopen")
        .Open("a")
        .Append("a", 1, [0x01])
        .Reset("a", 1, Lineage(1), [0xb1], [0xb2, 0xb3])
        .Append("a", 1, [0x01])
        .Clock(Start.AddTicks(1234567))
        .Append("a", 2, [0x02], actor: null, source: CollabOperationSource.HttpEdit)
        .Append("a", 3, [0x03], actor: "é😀", source: CollabOperationSource.ClientV1)
        .Find("a", 1, Digest(0x01))
        .Find("a", 1, Digest(0x09))
        .Find("a", 9, Digest(0x09))
        .Append("a", 1, [0x01])
        .Append("a", 2, [0x07])
        .Close("a")
        .Open("b")
        .Find("b", 3, Digest(0x03))
        .Append("b", 4, [0x04])
        .Close("b")
        .Close("b")
        .Append("b", 5, [0x05]);

    yield return new Scenario("an-unseeded-open-and-a-reset-that-is-refused")
        .Open("a")
        .Find("a", 1, Digest(0x01))
        .Checkpoint("a", 1, [0xc1])
        .ResetRaw("a", 1, 1, "ABCDEF0123456789abcdef0123456789", [[0xb1]])
        .ResetRaw("a", 1, 1, "abc", [[0xb1]])
        .ResetRaw("a", 0, 1, Lineage(1), [[0xb1]])
        .ResetRaw("a", 1, 1, Lineage(1), [[0xb1], []])
        .Reset("a", 3, Lineage(1))
        .Reset("a", 3, Lineage(2), [0xb2])
        .Reset("a", 2, Lineage(2), [0xb2])
        .Reset("a", -1, Lineage(2), [0xb2])
        .ResetRaw("a", 2, 4, Lineage(1), [[0xb4]])
        .Close("a")
        .Open("b");

    yield return new Scenario("the-update-limit")
        .MaxUpdateBytes(4)
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [1, 2, 3, 4])
        .Append("a", 2, [1, 2, 3, 4, 5])
        .Append("a", 3, [])
        .Close("a");

    yield return new Scenario("checkpoints")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .AppendRange("a", 1, 5)
        .Checkpoint("a", 0, [0xc0])
        .Checkpoint("a", 6, [0xc6])
        .Checkpoint("a", 3, [0xc3])
        .Checkpoint("a", 3, [0xff])
        .Checkpoint("a", 2, [0xc2])
        .Checkpoint("a", 4, [])
        .Checkpoint("a", 5, [0xc5, 0xc5])
        .Close("a")
        .Open("b")
        .Append("b", 6, [6])
        .Checkpoint("b", 5, [0x00])
        .Checkpoint("b", 6, [0xc6])
        .Close("b");

    yield return new Scenario("reset-names-its-files-after-the-minting-fence")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Append("a", 1, [1])
        .Checkpoint("a", 1, [0xc1])
        .Close("a")
        .Open("b")
        .Reset("b", 2, Lineage(2), [0xb2])
        .Append("b", 2, [2])
        .Find("b", 1, Digest(1))
        .Clock(Start.AddDays(1))
        .Reset("b", 3, Lineage(3))
        .Append("b", 3, [3])
        .Close("b");

    yield return new Scenario("a-second-open-is-refused-while-the-first-is-live")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Open("b")
        .Purge()
        .Close("a")
        .Open("b")
        .Close("b");

    yield return new Scenario("the-fence-not-the-lock-decides")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [1])
        .Delete(Lock)
        .Append("a", 2, [2])
        .Open("b")
        .Append("a", 3, [3])
        .Find("a", 1, Digest(1))
        .Checkpoint("a", 1, [0xc1])
        .Reset("a", 9, Lineage(9))
        .Append("b", 3, [3])
        .Close("a")
        .Close("b")
        .Open("c")
        .Close("c");

    // A stale session's close must not hand back the fence its successor holds.
    yield return new Scenario("a-stale-session-closing-releases-nothing")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Delete(Lock)
        .Open("b")
        .Close("a")
        .Open("c")
        .Close("b")
        .Open("c")
        .Close("c");

    yield return new Scenario("every-call-after-close-is-disposed")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [1])
        .Close("a")
        .Find("a", 1, Digest(1))
        .Append("a", 2, [2])
        .Checkpoint("a", 1, [0xc1])
        .Reset("a", 2, Lineage(2));

    yield return new Scenario("a-purge-fences-a-stale-session")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Append("a", 1, [1])
        .Delete(Lock)
        .Purge()
        .Append("a", 2, [2])
        .Checkpoint("a", 1, [0xc1])
        .Reset("a", 2, Lineage(2))
        .Close("a")
        .Open("b")
        .IsPurged();

    yield return new Scenario("purge-removes-every-payload")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Append("a", 1, [1])
        .Checkpoint("a", 1, [0xc1])
        .Reset("a", 2, Lineage(2), [0xb2])
        .Append("a", 2, [2])
        .Close("a")
        .Write("{doc}.journal/journal.99.99", [0x99])
        .Write(Lock, [0x5a])
        .IsPurged()
        .Purge()
        .IsPurged()
        .Purge()
        .Open("b")
        .Lineages()
        .DeleteLineage(Lineage(1))
        .Baseline(Lineage(1))
        .Records(Lineage(1), ulong.MaxValue);

    yield return new Scenario("a-purge-that-fails-keeps-its-marker")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [1])
        .Close("a")
        .Mkdir("{doc}.journal/orphan-directory")
        .Write("{doc}.journal/orphan-directory/old-payload", [0x7b])
        .Purge()
        .Open("b")
        .Delete("{doc}.journal/orphan-directory/old-payload")
        .Rmdir("{doc}.journal/orphan-directory")
        .Purge();

    yield return new Scenario("a-purge-of-a-document-never-opened")
        .Purge()
        .Open("a");

    foreach (var cut in new[] { 1, 37, 38, 45 })
    {
      yield return new Scenario($"recovery-truncates-a-torn-tail-of-{cut}-bytes")
          .Open("a")
          .Reset("a", 1, Lineage(1))
          .AppendRange("a", 1, 2)
          .Close("a")
          .AppendBytes(Journal1, RecordBytes(3, actor: "user-1")[..cut])
          .Records(Lineage(1), ulong.MaxValue)
          .Open("b")
          .Find("b", 3, Digest(3))
          .Append("b", 3, [3])
          .Close("b");
    }

    yield return new Scenario("a-lookup-leaves-a-torn-tail-and-the-append-clears-it")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [1])
        .AppendBytes(Journal1, RecordBytes(2, actor: "user-1")[..20])
        .Find("a", 2, Digest(2))
        .Append("a", 2, [2])
        .Close("a");

    yield return new Scenario("a-write-that-landed-without-its-answer-is-read-back")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Append("a", 1, [0x42])
        .AppendBytes(Journal1, RecordBytes(2, actor: "user-1", update: [0x43]))
        .Find("a", 2, Digest(0x43))
        .Append("a", 2, [0x43])
        .Append("a", 3, [0x44])
        .Close("a");

    foreach (var mode in new[]
    {
      "header-checksum", "version", "source", "sequence-zero", "committed-at",
      "actor-id-length", "digest-truncated", "update-length-missing",
      "trailing-bytes", "body-checksum", "sequence-jump", "duplicate-id",
    })
    {
      yield return new Scenario($"middle-corruption-{mode}")
          .Open("a")
          .Reset("a", 1, Lineage(1))
          .Append("a", 1, [1])
          .AppendCandidate("a", OpId(2), null, CollabOperationSource.ClientV2,
              [0x0a, 0x0b, 0x0c, 0x0d], Encoding.ASCII.GetBytes("0123456789abcdef0123456789abcdef"))
          .Append("a", 3, [3])
          .Close("a")
          .CorruptRecord(Journal1, 1, mode)
          .Open("b")
          .Records(Lineage(1), ulong.MaxValue)
          .Open("c");
    }

    yield return new Scenario("a-missing-journal-fails-closed")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Close("a")
        .Delete(Journal1)
        .Open("b")
        .Lineages()
        .Records(Lineage(1), 5)
        .Headers(Lineage(1));

    yield return new Scenario("a-missing-baseline-fails-closed")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Close("a")
        .Delete("{doc}.journal/baseline.1.1")
        .Open("b")
        .Baseline(Lineage(1));

    yield return new Scenario("journal-files-without-a-manifest")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Close("a")
        .Delete(Manifest)
        .Open("b");

    yield return new Scenario("a-bare-journal-file-without-a-manifest")
        .Mkdir("{doc}.journal")
        .Write("{doc}.journal/journal", [])
        .Open("a")
        .Delete("{doc}.journal/journal")
        .Write("{doc}.journal/journalx", [])
        .Open("b")
        .Close("b");

    yield return new Scenario("an-empty-manifest-is-unseeded")
        .Mkdir("{doc}.journal")
        .Write(Manifest, [])
        .Lineages()
        .DeleteLineage(Lineage(1))
        .Open("a")
        .Close("a");

    yield return new Scenario("manifests-that-do-not-read")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Close("a")
        .Snapshot(Manifest, "good")
        .Write(Manifest, new byte[100])
        .Open("b")
        .Lineages()
        .Restore(Manifest, "good")
        .ForeignManifest(Manifest)
        .Open("c")
        .Zero(Manifest, 0, 256)
        .Open("d")
        .DeleteLineage(Lineage(1))
        .Restore(Manifest, "good")
        .Open("e")
        .Close("e");

    yield return new Scenario("a-checkpoint-past-the-journal")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .AppendRange("a", 1, 5)
        .Checkpoint("a", 5, [0xc5])
        .Close("a")
        .KeepRecords(Journal1, 3)
        .Open("b");

    yield return new Scenario("a-checkpoint-whose-file-is-wrong")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .AppendRange("a", 1, 3)
        .Checkpoint("a", 2, [0xc2])
        .Close("a")
        .Snapshot("{doc}.journal/checkpoint.1.2.1", "cp")
        .Delete("{doc}.journal/checkpoint.1.2.1")
        .Open("b")
        .Sealed("{doc}.journal/checkpoint.1.2.1", "BKJC", 3, [0xc2])
        .Open("c")
        .Restore("{doc}.journal/checkpoint.1.2.1", "cp")
        .Open("d")
        .Close("d");

    yield return new Scenario("a-checkpoint-that-cannot-be-sealed-publishes-nothing")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .AppendRange("a", 1, 5)
        .Checkpoint("a", 3, [0xc0, 0xc1])
        .Mkdir("{doc}.journal/checkpoint.1.5.1")
        .Checkpoint("a", 5, [0xd0, 0xd1])
        .Close("a")
        .Open("b")
        .Close("b");

    yield return new Scenario("a-crash-before-the-checkpoint-publication")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .AppendRange("a", 1, 5)
        .Checkpoint("a", 3, [0xc0, 0xc1])
        .Close("a")
        .Open("b")
        .Snapshot(Manifest, "before")
        .Checkpoint("b", 5, [0xd0, 0xd1])
        .Close("b")
        .Restore(Manifest, "before")
        .Open("c")
        .Close("c");

    yield return new Scenario("the-sweep-matches-like-dotnet-globs")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .AppendRange("a", 1, 3)
        .Write("{doc}.journal/checkpoint.1", [0x01])
        .Write("{doc}.journal/checkpoint.1.x.1", [0x02])
        .Write("{doc}.journal/checkpoint.1.7.11", [0x03])
        .Write("{doc}.journal/checkpoint.12.1.1", [0x04])
        .Checkpoint("a", 1, [0xc1])
        .Checkpoint("a", 2, [0xc2])
        .Close("a");

    foreach (var frames in new[] { 0, 3 })
    {
      yield return new Scenario($"imports-a-working-set-with-{frames}-frames")
          .Clock(Start.AddHours(1))
          .WorkingSetFile(2, 7, Lineage(7), LocalCollabOperationStoreTests.LegacyFrames(frames))
          .Lineages()
          .Open("a")
          .Append("a", 1, [1])
          .Close("a")
          .Lineages()
          .Baseline(Lineage(7))
          .Open("b")
          .Close("b");
    }

    yield return new Scenario("an-import-that-crashed-before-its-publication")
        .WorkingSetFile(2, 7, Lineage(7), LocalCollabOperationStoreTests.LegacyFrames(3))
        .Open("a")
        .Close("a")
        .Zero(Manifest, 0, 128)
        .Open("b")
        .Append("b", 1, [1])
        .Close("b");

    yield return new Scenario("an-abandoned-import-of-another-lineage-is-not-deletable")
        .WorkingSetFile(2, 7, Lineage(7), LocalCollabOperationStoreTests.LegacyFrames(1))
        .Open("a")
        .Close("a")
        .Zero(Manifest, 0, 128)
        .WorkingSetFile(2, 8, Lineage(8), LocalCollabOperationStoreTests.LegacyFrames(2))
        .Open("b")
        .Append("b", 1, [1])
        .Checkpoint("b", 1, [0xc1])
        .Lineages()
        .DeleteLineage(Lineage(7))
        .Close("b");

    yield return new Scenario("a-purge-marker-alone-fences-a-session")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Write("{doc}.journal/purged", [])
        .Append("a", 1, [1])
        .Delete("{doc}.journal/purged")
        .Append("a", 1, [1])
        .Close("a");

    yield return new Scenario("an-import-is-never-read-again")
        .WorkingSetFile(2, 7, Lineage(7), LocalCollabOperationStoreTests.LegacyFrames(3))
        .Open("a")
        .Append("a", 1, [1])
        .Close("a")
        .WorkingSetFile(3, 99, Lineage(99), [[0xff, 0xff]])
        .Open("b")
        .Close("b")
        .Write(WorkingSet, [0xde, 0xad, 0xbe, 0xef])
        .Open("c")
        .Close("c");

    foreach (var mode in new[] { "magic", "frame-length", "header-truncated" })
    {
      yield return new Scenario($"a-working-set-that-does-not-decode-{mode}")
          .WorkingSetFile(2, 7, Lineage(7), LocalCollabOperationStoreTests.LegacyFrames(3))
          .Snapshot(WorkingSet, "intact")
          .DamageWorkingSet(mode)
          .Open("a")
          .Open("b")
          .Restore(WorkingSet, "intact")
          .Open("c")
          .Close("c");
    }

    yield return new Scenario("history-lists-reads-and-deletes")
        .Clock(Start.AddMinutes(1))
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .AppendRange("a", 1, 3)
        .Checkpoint("a", 2, [0xc2])
        .Clock(Start.AddMinutes(2))
        .Reset("a", 2, Lineage(2), [0xb2], [0xb3])
        .Append("a", 1, [0x11], actor: null)
        .Clock(Start.AddMinutes(3))
        .Reset("a", 3, Lineage(3))
        .Write("{doc}.journal/checkpoint.1", [0x01])
        .Lineages()
        .Headers(Lineage(1))
        .Records(Lineage(1), 2)
        .Records(Lineage(1), 0)
        .Records(Lineage(2), ulong.MaxValue)
        .Baseline(Lineage(2))
        .Baseline(Lineage(3))
        .Baseline(Lineage(9))
        .Headers(Lineage(9))
        .DeleteLineage(Lineage(3))
        .DeleteLineage(Lineage(9))
        .DeleteLineage(Lineage(1))
        .DeleteLineage(Lineage(1))
        .Lineages()
        .Baseline(Lineage(1))
        .Append("a", 2, [0x12])
        .Close("a")
        .Open("b")
        .Close("b");

    yield return new Scenario("history-of-a-reused-lineage-lists-the-newer-generation")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Append("a", 1, [1])
        .Reset("a", 2, Lineage(2))
        .Reset("a", 3, Lineage(1), [0xb3])
        .Reset("a", 4, Lineage(4))
        .Lineages()
        .Baseline(Lineage(1))
        .Headers(Lineage(1))
        .DeleteLineage(Lineage(1))
        .Lineages()
        .Close("a");

    yield return new Scenario("history-of-a-document-opened-before-the-ledger")
        .Open("a")
        .Reset("a", 1, Lineage(1), [0xb1])
        .Append("a", 1, [1])
        .Close("a")
        .Delete(Ledger)
        .Lineages()
        .Records(Lineage(1), ulong.MaxValue)
        .DeleteLineage(Lineage(1))
        .Open("b")
        .Lineages()
        .Close("b");

    yield return new Scenario("history-never-lists-an-orphan-generation")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Close("a")
        .Sealed("{doc}.journal/baseline.2.5", "BKJB", 0, [])
        .Write("{doc}.journal/journal.2.5", [])
        .Lineages()
        .DeleteLineage(Lineage(2));

    yield return new Scenario("history-reads-stop-at-a-torn-tail-and-leave-it")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .AppendRange("a", 1, 2)
        .AppendBytes(Journal1, RecordBytes(3, actor: "user-1")[..50])
        .Headers(Lineage(1))
        .Records(Lineage(1), ulong.MaxValue)
        .Close("a");

    yield return new Scenario("history-skips-bad-and-torn-ledger-entries")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Reset("a", 2, Lineage(2))
        .Close("a")
        .Flip(Ledger, 70)
        .AppendBytes(Ledger, [1, 2, 3])
        .Lineages()
        .Open("b")
        .Reset("b", 3, Lineage(3))
        .Lineages()
        .Close("b");

    yield return new Scenario("history-of-a-purged-document")
        .Open("a")
        .Reset("a", 1, Lineage(1))
        .Reset("a", 2, Lineage(2))
        .Close("a")
        .Purge()
        .IsPurged()
        .Lineages()
        .DeleteLineage(Lineage(1));
  }

  private static byte[] RecordBytes(int n, string? actor, byte[]? update = null)
  {
    update ??= [(byte)n];

    return CollabJournalCodec.EncodeRecord(new CollabOperationRecord(
        OpId(n),
        (ulong)n,
        DateTimeOffset.UnixEpoch,
        actor,
        CollabOperationSource.ClientV2,
        update,
        SHA256.HashData(update)));
  }

  private static async Task<JsonObject> RunAsync(Scenario scenario)
  {
    var root = Path.Combine(Path.GetTempPath(), $"blok-journal-capture-{Guid.NewGuid():N}");
    var copy = root + "-reopen";

    try
    {
      Directory.CreateDirectory(root);
      var runner = new Runner(root, scenario.MaxUpdate);
      var steps = new JsonArray();

      foreach (var step in scenario.Steps)
      {
        steps.Add(await runner.RunAsync(step));
      }

      await runner.CloseAllAsync();

      var result = new JsonObject
      {
        ["name"] = scenario.Name,
        ["steps"] = steps,
        ["log"] = new JsonArray([.. runner.Logs.Select(line => (JsonNode?)line)]),
        ["files"] = Listing(root),
      };

      if (scenario.MaxUpdate is { } max)
      {
        result["maxUpdateBytes"] = max;
      }

      // A fresh store over a copy of the files: what any later open reads.
      CopyTree(root, copy);
      var reopen = new Runner(copy, scenario.MaxUpdate);
      result["reopen"] = await reopen.OpenResultAsync();
      await reopen.CloseAllAsync();

      return result;
    }
    finally
    {
      foreach (var path in new[] { root, copy })
      {
        if (Directory.Exists(path))
        {
          Directory.Delete(path, recursive: true);
        }
      }
    }
  }

  private static JsonObject Listing(string root)
  {
    var listing = new SortedDictionary<string, string?>(StringComparer.Ordinal);
    var key = CollabDocKey.For(DocId);

    foreach (var entry in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
    {
      var relative = Path.GetRelativePath(root, entry).Replace('\\', '/').Replace(key, "{doc}");

      if (Directory.Exists(entry))
      {
        listing[relative + "/"] = null;
      }
      else
      {
        listing[relative] = Hex(File.ReadAllBytes(entry));
      }
    }

    var files = new JsonObject();

    foreach (var (path, content) in listing)
    {
      files[path] = content;
    }

    return files;
  }

  private static void CopyTree(string source, string destination)
  {
    Directory.CreateDirectory(destination);

    foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
    {
      Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
    }

    foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
    {
      File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)));
    }
  }

  /// <summary>A scenario and the steps it runs, built fluently.</summary>
  private sealed class Scenario(string name)
  {
    internal string Name { get; } = name;

    internal long? MaxUpdate { get; private set; }

    internal List<JsonObject> Steps { get; } = [];

    internal Scenario MaxUpdateBytes(long max)
    {
      MaxUpdate = max;

      return this;
    }

    private Scenario Add(JsonObject step)
    {
      Steps.Add(step);

      return this;
    }

    internal Scenario Clock(DateTimeOffset now) =>
        Add(new JsonObject { ["op"] = "clock", ["ticks"] = Ticks(now) });

    internal Scenario Open(string session) =>
        Add(new JsonObject { ["op"] = "open", ["session"] = session });

    internal Scenario Close(string session) =>
        Add(new JsonObject { ["op"] = "close", ["session"] = session });

    internal Scenario Append(
        string session,
        int n,
        byte[] update,
        string? actor = "user-1",
        CollabOperationSource source = CollabOperationSource.ClientV2)
    {
      return AppendCandidate(session, OpId(n), actor, source, update, SHA256.HashData(update));
    }

    internal Scenario AppendCandidate(
        string session,
        string operationId,
        string? actor,
        CollabOperationSource source,
        byte[] update,
        byte[] digest) =>
        Add(new JsonObject
        {
          ["op"] = "append",
          ["session"] = session,
          ["operationId"] = operationId,
          ["actorId"] = actor,
          ["source"] = (int)source,
          ["update"] = Hex(update),
          ["digest"] = Hex(digest),
        });

    internal Scenario AppendRange(string session, int from, int through)
    {
      for (var n = from; n <= through; n++)
      {
        Append(session, n, [(byte)n]);
      }

      return this;
    }

    internal Scenario Find(string session, int n, string digest) =>
        Add(new JsonObject
        {
          ["op"] = "find",
          ["session"] = session,
          ["operationId"] = OpId(n),
          ["digest"] = digest,
        });

    internal Scenario Checkpoint(string session, ulong through, byte[] state) =>
        Add(new JsonObject
        {
          ["op"] = "checkpoint",
          ["session"] = session,
          ["through"] = through.ToString(CultureInfo.InvariantCulture),
          ["state"] = Hex(state),
        });

    internal Scenario Reset(string session, long epoch, string lineage, params byte[][] baseline) =>
        ResetRaw(session, 1, epoch, lineage, baseline);

    internal Scenario ResetRaw(
        string session,
        int format,
        long epoch,
        string lineage,
        byte[][] baseline) =>
        Add(new JsonObject
        {
          ["op"] = "reset",
          ["session"] = session,
          ["format"] = format,
          ["epoch"] = epoch,
          ["lineage"] = lineage,
          ["baseline"] = new JsonArray([.. baseline.Select(frame => (JsonNode?)Hex(frame))]),
        });

    internal Scenario Purge() => Add(new JsonObject { ["op"] = "purge" });

    internal Scenario IsPurged() => Add(new JsonObject { ["op"] = "isPurged" });

    internal Scenario Lineages() => Add(new JsonObject { ["op"] = "lineages" });

    internal Scenario Baseline(string lineage) =>
        Add(new JsonObject { ["op"] = "baseline", ["lineage"] = lineage });

    internal Scenario Headers(string lineage) =>
        Add(new JsonObject { ["op"] = "headers", ["lineage"] = lineage });

    internal Scenario Records(string lineage, ulong through) =>
        Add(new JsonObject
        {
          ["op"] = "records",
          ["lineage"] = lineage,
          ["through"] = through.ToString(CultureInfo.InvariantCulture),
        });

    internal Scenario DeleteLineage(string lineage) =>
        Add(new JsonObject { ["op"] = "deleteLineage", ["lineage"] = lineage });

    internal Scenario Write(string path, byte[] bytes) =>
        Add(new JsonObject { ["op"] = "write", ["path"] = path, ["hex"] = Hex(bytes) });

    internal Scenario AppendBytes(string path, byte[] bytes) =>
        Add(new JsonObject { ["op"] = "appendBytes", ["path"] = path, ["hex"] = Hex(bytes) });

    internal Scenario Delete(string path) =>
        Add(new JsonObject { ["op"] = "delete", ["path"] = path });

    internal Scenario Mkdir(string path) =>
        Add(new JsonObject { ["op"] = "mkdir", ["path"] = path });

    internal Scenario Rmdir(string path) =>
        Add(new JsonObject { ["op"] = "rmdir", ["path"] = path });

    internal Scenario Zero(string path, int offset, int length) =>
        Add(new JsonObject { ["op"] = "zero", ["path"] = path, ["offset"] = offset, ["length"] = length });

    internal Scenario Flip(string path, int offset) =>
        Add(new JsonObject { ["op"] = "flip", ["path"] = path, ["offset"] = offset });

    internal Scenario Snapshot(string path, string name) =>
        Add(new JsonObject { ["op"] = "snapshot", ["path"] = path, ["name"] = name });

    internal Scenario Restore(string path, string name) =>
        Add(new JsonObject { ["op"] = "restore", ["path"] = path, ["name"] = name });

    internal Scenario KeepRecords(string path, int count) =>
        Add(new JsonObject { ["op"] = "keepRecords", ["path"] = path, ["count"] = count });

    // The steps below are worked out here and written down as plain "write"
    // steps, so a replayer needs no copy of the code that made the bytes.
    internal Scenario CorruptRecord(string path, int index, string mode) =>
        Add(new JsonObject
        {
          ["op"] = "corruptRecord",
          ["path"] = path,
          ["index"] = index,
          ["mode"] = mode,
        });

    internal Scenario ForeignManifest(string path) =>
        Add(new JsonObject { ["op"] = "foreignManifest", ["path"] = path });

    internal Scenario DamageWorkingSet(string mode) =>
        Add(new JsonObject { ["op"] = "damageWorkingSet", ["mode"] = mode });

    internal Scenario WorkingSetFile(int format, long epoch, string lineage, IReadOnlyList<byte[]> frames)
    {
      var document = CollabWorkingSetCodec.EncodeDocument(
          new CollabWorkingSetTag(format, epoch, lineage),
          CollabWorkingSetCodec.EncodeFrames(frames));

      return Write(WorkingSet, document);
    }

    internal Scenario Sealed(string path, string magic, ulong tag, byte[] content) =>
        Add(new JsonObject
        {
          ["op"] = "sealed",
          ["path"] = path,
          ["magic"] = magic,
          ["tag"] = tag.ToString(CultureInfo.InvariantCulture),
          ["content"] = Hex(content),
        });
  }

  private sealed class FixedTime : TimeProvider
  {
    internal DateTimeOffset Now { get; set; } = Start;

    public override DateTimeOffset GetUtcNow() => Now;
  }

  private sealed class Runner
  {
    private readonly string root;
    private readonly FixedTime time = new();
    private readonly LocalCollabOperationStore store;
    private readonly Dictionary<string, ICollabOperationSession> sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, byte[]> snapshots = new(StringComparer.Ordinal);

    internal Runner(string root, long? maxUpdate)
    {
      this.root = root;
      store = new LocalCollabOperationStore(
          root,
          maxUpdate ?? LocalCollabOperationStore.DefaultMaxUpdateBytes,
          line => Logs.Add(Normalise(line)),
          time);
    }

    internal List<string> Logs { get; } = [];

    private string Normalise(string line)
    {
      // The OS's own words for a held lock differ per platform.
      const string Held = " is held elsewhere: ";
      var cut = line.IndexOf(Held, StringComparison.Ordinal);

      return (cut < 0 ? line : line[..(cut + Held.Length)] + "…")
          .Replace(root, "{root}")
          .Replace(CollabDocKey.For(DocId), "{doc}");
    }

    private string Resolve(JsonObject step) =>
        Path.Combine(root, ((string)step["path"]!).Replace("{doc}", CollabDocKey.For(DocId)));

    internal async Task<JsonObject> OpenResultAsync()
    {
      try
      {
        var opened = await store.OpenAsync(DocId);

        if (opened.Session is { } session)
        {
          sessions["reopen"] = session;
        }

        return EncodeOpen(opened);
      }
      catch (Exception error) when (Kind(error) is not null)
      {
        return Error(error);
      }
    }

    internal async Task CloseAllAsync()
    {
      foreach (var session in sessions.Values)
      {
        await session.DisposeAsync();
      }

      sessions.Clear();
    }

    internal async Task<JsonObject> RunAsync(JsonObject step)
    {
      var op = (string)step["op"]!;

      switch (op)
      {
        case "clock":
          time.Now = new DateTimeOffset(long.Parse((string)step["ticks"]!, CultureInfo.InvariantCulture), TimeSpan.Zero);

          return step;

        case "write":
          File.WriteAllBytes(Resolve(step), Convert.FromHexString((string)step["hex"]!));

          return step;

        case "appendBytes":
          using (var file = new FileStream(Resolve(step), FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
          {
            file.Write(Convert.FromHexString((string)step["hex"]!));
          }

          return step;

        case "delete":
          File.Delete(Resolve(step));

          return step;

        case "mkdir":
          Directory.CreateDirectory(Resolve(step));

          return step;

        case "rmdir":
          Directory.Delete(Resolve(step));

          return step;

        case "zero":
          {
            var path = Resolve(step);
            var bytes = File.ReadAllBytes(path);
            bytes.AsSpan((int)step["offset"]!, (int)step["length"]!).Clear();
            File.WriteAllBytes(path, bytes);

            return step;
          }

        case "flip":
          {
            var path = Resolve(step);
            var bytes = File.ReadAllBytes(path);
            bytes[(int)step["offset"]!] ^= 0xff;
            File.WriteAllBytes(path, bytes);

            return step;
          }

        case "snapshot":
          snapshots[(string)step["name"]!] = File.ReadAllBytes(Resolve(step));

          return step;

        case "restore":
          File.WriteAllBytes(Resolve(step), snapshots[(string)step["name"]!]);

          return step;

        case "keepRecords":
          {
            var path = Resolve(step);
            var bytes = File.ReadAllBytes(path);
            var offsets = LocalCollabOperationStoreTests.RecordOffsets(bytes);
            var keep = (int)step["count"]!;
            var length = keep == 0 ? 0 : offsets[keep - 1].Offset + offsets[keep - 1].Length;
            File.WriteAllBytes(path, bytes[..length]);

            return step;
          }

        case "sealed":
          LocalCollabOperationStore.WriteSealed(
              Resolve(step),
              Encoding.ASCII.GetBytes((string)step["magic"]!),
              ulong.Parse((string)step["tag"]!, CultureInfo.InvariantCulture),
              Convert.FromHexString((string)step["content"]!));

          return step;

        case "corruptRecord":
          {
            var path = Resolve(step);
            var bytes = File.ReadAllBytes(path);
            var offsets = LocalCollabOperationStoreTests.RecordOffsets(bytes);
            var (offset, length) = offsets[(int)step["index"]!];
            LocalCollabOperationStoreTests.Corrupt(bytes, offset, length, (string)step["mode"]!);
            File.WriteAllBytes(path, bytes);

            return Written(step, bytes);
          }

        case "foreignManifest":
          {
            var path = Resolve(step);
            var bytes = File.ReadAllBytes(path);

            for (var slot = 0; slot < 2; slot++)
            {
              var span = bytes.AsSpan(slot * LocalCollabOperationStore.ManifestSlotSize, LocalCollabOperationStore.ManifestSlotSize);
              span[4] = 1;
              SHA256.HashData(span[..96], span[96..]);
            }

            File.WriteAllBytes(path, bytes);

            return Written(step, bytes);
          }

        case "damageWorkingSet":
          {
            var path = Path.Combine(root, CollabDocKey.For(DocId));
            var bytes = LocalCollabOperationStoreTests.Damage(File.ReadAllBytes(path), (string)step["mode"]!);
            File.WriteAllBytes(path, bytes);

            return Written(new JsonObject { ["op"] = "write", ["path"] = WorkingSet }, bytes);
          }

        default:
          break;
      }

      JsonNode result;

      try
      {
        result = await CallAsync(op, step);
      }
      catch (Exception error) when (Kind(error) is not null)
      {
        result = Error(error);
      }

      step["result"] = result;

      return step;
    }

    private static JsonObject Written(JsonObject step, byte[] bytes) =>
        new()
        {
          ["op"] = "write",
          ["path"] = (string)step["path"]!,
          ["hex"] = Hex(bytes),
          ["was"] = step.DeepClone(),
        };

    private async Task<JsonNode> CallAsync(string op, JsonObject step)
    {
      var name = (string?)step["session"];

      switch (op)
      {
        case "open":
          {
            var opened = await store.OpenAsync(DocId);

            if (opened.Session is { } session)
            {
              sessions[name!] = session;
            }

            return EncodeOpen(opened);
          }

        case "close":
          await sessions[name!].DisposeAsync();

          return new JsonObject { ["ok"] = true };

        case "append":
          {
            var appended = await sessions[name!].AppendAsync(new CollabOperationCandidate(
                (string)step["operationId"]!,
                (string?)step["actorId"],
                (CollabOperationSource)(int)step["source"]!,
                Convert.FromHexString((string)step["update"]!),
                Convert.FromHexString((string)step["digest"]!)));

            return new JsonObject
            {
              ["outcome"] = appended.Outcome.ToString(),
              ["sequence"] = appended.ServerSequence.ToString(CultureInfo.InvariantCulture),
            };
          }

        case "find":
          {
            var found = await sessions[name!].FindCommittedAsync(
                (string)step["operationId"]!,
                Convert.FromHexString((string)step["digest"]!));

            return new JsonObject
            {
              ["outcome"] = found.Outcome.ToString(),
              ["sequence"] = found.ServerSequence.ToString(CultureInfo.InvariantCulture),
            };
          }

        case "checkpoint":
          await sessions[name!].WriteCheckpointAsync(new CollabOperationCheckpoint(
              ulong.Parse((string)step["through"]!, CultureInfo.InvariantCulture),
              Convert.FromHexString((string)step["state"]!)));

          return new JsonObject { ["ok"] = true };

        case "reset":
          {
            var head = await sessions[name!].ResetAsync(new CollabOperationReset(
                (int)step["format"]!,
                (long)step["epoch"]!,
                (string)step["lineage"]!,
                [.. step["baseline"]!.AsArray().Select(frame =>
                  new ReadOnlyMemory<byte>(Convert.FromHexString((string)frame!)))]));

            return EncodeHead(head);
          }

        case "purge":
          return new JsonObject { ["outcome"] = (await store.PurgeAsync(DocId)).ToString() };

        case "isPurged":
          return new JsonObject { ["purged"] = await store.IsPurgedAsync(DocId) };

        case "lineages":
          return new JsonObject
          {
            ["lineages"] = new JsonArray([.. (await store.ListLineagesAsync(DocId)).Select(info =>
                (JsonNode?)new JsonObject
                {
                  ["lineage"] = info.Lineage,
                  ["epoch"] = info.Epoch,
                  ["format"] = info.Format,
                  ["createdAt"] = info.CreatedAt is { } created ? Ticks(created) : null,
                  ["current"] = info.Current,
                })]),
          };

        case "baseline":
          {
            var frames = await store.ReadBaselineAsync(DocId, (string)step["lineage"]!);

            return new JsonObject
            {
              ["baseline"] = frames is null
                ? null
                : new JsonArray([.. frames.Select(frame => (JsonNode?)Hex(frame.Span))]),
            };
          }

        case "records":
          {
            var records = new JsonArray();

            await foreach (var record in store.ReadRecordsAsync(
                DocId,
                (string)step["lineage"]!,
                ulong.Parse((string)step["through"]!, CultureInfo.InvariantCulture)))
            {
              records.Add(EncodeRecord(record));
            }

            return new JsonObject { ["records"] = records };
          }

        case "headers":
          {
            var headers = new JsonArray();

            await foreach (var header in store.ReadHeadersAsync(DocId, (string)step["lineage"]!))
            {
              headers.Add(new JsonObject
              {
                ["sequence"] = header.ServerSequence.ToString(CultureInfo.InvariantCulture),
                ["committedAt"] = Ticks(header.CommittedAt),
                ["actorId"] = header.ActorId,
              });
            }

            return new JsonObject { ["headers"] = headers };
          }

        case "deleteLineage":
          return new JsonObject
          {
            ["outcome"] = (await store.DeleteLineageAsync(DocId, (string)step["lineage"]!)).ToString(),
          };

        default:
          throw new ArgumentOutOfRangeException(nameof(op), op, "unknown step");
      }
    }
  }

  private static JsonObject EncodeOpen(CollabDocumentOpen opened)
  {
    var encoded = new JsonObject { ["outcome"] = opened.Outcome.ToString() };

    if (opened.Session is not { } session)
    {
      return encoded;
    }

    var result = session.OpenResult;
    encoded["head"] = result.Head is { } head ? EncodeHead(head) : null;
    encoded["baseline"] = new JsonArray([.. result.Baseline.Select(frame => (JsonNode?)Hex(frame.Span))]);
    encoded["checkpoint"] = result.Checkpoint is { } checkpoint
      ? new JsonObject
      {
        ["through"] = checkpoint.Through.ToString(CultureInfo.InvariantCulture),
        ["state"] = Hex(checkpoint.State.Span),
      }
      : null;
    encoded["tail"] = new JsonArray([.. result.Tail.Select(record => (JsonNode?)EncodeRecord(record))]);

    return encoded;
  }

  private static JsonObject EncodeHead(CollabDocumentHead head) =>
      new()
      {
        ["format"] = head.Format,
        ["epoch"] = head.Epoch,
        ["lineage"] = head.Lineage,
        ["durableThrough"] = head.DurableThrough.ToString(CultureInfo.InvariantCulture),
      };

  private static JsonObject EncodeRecord(CollabOperationRecord record) =>
      new()
      {
        ["operationId"] = record.OperationId,
        ["sequence"] = record.ServerSequence.ToString(CultureInfo.InvariantCulture),
        ["committedAt"] = Ticks(record.CommittedAt),
        ["actorId"] = record.ActorId,
        ["source"] = (int)record.Source,
        ["update"] = Hex(record.Update.Span),
        ["digest"] = Hex(record.Digest.Span),
      };

  /// <summary>
  /// Null for an exception the capture does not expect, so it fails the test.
  /// IOException and UnauthorizedAccessException are one kind: which of the two
  /// the OS gives for the same fault differs per platform.
  /// </summary>
  private static string? Kind(Exception error) => error switch
  {
    CollabOperationFenceLostException => "FenceLost",
    InvalidDataException => "InvalidData",
    ObjectDisposedException => "Disposed",
    InvalidOperationException => "InvalidOperation",
    ArgumentOutOfRangeException => "ArgumentOutOfRange",
    ArgumentException => "Argument",
    IOException or UnauthorizedAccessException => "IO",
    _ => null,
  };

  private static JsonObject Error(Exception error)
  {
    var kind = Kind(error)!;
    var encoded = new JsonObject { ["type"] = kind };

    if (kind is not ("IO" or "Disposed"))
    {
      // .NET appends the parameter name and value to an ArgumentException's
      // message; the store's own words come before it.
      var message = error.Message;
      var cut = message.IndexOf(" (Parameter '", StringComparison.Ordinal);
      encoded["message"] = cut < 0 ? message : message[..cut];
    }

    return new JsonObject { ["error"] = encoded };
  }
}
