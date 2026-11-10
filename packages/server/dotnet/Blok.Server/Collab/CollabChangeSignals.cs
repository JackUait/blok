using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>
/// What changed in one document during one window, by id only. It carries no
/// content: read <c>/history/changes</c> for that. Signals can be lost, so a
/// host that must not miss a change reconciles through <c>/history/changes</c>
/// and <c>olderEnd</c>.
/// </summary>
/// <param name="DocumentId">The document. Caller-supplied text; treat it as untrusted.</param>
/// <param name="Lineage">The lineage every record of the window is on.</param>
/// <param name="FromSequence">The window's first record.</param>
/// <param name="ToSequence">The window's last record.</param>
/// <param name="WindowStart">The server's clock at the window's first record.</param>
/// <param name="WindowEnd"><paramref name="WindowStart"/> plus the window length.</param>
/// <param name="Blocks">Blocks still changed at the end of the window, first touched first.</param>
/// <param name="Page">Changed page keys: <c>title</c>, <c>icon</c>, or <c>values.&lt;key&gt;</c>.</param>
/// <param name="Properties">Changed property ids, per database row.</param>
/// <param name="Schema">Changed schema entries, per database.</param>
/// <param name="Authors">Who wrote the window's records, first seen first.</param>
/// <param name="Truncated">
/// True when the window held more records than one read takes. The signal
/// then names only the newest of them, from <paramref name="FromSequence"/> on.
/// </param>
public sealed record CollabChangeSignal(
    string DocumentId,
    string Lineage,
    ulong FromSequence,
    ulong ToSequence,
    DateTimeOffset WindowStart,
    DateTimeOffset WindowEnd,
    IReadOnlyList<CollabSignalBlock> Blocks,
    IReadOnlyList<string> Page,
    IReadOnlyList<CollabSignalProperties> Properties,
    IReadOnlyList<CollabSignalSchema> Schema,
    IReadOnlyList<CollabSignalAuthor> Authors,
    bool Truncated = false);

/// <summary>One block: <c>added</c>, <c>removed</c>, <c>changed</c> or <c>moved</c> over the window.</summary>
public sealed record CollabSignalBlock(string Id, string Kind);

/// <summary>The property ids that changed on one database row.</summary>
public sealed record CollabSignalProperties(string RowId, IReadOnlyList<string> Ids);

/// <summary>
/// One schema entry of one database: <c>created</c>, <c>updated</c> or
/// <c>deleted</c> over the window. No name: a property name is content.
/// </summary>
public sealed record CollabSignalSchema(string DatabaseId, string Id, string Action);

/// <summary>One author. Kind is the record note's kind, null when no note was written.</summary>
public sealed record CollabSignalAuthor(string Id, string? Kind);

/// <summary>Who did an audited thing. Kind and OnBehalfOf come from the record note, when there is one.</summary>
public sealed record CollabAuditActor(string Id, string? Kind, string? OnBehalfOf);

/// <summary>
/// One typed audit event. Blok stores none of them; keeping them is the host's job.
/// </summary>
/// <param name="Type">One of <see cref="CollabAuditEventTypes"/>.</param>
/// <param name="DocumentId">The document. Caller-supplied text; treat it as untrusted.</param>
/// <param name="At">The server's clock when it happened.</param>
/// <param name="Actor">Who did it. Null when the server does not know.</param>
/// <param name="Lineage">The lineage, for <c>history.lineageDeleted</c>.</param>
public sealed record CollabAuditEvent(
    string Type,
    string DocumentId,
    DateTimeOffset At,
    CollabAuditActor? Actor,
    string? Lineage = null);

/// <summary>The audit event types Blok emits.</summary>
public static class CollabAuditEventTypes
{
  /// <summary>A member's write was journalled. Same moment and throttle as <see cref="CollabActivityKind.Edited"/>.</summary>
  public const string ContentEdited = "content.edited";

  /// <summary>A superseded lineage was deleted through the history route.</summary>
  public const string LineageDeleted = "history.lineageDeleted";

  /// <summary>A document was purged. Carries no actor: the purge seam takes none.</summary>
  public const string DocumentPurged = "document.purged";
}

/// <summary>One journal record as the change signals read it: ids only.</summary>
internal sealed record CollabSignalRecord(
    string Lineage,
    ulong Sequence,
    DateTimeOffset CommittedAt,
    string? Actor,
    CollabRecordNote? Note,
    IReadOnlyList<CollabSignalBlock> Blocks,
    IReadOnlyList<string> Page,
    IReadOnlyList<CollabSignalProperties> Properties,
    IReadOnlyList<CollabSignalSchema> Schema);

/// <summary>
/// Folds journal records into change signals. Go and Rust read the same
/// fixture (collab-history/signals.json).
/// </summary>
internal static class CollabChangeSignals
{
  internal const string Added = "added";
  internal const string Removed = "removed";
  internal const string Changed = "changed";
  internal const string Moved = "moved";

  /// <summary>
  /// Splits records, in commit order, into windows: a window starts at its
  /// first record and holds each next record on the same lineage committed
  /// before its end. Then collapses each.
  /// </summary>
  public static List<CollabChangeSignal> Fold(string documentId, IReadOnlyList<CollabSignalRecord> records, TimeSpan window)
  {
    var signals = new List<CollabChangeSignal>();
    var start = 0;

    for (var r = 1; r <= records.Count; r++)
    {
      if (r < records.Count &&
          string.Equals(records[r].Lineage, records[start].Lineage, StringComparison.Ordinal) &&
          records[r].CommittedAt < records[start].CommittedAt + window)
      {
        continue;
      }

      var at = records[start].CommittedAt;

      if (Collapse(documentId, at, at + window, [.. records.Skip(start).Take(r - start)]) is { } signal)
      {
        signals.Add(signal);
      }

      start = r;
    }

    return signals;
  }

