using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

internal enum CollabJoinStatus
{
  Joined,

  /// <summary>Access changed after the handshake; the endpoint answers 403.</summary>
  Forbidden,

  Purged,

  /// <summary>The doc endpoint could not seed the room; the endpoint closes 4503 and the next join retries.</summary>
  SeedFailed,

  /// <summary>The server is shutting down; new sessions are refused.</summary>
  Draining,

  /// <summary>
  /// The document cannot be served right now and nothing is wrong with the
  /// request: another live process holds its journal, or a commit failure put
  /// this document in its retry cooldown. The endpoint closes 4503 and the
  /// client comes back.
  /// </summary>
  Unavailable,
}

internal sealed record CollabJoinResult(
    CollabJoinStatus Status,
    CollabMembership? Membership,
    Exception? Error);

internal enum CollabEditStatus
{
  Applied,

  /// <summary>The id is committed for a different request body. The endpoint answers 409.</summary>
  Conflict,

  /// <summary>The server is going down; the endpoint answers 503.</summary>
  Draining,

  /// <summary>An op failed validation; nothing was written. The endpoint answers 422.</summary>
  Invalid,

  /// <summary>
  /// Reading the edit's rich text HTML ran past the runtime's limits; nothing
  /// was written and the room stays open. A retry may pass, so the endpoint
  /// answers 503 with Retry-After.
  /// </summary>
  Overloaded,

  /// <summary>
  /// Reading the edit's rich text HTML ran out of the runtime's per-call
  /// allocation budget. The same body fails every time; nothing was written.
  /// The endpoint answers 413.
  /// </summary>
  TooLarge,

  Purged,

  /// <summary>The doc endpoint could not seed the room; the endpoint answers 503.</summary>
  SeedFailed,

  /// <summary>
  /// The document cannot be served right now: another live process holds its
  /// journal, or a commit failure put it in its retry cooldown. The endpoint
  /// answers 503.
  /// </summary>
  Unavailable,

  /// <summary>
  /// The journal head is not the one the caller named; nothing was applied.
  /// The receipt carries the current head. The endpoint answers 412.
  /// </summary>
  PreconditionFailed,

  /// <summary>
  /// A precondition was sent but no journal is registered, so there is no
  /// head to check it against. The endpoint answers 428.
  /// </summary>
  PreconditionRequired,

  /// <summary>A dry run planned the edit and applied nothing; the receipt is the head it planned against.</summary>
  Previewed,
}

/// <summary>The journal head an HTTP edit expects, from its If-Match header.</summary>
internal sealed record CollabEditPrecondition(string Lineage, ulong Sequence);

internal sealed record CollabEditReceipt(CollabWorkingSetTag Tag, ulong ServerSequence);

internal sealed record CollabEditResult(
    CollabEditStatus Status,
    Exception? Error,
    CollabEditReceipt? Receipt = null);

internal enum CollabStateStatus
{
  Ready,
  Purged,

  /// <summary>The server is going down; the endpoint answers 503.</summary>
  Draining,

  /// <summary>The doc endpoint could not seed the room; the endpoint answers 503.</summary>
  SeedFailed,

  /// <summary>Held by another process or in its commit cooldown; the endpoint answers 503.</summary>
  Unavailable,

  /// <summary>The converter cannot write this document as JSON; the endpoint answers 500.</summary>
  ExportFailed,

  /// <summary>
  /// The export ran past the runtime's limits reading rich text HTML. A retry
  /// may pass, so the endpoint answers 503 with Retry-After.
  /// </summary>
  Overloaded,
}

/// <summary>
/// One consistent read of a room: the export bytes and, on a journal-backed
/// room, the head they reflect. Both are taken in one lane hold.
/// </summary>
internal sealed record CollabStateResult(
    CollabStateStatus Status,
    byte[] Json,
    CollabEditReceipt? Head = null,
    Exception? Error = null);

internal enum CollabResetStatus
{
  Reset,
  SeedFailed,
  Unavailable,
  Purged,
}

internal sealed record CollabResetResult(
    CollabResetStatus Status,
    CollabWorkingSetTag? Tag,
    Exception? Error);

/// <summary>How a history request resolved before any version was read or restored.</summary>
internal enum CollabHistoryStatus
{
  Ready,

  /// <summary>No journal, or a journal store without history reads.</summary>
  NoHistory,

  /// <summary>Unknown lineage, or a sequence past the lineage's durable head.</summary>
  NotFound,

  Purged,

  /// <summary>The converter hit a limit a retry may pass.</summary>
  Unavailable,

  /// <summary>The converter cannot write the version as JSON.</summary>
  ExportFailed,

  /// <summary>A stored baseline or record could not be read or replayed.</summary>
  Corrupt,
}

internal sealed record CollabHistoryListResult(
    CollabHistoryStatus Status,
    IReadOnlyList<CollabLineageInfo> Lineages,
    IReadOnlyList<CollabVersion> Versions);

/// <summary>A version as OutputData JSON. <paramref name="Time"/> is the point's time, null when unknown.</summary>
internal sealed record CollabHistoryReadResult(
    CollabHistoryStatus Status,
    byte[] Json,
    DateTimeOffset? Time);

/// <summary>Each record's edits, oldest first. <paramref name="Truncated"/>: older records were left out.</summary>
internal sealed record CollabHistoryChangesResult(
    CollabHistoryStatus Status,
    IReadOnlyList<CollabRecordChanges> Changes,
    bool Truncated);

/// <summary>A restore planned and measured against the live document, with nothing applied.</summary>
internal sealed record CollabRestorePreview(
    IReadOnlyList<CollabBlockChange> Blocks,
    IReadOnlyList<string> Page,
    IReadOnlyList<CollabRestoreGuard> Guards,
    long FrameBytes,
    long LimitBytes,
    CollabEditReceipt Head);

