using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>The raw block structure of a live doc, as the edit planner sees it.</summary>
internal sealed record CollabDocStructure(
    IReadOnlyDictionary<string, CollabKeyShape> Keys,
    IReadOnlyList<string> RootOrder,
    IReadOnlySet<string> ReachedInMainPass);

/// <summary>The top-level keys of a doc's page maps, by map name (see <see cref="YDocConverter.ReadPageMaps"/>).</summary>
internal sealed record CollabPageMaps(IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> Maps);

/// <summary>
/// Who restores and when, in ms since the epoch. With it, a restore trashes a
/// page pointer the target lacks instead of removing it.
/// </summary>
internal sealed record CollabRestoreTrash(string? By, long At);

/// <summary>
/// One key of the blocks map. <paramref name="StoredParent"/> is the raw
/// string parentId of any map entry (null for a non-map), and
/// <paramref name="ListedChildren"/> the string entries of its contentIds
/// (null when there is no array).
/// </summary>
internal sealed record CollabKeyShape(
    bool IsBlock,
    string? StoredParent,
    IReadOnlyList<string>? ListedChildren);

/// <summary>
/// What a <c>databases=keep</c> restore aims at: the target with every kept
/// block as it is now, the kept blocks that exist now, and one guard per
/// kept root the restore would orphan.
/// </summary>
internal sealed record CollabKeptDatabases(
    JsonArray Target,
    IReadOnlySet<string> Pinned,
    IReadOnlyList<CollabRestoreGuard> Orphaned);

/// <summary>
/// Plans a version restore as /edit ops against the live doc: blocks that can
/// stay keep their place, everything else is removed and inserted again. The
/// rules (design doc, section 5) follow what EditPlanner accepts: an insert's
/// <c>after</c> must be a block whose stored parentId is the op's parent and
/// that the parent lists, and a removal takes every key below it by stored
/// parentId.
/// </summary>
internal static class CollabRestorePlanner
{
  internal static IReadOnlyList<CollabEditOp> Plan(
      JsonArray currentBlocks,
      CollabDocStructure current,
      JsonArray targetBlocks,
      CollabPageMaps currentMaps,
      CollabPageMaps targetMaps,
      CollabRestoreTrash? trash = null)
  {
    return Plan(currentBlocks, current, targetBlocks, currentMaps, targetMaps, trash, null);
  }

  /// <summary>
  /// <see cref="Plan(JsonArray, CollabDocStructure, JsonArray, CollabPageMaps, CollabPageMaps, CollabRestoreTrash?)"/>
  /// where every <paramref name="pinned"/> block stays as it is: no op names it.
  /// </summary>
  internal static IReadOnlyList<CollabEditOp> Plan(
      JsonArray currentBlocks,
      CollabDocStructure current,
      JsonArray targetBlocks,
      CollabPageMaps currentMaps,
      CollabPageMaps targetMaps,
      CollabRestoreTrash? trash,
      IReadOnlySet<string>? pinned)
  {
    ArgumentNullException.ThrowIfNull(currentMaps);
    ArgumentNullException.ThrowIfNull(targetMaps);

    var ops = Plan(currentBlocks, current, trash is null ? targetBlocks : WithTrashedPages(currentBlocks, targetBlocks, trash), pinned).ToList();
    var patches = new List<CollabMapPatch>();

    foreach (var name in YDocConverter.PageMaps)
    {
      var live = currentMaps.Maps.GetValueOrDefault(name) ?? new Dictionary<string, object?>();
      var wanted = targetMaps.Maps.GetValueOrDefault(name) ?? new Dictionary<string, object?>();

      foreach (var key in live.Keys.Where(key => !wanted.ContainsKey(key)).Order(StringComparer.Ordinal))
      {
        patches.Add(new CollabMapPatch(name, key, null, Remove: true));
      }

      foreach (var (key, value) in wanted.OrderBy(entry => entry.Key, StringComparer.Ordinal))
      {
        // The client writes plain JSON only; a shared type or undefined here
        // has no copy this server can make, so the live key stays as it is.
        if (!YDocConverter.IsPlainMapValue(value) ||
            (live.TryGetValue(key, out var now) && YDocConverter.PlainMapValuesEqual(now, value)))
        {
          continue;
        }

        patches.Add(new CollabMapPatch(name, key, value, Remove: false));
      }
    }

    if (patches.Count > 0)
    {
      ops.Add(new CollabEditOp.PatchMaps(patches));
    }

    return ops;
  }

