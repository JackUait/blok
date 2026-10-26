using System.Text.Json.Nodes;
using Blok.Server.Collab;

namespace Blok.Server.Agent;

/// <summary>
/// The undo steps of agents in live rooms. A room call carries no session, so the
/// steps belong to one actor in one room, in this process's memory, and go after
/// <see cref="IdleLimit"/> without a call. Each step keeps how its blocks and page
/// keys looked before and after it, so undo writes back only those, and only while
/// nobody else changed them.
/// </summary>
internal sealed class RoomAgentHistory(TimeProvider time)
{
  // Same caps as AGENT_HISTORY_LIMITS in src/shared/agent/document-session.ts.
  internal const int MaxSteps = 100;
  internal const int MaxChars = 4 * 1024 * 1024;
  internal static readonly TimeSpan IdleLimit = TimeSpan.FromHours(1);

  private readonly Dictionary<(string DocId, string ActorId), Steps> rooms = [];

  /// <summary>
  /// One batch: the projection of its blocks and page keys before and after it.
  /// <c>Other</c> is a page action, which wrote another document.
  /// </summary>
  internal sealed class Step
  {
    internal bool Other { get; init; }
    /// <summary>The journal lineage the step was written in; null in a room without a journal.</summary>
    internal string? Lineage { get; set; }
    internal IReadOnlySet<string> Ids { get; init; } = new HashSet<string>(StringComparer.Ordinal);
    internal IReadOnlySet<string> PageKeys { get; init; } = new HashSet<string>(StringComparer.Ordinal);
    internal JsonObject Before { get; set; } = [];
    internal JsonObject After { get; set; } = [];
    /// <summary>The raw page map values: a restore copies them as the room stores them.</summary>
    internal IReadOnlyDictionary<string, object?> PageBefore { get; set; } = new Dictionary<string, object?>();
    internal IReadOnlyDictionary<string, object?> PageAfter { get; set; } = new Dictionary<string, object?>();

    internal int Chars => Before.ToJsonString().Length + After.ToJsonString().Length;
  }

  internal sealed class Steps
  {
    internal List<Step> Done { get; } = [];
    internal List<Step> Undone { get; } = [];
    internal DateTimeOffset LastUsed { get; set; }
  }

  /// <summary>The actor's steps in the room; null when it has none.</summary>
  internal Steps? Find(string docId, string actorId)
  {
    lock (rooms)
    {
      Prune();

      if (!rooms.TryGetValue((docId, actorId), out var steps))
      {
        return null;
      }

      steps.LastUsed = time.GetUtcNow();

      return steps;
    }
  }

  /// <summary>Drops every actor's steps in the room.</summary>
  internal void Forget(string docId)
  {
    lock (rooms)
    {
      foreach (var key in rooms.Keys.Where(key => key.DocId == docId).ToList())
      {
        rooms.Remove(key);
      }
    }
  }

  /// <summary>A new batch: drops the redo side and the oldest steps past the caps.</summary>
  internal void Add(string docId, string actorId, Step step)
  {
    lock (rooms)
    {
      Prune();

      if (!rooms.TryGetValue((docId, actorId), out var steps))
      {
        steps = new Steps();
        rooms[(docId, actorId)] = steps;
      }

      steps.LastUsed = time.GetUtcNow();
      steps.Done.Add(step);

      // A page action leaves the redo side, as the shared executor's marks do.
      if (!step.Other)
      {
        steps.Undone.Clear();
      }

      while (steps.Done.Count + steps.Undone.Count > MaxSteps
          || (steps.Done.Count > 1 && steps.Done.Sum(entry => entry.Chars) + steps.Undone.Sum(entry => entry.Chars) > MaxChars))
      {
        steps.Done.RemoveAt(0);
      }
    }
  }

  private void Prune()
  {
    var now = time.GetUtcNow();

    foreach (var key in rooms.Where(entry => now - entry.Value.LastUsed > IdleLimit).Select(entry => entry.Key).ToList())
    {
      rooms.Remove(key);
    }
  }

