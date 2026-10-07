using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

internal enum CollabBlockChangeKind
{
  Added,
  Removed,
  Changed,
  Moved,
}

/// <summary>One block a record touched. Before is null when added, After when removed.</summary>
internal sealed record CollabBlockChange(
    string Id,
    string? Type,
    CollabBlockChangeKind Kind,
    JsonObject? Before,
    JsonObject? After);

/// <summary>
/// One journal record's visible edits. Page lists changed keys of the page
/// map, then of the values map as "values.&lt;key&gt;".
/// </summary>
internal sealed record CollabRecordChanges(
    ulong Sequence,
    DateTimeOffset CommittedAt,
    string? ActorId,
    IReadOnlyList<CollabBlockChange> Blocks,
    IReadOnlyList<string> Page);

/// <summary>What changed between two exports of one document, by block id and by page key.</summary>
internal static class CollabVersionChanges
{
  private const string PageRoot = "page";
  private const string ValuesRoot = "values";
  private const string ValuesPrefix = "values.";

  /// <summary>
  /// Replays once from the baseline and diffs every record after
  /// <paramref name="firstBefore"/> (0 = the baseline) against the step
  /// before it. HTML in rich fields is read only for the blocks returned:
  /// a format-1 lineage would otherwise send every field through the runtime
  /// on every step. A converter failure other than a transient one is thrown
  /// as <see cref="CollabChangesExportException"/>.
  /// </summary>
  internal static async ValueTask<IReadOnlyList<CollabRecordChanges>> ReplayAsync(
      IReadOnlyList<ReadOnlyMemory<byte>> baseline,
      IAsyncEnumerable<CollabOperationRecord> records,
      ulong firstBefore,
      ICollabDocConverter converter,
      CancellationToken ct)
  {
    var changes = new List<CollabRecordChanges>();
    var kept = new HashSet<RichTextHtmlSlot>(ReferenceEqualityComparer.Instance);
    var warned = new HashSet<string>(StringComparer.Ordinal);
    StepExport? previous = null;

    await foreach (var (record, doc) in CollabHistoryReplay.StepAsync(baseline, records, ct).ConfigureAwait(false))
    {
      if ((record?.ServerSequence ?? 0) < firstBefore)
      {
        continue;
      }

      var current = StepExport.Of(converter, doc, warned);

      if (record is not null && record.ServerSequence > firstBefore && previous is not null)
      {
        var blocks = Blocks(previous.Blocks, current.Blocks);

        foreach (var change in blocks)
        {
          previous.Keep(change.Before, kept);
          current.Keep(change.After, kept);
        }

        changes.Add(new CollabRecordChanges(
            record.ServerSequence,
            record.CommittedAt,
            record.ActorId,
            blocks,
            Page(previous.Page, current.Page)));
      }

      previous?.DetachKept();
      previous = current;
    }

    previous?.DetachKept();

    try
    {
      await converter.ResolveAsync([.. kept], ct).ConfigureAwait(false);
    }
    catch (Exception error) when (error is not (CollabTransientException or OperationCanceledException))
    {
      throw new CollabChangesExportException(error);
    }

    return changes;
  }

  /// <summary>
  /// Added, changed and moved in <paramref name="after"/> order, then removed
  /// in <paramref name="before"/> order. Moved follows src/view/diff-output-data.ts,
  /// so the server and the client mark the same blocks.
  /// </summary>
  internal static IReadOnlyList<CollabBlockChange> Blocks(JsonArray before, JsonArray after)
  {
    var beforeById = IndexById(before);
    var afterById = IndexById(after);
    var reordered = Reordered(before, after, beforeById, afterById);
    var changes = new List<CollabBlockChange>();

    foreach (var (id, block) in InOrder(after, afterById))
    {
      if (!beforeById.TryGetValue(id, out var old))
      {
        changes.Add(new CollabBlockChange(id, TypeOf(block), CollabBlockChangeKind.Added, null, block));
      }
      else if (IsChanged(old, block))
      {
        changes.Add(new CollabBlockChange(id, TypeOf(block), CollabBlockChangeKind.Changed, old, block));
      }
      else if (ParentOf(old) != ParentOf(block) || reordered.Contains(id))
      {
        changes.Add(new CollabBlockChange(id, TypeOf(block), CollabBlockChangeKind.Moved, old, block));
      }
    }

    foreach (var (id, block) in InOrder(before, beforeById))
    {
      if (!afterById.ContainsKey(id))
      {
        changes.Add(new CollabBlockChange(id, TypeOf(block), CollabBlockChangeKind.Removed, block, null));
      }
    }

    return changes;
  }

