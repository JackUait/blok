using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Yjs;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// The agent's undo steps on a live room, as Node keeps them: StoreApplier's
/// steps over a <see cref="LiveUndoManager"/> (store-applier.ts), and the
/// executor's history marks (executor.ts historyStep). Each step also keeps the
/// document pair the bundle saw around it, so the bundle's approval gate checks
/// what the step unlocks or shares exactly as Node recorded it.
/// </summary>
internal sealed class LiveAgentHistory
{
  // AGENT_HISTORY_LIMITS.steps in src/shared/agent/document-session.ts.
  internal const int MaxSteps = 100;


  private readonly LiveRoom room;
  private readonly object origin;
  private readonly Func<RichTextFields> fields;
  private readonly LiveUndoManager undoManager;
  private readonly List<Step> done = [];
  private readonly List<Step> undone = [];
  private readonly List<Mark> past = [];
  private readonly List<Mark> future = [];

  internal LiveAgentHistory(LiveRoom room, object origin, Func<RichTextFields>? fields = null)
  {
    this.room = room;
    this.origin = origin;
    this.fields = fields ?? (() => RichTextFields.BuiltIn);
    var doc = room.Doc;

    undoManager = new LiveUndoManager(
        doc,
        [doc.GetMap("blocks"), doc.GetArray("root"), doc.GetMap("values"), doc.GetMap("page")],
        tracked => ReferenceEquals(tracked, origin),
        (replay, body) => room.WriteLocal(replay, body));
    room.LocalWriteCommitted += write => undoManager.AfterTransaction(write.Origin, write.Transaction);
  }

  /// <summary>'own', 'other' or a restore (executor.ts HistoryMark).</summary>
  private sealed record Mark(string Kind, string? Restored = null);

  private sealed class Step
  {
    internal LiveUndoManager.StackItem? Item { get; set; }
    internal HashSet<string> Ids { get; } = new(StringComparer.Ordinal);
    internal HashSet<string> PlacedOnly { get; } = new(StringComparer.Ordinal);
    internal HashSet<string?> Parents { get; } = [];
    internal string Shape { get; set; } = "";
    /// <summary>The bundle's document and history after the step, or after its last redo.</summary>
    internal required JsonObject UndoGate { get; set; }
    /// <summary>The same after its last undo.</summary>
    internal JsonObject? RedoGate { get; set; }
  }

  /// <summary>What to send the bundle so it checks a history command as Node's executor would.</summary>
  internal sealed record Gate(JsonObject Document, JsonObject History, JsonObject? Refusal);

  /// <summary>
  /// A write batch with edits: <paramref name="write"/> makes its one local write under the
  /// agent origin. <paramref name="gate"/> is the bundle's document and history after it.
  /// </summary>
  internal void Apply(JsonArray edits, Action write, JsonObject gate)
  {
    var step = new Step { UndoGate = gate };
    var before = Blocks();
    var stacked = undoManager.UndoStack.Count;

    Track(edits, before, step);
    write();
    var after = Blocks();

    foreach (var block in before.Concat(after))
    {
      if (Id(block) is { } id && step.Ids.Contains(id))
      {
        step.Parents.Add(ParentOf(block));
      }
    }
    step.Item = undoManager.UndoStack.Count > stacked ? undoManager.UndoStack[^1] : null;
    step.Shape = Shape(step);
    done.Add(step);
    undone.Clear();
    past.Add(new Mark("own"));
    future.Clear();
    // A new step cleared the redo side, so only the oldest done steps can be over the limit.
    while (done.Count > MaxSteps)
    {
      var oldest = done[0];

      done.RemoveAt(0);
      if (oldest.Item is not null)
      {
        undoManager.UndoStack.Remove(oldest.Item);
      }
    }
  }

  /// <summary>
  /// A comment batch: written outside undo, so no step, but the executor still marks it,
  /// so the next undo reverts the step before it (store-applier.ts applyComments).
  /// </summary>
  internal void MarkComment()
  {
    past.Add(new Mark("own"));
    future.Clear();
  }