  internal static IReadOnlyList<CollabEditOp> Plan(
      JsonArray currentBlocks, CollabDocStructure current, JsonArray targetBlocks, IReadOnlySet<string>? pinned = null)
  {
    ArgumentNullException.ThrowIfNull(currentBlocks);
    ArgumentNullException.ThrowIfNull(current);
    ArgumentNullException.ThrowIfNull(targetBlocks);

    var target = NormalizeTarget(targetBlocks).OfType<JsonObject>().ToList();
    var exported = new Dictionary<string, (JsonObject Block, int Position)>(StringComparer.Ordinal);

    foreach (var block in currentBlocks.OfType<JsonObject>())
    {
      if (IdOf(block) is { } id)
      {
        exported.TryAdd(id, (block, exported.Count));
      }
    }

    var hasTargetChildren = target
        .Select(ParentOf)
        .OfType<string>()
        .ToHashSet(StringComparer.Ordinal);
    // A pinned block is kept whatever the longest run says; the others order around it.
    var kept = KeptInPlace(
        pinned is null ? target : [.. target.Where(block => !pinned.Contains(IdOf(block)!))],
        exported,
        current,
        hasTargetChildren);

    if (pinned is not null)
    {
      kept.UnionWith(pinned.Where(exported.ContainsKey));
    }

    var ops = new List<CollabEditOp>();
    var removed = Removals(currentBlocks, current, kept, ops);

    kept.ExceptWith(removed);

    foreach (var block in target)
    {
      var id = IdOf(block)!;

      if (kept.Contains(id) &&
          Canonical(block["data"]) != Canonical(exported[id].Block["data"]))
      {
        ops.Add(new CollabEditOp.Update(id, block["data"]?.DeepClone() as JsonObject ?? []));
      }
    }

    // Pre-order, so a parent is in place before its first child, and the
    // previous sibling is in place before the next.
    var lastChild = new Dictionary<ParentKey, string>();

    foreach (var block in target)
    {
      var id = IdOf(block)!;
      var parent = new ParentKey(ParentOf(block));
      var after = lastChild.GetValueOrDefault(parent);

      lastChild[parent] = id;

      if (!kept.Contains(id))
      {
        ops.Add(new CollabEditOp.Insert(id, InsertedBlock(block), after, parent.Id));
      }
    }

    return ops;
  }

  /// <summary>
  /// The target plus every live page pointer it lacks, with <c>trashed</c>
  /// set, so the sub-page is not cut off. A pointer keeps its place among
  /// its live siblings; one whose parent the target lacks goes to the end of
  /// the root. A pointer already trashed keeps its stamps.
  /// </summary>
  internal static JsonArray WithTrashedPages(JsonArray currentBlocks, JsonArray targetBlocks, CollabRestoreTrash trash)
  {
    ArgumentNullException.ThrowIfNull(currentBlocks);
    ArgumentNullException.ThrowIfNull(targetBlocks);
    ArgumentNullException.ThrowIfNull(trash);

    var targetIds = targetBlocks.OfType<JsonObject>().Select(IdOf).OfType<string>().ToHashSet(StringComparer.Ordinal);
    var live = currentBlocks.OfType<JsonObject>().Where(block => IdOf(block) is not null).ToList();
    var siblingIndex = new Dictionary<string, (ParentKey Parent, int Index)>(StringComparer.Ordinal);
    var siblingCount = new Dictionary<ParentKey, int>();

    foreach (var block in live)
    {
      var parent = new ParentKey(ParentOf(block));
      var index = siblingCount.GetValueOrDefault(parent);

      siblingIndex.TryAdd(IdOf(block)!, (parent, index));
      siblingCount[parent] = index + 1;
    }

    var result = targetBlocks.Select(node => node?.DeepClone()).ToList();

    foreach (var block in live)
    {
      var id = IdOf(block)!;

      if (TypeOf(block) != "page" || !targetIds.Add(id))
      {
        continue;
      }

      var former = ParentOf(block);
      var data = block["data"] is JsonObject liveData ? (JsonObject)liveData.DeepClone() : [];
      var index = siblingIndex[id].Index;

      if (!IsTrashed(data["trashed"]))
      {
        data["trashed"] = new JsonObject
        {
          ["at"] = trash.At,
          ["by"] = trash.By,
          ["formerParentId"] = former,
          ["formerIndex"] = index,
        };
      }

      var trashed = new JsonObject();

      foreach (var (key, value) in block)
      {
        if (key is not ("parent" or "content" or "data"))
        {
          trashed[key] = value?.DeepClone();
        }
      }

      trashed["data"] = data;

      if (former is null || targetIds.Contains(former))
      {
        if (former is not null)
        {
          trashed["parent"] = former;
        }

        result.Insert(SlotAmongSiblings(result, new ParentKey(former), siblingIndex, index), trashed);
      }
      else
      {
        result.Add(trashed);
      }
    }

    return new JsonArray([.. result]);
  }