  /// <summary>
  /// A comparable form of every page and values key. Plain JSON values
  /// compare by content; anything else (a nested Y type) by the item that
  /// holds it, so only a new write reads as a change.
  /// </summary>
  internal static IReadOnlyDictionary<string, string> PageFields(YDoc doc)
  {
    var fields = new Dictionary<string, string>(StringComparer.Ordinal);

    Read(doc.GetMap(PageRoot), "", fields);
    Read(doc.GetMap(ValuesRoot), ValuesPrefix, fields);

    return fields;
  }

  internal static IReadOnlyList<string> Page(
      IReadOnlyDictionary<string, string> before,
      IReadOnlyDictionary<string, string> after)
  {
    return before.Keys
        .Union(after.Keys)
        .Where(key => before.GetValueOrDefault(key) != after.GetValueOrDefault(key))
        .OrderBy(key => key.StartsWith(ValuesPrefix, StringComparison.Ordinal))
        .ThenBy(key => key, StringComparer.Ordinal)
        .ToList();
  }

  private static void Read(YMap map, string prefix, Dictionary<string, string> fields)
  {
    foreach (var key in map.Keys)
    {
      map.TryGet(key, out var value);
      fields[prefix + key] = Fingerprint(value) ?? $"#{map.Map[key].Id.Client}:{map.Map[key].Id.Clock}";
    }
  }

  private static string? Fingerprint(object? value)
  {
    if (value is YAbstractType or YUndefined)
    {
      return null;
    }

    try
    {
      // "=" keeps a JSON text apart from the "#" item ids.
      return "=" + JsJson.Stringify(value);
    }
    catch (ArgumentException)
    {
      return null;
    }
  }

  /// <summary>Ids of matched blocks that keep their parent but leave the longest kept order of its children.</summary>
  private static HashSet<string> Reordered(
      JsonArray before,
      JsonArray after,
      Dictionary<string, JsonObject> beforeById,
      Dictionary<string, JsonObject> afterById)
  {
    var positionBefore = new Dictionary<string, int>(StringComparer.Ordinal);
    var siblingCounts = new Dictionary<string, int>(StringComparer.Ordinal);

    foreach (var (id, block) in InOrder(before, beforeById))
    {
      var parent = ParentOf(block) ?? "";
      var count = siblingCounts.GetValueOrDefault(parent);

      positionBefore[id] = count;
      siblingCounts[parent] = count + 1;
    }

    var afterSiblings = new Dictionary<string, List<string>>(StringComparer.Ordinal);

    foreach (var (id, block) in InOrder(after, afterById))
    {
      if (beforeById.TryGetValue(id, out var old) && ParentOf(old) == ParentOf(block))
      {
        var parent = ParentOf(block) ?? "";

        if (!afterSiblings.TryGetValue(parent, out var siblings))
        {
          siblings = [];
          afterSiblings[parent] = siblings;
        }

        siblings.Add(id);
      }
    }

    var reordered = new HashSet<string>(StringComparer.Ordinal);

    foreach (var ids in afterSiblings.Values)
    {
      var kept = CollabLongestKeptOrder.Of(ids.Select(id => positionBefore[id]).ToList()).ToHashSet();

      for (var index = 0; index < ids.Count; index++)
      {
        if (!kept.Contains(index))
        {
          reordered.Add(ids[index]);
        }
      }
    }

    return reordered;
  }

  /// <summary>First block per id, in array order. An export never repeats an id.</summary>
  private static Dictionary<string, JsonObject> IndexById(JsonArray blocks)
  {
    var byId = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var block in blocks.OfType<JsonObject>())
    {
      if (StringOf(block["id"]) is { } id)
      {
        byId.TryAdd(id, block);
      }
    }