  /// <summary>A batch that only wrote another document (a host action).</summary>
  internal void MarkOther()
  {
    past.Add(new Mark("other"));
  }

  internal void MarkRestored(string? previous)
  {
    past.Add(new Mark("restored", previous));
    future.Clear();
  }

  internal Gate GateFor(bool undo)
  {
    var last = past.LastOrDefault();

    if (last is { Kind: "restored" })
    {
      // The empty other-mark lets the bundle check the envelope; its answer is then replaced.
      return undo
          ? new Gate(NoStep(), new JsonObject { ["past"] = new JsonArray("other") }, Refusal(
              "UNDO_OTHER_DOCUMENT", "UNDO_RESTORED",
              "The last batch restored a version. history.undo cannot undo a restore."
              + (last.Restored is null ? "" : $" To go back, history.restore \"{last.Restored}\", the version that was current before.")))
          : new Gate(NoStep(), [], Refusal("NOTHING_TO_REDO", "NOTHING_TO_REDO", "The last batch restored a version. There is nothing to redo after it."));
    }
    if (undo && last is { Kind: "other" })
    {
      return new Gate(NoStep(), new JsonObject { ["past"] = new JsonArray("other") }, null);
    }
    var step = undo ? done.LastOrDefault() : undone.LastOrDefault();
    var pair = step is null ? null : undo ? step.UndoGate : step.RedoGate;

    // No step: an empty document, so the gate asks about no locked database (Node's pendingUnlocks is []).
    return pair is null
        ? new Gate(NoStep(), [], null)
        : new Gate((JsonObject)pair["document"]!.DeepClone(), (JsonObject)pair["history"]!.DeepClone(), null);
  }

  /// <summary>
  /// Replays the top step once the bundle let it through (StoreApplier.undo/redo and replay).
  /// <paramref name="gate"/> is the bundle's document and history after its own replay.
  /// Returns the refusal, or null when it ran.
  /// </summary>
  internal JsonObject? Replay(bool undo, JsonObject gate)
  {
    var verb = undo ? "undone" : "redone";
    var step = undo ? done.LastOrDefault() : undone.LastOrDefault();

    if (step is null)
    {
      return undo
          ? Error("NOTHING_TO_UNDO", "This session has no step to undo.", false)
          : Error("NOTHING_TO_REDO", "This session has no undone step to redo.", false);
    }
    var (from, to) = undo ? (undoManager.UndoStack, undoManager.RedoStack) : (undoManager.RedoStack, undoManager.UndoStack);

    // The bundle approved the lock and sharing change from the pair kept on the step; a peer's change to them since would be replayed unasked.
    if ((undo ? step.UndoGate : step.RedoGate) is { } pair && GuardsMoved(pair, undo))
    {
      return Error("CONFLICT", $"Someone else changed the blocks this step added, removed or moved, so it can no longer be {verb}. Re-read the document before retrying.", true);
    }

    // Yjs merges a replay with a peer's text and map writes, but not with a peer's change to the step's blocks.
    if (Shape(step) != step.Shape || (step.Item is not null && (from.Count == 0 || !ReferenceEquals(from[^1], step.Item))))
    {
      return Error("CONFLICT", $"Someone else changed the blocks this step added, removed or moved, so it can no longer be {verb}. Re-read the document before retrying.", true);
    }
    if (step.Item is not null)
    {
      var stacked = to.Count;

      if (undo)
      {
        undoManager.Undo();
      }
      else
      {
        undoManager.Redo();
      }
      // A replay that applied nothing leaves no entry to replay back.
      step.Item = to.Count > stacked ? to[^1] : null;
    }
    step.Shape = Shape(step);
    if (undo)
    {
      step.RedoGate = gate;
      undone.Add(step);
      done.RemoveAt(done.Count - 1);
    }
    else
    {
      step.UndoGate = gate;
      done.Add(step);
      undone.RemoveAt(undone.Count - 1);
    }
    var (marksFrom, marksTo) = undo ? (past, future) : (future, past);
    var moved = marksFrom.LastOrDefault() ?? new Mark("own");

    if (marksFrom.Count > 0)
    {
      marksFrom.RemoveAt(marksFrom.Count - 1);
    }
    marksTo.Add(moved);

    return null;
  }