  /// <summary>
  /// A <c>trashed</c> the page tool keeps: the same check as its readTrashed,
  /// so a value it would drop is stamped afresh here.
  /// </summary>
  private static bool IsTrashed(JsonNode? node)
  {
    return node is JsonObject trashed &&
        NumberOf(trashed["at"]) is { } at && double.IsFinite(at) &&
        trashed.ContainsKey("by") && IsIdOrNull(trashed["by"]) &&
        trashed.ContainsKey("formerParentId") && IsIdOrNull(trashed["formerParentId"]) &&
        NumberOf(trashed["formerIndex"]) is { } position && position >= 0 && Math.Floor(position) == position;
  }

  private static double? NumberOf(JsonNode? node)
  {
    return node is JsonValue value && value.GetValueKind() == JsonValueKind.Number
      ? double.Parse(value.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture)
      : null;
  }

  private static bool IsIdOrNull(JsonNode? node)
  {
    return node is null || (node is JsonValue value && value.GetValueKind() == JsonValueKind.String);
  }

  /// <summary>
  /// Where in the target list a block goes so that, among the target's
  /// children of <paramref name="parent"/>, it follows every one that sat
  /// before it live.
  /// </summary>
  private static int SlotAmongSiblings(
      List<JsonNode?> target, ParentKey parent, Dictionary<string, (ParentKey Parent, int Index)> siblingIndex, int index)
  {
    int? first = null;
    int? afterLast = null;

    for (var position = 0; position < target.Count; position++)
    {
      if (target[position] is not JsonObject block || new ParentKey(ParentOf(block)) != parent)
      {
        continue;
      }

      first ??= position;

      if (IdOf(block) is { } id && siblingIndex.TryGetValue(id, out var live) && live.Parent == parent && live.Index < index)
      {
        afterLast = position + 1;
      }
    }

    return afterLast ?? first ?? target.Count;
  }

  /// <summary>
  /// A <c>databases=keep</c> restore: every database, on either side, stays as
  /// it is now, with everything below it on either side (rows, row bodies,
  /// comments). One deleted since the point stays deleted; one made since
  /// stays. <see cref="CollabKeptDatabases.Target"/> is the target with the
  /// kept blocks as they are now, each kept root after the nearest sibling
  /// it follows now. A kept root whose parent the restore removes is
  /// orphaned: the restore is refused, never moved.
  /// </summary>
  internal static CollabKeptDatabases KeepDatabases(JsonArray currentBlocks, JsonArray targetBlocks)
  {
    ArgumentNullException.ThrowIfNull(currentBlocks);

    var target = NormalizeTarget(targetBlocks).OfType<JsonObject>().ToList();
    var live = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
    var liveChildren = new Dictionary<ParentKey, List<string>>();
    var targetChildren = new Dictionary<ParentKey, List<string>>();

    // First copy wins, as the planner reads the export.
    foreach (var block in currentBlocks.OfType<JsonObject>())
    {
      if (IdOf(block) is { } id && live.TryAdd(id, block))
      {
        Children(liveChildren, new ParentKey(ParentOf(block))).Add(id);
      }
    }

    foreach (var block in target)
    {
      Children(targetChildren, new ParentKey(ParentOf(block))).Add(IdOf(block)!);
    }

    var kept = new HashSet<string>(StringComparer.Ordinal);
    var pending = new Stack<string>(
        live.Values.Concat(target).Where(block => TypeOf(block) == "database").Select(block => IdOf(block)!));

    while (pending.Count > 0)
    {
      var id = pending.Pop();

      if (!kept.Add(id))
      {
        continue;
      }

      foreach (var child in Children(liveChildren, new ParentKey(id)).Concat(Children(targetChildren, new ParentKey(id))))
      {
        pending.Push(child);
      }
    }

    var restored = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var block in target.Where(block => !kept.Contains(IdOf(block)!)))
    {
      restored[IdOf(block)!] = block;
    }