  /// <summary>A step from what the batch changed between two exports of the room.</summary>
  internal static Step Between(JsonObject before, CollabPageMaps beforeMaps, JsonObject after, CollabPageMaps afterMaps)
  {
    var was = Shapes(before);
    var now = Shapes(after);
    var ids = new HashSet<string>(StringComparer.Ordinal);

    foreach (var id in was.Keys.Union(now.Keys))
    {
      if (!was.TryGetValue(id, out var a) || !now.TryGetValue(id, out var b) || a != b)
      {
        ids.Add(id);
      }
    }

    var keys = new HashSet<string>(StringComparer.Ordinal);

    foreach (var map in YDocConverter.PageMaps)
    {
      var left = beforeMaps.Maps.GetValueOrDefault(map) ?? new Dictionary<string, object?>();
      var right = afterMaps.Maps.GetValueOrDefault(map) ?? new Dictionary<string, object?>();

      foreach (var key in left.Keys.Union(right.Keys))
      {
        if (Fingerprint(left, key) != Fingerprint(right, key))
        {
          keys.Add($"{map}/{key}");
        }
      }
    }

    return new Step
    {
      Ids = ids,
      PageKeys = keys,
      Before = Project(before, beforeMaps, ids, keys),
      After = Project(after, afterMaps, ids, keys),
      PageBefore = PageValues(beforeMaps, keys),
      PageAfter = PageValues(afterMaps, keys),
    };
  }

  /// <summary>
  /// The step's blocks (whole, with their slot) and page keys as an export has them.
  /// <c>order</c> lists the present blocks in document order, so a restore puts
  /// each one back after a sibling already in place.
  /// </summary>
  internal static JsonObject Project(JsonObject export, CollabPageMaps maps, IReadOnlySet<string> ids, IReadOnlySet<string> keys)
  {
    var blocks = new JsonObject();
    var order = new JsonArray();
    var slots = Slots(export);

    foreach (var block in Blocks(export))
    {
      if (IdOf(block) is { } id && ids.Contains(id))
      {
        order.Add(id);
      }
    }

    foreach (var id in ids.Order(StringComparer.Ordinal))
    {
      var block = Blocks(export).FirstOrDefault(entry => IdOf(entry) == id);

      blocks[id] = block is null
          ? null
          : new JsonObject { ["block"] = Unstamped(block), ["after"] = slots.GetValueOrDefault(id) };
    }

    var page = new JsonObject();

    foreach (var entry in keys.Order(StringComparer.Ordinal))
    {
      var (name, key) = Split(entry);

      page[entry] = Fingerprint(maps.Maps.GetValueOrDefault(name) ?? new Dictionary<string, object?>(), key);
    }

    // Kept beside the projection, not in it: a replay restamps, and the next check must still match.
    var stamps = new JsonObject();

    foreach (var block in Blocks(export))
    {
      if (IdOf(block) is { } id && ids.Contains(id) && block["lastEditedAt"] is not null)
      {
        stamps[id] = new JsonObject { ["at"] = block["lastEditedAt"]?.DeepClone(), ["by"] = block["lastEditedBy"]?.DeepClone(), ["with"] = block["lastEditedWith"]?.DeepClone() };
      }
    }

    return new JsonObject { ["blocks"] = blocks, ["order"] = order, ["page"] = page, ["stamps"] = stamps };
  }

  /// <summary>Whether two projections hold the same blocks, slots and page keys; edit stamps do not count.</summary>
  internal static bool Same(JsonObject left, JsonObject right) =>
      left["blocks"]?.ToJsonString() == right["blocks"]?.ToJsonString()
      && left["order"]?.ToJsonString() == right["order"]?.ToJsonString()
      && left["page"]?.ToJsonString() == right["page"]?.ToJsonString();

  /// <summary>The room as it would be with the step's blocks and page keys as <paramref name="wanted"/> has them.</summary>
  internal static (JsonArray Blocks, CollabPageMaps Maps) Restore(
      JsonObject export, CollabPageMaps maps, Step step, JsonObject wanted, IReadOnlyDictionary<string, object?> page)
  {
    var target = Blocks(export).Where(block => IdOf(block) is not { } id || !step.Ids.Contains(id))
        .Select(block => (JsonObject)block.DeepClone()).ToList();
    var entries = wanted["blocks"] as JsonObject ?? [];

    foreach (var id in (wanted["order"] as JsonArray ?? []).Select(node => node?.GetValue<string>()).OfType<string>())
    {
      if (entries[id] is not JsonObject entry || entry["block"]?.DeepClone() is not JsonObject block)
      {
        continue;
      }

      var parent = block["parent"]?.GetValue<string>();
      var after = entry["after"]?.GetValue<string>();
      var at = after is null ? -1 : target.FindIndex(other => IdOf(other) == after);

      if (at < 0)
      {
        var first = target.FindIndex(other => other["parent"]?.GetValue<string>() == parent);

        at = first < 0 ? target.Count - 1 : first - 1;
      }

      target.Insert(at + 1, block);
    }

    var restored = maps.Maps.ToDictionary(
        entry => entry.Key,
        entry => (IReadOnlyDictionary<string, object?>)entry.Value.ToDictionary(pair => pair.Key, pair => pair.Value),
        StringComparer.Ordinal);

    foreach (var entry in step.PageKeys)
    {
      var (name, key) = Split(entry);
      var map = restored.GetValueOrDefault(name)?.ToDictionary(pair => pair.Key, pair => pair.Value)
          ?? new Dictionary<string, object?>();

      if (page.TryGetValue(entry, out var value))
      {
        map[key] = value;
      }
      else
      {
        map.Remove(key);
      }

      restored[name] = map;
    }

    return (new JsonArray([.. target]), new CollabPageMaps(restored));
  }