/// <summary>A dry run's answer: the preview, or the edit result that refused before the plan.</summary>
internal sealed record CollabRestorePreviewResult(
    CollabHistoryStatus History,
    CollabRestorePreview? Preview,
    CollabEditResult? Edit);

/// <summary><paramref name="Edit"/> is set only when <paramref name="History"/> is Ready. <paramref name="Refused"/> is set when a guard refused it.</summary>
internal sealed record CollabRestoreResult(
    CollabHistoryStatus History,
    CollabEditResult? Edit,
    IReadOnlyList<CollabRestoreGuard>? Refused = null,
    bool Hidden = false);

/// <summary>How one restore runs. <paramref name="Hidden"/>: the host's history window hides the point.</summary>
internal sealed record CollabRestoreOptions(bool Hidden = false);

/// <summary>
/// Owns one <see cref="CollabRoom"/> per open doc. Rooms remove themselves
/// when they close (eviction, reset, seed failure, drain); a join that races
/// a closing room simply retries on a fresh one.
/// </summary>
internal sealed partial class CollabRoomManager : ICollabRoomManager, ICollabDocumentPurger
{
  private const int MaxJoinAttempts = 16;

  private readonly Dictionary<string, CollabRoom> rooms = new(StringComparer.Ordinal);
  private readonly Dictionary<string, SemaphoreSlim> purgeLanes = new(StringComparer.Ordinal);

  /// <summary>
  /// A document's content was replaced wholesale: purged, reset from the store, or
  /// restored to a version. Agent undo steps (Agent/RoomAgentHistory.cs) listen, since
  /// replaying one now would bring back what this replaced.
  /// </summary>
  internal event Action<string>? DocumentReplaced;

  /// <summary>The room clock: what a history window counts back from.</summary>
  internal DateTimeOffset Now => timeProvider.GetUtcNow();
  private readonly Dictionary<string, CommitCooldown> cooldowns = new(StringComparer.Ordinal);
  private readonly ICollabWorkingSetStore store;
  private readonly ICollabOperationStore? operationStore;
  private readonly ICollabActivityObserver? activityObserver;
  private readonly ICollabRecordNotes? recordNotes;
  private readonly IDocEndpointClient endpoint;
  private readonly ICollabDocConverter converter;
  private readonly CollabRoomOptions options;
  private readonly TimeProvider timeProvider;
  private readonly Action<string>? log;
  private volatile bool draining;

  internal CollabRoomManager(
      ICollabWorkingSetStore store,
      IDocEndpointClient endpoint,
      ICollabDocConverter converter,
      CollabRoomOptions options,
      TimeProvider timeProvider,
      Action<string>? log = null,
      ICollabOperationStore? operationStore = null,
      ICollabActivityObserver? activityObserver = null,
      ICollabRecordNotes? recordNotes = null)
  {
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(endpoint);
    ArgumentNullException.ThrowIfNull(converter);
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(timeProvider);

    this.store = store;
    this.endpoint = endpoint;
    this.converter = converter;
    this.options = options;
    this.timeProvider = timeProvider;
    this.log = log;
    this.operationStore = operationStore;
    this.activityObserver = activityObserver;
    this.recordNotes = recordNotes;
  }

  internal int LiveRoomCount
  {
    get
    {
      lock (rooms)
      {
        return rooms.Count;
      }
    }
  }

  internal async ValueTask<CollabJoinResult> JoinAsync(
      string docId,
      ICollabMember member,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(member);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabJoinResult(CollabJoinStatus.Purged, null, null);
      }

      if (draining)
      {
        return new CollabJoinResult(CollabJoinStatus.Draining, null, null);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabJoinResult(CollabJoinStatus.Unavailable, null, null);
      }

      var room = RoomUnlessDraining(docId, out var refused);

      if (refused)
      {
        return new CollabJoinResult(CollabJoinStatus.Draining, null, null);
      }

      if (room is null)
      {
        return new CollabJoinResult(CollabJoinStatus.Purged, null, null);
      }

      var result = await room.JoinAsync(member, cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during join.");
  }

  internal async ValueTask<CollabWorkingSetTag> ResetAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    var result = await ResetForHttpAsync(docId, cancellationToken);

