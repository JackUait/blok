using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>The raw block structure of a live doc, as the edit planner sees it.</summary>
internal sealed record CollabDocStructure(
    IReadOnlyDictionary<string, CollabKeyShape> Keys,
    IReadOnlyList<string> RootOrder,
    IReadOnlySet<string> ReachedInMainPass);

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
      JsonArray currentBlocks, CollabDocStructure current, JsonArray targetBlocks)
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
    var kept = KeptInPlace(target, exported, current, hasTargetChildren);
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

    foreach (var key in (string[])["type", "data", "tunes", "lastEditedAt", "lastEditedBy"])
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