  /// <summary>
  /// The edit stamps the wanted blocks had, as ops after the restore: the planner writes
  /// data and structure only, and a stored session's undo brings the stamp back too.
  /// </summary>
  internal static IEnumerable<CollabEditOp> Stamps(JsonObject wanted)
  {
    foreach (var (id, node) in wanted["stamps"] as JsonObject ?? [])
    {
      // The export may hold the time as a long, which TryGetValue<double> refuses.
      if (node is JsonObject stamp && stamp["at"] is JsonValue at
          && double.TryParse(at.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var time)
          && stamp["by"] is JsonValue by && by.TryGetValue<string>(out var editor))
      {
        yield return new CollabEditOp.SetMetadata(id, time, editor, stamp["with"]?.GetValue<string>());
      }
    }
  }

  /// <summary>
  /// The block without its edit stamp: a replay writes the data back but stamps the block
  /// anew, and the next undo must still find it as the step before left it.
  /// </summary>
  private static JsonObject Unstamped(JsonObject block)
  {
    var copy = (JsonObject)block.DeepClone();

    copy.Remove("lastEditedAt");
    copy.Remove("lastEditedBy");
    copy.Remove("lastEditedWith");

    return copy;
  }

  private static IEnumerable<JsonObject> Blocks(JsonObject export) =>
      (export["blocks"] as JsonArray ?? []).OfType<JsonObject>();

  private static string? IdOf(JsonObject block) => block["id"] is JsonValue id && id.TryGetValue<string>(out var text) ? text : null;

  /// <summary>Each block's previous sibling, by parent link and document order.</summary>
  private static Dictionary<string, string?> Slots(JsonObject export)
  {
    var last = new Dictionary<string, string?>(StringComparer.Ordinal);
    var slots = new Dictionary<string, string?>(StringComparer.Ordinal);

    foreach (var block in Blocks(export))
    {
      if (IdOf(block) is not { } id)
      {
        continue;
      }

      var parent = block["parent"]?.GetValue<string>() ?? string.Empty;

      slots[id] = last.GetValueOrDefault(parent);
      last[parent] = id;
    }

    return slots;
  }

  private static Dictionary<string, string> Shapes(JsonObject export)
  {
    var slots = Slots(export);

    return Blocks(export)
        .Where(block => IdOf(block) is not null)
        .GroupBy(block => IdOf(block) ?? string.Empty, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => $"{slots.GetValueOrDefault(group.Key)}\n{Unstamped(group.First()).ToJsonString()}", StringComparer.Ordinal);
  }

  private static (string Map, string Key) Split(string entry)
  {
    var slash = entry.IndexOf('/', StringComparison.Ordinal);

    return (entry[..slash], entry[(slash + 1)..]);
  }

  private static Dictionary<string, object?> PageValues(CollabPageMaps maps, IReadOnlySet<string> keys)
  {
    var values = new Dictionary<string, object?>(StringComparer.Ordinal);

    foreach (var entry in keys)
    {
      var (name, key) = Split(entry);

      if (maps.Maps.GetValueOrDefault(name) is { } map && map.TryGetValue(key, out var value))
      {
        values[entry] = value;
      }
    }

    return values;
  }

  /// <summary>A comparable spelling of a page map value; a shared type only says it is one.</summary>
  private static string Fingerprint(IReadOnlyDictionary<string, object?> map, string key)
  {
    if (!map.TryGetValue(key, out var value))
    {
      return "absent";
    }

    return YDocConverter.IsPlainMapValue(value)
        ? RichText.ToJsonNode(value)?.ToJsonString() ?? "null"
        : $"shared:{value?.GetType().Name}";
  }
}