    var orphaned = new List<CollabRestoreGuard>();
    var orphanParents = new Dictionary<string, string?>(StringComparer.Ordinal);
    var orphanRoots = new List<string>();
    // A kept root goes right after the nearest sibling it follows now that the
    // restore places under the same parent, or first. One pass in current
    // order: each parent's anchor is the last such sibling seen.
    var first = new Dictionary<ParentKey, List<string>>();
    var after = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    var anchors = new Dictionary<ParentKey, string>();

    foreach (var (id, block) in live)
    {
      var parent = ParentOf(block);
      var key = new ParentKey(parent);

      if (!kept.Contains(id))
      {
        if (restored.TryGetValue(id, out var placedBlock) && ParentOf(placedBlock) == parent)
        {
          anchors[key] = id;
        }

        continue;
      }

      if (parent is not null && kept.Contains(parent) && live.ContainsKey(parent))
      {
        continue;
      }

      if (parent is not null && !restored.ContainsKey(parent))
      {
        orphaned.Add(new CollabRestoreGuard(OrphanedDatabase, id));
        orphanParents[id] = null;
        orphanRoots.Add(id);

        continue;
      }

      if (anchors.TryGetValue(key, out var anchor))
      {
        (after.TryGetValue(anchor, out var list) ? list : after[anchor] = []).Add(id);
      }
      else
      {
        Children(first, key).Add(id);
      }

      anchors[key] = id;
    }

    var placed = new Dictionary<ParentKey, List<string>>();

    // Each id, then the roots that follow it, depth first; a stack, since a run of kept roots can be long.
    void Follow(ParentKey key, IReadOnlyList<string> ids)
    {
      var stack = new Stack<string>(ids.Reverse());

      while (stack.Count > 0)
      {
        var id = stack.Pop();

        Children(placed, key).Add(id);

        if (after.TryGetValue(id, out var next))
        {
          for (var index = next.Count - 1; index >= 0; index--)
          {
            stack.Push(next[index]);
          }
        }
      }
    }

    foreach (var (key, ids) in first)
    {
      Follow(key, ids);
    }

    foreach (var block in target)
    {
      if (restored.ContainsKey(IdOf(block)!))
      {
        Follow(new ParentKey(ParentOf(block)), [IdOf(block)!]);
      }
    }

    Children(placed, new ParentKey(null)).AddRange(orphanRoots);

    var blocks = new JsonArray();
    var byId = target.ToDictionary(block => IdOf(block)!, StringComparer.Ordinal);
    var walk = new Stack<string>(Enumerable.Reverse(Children(placed, new ParentKey(null))));

    while (walk.Count > 0)
    {
      var id = walk.Pop();
      var children = kept.Contains(id)
        ? Children(liveChildren, new ParentKey(id))
        : Children(placed, new ParentKey(id));

      if (kept.Contains(id))
      {
        var copy = live[id].DeepClone().AsObject();

        if (orphanParents.ContainsKey(id))
        {
          copy.Remove("parent");
        }

        blocks.Add(copy);
      }
      else
      {
        blocks.Add(byId[id].DeepClone());
      }

      for (var index = children.Count - 1; index >= 0; index--)
      {
        walk.Push(children[index]);
      }
    }