    return byId;
  }

  private static IEnumerable<(string Id, JsonObject Block)> InOrder(
      JsonArray blocks,
      Dictionary<string, JsonObject> byId)
  {
    foreach (var block in blocks.OfType<JsonObject>())
    {
      if (StringOf(block["id"]) is { } id && ReferenceEquals(byId[id], block))
      {
        yield return (id, block);
      }
    }
  }

  private static bool IsChanged(JsonObject before, JsonObject after)
  {
    return TypeOf(before) != TypeOf(after) ||
        !JsonNode.DeepEquals(before["data"], after["data"]) ||
        !JsonNode.DeepEquals(before["tunes"] ?? new JsonObject(), after["tunes"] ?? new JsonObject());
  }

  private static string? TypeOf(JsonObject block) => StringOf(block["type"]);

  private static string? ParentOf(JsonObject block) => StringOf(block["parent"]);

  private static string? StringOf(JsonNode? node)
  {
    return node is JsonValue value && value.GetValueKind() == JsonValueKind.String
      ? value.GetValue<string>()
      : null;
  }
}

/// <summary>One step's export: its blocks, page fields, and the HTML slots of each block.</summary>
internal sealed class StepExport
{
  private readonly Dictionary<JsonObject, List<RichTextHtmlSlot>> slotsByBlock;
  private readonly HashSet<JsonObject> keptBlocks = new(ReferenceEqualityComparer.Instance);

  private StepExport(
      JsonArray blocks,
      IReadOnlyDictionary<string, string> page,
      Dictionary<JsonObject, List<RichTextHtmlSlot>> slotsByBlock)
  {
    Blocks = blocks;
    Page = page;
    this.slotsByBlock = slotsByBlock;
  }

  internal JsonArray Blocks { get; }

  internal IReadOnlyDictionary<string, string> Page { get; }

  internal static StepExport Of(ICollabDocConverter converter, YDoc doc, ISet<string> warned)
  {
    JsonArray blocks;
    IReadOnlyList<RichTextHtmlSlot> slots;

    try
    {
      blocks = converter.ExportBlocks(doc, warned, out slots);
    }
    catch (Exception error) when (error is not (CollabTransientException or OperationCanceledException))
    {
      throw new CollabChangesExportException(error);
    }

    var slotsByBlock = new Dictionary<JsonObject, List<RichTextHtmlSlot>>(ReferenceEqualityComparer.Instance);

    foreach (var slot in slots)
    {
      // A slot sits somewhere inside its block's data; climb to the block.
      JsonNode node = slot.Target;

      while (node.Parent is { } parent && !ReferenceEquals(parent, blocks))
      {
        node = parent;
      }

      if (node is JsonObject block && ReferenceEquals(node.Parent, blocks))
      {
        if (!slotsByBlock.TryGetValue(block, out var owned))
        {
          owned = [];
          slotsByBlock[block] = owned;
        }

        owned.Add(slot);
      }
    }

    return new StepExport(blocks, CollabVersionChanges.PageFields(doc), slotsByBlock);
  }

  internal void Keep(JsonObject? block, HashSet<RichTextHtmlSlot> kept)
  {
    if (block is null)
    {
      return;
    }

    keptBlocks.Add(block);

    if (slotsByBlock.TryGetValue(block, out var owned))
    {
      kept.UnionWith(owned);
    }
  }

  /// <summary>
  /// Takes kept blocks out of this export once no later step reads it, so
  /// they stop holding the whole array alive. Their slots stay valid: a
  /// slot points inside its block.
  /// </summary>
  internal void DetachKept()
  {
    foreach (var block in keptBlocks)
    {
      Blocks.Remove(block);
    }

    keptBlocks.Clear();
  }
}

/// <summary>The converter could not export or read a step; never a transient limit.</summary>
internal sealed class CollabChangesExportException(Exception inner)
    : Exception($"collab: a step of the history could not be exported: {inner.Message}", inner);