  /// <summary>
  /// One window's records, oldest first, as one signal; null when nothing
  /// is left. A block added and removed in the window is gone, with its
  /// properties and schema entries.
  /// </summary>
  public static CollabChangeSignal? Collapse(
      string documentId,
      DateTimeOffset windowStart,
      DateTimeOffset windowEnd,
      IReadOnlyList<CollabSignalRecord> records)
  {
    if (records.Count == 0)
    {
      return null;
    }

    var blockOrder = new List<string>();
    var blocks = new Dictionary<string, string?>(StringComparer.Ordinal);
    var page = new List<string>();
    var rowOrder = new List<string>();
    var rows = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    var schemaOrder = new List<(string, string)>();
    var schema = new Dictionary<(string, string), CollabSignalSchema?>();
    var authorOrder = new List<string>();
    var kinds = new Dictionary<string, string?>(StringComparer.Ordinal);

    foreach (var record in records)
    {
      foreach (var block in record.Blocks)
      {
        if (!blocks.TryGetValue(block.Id, out var seen))
        {
          blockOrder.Add(block.Id);
        }

        blocks[block.Id] = seen is null ? block.Kind : Combine(seen, block.Kind);
      }

      foreach (var key in record.Page)
      {
        if (!page.Contains(key))
        {
          page.Add(key);
        }
      }

      foreach (var row in record.Properties)
      {
        if (!rows.TryGetValue(row.RowId, out var ids))
        {
          rowOrder.Add(row.RowId);
          rows[row.RowId] = ids = [];
        }

        ids.AddRange(row.Ids.Where(id => !ids.Contains(id)));
      }

      foreach (var entry in record.Schema)
      {
        var key = (entry.DatabaseId, entry.Id);

        if (!schema.TryGetValue(key, out var seen))
        {
          schemaOrder.Add(key);
        }

        schema[key] = seen is null ? entry : CombineSchema(seen, entry);
      }

      var visible = record.Blocks.Count > 0 || record.Page.Count > 0 || record.Properties.Count > 0 || record.Schema.Count > 0;

      if (visible && record.Actor is { } actor)
      {
        if (!kinds.ContainsKey(actor))
        {
          authorOrder.Add(actor);
          kinds[actor] = null;
        }

        // The actor's first note, as the version list reads it.
        kinds[actor] ??= record.Note?.Kind;
      }
    }

    bool Gone(string id) => blocks.TryGetValue(id, out var kind) && kind is null;

    var signal = new CollabChangeSignal(
        documentId,
        records[0].Lineage,
        records[0].Sequence,
        records[^1].Sequence,
        windowStart,
        windowEnd,
        [.. blockOrder.Where(id => blocks[id] is not null).Select(id => new CollabSignalBlock(id, blocks[id]!))],
        page,
        [.. rowOrder.Where(id => !Gone(id) && rows[id].Count > 0).Select(id => new CollabSignalProperties(id, rows[id]))],
        [.. schemaOrder.Where(key => !Gone(key.Item1) && schema[key] is not null).Select(key => schema[key]!)],
        [.. authorOrder.Select(id => new CollabSignalAuthor(id, kinds[id]))]);

    return signal.Blocks.Count == 0 && signal.Page.Count == 0 && signal.Properties.Count == 0 && signal.Schema.Count == 0
      ? null
      : signal;
  }

  /// <summary>A block over two changes; null when added then removed.</summary>
  internal static string? Combine(string older, string newer)
  {
    if (older == Added)
    {
      return newer == Removed ? null : Added;
    }

    if (newer == Removed)
    {
      return Removed;
    }

    return older == Moved && newer == Moved ? Moved : Changed;
  }

  private static CollabSignalSchema? CombineSchema(CollabSignalSchema older, CollabSignalSchema newer)
  {
    var action = older.Action == "created"
      ? newer.Action == "deleted" ? null : "created"
      : newer.Action == "deleted" ? "deleted" : "updated";

    return action is null ? null : newer with { Action = action };
  }

  /// <summary>One record of a changes read, as the signals read it.</summary>
  internal static CollabSignalRecord FromChanges(string lineage, CollabRecordChanges record, CollabRecordNote? note)
  {
    var properties = new List<CollabSignalProperties>();
    var schema = new List<CollabSignalSchema>();

    foreach (var block in record.Blocks)
    {
      if (block.Kind != CollabBlockChangeKind.Changed)
      {
        continue;
      }

      var fields = CollabDatabaseChanges.Describe(block.Type, block.Before, block.After);

      if (fields["properties"] is JsonArray ids)
      {
        properties.Add(new CollabSignalProperties(block.Id, [.. ids.Select(entry => entry!["id"]!.GetValue<string>())]));
      }

      if (fields["schema"] is JsonArray entries)
      {
        schema.AddRange(entries.Select(entry => new CollabSignalSchema(
            block.Id,
            entry!["id"]!.GetValue<string>(),
            entry["action"]!.GetValue<string>())));
      }
    }

    return new CollabSignalRecord(
        lineage,
        record.Sequence,
        record.CommittedAt,
        record.ActorId,
        note,
        [.. record.Blocks.Select(block => new CollabSignalBlock(block.Id, KindName(block.Kind)))],
        record.Page,
        properties,
        schema);
  }

  private static string KindName(CollabBlockChangeKind kind) => kind switch
  {
    CollabBlockChangeKind.Added => Added,
    CollabBlockChangeKind.Removed => Removed,
    CollabBlockChangeKind.Moved => Moved,
    _ => Changed,
  };
}