    return result.Tag ?? throw result.Error ?? new InvalidOperationException(
        $"collab: document \"{docId}\" is unavailable");
  }

  internal async ValueTask<CollabResetResult> ResetForHttpAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      var room = RoomFor(docId);

      if (room is null)
      {
        return new CollabResetResult(CollabResetStatus.Purged, null, null);
      }

      var result = await room.ResetAsync(cancellationToken);

      if (result is not null)
      {
        DocumentReplaced?.Invoke(docId);

        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during reset.");
  }

  internal ValueTask<CollabEditResult> EditAsync(
      string docId,
      IReadOnlyList<CollabEditOp> ops,
      CancellationToken cancellationToken = default)
  {
    return EditAsync(
        docId,
        ops,
        Guid.NewGuid().ToString("N"),
        CollabEditOps.CanonicalBodyDigest(ops),
        actorId: null,
        cancellationToken: cancellationToken);
  }

  /// <summary>How long an overloaded request should wait: the room's first backoff.</summary>
  internal TimeSpan RetryAfter => options.RetryBackoff;

  internal CollabRoomOptions Options => options;

  /// <summary>The converter the rooms run, so an agent plans on the same export they serve.</summary>
  internal ICollabDocConverter Converter => converter;

  /// <summary>Without a journal, an edit with no ops still persists and schedules an export.</summary>
  internal bool HasJournal => operationStore is not null;

  /// <summary>The journal keeps versions: <see cref="HistoryAsync(string, TimeSpan?, bool, CancellationToken)"/> and <see cref="ReadVersionAsync"/> can answer.</summary>
  internal bool HasHistory => operationStore is ICollabOperationHistoryStore;

  /// <summary>Block-level HTTP edit with the endpoint's idempotency receipt.</summary>
  internal async ValueTask<CollabEditResult> EditAsync(
      string docId,
      IReadOnlyList<CollabEditOp> ops,
      string operationId,
      ReadOnlyMemory<byte> digest,
      string? actorId,
      CollabEditPrecondition? expect = null,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(ops);
    ArgumentException.ThrowIfNullOrEmpty(operationId);

    // Checked before a room is made, so no seed GET is spent on it.
    if (expect is not null && operationStore is null)
    {
      return new CollabEditResult(CollabEditStatus.PreconditionRequired, null);
    }

    return await EditInRoomAsync(
        docId,
        room => room.EditAsync(ops, operationId, digest, actorId, expect, cancellationToken));
  }

  /// <summary>
  /// An agent batch planned against the live doc inside the room lane, after
  /// the duplicate and precondition checks (01 §3.14), like a restore.
  /// </summary>
  internal async ValueTask<CollabEditResult> AgentEditAsync(
      string docId,
      Func<YDoc, CancellationToken, ValueTask<IReadOnlyList<CollabEditOp>>> planOps,
      string operationId,
      ReadOnlyMemory<byte> digest,
      string? actorId,
      CollabEditPrecondition? expect,
      Func<YDoc, CollabEditReceipt?, CancellationToken, ValueTask>? applied = null,
      CollabRecordNote? note = null,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(planOps);
    ArgumentException.ThrowIfNullOrEmpty(operationId);

    // Without a journal the room never checks a precondition, so it would be ignored.
    if (expect is not null && operationStore is null)
    {
      return new CollabEditResult(CollabEditStatus.PreconditionRequired, null);
    }

    return await EditInRoomAsync(
        docId,
        room => room.EditAsync(planOps, operationId, digest, actorId, expect, applied, note, cancellationToken));
  }

  private async ValueTask<CollabEditResult> EditInRoomAsync(
      string docId,
      Func<CollabRoom, Task<CollabEditResult?>> edit)
  {
    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabEditResult(CollabEditStatus.Purged, null);
      }

      // Refused during shutdown, like a join: a room created after the drain
      // pass has already swept would seed a document from the consumer's
      // endpoint and then be closed without ever flushing it back.
      if (draining)
      {
        return new CollabEditResult(CollabEditStatus.Draining, null);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabEditResult(CollabEditStatus.Unavailable, null);
      }

      var room = RoomUnlessDraining(docId, out var refused);

      if (refused)
      {
        return new CollabEditResult(CollabEditStatus.Draining, null);
      }

      if (room is null)
      {
        return new CollabEditResult(CollabEditStatus.Purged, null);
      }

      var result = await edit(room);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during an edit.");
  }

  /// <summary>
  /// Every lineage the journal holds, and its versions newest first. A
  /// <paramref name="group"/> window replaces both default grouping limits.
  /// </summary>
  internal ValueTask<CollabHistoryListResult> HistoryAsync(
      string docId,
      TimeSpan? group = null,
      CancellationToken cancellationToken = default) =>
      HistoryAsync(docId, group, byActor: false, cancellationToken);

  /// <summary>
  /// <paramref name="byActor"/> also starts a version where the actor
  /// changes. With a record notes store, each version carries its actors' kinds.
  /// </summary>
  internal async ValueTask<CollabHistoryListResult> HistoryAsync(
      string docId,
      TimeSpan? group,
      bool byActor,
      CancellationToken cancellationToken)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    if (operationStore is not ICollabOperationHistoryStore history)
    {
      return new CollabHistoryListResult(CollabHistoryStatus.NoHistory, [], []);
    }

    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return new CollabHistoryListResult(CollabHistoryStatus.Purged, [], []);
    }

    IReadOnlyList<CollabLineageInfo> lineages;
    var withHeaders = new List<(CollabLineageInfo, IReadOnlyList<CollabRecordHeader>)>();

    try
    {
      lineages = await history.ListLineagesAsync(docId, cancellationToken);

      foreach (var lineage in lineages)
      {
        var headers = new List<CollabRecordHeader>();

        await foreach (var header in history.ReadHeadersAsync(docId, lineage.Lineage, cancellationToken))
        {
          headers.Add(header);
        }

        withHeaders.Add((lineage, headers));
      }
    }
    catch (InvalidDataException error)
    {
      log?.Invoke($"collab: the history of \"{docId}\" could not be read: {error.Message}");

      return new CollabHistoryListResult(CollabHistoryStatus.Corrupt, [], []);
    }

    // A purge that raced the reads leaves them empty.
    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return new CollabHistoryListResult(CollabHistoryStatus.Purged, [], []);
    }

    Func<string, ulong, CollabRecordNote?>? noteOf = null;

    if (recordNotes is not null)
    {
      var byLineage = new Dictionary<string, IReadOnlyDictionary<ulong, CollabRecordNote>>(StringComparer.Ordinal);

      foreach (var lineage in lineages)
      {
        byLineage[lineage.Lineage] = await ReadNotesAsync(docId, lineage.Lineage, cancellationToken) ?? Empty;
      }

      noteOf = (lineage, sequence) => byLineage[lineage].GetValueOrDefault(sequence);
    }

    return new CollabHistoryListResult(
        CollabHistoryStatus.Ready,
        lineages,
        CollabVersionTimeline.Group(
            withHeaders,
            group ?? CollabVersionTimeline.IdleGap,
            group ?? CollabVersionTimeline.MaxSpan,
            byActor,
            noteOf));
  }

  private static readonly IReadOnlyDictionary<ulong, CollabRecordNote> Empty = new Dictionary<ulong, CollabRecordNote>();

  /// <summary>
  /// The record notes of one lineage; null without a store. A store that
  /// fails reads as no notes: they are informational.
  /// </summary>
  internal async ValueTask<IReadOnlyDictionary<ulong, CollabRecordNote>?> ReadNotesAsync(
      string docId,
      string lineage,
      CancellationToken cancellationToken)
  {
    if (recordNotes is null)
    {
      return null;
    }

    try
    {
      return await recordNotes.ReadAsync(docId, lineage, cancellationToken);
    }
    catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
    {
      log?.Invoke($"collab: the record notes of \"{docId}\" could not be read: {error.Message}");

      return Empty;
    }
  }

  /// <summary>One point of a lineage as OutputData JSON, read without the room.</summary>
  internal async ValueTask<CollabHistoryReadResult> ReadVersionAsync(
      string docId,
      string lineage,
      ulong sequence,
      CancellationToken cancellationToken = default)
  {
    var point = await ReadPointAsync(docId, lineage, sequence, cancellationToken);

    if (point.Status != CollabHistoryStatus.Ready)
    {
      return new CollabHistoryReadResult(point.Status, [], null);
    }

    var output = point.Output!.AsObject();

    // The export stamps the export time; a version carries its own, or none.
    if (point.Time is { } at)
    {
      output["time"] = at.ToUnixTimeMilliseconds();
    }
    else
    {
      output.Remove("time");
    }

    // A host reads its own page fields from here after a restore. The title
    // and icon are already top-level (the export writes them), so the page
    // object leaves them out, and is left out when nothing else remains.
    if (point.Doc is { } doc)
    {
      foreach (var (name, map) in YDocConverter.PlainPageMaps(doc, ["title", "icon"]))
      {
        output[name] = map;
      }
    }

    return new CollabHistoryReadResult(
        CollabHistoryStatus.Ready,
        DocEndpointClient.Serialize(output),
        point.Time);
  }

  /// <summary>The most records one changes answer carries; the newest are kept.</summary>
  internal const int MaxChangeRecords = 200;

  /// <summary>
  /// The most bytes of rows one changes answer carries. Each row holds whole
  /// blocks, so 200 rows of large blocks ran to hundreds of MB.
  /// </summary>
  internal const int MaxChangeBytes = 4 * 1024 * 1024;

  /// <summary>
  /// The edits of each record in (<paramref name="since"/>, <paramref name="sequence"/>]
  /// of one lineage, read without the room. The replay always starts at the
  /// baseline; the cap only limits which records are diffed.
  /// </summary>
  internal async ValueTask<CollabHistoryChangesResult> ChangesAsync(
      string docId,
      string lineage,
      ulong sequence,
      ulong since,
      int maxRecords = MaxChangeRecords,
      int maxBytes = MaxChangeBytes,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentException.ThrowIfNullOrEmpty(lineage);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(since, sequence);
    ArgumentOutOfRangeException.ThrowIfLessThan(maxRecords, 1);
    ArgumentOutOfRangeException.ThrowIfLessThan(maxBytes, 1);

    if (operationStore is not ICollabOperationHistoryStore history)
    {
      return new CollabHistoryChangesResult(CollabHistoryStatus.NoHistory, [], false);
    }

    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return new CollabHistoryChangesResult(CollabHistoryStatus.Purged, [], false);
    }

    IReadOnlyList<CollabRecordChanges> changes = [];
    var truncated = false;

    try
    {
      var known = (await history.ListLineagesAsync(docId, cancellationToken))
          .Any(entry => string.Equals(entry.Lineage, lineage, StringComparison.Ordinal));
      var found = known && sequence == 0;
      // The record whose state is the first "before": the last at or below since, 0 for the baseline.
      ulong firstBefore = 0;
      var window = new List<ulong>();

      if (known && sequence > 0)
      {
        // The bound comes from the headers: a record read stops early without saying so.
        await foreach (var header in history.ReadHeadersAsync(docId, lineage, cancellationToken))
        {
          if (header.ServerSequence > sequence)
          {
            break;
          }

          if (header.ServerSequence <= since)
          {
            firstBefore = header.ServerSequence;
          }
          else
          {
            window.Add(header.ServerSequence);
          }

          if (header.ServerSequence == sequence)
          {
            found = true;

            break;
          }
        }
      }

      if (!found)
      {
        return new CollabHistoryChangesResult(
            await IsPurgedAsync(history, docId, cancellationToken)
              ? CollabHistoryStatus.Purged
              : CollabHistoryStatus.NotFound,
            [],
            false);
      }

      if (window.Count > maxRecords)
      {
        firstBefore = window[window.Count - maxRecords - 1];
        window.RemoveRange(0, window.Count - maxRecords);
        truncated = true;
      }

      if (window.Count > 0)
      {
        var baseline = await history.ReadBaselineAsync(docId, lineage, cancellationToken);

        if (baseline is null)
        {
          return new CollabHistoryChangesResult(
              await IsPurgedAsync(history, docId, cancellationToken)
                ? CollabHistoryStatus.Purged
                : CollabHistoryStatus.NotFound,
              [],
              false);
        }

        changes = await CollabVersionChanges.ReplayAsync(
            baseline,
            history.ReadRecordsAsync(docId, lineage, sequence, cancellationToken),
            firstBefore,
            converter,
            cancellationToken,
            maxBytes);

        // The replay drops the oldest records past the byte budget; what is left is the window's tail.
        if (changes.Count == 0 ||
            !changes.Select(record => record.Sequence).SequenceEqual(window.Skip(window.Count - changes.Count)))
        {
          throw new InvalidDataException("collab: the records do not match their headers.");
        }

        truncated |= changes.Count < window.Count;
      }
    }
    catch (Exception error) when (error is InvalidDataException or CollabHistoryReplayException)
    {
      log?.Invoke(
          $"collab: the changes through {sequence} of lineage {lineage} of \"{docId}\" could not be rebuilt: {error.Message}");

      return new CollabHistoryChangesResult(CollabHistoryStatus.Corrupt, [], false);
    }
    catch (CollabTransientException)
    {
      return new CollabHistoryChangesResult(CollabHistoryStatus.Unavailable, [], false);
    }
    catch (CollabChangesExportException error)
    {
      log?.Invoke(
          $"collab: the changes through {sequence} of lineage {lineage} of \"{docId}\" could not be exported: {error.Message}");

      return new CollabHistoryChangesResult(CollabHistoryStatus.ExportFailed, [], false);
    }

    // A purge that raced the reads leaves them empty.
    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return new CollabHistoryChangesResult(CollabHistoryStatus.Purged, [], false);
    }

    return new CollabHistoryChangesResult(CollabHistoryStatus.Ready, changes, truncated);
  }

  internal async ValueTask<(CollabHistoryStatus Status, CollabLineageDeleteOutcome? Outcome)> DeleteLineageAsync(
      string docId,
      string lineage,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentException.ThrowIfNullOrEmpty(lineage);

    if (operationStore is not ICollabOperationHistoryStore history)
    {
      return (CollabHistoryStatus.NoHistory, null);
    }

    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return (CollabHistoryStatus.Purged, CollabLineageDeleteOutcome.Purged);
    }

    var outcome = await history.DeleteLineageAsync(docId, lineage, cancellationToken);

    return outcome == CollabLineageDeleteOutcome.Purged || IsPurging(docId)
      ? (CollabHistoryStatus.Purged, CollabLineageDeleteOutcome.Purged)
      : (CollabHistoryStatus.Ready, outcome);
  }

  /// <summary>The restore key's digest: the request line, never the plan.</summary>
  internal static byte[] RestoreDigest(string lineage, ulong sequence)
  {
    return SHA256.HashData(Encoding.UTF8.GetBytes(
        string.Create(CultureInfo.InvariantCulture, $"restore\n{lineage}\n{sequence}")));
  }

  /// <summary>
  /// Makes the live document equal one point, as one journalled edit. The
  /// point is rebuilt outside the room; the edit is planned inside its lane,
  /// after the duplicate and precondition checks, so a retry gets its first
  /// receipt and nothing lands between planning and applying.
  /// </summary>
  internal ValueTask<CollabRestoreResult> RestoreAsync(
      string docId,
      string lineage,
      ulong sequence,
      string operationId,
      string? actorId,
      CollabEditPrecondition? expect = null,
      CancellationToken cancellationToken = default)
  {
    return RestoreAsync(docId, lineage, sequence, operationId, actorId, expect, null, cancellationToken);
  }

  /// <summary>
  /// <see cref="RestoreAsync(string, string, ulong, string, string?, CollabEditPrecondition?, CancellationToken)"/>
  /// with the guards enforced when <paramref name="confirmed"/> is not null: a guard whose kind it lacks
  /// refuses the restore, which changes nothing and answers the guards in <see cref="CollabRestoreResult.Refused"/>.
  /// </summary>
  internal ValueTask<CollabRestoreResult> RestoreAsync(
      string docId,
      string lineage,
      ulong sequence,
      string operationId,
      string? actorId,
      CollabEditPrecondition? expect,
      IReadOnlySet<string>? confirmed,
      CancellationToken cancellationToken = default)
  {
    return RestoreAsync(docId, lineage, sequence, operationId, actorId, expect, confirmed, new CollabRestoreOptions(), cancellationToken);
  }

  /// <summary>
  /// A restore with its <paramref name="restore"/> options. A hidden point is
  /// never rebuilt; it is refused in the lane, after the duplicate check, so
  /// a committed retry still gets its receipt.
  /// </summary>
  internal async ValueTask<CollabRestoreResult> RestoreAsync(
      string docId,
      string lineage,
      ulong sequence,
      string operationId,
      string? actorId,
      CollabEditPrecondition? expect,
      IReadOnlySet<string>? confirmed,
      CollabRestoreOptions restore,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(operationId);
    ArgumentNullException.ThrowIfNull(restore);

    var point = restore.Hidden
      ? (Status: CollabHistoryStatus.NotFound, Output: (JsonNode?)null, Time: (DateTimeOffset?)null, Doc: (YDoc?)null)
      : await ReadPointAsync(docId, lineage, sequence, cancellationToken);
    IReadOnlyList<CollabRestoreGuard>? refused = null;

    // A missing point still goes to the room: a retry whose lineage was
    // deleted since must get its first receipt from the duplicate check.
    if (point.Status is not (CollabHistoryStatus.Ready or CollabHistoryStatus.NotFound))
    {
      return new CollabRestoreResult(point.Status, null);
    }

    var target = point.Output?["blocks"] as JsonArray ?? [];
    var targetMaps = point.Doc is { } replayed ? YDocConverter.ReadPageMaps(replayed) : null;
    // The request, never the plan: a retry plans against a doc that moved.
    var digest = RestoreDigest(lineage, sequence);
    CollabEditResult edit;

    try
    {
      edit = await EditInRoomAsync(
          docId,
          room => room.EditAsync(
              async (doc, token) =>
              {
                if (restore.Hidden)
                {
                  throw new RestorePointHiddenException();
                }

                if (point.Status == CollabHistoryStatus.NotFound || targetMaps is null)
                {
                  throw new RestorePointMissingException();
                }

                var structure = YDocConverter.DescribeStructure(doc);
                var current = await converter.ExportAsync(doc, token);
                var currentBlocks = current["blocks"] as JsonArray ?? [];

                // After the duplicate check: a refusal consumes no key, and a committed retry keeps its receipt.
                if (confirmed is not null)
                {
                  var guards = CollabRestoreGuards.Of(currentBlocks, target);

                  if (guards.Any(guard => !confirmed.Contains(guard.Kind)))
                  {
                    refused = guards;

                    throw new RestoreGuardedException();
                  }
                }

                return CollabRestorePlanner.Plan(
                    currentBlocks,
                    structure,
                    target,
                    YDocConverter.ReadPageMaps(doc),
                    targetMaps,
                    options.RestoreTrashesPages
                      ? new CollabRestoreTrash(string.IsNullOrEmpty(actorId) ? null : actorId, timeProvider.GetUtcNow().ToUnixTimeMilliseconds())
                      : null);
              },
              operationId,
              digest,
              actorId,
              expect,
              null,
              null,
              cancellationToken));
    }
    catch (RestorePointMissingException)
    {
      return new CollabRestoreResult(CollabHistoryStatus.NotFound, null);
    }
    catch (RestorePointHiddenException)
    {
      return new CollabRestoreResult(CollabHistoryStatus.NotFound, null, Hidden: true);
    }
    catch (RestoreGuardedException)
    {
      return new CollabRestoreResult(CollabHistoryStatus.Ready, null, refused);
    }

    if (edit.Status == CollabEditStatus.Applied)
    {
      DocumentReplaced?.Invoke(docId);
    }

    return new CollabRestoreResult(CollabHistoryStatus.Ready, edit);
  }

  /// <summary>
  /// A restore's dry run: planned in the lane against the live document, measured on a scratch copy,
  /// and never applied. A refusal before the plan (a stale If-Match, a purge, a room that cannot load)
  /// comes back as the edit.
  /// </summary>
  internal async ValueTask<CollabRestorePreviewResult> PreviewRestoreAsync(
      string docId,
      string lineage,
      ulong sequence,
      CollabEditPrecondition? expect,
      string? actorId = null,
      CancellationToken cancellationToken = default)
  {
    var point = await ReadPointAsync(docId, lineage, sequence, cancellationToken);

    if (point.Status != CollabHistoryStatus.Ready || point.Doc is not { } replayed)
    {
      return new CollabRestorePreviewResult(point.Status == CollabHistoryStatus.Ready ? CollabHistoryStatus.NotFound : point.Status, null, null);
    }

    var target = point.Output?["blocks"] as JsonArray ?? [];
    var targetMaps = YDocConverter.ReadPageMaps(replayed);
    IReadOnlyList<CollabBlockChange> blocks = [];
    IReadOnlyList<string> page = [];
    IReadOnlyList<CollabRestoreGuard> guards = [];
    long frameBytes = 0;

    var edit = await EditInRoomAsync(
        docId,
        room => room.PreviewAsync(
            async (doc, token) =>
            {
              var current = (await converter.ExportAsync(doc, token))["blocks"] as JsonArray ?? [];
              var ops = CollabRestorePlanner.Plan(
                  current,
                  YDocConverter.DescribeStructure(doc),
                  target,
                  YDocConverter.ReadPageMaps(doc),
                  targetMaps,
                  // The restorer's id is part of the frame the real restore sends.
                  options.RestoreTrashesPages
                    ? new CollabRestoreTrash(string.IsNullOrEmpty(actorId) ? null : actorId, timeProvider.GetUtcNow().ToUnixTimeMilliseconds())
                    : null);
              var (scratch, bytes) = await CollabRoom.ApplyToScratchAsync(doc, converter, ops, token);
              var after = (await converter.ExportAsync(scratch, token))["blocks"] as JsonArray ?? [];

              blocks = CollabVersionChanges.Blocks(current, after);
              page = CollabVersionChanges.Page(CollabVersionChanges.PageFields(doc), CollabVersionChanges.PageFields(scratch));
              guards = CollabRestoreGuards.Of(current, target);
              frameBytes = bytes;

              return ops;
            },
            expect,
            cancellationToken));

    return edit.Status == CollabEditStatus.Previewed && edit.Receipt is { } head
      ? new CollabRestorePreviewResult(
          CollabHistoryStatus.Ready,
          new CollabRestorePreview(blocks, page, guards, frameBytes, CollabRoom.FrameLimit(options), head),
          null)
      : new CollabRestorePreviewResult(CollabHistoryStatus.Ready, null, edit);
  }

  private async ValueTask<bool> IsPurgedAsync(
      ICollabOperationHistoryStore history,
      string docId,
      CancellationToken cancellationToken)
  {
    return IsPurging(docId) || await history.IsPurgedAsync(docId, cancellationToken);
  }

  /// <summary>Thrown by a restore's planner when its point is gone and the op id was never committed.</summary>
  private sealed class RestorePointMissingException : Exception;

  /// <summary>Thrown by a restore's planner when the host's window hides its point.</summary>
  private sealed class RestorePointHiddenException : Exception;

  /// <summary>Thrown by a restore's planner when a guard is present that the request did not confirm.</summary>
  private sealed class RestoreGuardedException : Exception;

  /// <summary>
  /// A point rebuilt and exported. Its bounds come from the store's headers:
  /// a record read stops early without saying so.
  /// </summary>
  private async ValueTask<(CollabHistoryStatus Status, JsonNode? Output, DateTimeOffset? Time, YDoc? Doc)> ReadPointAsync(
      string docId,
      string lineage,
      ulong sequence,
      CancellationToken cancellationToken)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentException.ThrowIfNullOrEmpty(lineage);

    if (operationStore is not ICollabOperationHistoryStore history)
    {
      return (CollabHistoryStatus.NoHistory, null, null, null);
    }

    if (await IsPurgedAsync(history, docId, cancellationToken))
    {
      return (CollabHistoryStatus.Purged, null, null, null);
    }

    YDoc replayed;
    DateTimeOffset? time;

    try
    {
      var info = (await history.ListLineagesAsync(docId, cancellationToken))
          .FirstOrDefault(entry => string.Equals(entry.Lineage, lineage, StringComparison.Ordinal));
      time = info?.CreatedAt;
      var found = info is not null && sequence == 0;

      if (info is not null && sequence > 0)
      {
        await foreach (var header in history.ReadHeadersAsync(docId, lineage, cancellationToken))
        {
          if (header.ServerSequence >= sequence)
          {
            found = header.ServerSequence == sequence;
            time = header.CommittedAt;

            break;
          }
        }
      }

      var baseline = found ? await history.ReadBaselineAsync(docId, lineage, cancellationToken) : null;

      if (baseline is null)
      {
        return (
            await IsPurgedAsync(history, docId, cancellationToken)
              ? CollabHistoryStatus.Purged
              : CollabHistoryStatus.NotFound,
            null,
            null,
            null);
      }

      replayed = await CollabHistoryReplay.BuildAsync(
          baseline,
          history.ReadRecordsAsync(docId, lineage, sequence, cancellationToken),
          cancellationToken);
    }
    catch (Exception error) when (error is InvalidDataException or CollabHistoryReplayException)
    {
      log?.Invoke(
          $"collab: version {sequence} of lineage {lineage} of \"{docId}\" could not be rebuilt: {error.Message}");

      return (CollabHistoryStatus.Corrupt, null, null, null);
    }

    try
    {
      return (CollabHistoryStatus.Ready, await converter.ExportAsync(replayed, cancellationToken), time, replayed);
    }
    catch (CollabTransientException)
    {
      return (CollabHistoryStatus.Unavailable, null, null, null);
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      log?.Invoke(
          $"collab: version {sequence} of lineage {lineage} of \"{docId}\" could not be exported: {error.Message}");

      return (CollabHistoryStatus.ExportFailed, null, null, null);
    }
  }

  /// <summary>GET /sync/{doc}/state: the live document, loading the room the way an edit does.</summary>
  internal async ValueTask<CollabStateResult> StateAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabStateResult(CollabStateStatus.Purged, []);
      }

      if (draining)
      {
        return new CollabStateResult(CollabStateStatus.Draining, []);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabStateResult(CollabStateStatus.Unavailable, []);
      }

      var room = RoomUnlessDraining(docId, out var refused);

      if (refused)
      {
        return new CollabStateResult(CollabStateStatus.Draining, []);
      }

      if (room is null)
      {
        return new CollabStateResult(CollabStateStatus.Purged, []);
      }

      var result = await room.StateAsync(cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during a state read.");
  }

  public async ValueTask<int> RecheckAccessAsync(
      string documentId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(documentId);
    CollabRoom? room;

    lock (rooms)
    {
      rooms.TryGetValue(documentId, out room);
    }

    return room is null ? 0 : await room.RecheckAccessAsync(cancellationToken);
  }

  /// <summary>
  /// Publishes a checkpoint on a document that is already loaded, and with it
  /// the one whole-JSON projection a checkpoint earns. Nothing drives this
  /// yet: the cadence belongs to the checkpoint publisher (plan task 5.1).
  /// False when no room holds the document, or the room had nothing new.
  /// </summary>
  internal async ValueTask<bool> CheckpointAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    CollabRoom? room;

    lock (rooms)
    {
      if (purgeLanes.ContainsKey(docId))
      {
        return false;
      }

      rooms.TryGetValue(docId, out room);
    }

    return room is not null && await room.CheckpointAsync(cancellationToken);
  }

  /// <summary>Consecutive commit failures for one document, and when it may be loaded again.</summary>
  private sealed record CommitCooldown(int Failures, DateTimeOffset Until);

  public async ValueTask<CollabDocumentPurgeOutcome> PurgeDocumentAsync(
      string documentId,
      Func<CancellationToken, ValueTask<bool>> authorize,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(documentId);
    ArgumentNullException.ThrowIfNull(authorize);

    if (documentId is "." or ".." ||
        documentId.Contains('/') ||
        documentId.Contains('\\') ||
        documentId.Contains("%2f", StringComparison.OrdinalIgnoreCase) ||
        documentId.Contains("%5c", StringComparison.OrdinalIgnoreCase))
    {
      throw new ArgumentException(
          "collab: document ids must be a single path segment.",
          nameof(documentId));
    }

    if (!await authorize(cancellationToken))
    {
      throw new UnauthorizedAccessException(
          "collab: document purge was not authorized.");
    }

    if (operationStore is not null &&
        operationStore is not ICollabOperationPurgeStore)
    {
      throw new NotSupportedException(
          $"the operation journal cannot purge documents: the registered {nameof(ICollabOperationStore)} " +
          $"({operationStore.GetType().FullName}) must also implement {nameof(ICollabOperationPurgeStore)}");
    }

    SemaphoreSlim purgeLane;

    lock (rooms)
    {
      if (purgeLanes.TryGetValue(documentId, out var existing))
      {
        purgeLane = existing;
      }
      else
      {
        purgeLane = new SemaphoreSlim(1, 1);
        purgeLanes[documentId] = purgeLane;
      }

      if (rooms.TryGetValue(documentId, out var current))
      {
        current.RequestPurge();
      }
    }

    await purgeLane.WaitAsync(cancellationToken);

    try
    {
      CollabRoom? room;

      // Before anything is deleted: an attempt that fails halfway still leaves no step to replay.
      DocumentReplaced?.Invoke(documentId);

      lock (rooms)
      {
        rooms.TryGetValue(documentId, out room);
        room?.RequestPurge();
      }

      if (room is not null)
      {
        await room.PurgeAsync(cancellationToken);
      }

      if (operationStore is ICollabOperationPurgeStore journal)
      {
        var outcome = await journal.PurgeAsync(documentId, cancellationToken);

        if (outcome == CollabDocumentPurgeOutcome.DocumentOpenElsewhere)
        {
          return outcome;
        }
      }

      await store.DeleteAsync(documentId, cancellationToken);

      return CollabDocumentPurgeOutcome.Purged;
    }
    finally
    {
      purgeLane.Release();
    }
  }

  /// <summary>Plan decision 19: refuse new joins, flush every room (blob + export), close members 1001.</summary>
  public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
  {
    draining = true;

    // A join that passed the draining check a moment ago may still add a
    // room; keep going until nothing is left. Rooms drain together and one
    // that throws is dropped rather than allowed to abort the pass — a
    // sequential await let the first failure strand every room after it.
    while (LiveRooms() is { Length: > 0 } rooms)
    {
      await Task.WhenAll(Array.ConvertAll(
          rooms,
          room => DrainRoomAsync(room, cancellationToken)));
    }
  }

  /// <summary>
  /// Test hook: completes once every room has run the work queued before the
  /// call AND delivered the activity that work handed to the host. That second
  /// half awaits HOST code with NO bound — unlike <see cref="DrainAsync"/>,
  /// which bounds it twice — so this belongs in tests and nowhere else.
  /// </summary>
  internal async Task SettleAsync()
  {
    foreach (var room in LiveRooms())
    {
      await room.SettleAsync();
    }
  }

  /// <summary>Test hook: waits until no room has a working-set write in flight.</summary>
  internal async Task SettleWritesAsync()
  {
    foreach (var room in LiveRooms())
    {
      while (await room.PersistInFlightAsync())
      {
        await Task.Delay(1);
      }
    }
  }

  private async Task DrainRoomAsync(
      CollabRoom room,
      CancellationToken cancellationToken)
  {
    try
    {
      await room.DrainAsync(cancellationToken);
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: room \"{room.DocId}\" could not be drained: {error.Message}");
      Forget(room);
    }
  }

  private CollabRoom[] LiveRooms()
  {
    lock (rooms)
    {
      return [.. rooms.Values];
    }
  }

  private bool IsPurging(string docId)
  {
    lock (rooms)
    {
      return purgeLanes.ContainsKey(docId);
    }
  }

  private CollabRoom? RoomFor(string docId)
  {
    return RoomForDoor(docId, refuseDraining: false, out _);
  }

  /// <summary>
  /// RoomFor, but refused once a drain has begun. Checked under the lock
  /// DrainAsync's sweep takes, so no room is made after its last empty sweep.
  /// </summary>
  private CollabRoom? RoomUnlessDraining(string docId, out bool refused)
  {
    return RoomForDoor(docId, refuseDraining: true, out refused);
  }

  private CollabRoom? RoomForDoor(string docId, bool refuseDraining, out bool refused)
  {
    refused = false;

    lock (rooms)
    {
      if (purgeLanes.ContainsKey(docId))
      {
        return null;
      }

      if (refuseDraining && draining)
      {
        refused = true;

        return null;
      }

      if (!rooms.TryGetValue(docId, out var room))
      {
        room = new CollabRoom(
            docId,
            store,
            endpoint,
            converter,
            options,
            timeProvider,
            log,
            operationStore,
            activityObserver,
            recordNotes);
        room.Closed += OnRoomClosed;
        rooms[docId] = room;
      }

      return room;
    }
  }

  /// <summary>
  /// A document whose commit failed is refused for a doubling wait. Without it
  /// every reconnect through the outage would reload that document's baseline
  /// and tail from the store that is already in trouble. A load that ran past
  /// the runtime's limits is held off the same way: each retry would hold a
  /// pooled engine for the whole timeout, at the same rate.
  /// </summary>
  private bool InCommitCooldown(string docId)
  {
    lock (rooms)
    {
      return cooldowns.TryGetValue(docId, out var cooldown) &&
          timeProvider.GetUtcNow() < cooldown.Until;
    }
  }

  private void OnRoomClosed(CollabRoom room)
  {
    lock (rooms)
    {
      if (room.CommitUnavailable || room.LoadHeldOff)
      {
        var failures = (cooldowns.TryGetValue(room.DocId, out var cooldown)
            ? cooldown.Failures
            : 0) + 1;
        var wait = options.Backoff(failures);

        cooldowns[room.DocId] = new CommitCooldown(failures, timeProvider.GetUtcNow() + wait);

        if (room.LoadHeldOff)
        {
          log?.Invoke(
              $"collab: document \"{room.DocId}\" failed to load in a way the next open repeats, " +
              $"so it is held off for {wait} (failure {failures}); the room's own log line says why");
        }
      }
      else
      {
        // The room served and closed for an ordinary reason, so the store is
        // no longer the problem: the next failure starts its wait over.
        cooldowns.Remove(room.DocId);
      }
    }

    Forget(room);
  }

  private void Forget(CollabRoom room)
  {
    lock (rooms)
    {
      if (rooms.TryGetValue(room.DocId, out var current) &&
          ReferenceEquals(current, room))
      {
        rooms.Remove(room.DocId);
      }
    }
  }
}