  /// <summary>
  /// Whether a database lock or view sharing the step changes (its pair's two sides differ)
  /// is no longer as the pair's current side has it.
  /// </summary>
  private bool GuardsMoved(JsonObject pair, bool undo)
  {
    var now = BlocksOf(pair["document"]);
    var target = BlocksOf((pair["history"]?[undo ? "past" : "future"] as JsonArray)?.LastOrDefault());
    var touched = now.Keys.Union(target.Keys).Where(id => Guard(now, id) != Guard(target, id)).ToList();

    if (touched.Count == 0)
    {
      return false;
    }
    var live = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var block in Blocks())
    {
      if (Id(block) is { } id)
      {
        live.TryAdd(id, block);
      }
    }

    return touched.Any(id => Guard(now, id) != Guard(live, id));
  }

  private static Dictionary<string, JsonObject> BlocksOf(JsonNode? document)
  {
    var blocks = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var block in (document?["blocks"] as JsonArray ?? []).OfType<JsonObject>())
    {
      if (Id(block) is { } id)
      {
        blocks.TryAdd(id, block);
      }
    }

    return blocks;
  }

  /// <summary>A database's lock flag and each view's sharing settings, as approval.ts compares them.</summary>
  private static string Guard(Dictionary<string, JsonObject> blocks, string id)
  {
    if (!blocks.TryGetValue(id, out var block) || block["type"] is not JsonValue type || !type.TryGetValue<string>(out var name) || name != "database")
    {
      return "";
    }
    var data = block["data"];
    var locked = (data?["schema"] as JsonArray ?? []).OfType<JsonObject>()
        .Any(property => McpJson.String(property["type"]) == "title" && McpJson.Bool(property["databaseLocked"]) == true);
    var views = (data?["views"] as JsonArray ?? []).OfType<JsonObject>().Select(view =>
    {
      var form = view["form"];

      return new JsonArray(
          view["id"]?.DeepClone(), form?["closed"]?.DeepClone(), form?["public"]?.DeepClone(), form?["anonymous"]?.DeepClone(),
          form?["submissionAccess"]?.DeepClone(), view["calendarSync"]?.DeepClone()).ToJsonString();
    }).Order(StringComparer.Ordinal);

    return $"{locked}\n{string.Join("\n", views)}";
  }

  private static JsonObject NoStep() => new() { ["blocks"] = new JsonArray() };

  private static JsonObject Refusal(string when, string code, string message) => new()
  {
    ["when"] = when,
    ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["commandIndex"] = 0, ["retryable"] = false },
  };

  private static JsonObject Error(string code, string message, bool retryable) => new()
  {
    ["code"] = code,
    ["message"] = message,
    ["retryable"] = retryable,
  };

  /// <summary>The ids StoreApplier.applyOne adds for each structural edit.</summary>
  private static void Track(JsonArray edits, List<JsonObject> before, Step step)
  {
    var children = before.Where(block => Id(block) is not null)
        .ToDictionary(block => Id(block)!, block => (block["content"] as JsonArray ?? []).Select(id => id?.GetValue<string>()).OfType<string>().ToList(), StringComparer.Ordinal);

    void Moved(string id)
    {
      if (step.Ids.Add(id))
      {
        step.PlacedOnly.Add(id);
      }
    }
    void Removed(string id)
    {
      step.Ids.Add(id);
      step.PlacedOnly.Remove(id);
    }
    void Inserted(JsonObject? block)
    {
      if (block?["id"]?.GetValue<string>() is { } id)
      {
        step.Ids.Add(id);
      }
      foreach (var child in block?["children"] as JsonArray ?? [])
      {
        Inserted(child as JsonObject);
      }
    }
    IEnumerable<string> Walk(string id) => children.GetValueOrDefault(id, []).SelectMany(Walk).Append(id);

    foreach (var edit in edits.OfType<JsonObject>())
    {
      var id = edit["id"]?.GetValue<string>();

      switch (edit["op"]?.GetValue<string>())
      {
        case "insert":
          Inserted(edit["block"] as JsonObject);
          break;
        case "remove" when id is not null:
          if (edit["withChildren"]?.GetValue<bool>() == true)
          {
            foreach (var gone in Walk(id))
            {
              Removed(gone);
            }
            break;
          }
          foreach (var child in children.GetValueOrDefault(id, []))
          {
            Moved(child);
          }
          Removed(id);
          break;
        case "move" when id is not null:
          Moved(id);
          break;
        default:
          break;
      }
    }
  }

  private List<JsonObject> Blocks() =>
      [.. YDocConverter.Export(room.Doc, fields(), null, out _).OfType<JsonObject>()];

  private static string? Id(JsonObject block) => block["id"] is JsonValue id && id.TryGetValue<string>(out var text) ? text : null;

  private static string? ParentOf(JsonObject block) => block["parent"] is JsonValue parent && parent.TryGetValue<string>(out var text) ? text : null;

  /// <summary>The step's blocks as the room has them now (a moved one by its slot), with each parent's order of them.</summary>
  private string Shape(Step step)
  {
    var list = Blocks();
    var blocks = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var block in list)
    {
      if (Id(block) is { } id)
      {
        blocks.TryAdd(id, block);
      }
    }
    var roots = list.Where(block => ParentOf(block) is null).Select(Id).OfType<string>().ToList();
    JsonNode? OrderIn(string? parent)
    {
      var order = parent is null
          ? roots
          : blocks.TryGetValue(parent, out var block) && block["content"] is JsonArray content
              ? content.Select(id => id?.GetValue<string>()).OfType<string>().ToList()
              : null;

      return order is null ? null : new JsonArray([.. order.Where(step.Ids.Contains).Select(id => (JsonNode)id)]);
    }

    var shape = new JsonObject
    {
      ["blocks"] = new JsonArray([.. step.Ids.Order(StringComparer.Ordinal).Select(id => !blocks.TryGetValue(id, out var block)
          ? (JsonNode)"gone"
          : step.PlacedOnly.Contains(id) ? Placement(id) : block.DeepClone())]),
      ["parents"] = new JsonArray([.. step.Parents.OrderBy(parent => parent ?? "", StringComparer.Ordinal)
          .Select(parent => (JsonNode)new JsonArray(parent, OrderIn(parent)))]),
    };

    return shape.ToJsonString();
  }

  /// <summary>DocumentStore.getPlacement: the parentId key and the first order array that lists the block.</summary>
  private JsonObject? Placement(string id)
  {
    var blocksMap = room.Doc.GetMap("blocks");

    if (!blocksMap.TryGet(id, out var value) || value is not YMap block)
    {
      return null;
    }
    var parentId = block.TryGet("parentId", out var parent) ? parent as string : null;
    var orders = new List<YArray> { room.Doc.GetArray("root") };

    foreach (var key in blocksMap.Keys)
    {
      if (blocksMap.TryGet(key, out var other) && other is YMap map && map.TryGet("contentIds", out var content) && content is YArray array)
      {
        orders.Add(array);
      }
    }
    foreach (var order in orders)
    {
      var ids = order.Enumerate().ToList();
      var index = ids.IndexOf(id);

      if (index >= 0)
      {
        return new JsonObject { ["parentId"] = parentId, ["afterId"] = index > 0 ? ids[index - 1] as string : null };
      }
    }

    return new JsonObject { ["parentId"] = parentId, ["afterId"] = null };
  }
}