    return new CollabKeptDatabases(
        blocks,
        kept.Where(live.ContainsKey).ToHashSet(StringComparer.Ordinal),
        orphaned);
  }

  /// <summary>The guard kind of a kept database whose parent the restore removes. Never confirmable.</summary>
  internal const string OrphanedDatabase = "orphanedDatabase";

  /// <summary>
  /// The target as a restore reproduces it: a parent naming no target block
  /// becomes root, blocks come in pre-order (roots and siblings in target
  /// order), <c>content</c> is rebuilt from the parent links, and empty
  /// <c>tunes</c> are dropped, as the export drops them.
  /// </summary>
  internal static JsonArray NormalizeTarget(JsonArray targetBlocks)
  {
    ArgumentNullException.ThrowIfNull(targetBlocks);

    var blocks = new List<JsonObject>();
    var ids = new HashSet<string>(StringComparer.Ordinal);

    foreach (var block in targetBlocks.OfType<JsonObject>())
    {
      if (IdOf(block) is { } id && ids.Add(id))
      {
        blocks.Add(block);
      }
    }

    var parents = new Dictionary<string, string?>(StringComparer.Ordinal);
    var children = new Dictionary<ParentKey, List<string>>();

    foreach (var block in blocks)
    {
      var id = IdOf(block)!;
      var parent = ParentOf(block) is { } named && named != id && ids.Contains(named) ? named : null;

      parents[id] = parent;
    }

    var byId = blocks.ToDictionary(block => IdOf(block)!, StringComparer.Ordinal);
    var ordered = new List<string>();
    var seen = new HashSet<string>(StringComparer.Ordinal);

    foreach (var block in blocks)
    {
      Children(children, new ParentKey(parents[IdOf(block)!])).Add(IdOf(block)!);
    }

    // Roots first; a block still unreached sits on a parent cycle and is
    // made a root, which breaks the cycle at its first member in target order.
    var starts = Children(children, new ParentKey(null))
        .ToList()
        .Concat(blocks.Select(block => IdOf(block)!));

    foreach (var start in starts)
    {
      if (seen.Contains(start))
      {
        continue;
      }

      parents[start] = null;

      var pending = new Stack<string>([start]);

      // Iterative: nesting depth is the document's, not ours to bound.
      while (pending.Count > 0)
      {
        var id = pending.Pop();

        if (!seen.Add(id))
        {
          continue;
        }

        ordered.Add(id);

        var below = Children(children, new ParentKey(id));

        for (var index = below.Count - 1; index >= 0; index--)
        {
          pending.Push(below[index]);
        }
      }
    }

    var normalized = new JsonArray();

    foreach (var id in ordered)
    {
      var block = new JsonObject();

      foreach (var (key, value) in byId[id])
      {
        if (key is "parent" or "content" ||
            (key == "tunes" && value is JsonObject { Count: 0 }))
        {
          continue;
        }

        block[key] = value?.DeepClone();
      }

      if (parents[id] is { } parent)
      {
        block["parent"] = parent;
      }

      // A cycle member made root is still in its old parent's list.
      var content = Children(children, new ParentKey(id))
          .Where(child => parents[child] == id)
          .Select(child => (JsonNode?)child)
          .ToArray();

      if (content.Length > 0)
      {
        block["content"] = new JsonArray(content);
      }

      normalized.Add(block);
    }

    return normalized;
  }

  /// <summary>
  /// Steps 2 and 3: per target parent, the anchorable current blocks under
  /// the same parent with the same type and tunes, cut to the longest run
  /// whose current positions increase.
  /// </summary>
  private static HashSet<string> KeptInPlace(
      List<JsonObject> target,
      Dictionary<string, (JsonObject Block, int Position)> exported,
      CollabDocStructure current,
      HashSet<string> hasTargetChildren)
  {
    var rootOrder = current.RootOrder.ToHashSet(StringComparer.Ordinal);
    var listed = new Dictionary<string, HashSet<string>?>(StringComparer.Ordinal);
    var groups = new Dictionary<ParentKey, List<string>>();

    foreach (var block in target)
    {
      var id = IdOf(block)!;

      if (!exported.TryGetValue(id, out var live) ||
          !current.Keys.TryGetValue(id, out var shape) ||
          !shape.IsBlock ||
          !current.ReachedInMainPass.Contains(id))
      {
        continue;
      }

      var parent = ParentOf(live.Block);

      if (parent != ParentOf(block) ||
          shape.StoredParent != parent ||
          !ListsIt(parent, id, current, rootOrder, listed) ||
          TypeOf(live.Block) != TypeOf(block) ||
          Canonical(live.Block["tunes"] ?? new JsonObject()) != Canonical(block["tunes"] ?? new JsonObject()) ||
          (hasTargetChildren.Contains(id) && shape.ListedChildren is null))
      {
        continue;
      }

      Children(groups, new ParentKey(parent)).Add(id);
    }

    var kept = new HashSet<string>(StringComparer.Ordinal);

    foreach (var group in groups.Values)
    {
      foreach (var index in CollabLongestKeptOrder.Of(group.Select(id => exported[id].Position).ToList()))
      {
        kept.Add(group[index]);
      }
    }

    return kept;
  }

  private static bool ListsIt(
      string? parent,
      string id,
      CollabDocStructure current,
      HashSet<string> rootOrder,
      Dictionary<string, HashSet<string>?> listed)
  {
    if (parent is null)
    {
      return rootOrder.Contains(id);
    }

    if (!listed.TryGetValue(parent, out var children))
    {
      children = current.Keys.GetValueOrDefault(parent)?.ListedChildren?.ToHashSet(StringComparer.Ordinal);
      listed[parent] = children;
    }

    return children?.Contains(id) == true;
  }

  /// <summary>
  /// Step 4: every key that does not stay is removed. The removed set
  /// mirrors EditPlanner's walk over stored parentId, so a remove is never
  /// emitted for an id an earlier remove already took (that request would be
  /// refused).
  /// </summary>
  private static HashSet<string> Removals(
      JsonArray currentBlocks,
      CollabDocStructure current,
      HashSet<string> kept,
      List<CollabEditOp> ops)
  {
    var below = new Dictionary<string, List<string>>(StringComparer.Ordinal);

    foreach (var (id, shape) in current.Keys)
    {
      if (shape.StoredParent is { } parent)
      {
        if (!below.TryGetValue(parent, out var bucket))
        {
          bucket = [];
          below[parent] = bucket;
        }

        bucket.Add(id);
      }
    }

    // Export order first, so a parent's remove usually covers its children.
    var marked = currentBlocks
        .OfType<JsonObject>()
        .Select(IdOf)
        .OfType<string>()
        .Where(current.Keys.ContainsKey)
        .Concat(current.Keys.Keys.Order(StringComparer.Ordinal))
        .Where(id => !kept.Contains(id))
        .Distinct(StringComparer.Ordinal);
    var removed = new HashSet<string>(StringComparer.Ordinal);

    foreach (var id in marked)
    {
      if (!removed.Add(id))
      {
        continue;
      }

      ops.Add(new CollabEditOp.Remove(id));

      var pending = new Queue<string>([id]);

      while (pending.Count > 0)
      {
        foreach (var child in below.GetValueOrDefault(pending.Dequeue()) ?? [])
        {
          if (removed.Add(child))
          {
            pending.Enqueue(child);
          }
        }
      }
    }

    return removed;
  }

  private static JsonObject InsertedBlock(JsonObject block)
  {
    // Never parent or content: the op owns the position, and a content
    // list would be written as contentIds and linked twice.
    var inserted = new JsonObject();

    foreach (var key in (string[])["type", "data", "tunes", "lastEditedAt", "lastEditedBy", "lastEditedWith", "createdAt", "createdBy", "createdWith"])
    {
      if (block.TryGetPropertyValue(key, out var value))
      {
        inserted[key] = value?.DeepClone();
      }
    }

    return inserted;
  }

  private static List<string> Children(Dictionary<ParentKey, List<string>> children, ParentKey parent)
  {
    if (!children.TryGetValue(parent, out var list))
    {
      list = [];
      children[parent] = list;
    }

    return list;
  }

  private static string? IdOf(JsonObject block)
  {
    return StringOf(block["id"]);
  }

  private static string? ParentOf(JsonObject block)
  {
    return StringOf(block["parent"]);
  }

  private static string? TypeOf(JsonObject block)
  {
    return StringOf(block["type"]);
  }

  private static string? StringOf(JsonNode? node)
  {
    return node is JsonValue value && value.GetValueKind() == JsonValueKind.String
      ? value.GetValue<string>()
      : null;
  }

  /// <summary>JSON with object keys sorted at every level, so key order never reads as a change.</summary>
  private static string Canonical(JsonNode? node)
  {
    var builder = new StringBuilder();

    Write(node, builder);

    return builder.ToString();
  }

  private static void Write(JsonNode? node, StringBuilder builder)
  {
    switch (node)
    {
      case JsonObject entries:
        builder.Append('{');

        var first = true;

        foreach (var (key, value) in entries.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
          if (!first)
          {
            builder.Append(',');
          }

          first = false;
          builder.Append(JsonValue.Create(key).ToJsonString()).Append(':');
          Write(value, builder);
        }

        builder.Append('}');

        break;

      case JsonArray items:
        builder.Append('[');

        for (var index = 0; index < items.Count; index++)
        {
          if (index > 0)
          {
            builder.Append(',');
          }

          Write(items[index], builder);
        }

        builder.Append(']');

        break;

      default:
        builder.Append(node?.ToJsonString() ?? "null");

        break;
    }
  }

  /// <summary>A parent id where null is the root, usable as a dictionary key.</summary>
  private readonly record struct ParentKey(string? Id);
}
